"use node";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { scrapeZillowJson, scrapeRedfinMarkdown } from "./monitorScrape";
import {
  MONITOR,
  buildSearchUrl,
  extractNextData,
  listingsFromSearch,
  totalResultCount,
  detailFromCache,
  conservativeArv,
  inferRehabTier,
  estimateRehab,
  analyzeFlip,
  analyzeRental,
  scoreDeal,
  decideKeeper,
  riskFlags,
  buildJudgePrompt,
  parseJudgeResponse,
  type SearchListing,
  type JudgeVerdict,
} from "../src/scraper/monitorListings";
import { REHAB_TIERS, FLIP_DEFAULTS } from "../src/scraper/flip";
import { parseZip, parseRedfinComps, type Comp } from "../src/scraper/comps";

// "Monitor the Web" (Zillow NCC deal-finder) — the "use node" action layer:
// scan → per-listing enrich → keeper decision. ONE shared scan path (webhook /
// cron / manual). Mirrors sheriffActions (run created first + always finalized +
// staggered fan-out) and equityActions (capped enrich + lastError). Strictly
// additive. Spec: docs/superpowers/specs/2026-06-30-monitor-web-zillow-design.md.

type ScanResult = { scanned: number; newCount: number; keeperCount: number };

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LLM_MODEL = process.env.MONITOR_LLM_MODEL ?? "deepseek/deepseek-v3.2";
const STAGGER_MS = 3000; // per-listing analyze fan-out (mirror sheriff enrich)
// Buffer after the last analyzeOne is scheduled before the digest fires. Each
// analyzeOne is slow (spaced Zillow retries + comps + DeepSeek), so leave room.
const DIGEST_BUFFER_MS = 90_000;

function fcKey(): string {
  const k = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!k) throw new ConvexError({ code: "CONFIG", message: "FIRECRAWL_API_KEY is not set" });
  return k;
}

// Only send defined, non-null values — Convex `v.optional(...)` accepts a missing
// key, NOT an explicit null. The search card carries many nullable fields.
function upsertArgsFromCard(l: SearchListing) {
  return {
    zpid: l.zpid,
    source: "zillow" as const,
    url: l.url,
    address: l.address,
    ...(l.zip ? { propZip: l.zip } : {}),
    ...(l.lat != null ? { lat: l.lat } : {}),
    ...(l.lng != null ? { lng: l.lng } : {}),
    ...(l.price != null ? { listPrice: l.price } : {}),
    ...(l.beds != null ? { beds: l.beds } : {}),
    ...(l.baths != null ? { baths: l.baths } : {}),
    ...(l.sqft != null ? { sqft: l.sqft } : {}),
    ...(l.ppsf != null ? { ppsf: l.ppsf } : {}),
    ...(l.homeType ? { homeType: l.homeType } : {}),
    ...(l.daysOnZillow != null ? { daysOnZillow: l.daysOnZillow } : {}),
    ...(l.zestimate != null ? { zestimate: l.zestimate } : {}),
  };
}

/**
 * DeepSeek (via OpenRouter) text-only judge — condition/distress from the
 * description, never the numbers (those are computed deterministically). Mirrors
 * the OpenRouter call in conditionActions. Returns null on ANY failure (no key /
 * HTTP / timeout / unparseable) so the deterministic keep-gate still decides.
 */
