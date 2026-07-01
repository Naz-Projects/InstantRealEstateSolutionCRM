"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
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
const RESEND_URL = "https://api.resend.com/emails";
const FIRECRAWL_V2_MONITOR_URL = "https://api.firecrawl.dev/v2/monitor";
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
    // Cron 20h no-op guard: the daily safety net only fills in when the webhook
    // didn't fire. If a COMPLETE run already finished/started within the last 20h,
    // skip entirely (no run row, no scrape). Only the cron is guarded — webhook /
    // manual always run.
    if (trigger === "cron") {
      const recent = await ctx.runQuery(internal.monitorData.mostRecentCompleteRun, {});
      if (recent) {
        const ts = recent.finishedAt ?? recent.startedAt;
        if (Date.now() - ts < 20 * 60 * 60 * 1000) {
          return { scanned: 0, newCount: 0, keeperCount: 0 };
        }
      }
    }
    const runId = await ctx.runMutation(internal.monitorData.createRun, {
      trigger,
      source: "zillow",
    });

    let scanned = 0;
    let newCount = 0;
    try {
      // A missing key throws here — inside the try, so the catch below finalizes
      // this run as "failed" + logs it, instead of leaving no run row at all.
      const apiKey = fcKey();
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
        !!detail?.foreclosure;
      const keeper = decideKeeper({ belowMarket, flip, rental, distress, spread, dealScore: score.dealScore });

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

// ---- digest formatting (pure helpers for sendDigest) ----

type Keeper = Doc<"monitorListings">;

const money = (n: number | null | undefined): string =>
  n == null ? "n/a" : `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number | null | undefined): string =>
  n == null ? "n/a" : `${n.toFixed(1)}%`;
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// MAO for a flip exit, cap rate for a rental exit (fall back to whichever the row has).
function exitDetail(row: Keeper): string {
  if (row.bestExit === "RENTAL" && row.capRate != null) return `Cap rate ${(row.capRate * 100).toFixed(1)}%`;
  if (row.flipMao != null) return `MAO ${money(row.flipMao)}`;
  if (row.capRate != null) return `Cap rate ${(row.capRate * 100).toFixed(1)}%`;
  return "";
}

function metricBits(row: Keeper): string[] {
  return [
    row.bestExit ? `Best exit: ${row.bestExit}` : "",
    row.dealScore != null ? `Deal score: ${row.dealScore}` : "",
    row.spreadPct != null ? `Spread: ${pct(row.spreadPct)}` : "",
    exitDetail(row),
  ].filter(Boolean);
}

function keeperText(row: Keeper, monitorLink: string, i: number): string {
  const lines = [`${i + 1}. ${row.address} — ${money(row.listPrice)}`, `   ${metricBits(row).join(" · ")}`];
  if (row.matchedRequirements?.length) lines.push(`   Matched: ${row.matchedRequirements.join(", ")}`);
  if (row.offMarketSignals?.length) lines.push(`   Off-market signals: ${row.offMarketSignals.join(", ")}`);
  if (row.aiReason) lines.push(`   Why: ${row.aiReason}`);
  lines.push(`   Monitor: ${monitorLink}   Zillow: ${row.url}`);
  return lines.join("\n");
}

function keeperHtml(row: Keeper, monitorLink: string, i: number): string {
  const bits = metricBits(row).map(esc).join(" &middot; ");
  const matched = row.matchedRequirements?.length
    ? `<div style="color:#555;font-size:13px;margin-top:2px;">Matched: ${esc(row.matchedRequirements.join(", "))}</div>` : "";
  const offMarket = row.offMarketSignals?.length
    ? `<div style="color:#8a5a00;font-size:13px;margin-top:2px;">Off-market signals: ${esc(row.offMarketSignals.join(", "))}</div>` : "";
  const reason = row.aiReason
    ? `<div style="color:#333;font-size:13px;margin-top:4px;">${esc(row.aiReason)}</div>` : "";
  return `<div style="border:1px solid #e0e0e0;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
  <div style="font-size:16px;font-weight:600;color:#111;">${i + 1}. ${esc(row.address)}</div>
  <div style="font-size:15px;color:#111;margin-top:2px;">${esc(money(row.listPrice))}</div>
  <div style="color:#444;font-size:13px;margin-top:4px;">${bits}</div>
  ${matched}${offMarket}${reason}
  <div style="margin-top:8px;">
    <a href="${esc(monitorLink)}" style="color:#2D9C84;font-weight:600;text-decoration:none;margin-right:14px;">View in Monitor</a>
    <a href="${esc(row.url)}" style="color:#2D9C84;font-weight:600;text-decoration:none;">Zillow listing</a>
  </div>
</div>`;
}

function buildDigest(keepers: Keeper[], monitorLink: string): { subject: string; text: string; html: string } {
  const n = keepers.length;
  const plural = n === 1 ? "" : "s";
  const subject = `IRES Monitor: ${n} new deal${plural} (Zillow NCC)`;
  const header = `IRES Monitor — ${n} new deal${plural} (New Castle County), ranked by deal score`;
  const text = `${header}\n\n${keepers.map((r, i) => keeperText(r, monitorLink, i)).join("\n\n")}\n\nReview all: ${monitorLink}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:640px;margin:0 auto;">
  <h2 style="color:#111;margin:0 0 4px;">IRES Monitor — ${n} new deal${plural}</h2>
  <p style="color:#555;font-size:13px;margin:0 0 16px;">New Castle County · ranked by deal score</p>
  ${keepers.map((r, i) => keeperHtml(r, monitorLink, i)).join("\n")}
  <p style="color:#888;font-size:12px;margin-top:20px;">Review all in the <a href="${esc(monitorLink)}" style="color:#2D9C84;">Monitor page</a>.</p>
</div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Email the un-emailed keepers as a ranked digest via Resend. Key-gated: with no
 * RESEND_API_KEY it logs a note and returns {sent:false} (never throws) — the
 * /monitor page is the in-app review surface, so a missing key/failed send must
 * not break the run. Stamps emailedAt per row so a keeper is never emailed twice.
 * Mirrors convex/contractActions.ts. (runId is context only — rows carry no runId,
 * so "keeper && not-yet-emailed" is the correct set.)
 */
export const sendDigest = internalAction({
  args: { runId: v.id("monitorRuns") },
  handler: async (ctx, { runId }): Promise<{ sent: boolean }> => {
    void runId;
    const key = (process.env.RESEND_API_KEY ?? "").trim();
    if (!key) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: "monitor digest: no RESEND_API_KEY, skipped",
        context: "monitorActions.sendDigest",
      });
      return { sent: false };
    }

    const keepers = await ctx.runQuery(internal.monitorData.keepersToEmail, {});
    if (keepers.length === 0) return { sent: false };

    const from = (process.env.RESEND_FROM ?? "").trim();
    const to = (process.env.RESEND_TO ?? "").trim();
    const base =
      (process.env.PORTAL_BASE_URL ?? "").trim() || "https://crm.instantrealestatesolution.com";
    const monitorLink = `${base}/monitor`;
    const { subject, text, html } = buildDigest(keepers, monitorLink);

    try {
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, text, html }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
      }
      for (const k of keepers) {
        await ctx.runMutation(internal.monitorData.markEmailed, { id: k._id });
      }
      return { sent: true };
    } catch (e) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: `sendDigest failed: ${(e as Error).message}`,
        context: "monitorActions.sendDigest",
      });
      return { sent: false };
    }
  },
});

