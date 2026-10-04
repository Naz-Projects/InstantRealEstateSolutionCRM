"use node";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { scrapeZillowJson, scrapeRedfinSold } from "./monitorScrape";
import {
  MONITOR,
  buildSearchUrl,
  extractNextData,
  listingsFromSearch,
  totalResultCount,
  detailFromCache,
  isLandType,
  isMultiUnitType,
  isCondoType,
  cronScanEnabled,
  digestRecipients,
  conservativeArv,
  inferRehabTier,
  monitorRehab,
  shouldReopenForDigest,
  detectRenovated,
  evaluateDeal,
  rentForListing,
  riskFlags,
  buildJudgePrompt,
  parseJudgeResponse,
  type SearchListing,
  type JudgeVerdict,
} from "../src/scraper/monitorListings";
import { parseZip, parseRedfinComps, parseRedfinGisComps, isLegacyCompsCache, type Comp } from "../src/scraper/comps";
import { deriveDealSignals } from "../src/scraper/dealSignals";
import { buildDigest } from "../src/scraper/monitorDigest";

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
// The digest is COMPLETION-triggered (noteAnalyzeDone at pendingCount 0). This
// fallback fires late as a safety net for the killed-action case (a keeper is
// never emailed twice — keepersToEmail excludes stamped rows, so a duplicate
// digest is a no-op).
const DIGEST_FALLBACK_MS = 30 * 60_000;
// Per-scrape retry budgets. analyzeOne does up to TWO scrapes (detail + comps)
// plus a 30s LLM call inside ONE action, so each scrape's worst case must stay
// small: 2 attempts × 60s + 12s gap ≈ 2.2 min each → ~5 min action worst case,
// under the 10-min kill limit (a killed action strands rows "pending"). The
// top-level search scrape runs alone, so it keeps a longer envelope — capped so
// one fully-blocked page (~3×90s+40s ≈ 5 min) plus 4 fast pages still fits.
const ANALYZE_SCRAPE_BUDGET = { gaps: [0, 12_000], timeoutMs: 60_000 };
const SEARCH_SCRAPE_BUDGET = { gaps: [0, 12_000, 28_000], timeoutMs: 90_000 };
// Stuck-"pending" sweep threshold (analysis can lag a scan by an hour on a slow
// night; 6h is unambiguous death).
const SWEEP_PENDING_AFTER_MS = 6 * 60 * 60 * 1000;
// Shared per-zip comps cache TTL (DB layer): comps are 6-month sold data, so a
// half-day of staleness is immaterial next to re-scraping the zip per listing.
const ZIP_COMPS_DB_TTL_MS = 12 * 60 * 60 * 1000;

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
        max_tokens: 1200,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseJudgeResponse(json.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

// Two-level per-zip comps cache. L1 = module Map (only helps within one warm
// isolate). L2 = the shared `zipComps` table — scheduled analyzeOne calls run in
// separate isolates, so without it the SAME zip's Redfin page was re-scraped
// once per LISTING per night; the table makes it once per ZIP per ~12h.
const COMPS_TTL_MS = 30 * 60_000;
const compsCache = new Map<string, { comps: Comp[]; at: number }>();
async function compsForZip(ctx: ActionCtx, zip: string, apiKey: string): Promise<Comp[]> {
  const hit = compsCache.get(zip);
  if (hit && Date.now() - hit.at < COMPS_TTL_MS) return hit.comps;

  const cached = (await ctx.runQuery(internal.monitorData.getZipComps, {
    zip,
    maxAgeMs: ZIP_COMPS_DB_TTL_MS,
  })) as Comp[] | null;
  // A legacy (pre-gis, untyped markdown) row is a miss: it would bypass the type/age filters.
  if (cached && !isLegacyCompsCache(cached)) {
    compsCache.set(zip, { comps: cached, at: Date.now() });
    return cached;
  }

  const page = await scrapeRedfinSold(zip, apiKey, ANALYZE_SCRAPE_BUDGET);
  // Prefer the embedded gis payload (coords + home type + sold epoch, ~5x the rows);
  // the markdown rows are the fallback if Redfin changes the embed.
  const gis = page ? parseRedfinGisComps(page.rawHtml) : [];
  const comps = gis.length > 0 ? gis : page ? parseRedfinComps(page.markdown) : [];
  compsCache.set(zip, { comps, at: Date.now() });
  // Only a NON-EMPTY scrape is worth sharing — caching [] would pin every other
  // listing in the zip to "no comps" for 12h on one transient block. Untyped markdown
  // fallback rows are not shared either (they would read back as a legacy miss).
  if (comps.length > 0 && !isLegacyCompsCache(comps)) {
    await ctx.runMutation(internal.monitorData.storeZipComps, { zip, comps });
  }
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
    // Off-switch for the cron path only (e.g. the dev deployment duplicating prod's
    // nightly scan): MONITOR_SCAN_ENABLED="0" skips with no run row and no scrape.
    if (trigger === "cron" && !cronScanEnabled(process.env.MONITOR_SCAN_ENABLED)) {
      return { scanned: 0, newCount: 0, keeperCount: 0 };
    }
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
    // Webhook 10-min duplicate-scan guard: Firecrawl can redeliver the same event
    // (its retries, or two near-simultaneous fires). If ANY run — including one still
    // RUNNING — started within the last 10 min, skip entirely (no run row, no scrape).
    // Only the webhook is guarded here; manual always runs.
    if (trigger === "webhook") {
      const recent = await ctx.runQuery(internal.monitorData.mostRecentRun, {});
      if (recent && Date.now() - recent.startedAt < 10 * 60 * 1000) {
        return { scanned: 0, newCount: 0, keeperCount: 0 };
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

      // 0) Nightly hygiene. Retire keepers older than the board window so the
      // keeper queries stay bounded; sweep rows stuck "pending" (killed
      // analyses) to failed so a blocked night is visible, not green.
      const retired = await ctx.runMutation(internal.monitorData.archiveStaleKeepers, {
        days: MONITOR.keeperRetireDays,
      });
      const swept = await ctx.runMutation(internal.monitorData.sweepStalePending, {
        olderThanMs: SWEEP_PENDING_AFTER_MS,
      });
      if (swept > 0) {
        await ctx.runMutation(internal.errors.logServerError, {
          message: `monitor: swept ${swept} stuck-pending listing(s) to failed (analysis killed or timed out)`,
          context: "monitorActions.runMonitorScan",
        });
      }
      void retired; // observability only — the mutation logs nothing on 0

      // 1) Paginated search scrape → accumulate survivors.
      const survivors: SearchListing[] = [];
      let total: number | null = null;
      const pages = maxPages ?? 5;
      for (let page = 1; page <= pages; page++) {
        let nextData: any | null = null;
        if (page === 1 && content) nextData = extractNextData(content);
        if (!nextData) nextData = await scrapeZillowJson(buildSearchUrl({ page }), apiKey, SEARCH_SCRAPE_BUDGET);
        if (!nextData) break;

        const listings = listingsFromSearch(nextData);
        if (listings.length === 0) break;
        scanned += listings.length;
        if (total == null) total = totalResultCount(nextData);

        for (const l of listings) {
          if (
            l.isNewConstruction ||
            l.isZillowOwned ||
            // Apartment buildings / multi-family / condo units are not the wholesaling target — drop at the gate.
            isMultiUnitType(l.homeType) ||
            isCondoType(l.homeType) ||
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

      // 2) Upsert survivors, COLLECT the analyze set first — pendingCount must be
      // set on the run row BEFORE any analyzeOne is scheduled, or a fast first
      // analysis could decrement an unset counter and fire the digest early.
      const toAnalyze: Array<Doc<"monitorListings">["_id"]> = [];
      for (const l of survivors) {
        const up = await ctx.runMutation(internal.monitorData.upsertListing, upsertArgsFromCard(l));
        if (up.isNew) newCount++;
        if (up.isNew || up.priceDropped) toAnalyze.push(up.id);
      }
      await ctx.runMutation(internal.monitorData.setPendingCount, {
        id: runId,
        pendingCount: toAnalyze.length,
      });
      for (let i = 0; i < toAnalyze.length; i++) {
        await ctx.scheduler.runAfter(i * STAGGER_MS, internal.monitorActions.analyzeOne, {
          id: toAnalyze[i],
          runId,
        });
      }

      // 3) Digest: completion-triggered by noteAnalyzeDone at pendingCount 0.
      // With nothing to analyze, send now (still emails prior-night stragglers);
      // otherwise schedule only the late FALLBACK for the killed-action case
      // (idempotent — emailed keepers are excluded, so a duplicate is a no-op).
      if (toAnalyze.length === 0) {
        await ctx.scheduler.runAfter(0, internal.monitorActions.sendDigest, { runId });
      } else {
        await ctx.scheduler.runAfter(
          toAnalyze.length * STAGGER_MS + DIGEST_FALLBACK_MS,
          internal.monitorActions.sendDigest,
          { runId },
        );
      }

      await ctx.runMutation(internal.monitorData.finishRun, {
        id: runId,
        status: "complete",
        scanned,
        newCount,
      });
      return { scanned, newCount, keeperCount: 0 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.monitorData.finishRun, {
        id: runId,
        status: "failed",
        scanned,
        newCount,
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
 * rehab tier → multi-exit (flip + rental) → off-market cross-ref → DeepSeek
 * judge → renovated veto (an already-renovated house never keeps a flip exit) →
 * deal score → keeper decision. Patches the row `analyzed` (or `failed` +
 * lastError on a thrown error). Runs as a scheduled action (no user identity).
 */
export const analyzeOne = internalAction({
  // runId is optional: re-analysis calls (price drops predate this, skills, CLI)
  // and in-flight scheduled calls from an older deploy carry none — they simply
  // skip the run-counter bookkeeping.
  args: { id: v.id("monitorListings"), runId: v.optional(v.id("monitorRuns")) },
  handler: async (ctx, { id, runId }): Promise<void> => {
    // Every exit path MUST report, or the run's pendingCount never reaches 0
    // and the completion digest waits for the 30-min fallback.
    const done = async (outcome: "analyzed" | "failed", keeper: boolean): Promise<void> => {
      if (!runId) return;
      await ctx.runMutation(internal.monitorData.noteAnalyzeDone, { runId, outcome, keeper });
    };
    try {
      const row = await ctx.runQuery(internal.monitorData.getListingInternal, { id });
      if (!row) {
        await done("failed", false);
        return;
      }

      const apiKey = fcKey();

      // 1) Detail scrape (embedded JSON). null → card-data fallback (VERIFY).
      // Capped budget: this action does up to two scrapes + an LLM call, and a
      // worst-case full envelope would blow the 10-min action limit.
      const detailData = await scrapeZillowJson(row.url, apiKey, ANALYZE_SCRAPE_BUDGET);
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
      // Rent = min(stated lease, rentZestimate); tax = the listing's own rate when Zillow has one.
      const { rent, leaseRent } = rentForListing(description, rentZestimate);
      const taxRatePct = detail?.propertyTaxRate ?? row.propertyTaxRatePct ?? null;
      const zip = row.propZip ?? parseZip(row.address) ?? undefined;

      // 2b) LAND guard: house comps / rehab / rental math are meaningless on vacant
      // land, so it is never underwritten or kept — surfaced in "All new" only. Bail
      // before comps/ARV/rehab/exits/off-market and the DeepSeek call (saves credits).
      if (isLandType(homeType)) {
        await ctx.runMutation(internal.monitorData.patchAnalysis, {
          id,
          clearFlip: true, // a re-analyzed pre-guard land row may carry stale flip fields
          clearRental: true,
          fields: {
            status: "analyzed" as const,
            arvSource: "none",
            keeper: false,
            aiKeep: false,
            dealScore: 0,
            bestExit: "PASS",
            riskFlags: ["LAND (not underwritten)"],
            matchedRequirements: [],
          },
        });
        await done("analyzed", false);
        return;
      }

      // 2c) Multi-unit / condo guard: apartment buildings, multi-family, and
      // condo units are not the wholesaling target. The scan gate drops carded
      // ones; this catches rows whose card had no homeType but whose detail
      // reveals it, and de-keeps pre-guard rows on re-analysis. Never
      // underwritten, never a keeper.
      if (isMultiUnitType(homeType) || isCondoType(homeType)) {
        await ctx.runMutation(internal.monitorData.patchAnalysis, {
          id,
          clearFlip: true,
          clearRental: true,
          fields: {
            status: "analyzed" as const,
            arvSource: "none",
            keeper: false,
            aiKeep: false,
            dealScore: 0,
            bestExit: "PASS",
            riskFlags: [isCondoType(homeType) ? "CONDO (not a target)" : "MULTI-FAMILY (not a target)"],
            matchedRequirements: [],
            ...(detail?.homeType ? { homeType: detail.homeType } : {}),
          },
        });
        await done("analyzed", false);
        return;
      }

      // 3) Comps → ARV (75th-percentile comps $/sqft, capped 1.15x Zestimate) + as-is value (median $/sqft).
      const comps = zip ? await compsForZip(ctx, zip, apiKey) : [];
      const arvRes = conservativeArv({ comps, sqft, beds: bedsNum, zestimate, homeType, lat: row.lat ?? null, lng: row.lng ?? null, now: Date.now() });
      const arv = arvRes.arv;

      // 4) Rehab: description keyword tier now; re-scoped after the judge (step 9b)
      // with max(keyword, LLM conditionTier) — the LLM can only raise costs.
      const rehabTier = inferRehabTier(description);
      const yearBuilt = detail?.yearBuilt ?? row.yearBuilt ?? null;
      const preRehab = monitorRehab({ sqft, keywordTier: rehabTier, conditionTier: null, yearBuilt });

      // 5-6) Preliminary deal math (spread + flip + rental) — the judge's GIVEN numbers.
      // The final decision is re-run at 9b with the judge's renovated veto applied.
      const dealInput = {
        listPrice,
        zestimate,
        valueBasis: arvRes.asIsValue,
        arv,
        rent,
        taxRatePct,
      };
      const pre = evaluateDeal({
        ...dealInput,
        rehabTotal: preRehab.total,
        holdingMonths: preRehab.holdingMonths,
        renovated: detectRenovated(description),
      });

      // 6.5) Deterministic deal signals (math, not LLM). Stored even if the judge fails.
      const dealSignals = deriveDealSignals({
        listPrice: listPrice ?? 0,
        sqft,
        priceHistory: (detail?.priceHistory ?? row.priceHistory ?? []) as any,
        lastSoldPrice: detail?.lastSoldPrice ?? row.lastSoldPrice ?? null,
        dateSold: detail?.dateSold ?? row.lastSoldDate ?? null,
        daysOnZillow: detail?.daysOnZillow ?? row.daysOnZillow ?? null,
        yearBuilt: detail?.yearBuilt ?? row.yearBuilt ?? null,
        photoCount: detailOk ? (detail?.photoUrls?.length ?? 0) : null,
        compsPpsf: arvRes.compsPpsf,
        ...(zip ? { zip } : {}),
        now: Date.now(),
      });

      // 7) Risk flags (all from the scraped JSON).
      const flags = riskFlags({
        homeType,
        monthlyHoaFee: detail?.monthlyHoaFee ?? row.monthlyHoaFee ?? null,
        description,
        rehabTier,
        zestimate,
        compsArv: arvRes.source === "comps" ? arv : null,
        detailOk,
        sqftKnown: sqft != null && sqft > 0,
        arvSource: arvRes.source,
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
        spreadPct: pre.spreadPct,
        rehabTier,
        flipMarginPct: pre.flip ? +(pre.flip.margin * 100).toFixed(1) : null,
        capRatePct: pre.rental ? +(pre.rental.capRate * 100).toFixed(1) : null,
        homeType,
        description,
        dealSignals,
        priceHistoryCompact: (detail?.priceHistory ?? row.priceHistory ?? []).map((h: any) => `${h.date ?? "?"} ${h.event ?? ""} ${h.price != null ? "$" + h.price : ""}`.trim()).slice(0, 6).join(" | ") || undefined,
        lastSoldPrice: detail?.lastSoldPrice ?? row.lastSoldPrice ?? null,
        lastSoldDate: detail?.dateSold ?? row.lastSoldDate ?? null,
        yearBuilt: detail?.yearBuilt ?? row.yearBuilt ?? null,
        photoCount: detail?.photoUrls?.length ?? 0,
        daysOnMarket: detail?.daysOnZillow ?? row.daysOnZillow ?? null,
      });

      // 9b) Renovated veto: you cannot flip a house someone already flipped.
      // Deterministic detection is primary; the judge's opinion may only SUPPRESS
      // a flip (never create/restore a keep). Rental/below-market exits untouched —
      // a renovated rental with a clearing cap rate is a legitimate keeper.
      const renovated = detectRenovated(description) || verdict?.renovated === true;
      if (renovated) flags.push("RENOVATED (no flip)");
      const rehab = monitorRehab({ sqft, keywordTier: rehabTier, conditionTier: verdict?.conditionTier ?? null, yearBuilt });
      if (rehab.tier === "gut" && !flags.includes("heavy-rehab")) flags.push("heavy-rehab");
      flags.push(...rehab.addOns);

      // 10) Keeper decision — deterministic floors only (distress is a label, never a keep).
      const deal = evaluateDeal({ ...dealInput, rehabTotal: rehab.total, holdingMonths: rehab.holdingMonths, renovated });
      const { keeper, belowMarket, spread, spreadPct, rental } = deal;
      const flipFinal = deal.flip;
      if (leaseRent != null) flags.push(`LEASED at $${leaseRent.toLocaleString("en-US")}/mo`);
      if (rental?.taxEstimated) flags.push(`tax rate estimated ${MONITOR.rentalTaxFallbackPct}% (VERIFY)`);

      const matched = new Set<string>(verdict?.matchedRequirements ?? []);
      if (belowMarket) matched.add("below_market");

      // 11) Patch everything + status:"analyzed" (omit null-valued optionals).
      // clearFlip/clearRental: patchAnalysis merges, so a re-analyzed row whose exit
      // is now null (renovated veto / unknown rehab) must have it REMOVED, not omitted.
      await ctx.runMutation(internal.monitorData.patchAnalysis, {
        id,
        ...(flipFinal ? {} : { clearFlip: true }),
        ...(rental ? {} : { clearRental: true }),
        ...(shouldReopenForDigest(row.bestExit, deal.bestExit) ? { clearEmailed: true } : {}),
        fields: {
          status: "analyzed" as const,
          arvSource: arvRes.source,
          compsCount: arvRes.compsCount,
          rehabTier: rehab.tier,
          belowMarket,
          keeper,
          aiKeep: verdict?.keep ?? false,
          matchedRequirements: [...matched],
          riskFlags: flags,
          dealScore: deal.dealScore,
          flipScore: deal.flipScore,
          rentScore: deal.rentScore,
          bestExit: deal.bestExit,
          aiModel: LLM_MODEL,
          // deterministic deal signals (ALWAYS store — stands even when the judge fails)
          motivationPoints: dealSignals.motivationPoints,
          motivationSignals: dealSignals.motivationSignals,
          eraHazards: dealSignals.eraHazards,
          ...(dealSignals.ppsfDiscountPct != null ? { ppsfDiscountPct: dealSignals.ppsfDiscountPct } : {}),
          ...(dealSignals.tenureYears != null ? { tenureYears: dealSignals.tenureYears } : {}),
          ...(dealSignals.zipTier ? { zipTier: dealSignals.zipTier } : {}),
          ...(arv != null ? { conservativeArv: arv } : {}),
          ...(arvRes.asIsValue != null ? { asIsValue: arvRes.asIsValue } : {}),
          ...(arvRes.compsPpsf != null ? { compsPpsf: arvRes.compsPpsf } : {}),
          ...(spread != null ? { spread } : {}),
          ...(spreadPct != null ? { spreadPct } : {}),
          ...(rehab.total != null ? { rehabEstimate: rehab.total } : {}),
          ...(flipFinal
            ? {
                ...(flipFinal.mao != null ? { flipMao: Math.round(flipFinal.mao) } : {}),
                ...(flipFinal.profit != null ? { flipProfit: Math.round(flipFinal.profit) } : {}),
                ...(flipFinal.margin != null ? { flipMargin: flipFinal.margin } : {}),
                ...(flipFinal.roi != null ? { flipRoi: flipFinal.roi } : {}),
                ...(flipFinal.roomVsList != null ? { roomVsList: flipFinal.roomVsList } : {}),
              }
            : {}),
          ...(rental
            ? {
                capRate: rental.capRate,
                cashFlow: rental.cashFlow,
                onePctRule: rental.onePct,
                cashOnCash: rental.cashOnCash,
                dscr: rental.dscr,
                ...(deal.brrrrCashLeftIn != null ? { brrrrCashLeftIn: deal.brrrrCashLeftIn } : {}),
              }
            : {}),
          ...(leaseRent != null ? { leaseRent } : {}),
          ...(taxRatePct != null ? { propertyTaxRatePct: taxRatePct } : {}),
          ...(verdict
            ? {
                aiReason: verdict.reason,
                aiConditionNotes: verdict.conditionNotes,
                aiConfidence: verdict.confidence,
                ...(verdict.conditionTier ? { conditionTier: verdict.conditionTier } : {}),
                ...(verdict.valueAddScope ? { valueAddScope: verdict.valueAddScope } : {}),
                ...(verdict.redFlags.length ? { redFlags: verdict.redFlags } : {}),
                ...(verdict.verifyGates.length ? { verifyGates: verdict.verifyGates } : {}),
                ...(verdict.exitTriage ? { exitTriage: verdict.exitTriage } : {}),
                ...(verdict.exitFallbacks.length ? { exitFallbacks: verdict.exitFallbacks } : {}),
                ...(verdict.breakdown ? { breakdown: verdict.breakdown } : {}),
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
      await done("analyzed", keeper);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.runMutation(internal.monitorData.patchAnalysis, {
        id,
        fields: { status: "failed" as const, lastError: message.slice(0, 500) },
      });
      await done("failed", false);
    }
  },
});

/**
 * Email the un-emailed FLIP/RENTAL keepers as a 5-second brief (src/scraper/monitorDigest.ts) via Resend. Key-gated: with no
 * RESEND_API_KEY it logs a note and returns {sent:false} (never throws) — the
 * /monitor page is the in-app review surface, so a missing key/failed send must
 * not break the run. Stamps emailedAt per row so a keeper is never emailed twice.
 * Mirrors convex/contractActions.ts. (runId is context only — rows carry no runId,
 * so "keeper && not-yet-emailed" is the correct set.)
 */
export const sendDigest = internalAction({
  args: { runId: v.id("monitorRuns") },
  handler: async (ctx, { runId }): Promise<{ sent: boolean }> => {
    // First, independent of the key/send: retire board-only + archived keepers
    // from the never-emailed index so the digest scan stays bounded.
    await ctx.runMutation(internal.monitorData.markDigestSkipped, {});
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
    // Digest goes to EVERY active CRM user (not just the RESEND_TO admin);
    // RESEND_TO stays merged in as a fallback so the digest still sends if the
    // users table is ever empty. Deduped case-insensitively.
    const userEmails = await ctx.runQuery(internal.users.activeEmailsInternal, {});
    const to = digestRecipients(userEmails, process.env.RESEND_TO);
    if (to.length === 0) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: "monitor digest: no active-user emails and no RESEND_TO, skipped",
        context: "monitorActions.sendDigest",
      });
      return { sent: false };
    }
    const base =
      (process.env.PORTAL_BASE_URL ?? "").trim() || "https://crm.instantrealestatesolution.com";
    // "N more on the board" = active keepers beyond the ones in this email.
    const boardTotal = await ctx.runQuery(internal.monitorData.activeKeeperCount, {});
    const moreOnBoard = Math.max(0, boardTotal - keepers.length);
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    const { subject, text, html } = buildDigest(keepers, { baseUrl: base, moreOnBoard, date });

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
      await ctx.runMutation(internal.monitorData.noteEmailed, { runId, count: keepers.length });
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