async function judgeWithDeepSeek(rec: unknown): Promise<JudgeVerdict | null> {
  const orKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!orKey) return null;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: buildJudgePrompt(rec) }],
        temperature: 0,
        max_tokens: 600,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseJudgeResponse(json.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

// Best-effort per-zip comps cache (module-level; scheduled analyzeOne calls may
// run in separate isolates → often a cold Map — do NOT rely on it for correctness,
// it just avoids a duplicate Redfin scrape within one warm isolate). Keyed by zip
// with a short TTL so a reused isolate can't serve stale comps days later. (The
// spec's `${runId}:${zip}` key isn't possible here — analyzeOne only gets {id}.)
const COMPS_TTL_MS = 30 * 60_000;
const compsCache = new Map<string, { comps: Comp[]; at: number }>();
async function compsForZip(zip: string, apiKey: string): Promise<Comp[]> {
  const hit = compsCache.get(zip);
  if (hit && Date.now() - hit.at < COMPS_TTL_MS) return hit.comps;
  const md = await scrapeRedfinMarkdown(zip, apiKey);
  const comps = md ? parseRedfinComps(md) : [];
  compsCache.set(zip, { comps, at: Date.now() });
  return comps;
}

/**
 * The shared scan path for every trigger (webhook / cron / manual). Scrapes the
 * NCC newest-listings search (paginated), rule-filters, upserts each survivor,
 * fans out analyzeOne for new/price-dropped rows (staggered), schedules the
 * digest, and always finalizes the run row (mirrors the sheriff run lifecycle).
 */
export const runMonitorScan = internalAction({
  args: {
    trigger: v.union(v.literal("webhook"), v.literal("cron"), v.literal("manual")),
    content: v.optional(v.string()),
    maxPages: v.optional(v.number()),
  },
  handler: async (ctx, { trigger, content, maxPages }): Promise<ScanResult> => {
    // TODO(Task 13): when trigger === "cron", no-op if a successful monitorRuns
    // row exists in the last ~20h (the daily safety net shouldn't double-run).
    const apiKey = fcKey();
    const runId = await ctx.runMutation(internal.monitorData.createRun, {
      trigger,
      source: "zillow",
    });

    let scanned = 0;
    let newCount = 0;
    try {
      // 1) Paginated search scrape → accumulate survivors.
      const survivors: SearchListing[] = [];
      let total: number | null = null;
      const pages = maxPages ?? 5;
      for (let page = 1; page <= pages; page++) {
        let nextData: any | null = null;
        if (page === 1 && content) nextData = extractNextData(content);
        if (!nextData) nextData = await scrapeZillowJson(buildSearchUrl({ page }), apiKey);
        if (!nextData) break;

        const listings = listingsFromSearch(nextData);
        if (listings.length === 0) break;
        scanned += listings.length;
        if (total == null) total = totalResultCount(nextData);

        for (const l of listings) {
          if (
            l.isNewConstruction ||
            l.isZillowOwned ||
            // $0/placeholder-price foreclosure/auction listings have no underwritable purchase price -> mirage 100% spread; exclude.
            l.price == null ||
            l.price < MONITOR.minListPrice ||
            l.price > MONITOR.priceCeiling
          ) {
            continue;
          }
          survivors.push(l);
        }
        if (total != null && scanned >= total) break;
      }

      // 2) Upsert survivors; fan out analyzeOne for new / price-dropped rows.
      let scheduled = 0;
      for (const l of survivors) {
        const up = await ctx.runMutation(internal.monitorData.upsertListing, upsertArgsFromCard(l));
        if (up.isNew) newCount++;
        if (up.isNew || up.priceDropped) {
          await ctx.scheduler.runAfter(scheduled * STAGGER_MS, internal.monitorActions.analyzeOne, {
            id: up.id,
          });
          scheduled++;
        }
      }

      // 3) Digest after the fan-out window (stub for now — Task 12 fills Resend).
      await ctx.scheduler.runAfter(
        scheduled * STAGGER_MS + DIGEST_BUFFER_MS,
        internal.monitorActions.sendDigest,
        { runId },
      );

      await ctx.runMutation(internal.monitorData.finishRun, {
        id: runId,
        status: "complete",
        scanned,
        newCount,
        analyzedCount: 0, // filled by the async analyzeOne fan-out (Task 12 may bump)
        keeperCount: 0,
        emailedCount: 0,
      });
      return { scanned, newCount, keeperCount: 0 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.monitorData.finishRun, {
        id: runId,
        status: "failed",
        scanned,
        newCount,
        analyzedCount: 0,
        keeperCount: 0,
        emailedCount: 0,
        error: message,
      });
      await ctx.runMutation(internal.errors.logServerError, {
        message: `runMonitorScan failed: ${message}`,
        context: "monitorActions.runMonitorScan",
      });
      return { scanned, newCount, keeperCount: 0 };
    }
  },
});

/**
 * Enrich one discovered listing: detail scrape → comps → conservative ARV →
 * rehab tier → multi-exit (flip + rental) → deal score → off-market cross-ref →
 * DeepSeek judge → keeper decision. Patches the row `analyzed` (or `failed` +
 * lastError on a thrown error). Runs as a scheduled action (no user identity).
 */
export const analyzeOne = internalAction({
  args: { id: v.id("monitorListings") },
  handler: async (ctx, { id }): Promise<void> => {
    try {
      const row = await ctx.runQuery(internal.monitorData.getListingInternal, { id });
      if (!row) return;

      const apiKey = fcKey();

      // 1) Detail scrape (embedded JSON). null → card-data fallback (VERIFY).
      const detailData = await scrapeZillowJson(row.url, apiKey);
      const detail = detailData ? detailFromCache(detailData) : null;
      const detailOk = detail != null;

      // 2) Resolve the facts used for the math (detail corrects/fills the card).
      const listPrice = row.listPrice ?? null;
      const sqft = row.sqft ?? null;
      const bedsNum = typeof row.beds === "number" ? row.beds : null;
      const homeType = detail?.homeType ?? row.homeType;
      const description = detail?.description || row.description || "";
      const zestimate = detail?.zestimate ?? row.zestimate ?? null;
      const rentZestimate = detail?.rentZestimate ?? row.rentZestimate ?? null;
      const zip = row.propZip ?? parseZip(row.address) ?? undefined;

      // 3) Comps → conservative ARV (comps median $/sqft, capped vs Zestimate).
      const comps = zip ? await compsForZip(zip, apiKey) : [];
      const arvRes = conservativeArv({ comps, sqft, beds: bedsNum, zestimate, homeType });
      const arv = arvRes.arv;

      // 4) Rehab tier + estimate.
      const rehabTier = inferRehabTier(description);
      const rehab = estimateRehab(REHAB_TIERS[rehabTier].perSqft, sqft, FLIP_DEFAULTS.contingencyPct);
      const rehabTotal = rehab.total ?? 0;

      // 5) Below-market spread (conservative ARV vs list).
      const spread = arv != null && listPrice != null ? arv - listPrice : null;
      const spreadPct = spread != null && arv ? +(((spread) / arv) * 100).toFixed(1) : null;
      const belowMarket = spreadPct != null && spreadPct >= MONITOR.spreadThreshold * 100;

      // 6) Multi-exit underwriting + score.
      const flip = analyzeFlip(arv, listPrice, rehabTotal);
      const rental = analyzeRental({ rent: rentZestimate, list: listPrice ?? 0, rehab: rehabTotal });
      const score = scoreDeal(flip, rental);

      // 7) Risk flags (all from the scraped JSON).
      const flags = riskFlags({
        homeType,
        monthlyHoaFee: detail?.monthlyHoaFee ?? row.monthlyHoaFee ?? null,
        description,
        rehabTier,
        zestimate,
        compsArv: arvRes.source === "comps" ? arv : null,
        detailOk,
      });

      // 8) Off-market cross-reference (internal query — no user identity).
      const offMarket = await ctx.runQuery(internal.monitorData.offMarketForInternal, {
        address: row.address,
        ...(zip ? { zip } : {}),
      });

      // 9) DeepSeek judge (may be null — the deterministic gate still decides).
      const verdict = await judgeWithDeepSeek({
        address: row.address,
        listPrice,
        conservativeArv: arv,
        spreadPct,
        rehabTier,
        flipMarginPct: flip && flip.margin != null ? +(flip.margin * 100).toFixed(1) : null,
        capRatePct: rental ? +(rental.capRate * 100).toFixed(1) : null,
        homeType,
        description,
      });

      // 10) Keeper decision (deterministic OR + AI distress).
      const distress =
        !!verdict?.matchedRequirements.includes("distressed") ||
        !!detail?.foreclosure ||
        !!verdict?.keep;
      const keeper = decideKeeper({ belowMarket, flip, rental, distress });

      const matched = new Set<string>(verdict?.matchedRequirements ?? []);
      if (belowMarket) matched.add("below_market");

      // 11) Patch everything + status:"analyzed" (omit null-valued optionals).
      await ctx.runMutation(internal.monitorData.patchAnalysis, {
        id,
        fields: {
          status: "analyzed" as const,
          arvSource: arvRes.source,
          compsCount: arvRes.compsCount,
          rehabTier,
          belowMarket,
          keeper,
          aiKeep: verdict?.keep ?? false,
          matchedRequirements: [...matched],
          riskFlags: flags,
          dealScore: score.dealScore,
          bestExit: score.bestExit,
          aiModel: LLM_MODEL,
          ...(arv != null ? { conservativeArv: arv } : {}),
          ...(arvRes.compsPpsf != null ? { compsPpsf: arvRes.compsPpsf } : {}),
          ...(spread != null ? { spread } : {}),
          ...(spreadPct != null ? { spreadPct } : {}),
          ...(rehab.total != null ? { rehabEstimate: Math.round(rehab.total) } : {}),
          ...(flip
            ? {
                ...(flip.mao != null ? { flipMao: Math.round(flip.mao) } : {}),
                ...(flip.profit != null ? { flipProfit: Math.round(flip.profit) } : {}),
                ...(flip.margin != null ? { flipMargin: flip.margin } : {}),
                ...(flip.roi != null ? { flipRoi: flip.roi } : {}),
                ...(flip.roomVsList != null ? { roomVsList: flip.roomVsList } : {}),
              }
            : {}),
          ...(rental
            ? {
                capRate: rental.capRate,
                cashFlow: rental.cashFlow,
                onePctRule: rental.onePct,
                cashOnCash: rental.cashOnCash,
              }
            : {}),
          ...(verdict
            ? {
                aiReason: verdict.reason,
                aiConditionNotes: verdict.conditionNotes,
                aiConfidence: verdict.confidence,
              }
            : {}),
          ...(offMarket
            ? {
                offMarketPrclid: offMarket.prclid,
                offMarketSignals: offMarket.signals,
                ...(offMarket.balances != null ? { offMarketBalances: offMarket.balances } : {}),
                ...(offMarket.conditionScore != null
                  ? { offMarketConditionScore: offMarket.conditionScore }
                  : {}),
              }
            : {}),
          // detail-derived facts (only-if present; never clobber with null)
          ...(detail
            ? {
                ...(detail.description ? { description: detail.description.slice(0, 4000) } : {}),
                ...(detail.homeType ? { homeType: detail.homeType } : {}),
                ...(detail.yearBuilt != null ? { yearBuilt: detail.yearBuilt } : {}),
                ...(detail.zestimate != null ? { zestimate: detail.zestimate } : {}),
                ...(detail.rentZestimate != null ? { rentZestimate: detail.rentZestimate } : {}),
                ...(detail.lastSoldPrice != null ? { lastSoldPrice: detail.lastSoldPrice } : {}),
                ...(detail.dateSold ? { lastSoldDate: detail.dateSold } : {}),
                ...(detail.monthlyHoaFee != null ? { monthlyHoaFee: detail.monthlyHoaFee } : {}),
                ...(detail.daysOnZillow != null ? { daysOnZillow: detail.daysOnZillow } : {}),
                ...(detail.agentName ? { agentName: detail.agentName } : {}),
                ...(detail.agentPhone ? { agentPhone: detail.agentPhone } : {}),
                ...(detail.brokerName ? { brokerName: detail.brokerName } : {}),
                ...(detail.mlsId ? { mlsId: detail.mlsId } : {}),
                ...(detail.priceHistory?.length ? { priceHistory: detail.priceHistory } : {}),
                ...(detail.photoUrls?.length ? { photoUrls: detail.photoUrls } : {}),
              }
            : {}),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.monitorData.patchAnalysis, {
        id,
        fields: { status: "failed" as const, lastError: message.slice(0, 500) },
      });
    }
  },
});

/**
 * Email the run's keepers. MINIMAL STUB for now — Task 12 fills in Resend
 * (key-gated, no-op without RESEND_API_KEY). It exists so runMonitorScan's
 * scheduler reference typechecks.
 */
export const sendDigest = internalAction({
  args: { runId: v.id("monitorRuns") },
  handler: async (_ctx, _args): Promise<{ sent: boolean }> => {
    // TODO(Task 12): build the keeper digest (address, list price, comps value,
    // spread %, matched requirements, reason, links) and send via Resend.
    return { sent: false };
  },
});

/**
 * DEV-ONLY manual trigger (CLI). Inert unless IRES_DEV=1. `maxPages` lets a smoke
 * test run a cheap single page instead of the full 5.
 */
export const devMonitorScan = action({
  args: { maxPages: v.optional(v.number()) },
  handler: async (ctx, { maxPages }): Promise<ScanResult> => {
    if (process.env.IRES_DEV !== "1") {
      throw new ConvexError({ code: "FORBIDDEN", message: "devMonitorScan is dev-only (set IRES_DEV=1)" });
    }
    return ctx.runAction(internal.monitorActions.runMonitorScan, {
      trigger: "manual",
      ...(maxPages != null ? { maxPages } : {}),
    });
  },
});