/**
 * DEV-ONLY manual trigger (CLI). Inert unless IRES_DEV=1. `maxPages` lets a smoke
 * test run a cheap single page instead of the full 5.
 */
export const devMonitorScan = internalAction({
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

/**
 * One-time (or update) registration of the Firecrawl Monitor that watches the NCC
 * newest-listings search and POSTs to our webhook. Operator-invoked via the deploy
 * key (`npx convex run monitorActions:createFirecrawlMonitor`), see the monitor-web
 * skill. Key-gated on FIRECRAWL_API_KEY (throws CONFIG when unset). POSTs the
 * `/v2/monitor` body from spec §10: daily 8 PM ET scrape of `buildSearchUrl({})`
 * (`proxy:"enhanced"`) delivering `monitor.check.completed` to
 * `<site>/firecrawl-monitor` (one delivery per check → one scan). Firecrawl signs
 * EVERY delivery with the ACCOUNT-level webhook secret (dashboard → Settings →
 * Advanced), so convex/http.ts's FIRECRAWL_WEBHOOK_SECRET must equal that dashboard
 * value or deliveries 401. The site URL comes from CONVEX_SITE_URL, else the
 * `{siteUrl}` arg (`https://<deployment>.convex.site`). Returns a tolerant summary;
 * never throws on an HTTP/parse error (returns `{ok:false, error}`).
 */
export const createFirecrawlMonitor = internalAction({
  args: { siteUrl: v.optional(v.string()) },
  handler: async (
    _ctx,
    { siteUrl },
  ): Promise<{ ok: boolean; id?: string; warning?: string; error?: string }> => {
    const apiKey = fcKey();

    const site = (siteUrl ?? process.env.CONVEX_SITE_URL ?? "").trim().replace(/\/+$/, "");
    if (!site) {
      throw new ConvexError({
        code: "CONFIG",
        message:
          "No deployment site URL — set CONVEX_SITE_URL or pass {\"siteUrl\":\"https://<deployment>.convex.site\"}",
      });
    }
    const secret = (process.env.FIRECRAWL_WEBHOOK_SECRET ?? "").trim();

    const body = {
      name: "IRES NCC new listings",
      schedule: { text: "daily at 8:00 PM", timezone: "America/New_York" },
      targets: [
        {
          type: "scrape",
          urls: [buildSearchUrl({})],
          scrapeOptions: { formats: ["markdown"], proxy: "enhanced" },
        },
      ],
      webhook: {
        url: `${site}/firecrawl-monitor`,
        events: ["monitor.check.completed"],
        headers: {},
      },
      retentionDays: 30,
    };

    try {
      const res = await fetch(FIRECRAWL_V2_MONITOR_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { id?: string }; id?: string; error?: string }
        | null;
      if (!res.ok || json?.success === false) {
        return { ok: false, error: (json?.error ?? `Firecrawl ${res.status}`).toString().slice(0, 300) };
      }
      const id = json?.data?.id ?? json?.id;
      return {
        ok: true,
        ...(id ? { id } : {}),
        // Firecrawl signs every delivery with the ACCOUNT-level webhook secret
        // (dashboard → Settings → Advanced); convex/http.ts's FIRECRAWL_WEBHOOK_SECRET
        // must equal it or every delivery 401s (the daily cron still scans). The action
        // can't read the dashboard value, so it always warns.
        warning: secret
          ? "FIRECRAWL_WEBHOOK_SECRET is set — confirm it MATCHES the account webhook secret in the Firecrawl dashboard (Settings → Advanced); a mismatch 401s every delivery (the daily cron still scans)."
          : "FIRECRAWL_WEBHOOK_SECRET is unset on this deployment — set it to the account webhook secret from the Firecrawl dashboard (Settings → Advanced) or every delivery will 401 (the daily cron still scans).",
      };
    } catch (e) {
      return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
  },
});
