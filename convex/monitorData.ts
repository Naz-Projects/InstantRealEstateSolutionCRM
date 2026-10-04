import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./helpers";
import { requireAdmin } from "./lib/getAuthUser";
import { normalizeAddress } from "../src/scraper/potentialPipeline";
import { MONITOR, partitionDigestRows, evaluateDeal, dealInputFromStored, decisionFields } from "../src/scraper/monitorListings";
import { applyTriage, scanBlockedReason, type TriageState } from "../src/scraper/monitorTriage";
import { sightingPatch, cardCutFields, recheckPatch } from "../src/scraper/monitorRecheck";

// "Monitor the Web" (Zillow NCC deal-finder) — V8 data layer: queries + mutations
// ONLY (no "use node", no actions — those live in convex/monitorActions.ts).
// Internal fns are the write/read surface for the Task-10 scan action; the public
// (requireUser-gated) fns feed the /monitor page. Strictly additive.
// Spec: docs/superpowers/specs/2026-06-30-monitor-web-zillow-design.md §7 + §9.

// Fields the scan writes at DISCOVERY time (identity + search-card facts). The
// analysis/valuation/exit fields are filled later by `patchAnalysis`.
const listingUpsertArgs = {
  zpid: v.string(),
  source: v.union(v.literal("zillow"), v.literal("redfin")),
  url: v.string(),
  address: v.string(),
  propCity: v.optional(v.string()),
  propZip: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  listPrice: v.optional(v.number()),
  beds: v.optional(v.union(v.number(), v.string())),
  baths: v.optional(v.union(v.number(), v.string())),
  sqft: v.optional(v.number()),
  ppsf: v.optional(v.number()),
  homeType: v.optional(v.string()),
  yearBuilt: v.optional(v.number()),
  daysOnZillow: v.optional(v.number()),
  monthlyHoaFee: v.optional(v.number()),
  lastSoldPrice: v.optional(v.number()),
  lastSoldDate: v.optional(v.string()),
  priceHistory: v.optional(v.array(v.any())),
  description: v.optional(v.string()),
  photoUrls: v.optional(v.array(v.string())),
  agentName: v.optional(v.string()),
  agentPhone: v.optional(v.string()),
  brokerName: v.optional(v.string()),
  mlsId: v.optional(v.string()),
  zestimate: v.optional(v.number()),
  rentZestimate: v.optional(v.number()),
  homeStatus: v.optional(v.string()),
  priceChange: v.optional(v.number()),      // card-only (not a column): seeds lastPriceCut on insert
  datePriceChanged: v.optional(v.number()), // card-only (not a column)
  statusText: v.optional(v.string()),       // card-only (not a column): blocks a false back-on-market
};

// Everything the analyze step may write. Every key optional so a partial (VERIFY)
// patch validates; Convex only patches the keys actually sent (absent ≠ delete).
const analysisFields = v.object({
  // enrichment facts (detail scrape may fill/correct these)
  propCity: v.optional(v.string()),
  propZip: v.optional(v.string()),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  listPrice: v.optional(v.number()),
  beds: v.optional(v.union(v.number(), v.string())),
  baths: v.optional(v.union(v.number(), v.string())),
  sqft: v.optional(v.number()),
  ppsf: v.optional(v.number()),
  homeType: v.optional(v.string()),
  yearBuilt: v.optional(v.number()),
  daysOnZillow: v.optional(v.number()),
  monthlyHoaFee: v.optional(v.number()),
  lastSoldPrice: v.optional(v.number()),
  lastSoldDate: v.optional(v.string()),
  priceHistory: v.optional(v.array(v.any())),
  description: v.optional(v.string()),
  photoUrls: v.optional(v.array(v.string())),
  agentName: v.optional(v.string()),
  agentPhone: v.optional(v.string()),
  brokerName: v.optional(v.string()),
  mlsId: v.optional(v.string()),
  // valuation + keeper math
  zestimate: v.optional(v.number()),
  rentZestimate: v.optional(v.number()),
  conservativeArv: v.optional(v.number()),
  asIsValue: v.optional(v.number()),
  arvSource: v.optional(v.string()),
  compsPpsf: v.optional(v.number()),
  compsCount: v.optional(v.number()),
  spread: v.optional(v.number()),
  spreadPct: v.optional(v.number()),
  belowMarket: v.optional(v.boolean()),
  rehabTier: v.optional(v.string()),
  rehabEstimate: v.optional(v.number()),
  // exits (flip + rental + wholesale)
  flipMao: v.optional(v.number()),
  flipProfit: v.optional(v.number()),
  flipMargin: v.optional(v.number()),
  flipRoi: v.optional(v.number()),
  roomVsList: v.optional(v.number()),
  capRate: v.optional(v.number()),
  cashFlow: v.optional(v.number()),
  onePctRule: v.optional(v.number()),
  cashOnCash: v.optional(v.number()),
  dscr: v.optional(v.number()),
  brrrrCashLeftIn: v.optional(v.number()),
  leaseRent: v.optional(v.number()),
  propertyTaxRatePct: v.optional(v.number()),
  wholesaleSpread: v.optional(v.number()),
  // decision
  dealScore: v.optional(v.number()),
  flipScore: v.optional(v.number()),
  rentScore: v.optional(v.number()),
  bestExit: v.optional(v.string()),
  riskFlags: v.optional(v.array(v.string())),
  keeper: v.optional(v.boolean()),
  aiKeep: v.optional(v.boolean()),
  matchedRequirements: v.optional(v.array(v.string())),
  aiReason: v.optional(v.string()),
  aiConditionNotes: v.optional(v.string()),
  aiConfidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  aiModel: v.optional(v.string()),
  // deep-analysis (analyst breakdown) — deterministic dealSignals + LLM condition/exit
  motivationPoints: v.optional(v.number()),
  motivationSignals: v.optional(v.array(v.string())),
  ppsfDiscountPct: v.optional(v.number()),
  tenureYears: v.optional(v.number()),
  eraHazards: v.optional(v.array(v.string())),
  zipTier: v.optional(v.string()),
  conditionTier: v.optional(v.string()),
  valueAddScope: v.optional(v.string()),
  redFlags: v.optional(v.array(v.string())),
  verifyGates: v.optional(v.array(v.string())),
  exitTriage: v.optional(v.string()),
  exitFallbacks: v.optional(v.array(v.string())),
  breakdown: v.optional(v.string()),
  // off-market cross-reference match
  offMarketPrclid: v.optional(v.string()),
  offMarketSignals: v.optional(v.array(v.string())),
  offMarketBalances: v.optional(v.number()),
  offMarketConditionScore: v.optional(v.number()),
  // Phase 4 tracking (set by analyzeOne)
  homeStatus: v.optional(v.string()),
  recheckAt: v.optional(v.number()),
  alertTag: v.optional(v.string()),
  alertedEventAt: v.optional(v.number()),
  // workflow
  status: v.optional(
    v.union(
      v.literal("pending"),
      v.literal("analyzed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
  ),
  lastError: v.optional(v.string()),
});

// ---- internal: written/read by the scan + analyze actions (Task 10) ----

/**
 * Upsert a discovered listing by zpid. New zpid → insert a `pending` row (stamp
 * firstSeen/lastSeen/updatedAt). Repeat zpid: `sightingPatch` decides cut /
 * back-on-market / revive. On a repeat we do NOT overwrite the analyzed fields
 * with card data.
 */
export const upsertListing = internalMutation({
  args: listingUpsertArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const { priceChange, datePriceChanged, statusText, ...fields } = args;
    const existing = await ctx.db
      .query("monitorListings")
      .withIndex("by_zpid", (q) => q.eq("zpid", args.zpid))
      .first();

    if (!existing) {
      const id = await ctx.db.insert("monitorListings", {
        ...fields,
        ...cardCutFields({ priceChange, datePriceChanged }, now),
        status: "pending" as const,
        firstSeen: now,
        lastSeen: now,
        updatedAt: now,
      });
      return { id, isNew: true, priceDropped: false, backOnMarket: false };
    }

    // Cut detection (moves listPrice down so it can't re-fire), back-on-market, and
    // revive-on-new-cut (+ the revived row's rotation slot) all live in the pure
    // sightingPatch (tests/monitorRecheck.test.ts). We do NOT overwrite analyzed fields
    // with card data.
    const s = sightingPatch(existing, { price: args.listPrice ?? null, homeStatus: args.homeStatus, datePriceChanged, statusText }, now);
    await ctx.db.patch(existing._id, s.patch);
    return { id: existing._id, isNew: false, priceDropped: s.priceDropped, backOnMarket: s.backOnMarket };
  },
});

/** Given a batch of zpids, return the subset already stored (the dedupe filter). */
export const seenZpids = internalQuery({
  args: { zpids: v.array(v.string()) },
  handler: async (ctx, { zpids }) => {
    const found: string[] = [];
    for (const zpid of zpids) {
      const row = await ctx.db
        .query("monitorListings")
        .withIndex("by_zpid", (q) => q.eq("zpid", zpid))
        .first();
      if (row) found.push(zpid);
    }
    return found;
  },
});

/**
 * Patch one listing with any analysis/valuation/exit/decision output. `clearFlip`/`clearRental`
 * REMOVE the flip/rental fields (patch-to-undefined) — for re-analysis where the
 * renovated/land veto nulls the flip exit: the merge would otherwise keep stale
 * flipMao/flipMargin/etc. from a pre-veto pass. Must live here in the mutation —
 * explicit `undefined` values are stripped from action→mutation args.
 */
export const patchAnalysis = internalMutation({
  args: {
    id: v.id("monitorListings"),
    fields: analysisFields,
    clearFlip: v.optional(v.boolean()),
    clearRental: v.optional(v.boolean()),
    clearEmailed: v.optional(v.boolean()), // upgraded to FLIP/RENTAL, or a new cut/back-on-market re-alert -> back into the digest
    clearRecheck: v.optional(v.boolean()), // no longer a keeper -> leave the detail re-check rotation
  },
  handler: async (ctx, { id, fields, clearFlip, clearRental, clearEmailed, clearRecheck }) => {
    await ctx.db.patch(id, {
      ...fields,
      ...(clearEmailed ? { emailedAt: undefined } : {}),
      ...(clearRecheck ? { recheckAt: undefined } : {}),
      ...(clearFlip
        ? { flipMao: undefined, flipProfit: undefined, flipMargin: undefined, flipRoi: undefined, roomVsList: undefined }
        : {}),
      ...(clearRental
        ? { capRate: undefined, cashFlow: undefined, onePctRule: undefined, cashOnCash: undefined, dscr: undefined, brrrrCashLeftIn: undefined }
        : {}),
      updatedAt: Date.now(),
    });
  },
});

/** Open a run counter row (mirrors parcelSync); returns its id for finishRun. */
export const createRun = internalMutation({
  args: {
    trigger: v.union(v.literal("webhook"), v.literal("cron"), v.literal("manual")),
    source: v.union(v.literal("zillow"), v.literal("redfin")),
  },
  handler: async (ctx, { trigger, source }) => {
    return await ctx.db.insert("monitorRuns", {
      trigger,
      source,
      status: "running",
      scanned: 0,
      newCount: 0,
      analyzedCount: 0,
      keeperCount: 0,
      emailedCount: 0,
      startedAt: Date.now(),
    });
  },
});

/**
 * Finalize a run's SCAN phase (status/scanned/newCount). The analysis counters
 * (analyzedCount/keeperCount/failedCount/emailedCount) are deliberately NOT args:
 * they are bumped live by noteAnalyzeDone/noteEmailed as the async fan-out
 * completes — passing them here would clobber counts from analyses that raced
 * ahead of finishRun.
 */
export const finishRun = internalMutation({
  args: {
    id: v.id("monitorRuns"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    scanned: v.number(),
    newCount: v.number(),
    source: v.optional(v.union(v.literal("zillow"), v.literal("redfin"))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...rest }) => {
    await ctx.db.patch(id, { ...rest, finishedAt: Date.now() });
  },
});

/** Set how many analyzeOne calls the scan is about to schedule — BEFORE any are
 *  scheduled, so a fast first analysis can never decrement an unset counter. */
export const setPendingCount = internalMutation({
  args: { id: v.id("monitorRuns"), pendingCount: v.number() },
  handler: async (ctx, { id, pendingCount }) => {
    await ctx.db.patch(id, { pendingCount });
  },
});

/**
 * One analyzeOne finished (any exit path). Bumps the run's real counters and
 * counts pendingCount down; at 0 the digest fires immediately (completion-
 * triggered — no guessed buffer), and a night where everything failed writes an
 * errorLogs alert instead of looking green. Serializable mutations make the
 * concurrent decrements safe.
 */
export const noteAnalyzeDone = internalMutation({
  args: {
    runId: v.id("monitorRuns"),
    outcome: v.union(v.literal("analyzed"), v.literal("failed")),
    keeper: v.boolean(),
  },
  // Explicit return type: this handler references internal.monitorActions.* while
  // monitorActions references internal.monitorData.* — annotate to break the
  // TS7022 circular-inference cycle (lessons 2026-06-01).
  handler: async (ctx, { runId, outcome, keeper }): Promise<void> => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const analyzedCount = run.analyzedCount + (outcome === "analyzed" ? 1 : 0);
    const failedCount = (run.failedCount ?? 0) + (outcome === "failed" ? 1 : 0);
    const keeperCount = run.keeperCount + (keeper ? 1 : 0);
    const remaining = Math.max(0, (run.pendingCount ?? 0) - 1);
    await ctx.db.patch(runId, { analyzedCount, failedCount, keeperCount, pendingCount: remaining });
    if (remaining === 0) {
      await ctx.scheduler.runAfter(0, internal.monitorActions.sendDigest, { runId });
      if (analyzedCount === 0 && failedCount > 0) {
        await ctx.db.insert("errorLogs", {
          message: `monitor: 0 of ${failedCount} scheduled analyses succeeded — Zillow likely blocked all night`,
          source: "server" as const,
          severity: "error" as const,
          context: "monitorData.noteAnalyzeDone",
          resolved: false,
          createdAt: Date.now(),
        });
      }
    }
  },
});

/** Digest sent: add its keeper count to the run's emailedCount (incremental —
 *  the completion digest and the fallback digest may both fire for one run). */
export const noteEmailed = internalMutation({
  args: { runId: v.id("monitorRuns"), count: v.number() },
  handler: async (ctx, { runId, count }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    await ctx.db.patch(runId, { emailedCount: run.emailedCount + count });
  },
});

/**
 * The most recent COMPLETE run (by started time), for the cron 20h no-op guard.
 * The daily safety-net cron skips scanning if this run's finish/start time is
 * within the last 20h so the webhook + cron don't double-scan. null before any
 * complete run.
 */
export const mostRecentCompleteRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("monitorRuns")
      .withIndex("by_started")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "complete"))
      .first();
  },
});

/** The most recent run of ANY status (running/complete/failed), for the webhook
 *  10-min duplicate-scan guard — a still-RUNNING scan must block a duplicate too. */
export const mostRecentRun = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("monitorRuns")
      .withIndex("by_started")
      .order("desc")
      .first();
  },
});

/** Stamp emailedAt so a keeper is never emailed twice. */
export const markEmailed = internalMutation({
  args: { id: v.id("monitorListings") },
  handler: async (ctx, { id }) => {
    const now = Date.now();
    await ctx.db.patch(id, { emailedAt: now, updatedAt: now });
  },
});

/**
 * Stamp emailedAt ("digest processed") on never-emailed keepers that will never
 * be emailed (WHOLESALE/PASS/unset bestExit, or archived) so they leave the
 * by_keeper_emailed range and the nightly digest scan stays bounded. Run by
 * sendDigest before any send/key check. Returns the stamped count.
 */
export const markDigestSkipped = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_emailed", (q) => q.eq("keeper", true).eq("emailedAt", undefined))
      .collect();
    const { toSkip } = partitionDigestRows(rows);
    const now = Date.now();
    for (const r of toSkip) await ctx.db.patch(r._id, { emailedAt: now, updatedAt: now });
    return toSkip.length;
  },
});

/** Link a listing to the Potential deal it was promoted into. */
export const setPromotedDeal = internalMutation({
  args: {
    id: v.id("monitorListings"),
    promotedDealId: v.id("potentialDeals"),
  },
  handler: async (ctx, { id, promotedDealId }) => {
    await ctx.db.patch(id, { promotedDealId, updatedAt: Date.now() });
  },
});

/** One listing by id, for the action (no auth gate — internal callers only). */
export const getListingInternal = internalQuery({
  args: { id: v.id("monitorListings") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * Un-emailed keepers, best deal first (for the scheduled `sendDigest` action,
 * which has no user identity and so can't call the requireUser-gated
 * `listKeepers`). Rows carry no runId, so "keeper && emailedAt unset" is the
 * correct digest set. Capped so a first-run backlog can't send a giant email.
 */
export const keepersToEmail = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // Index-bounded: only keeper rows the digest hasn't processed. emailedAt means
    // "digest processed": sent rows are stamped by markEmailed and board-only /
    // archived rows by markDigestSkipped, so this set stays small over time.
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_emailed", (q) => q.eq("keeper", true).eq("emailedAt", undefined))
      .collect();
    // Filter BEFORE the cap so board-only keepers (WHOLESALE/PASS) can't crowd it.
    const active = partitionDigestRows(rows).toEmail;
    active.sort((a, b) => (b.dealScore ?? -Infinity) - (a.dealScore ?? -Infinity));
    return active.slice(0, limit ?? 50);
  },
});

/** Active (un-archived) keepers on the board, for the digest's "N more on the board". Bounded. */
export const activeKeeperCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .take(1000);
    return rows.length;
  },
});

/**
 * Nightly retire pass: keepers not seen in a Zillow search for `days` (by lastSeen) get archivedAt
 * stamped so the /monitor board and its queries stay bounded to the active
 * market. `keeper` itself is untouched (history preserved). Returns the count.
 */
export const archiveStaleKeepers = internalMutation({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const active = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .collect();
    let archived = 0;
    for (const row of active) {
      // lastSeen (last appearance in ANY Zillow search) — a keeper the price-cut sweep
      // keeps seeing stays on the board; the rotation (recheckAt) ends with it.
      if (row.lastSeen < cutoff) {
        await ctx.db.patch(row._id, { archivedAt: now, archivedReason: "stale", recheckAt: undefined, updatedAt: now });
        archived++;
      }
    }
    return archived;
  },
});

/**
 * Re-gate the active (non-archived) keepers under the CURRENT keeper rules using
 * only stored fields (no scraping, zero Firecrawl credits). De-keeps rows that now
 * fail; never promotes a non-keeper (the scan's analyzeOne is the only promoter).
 * Rows that stay keepers get their decision fields refreshed; rows the user already
 * promoted (promotedDealId) are skipped untouched. `dryRun` returns the
 * same counts without writing. Operator-run on prod after deploy:
 *   npx convex run monitorData:regateKeepers '{"dryRun":true}'
 */
export const regateKeepers = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .collect();
    const exitMix: Record<string, number> = {};
    const dekept: string[] = [];
    let skippedPromoted = 0;
    const now = Date.now();
    for (const row of rows) {
      // User already promoted it to a potential deal: leave untouched (counts as kept).
      if (row.promotedDealId) { skippedPromoted++; continue; }
      const input = dealInputFromStored(row);
      const d = evaluateDeal(input);
      if (d.keeper) exitMix[d.bestExit] = (exitMix[d.bestExit] ?? 0) + 1;
      else dekept.push(row.address);
      if (dryRun) continue;
      const tags = (row.matchedRequirements ?? []).filter((t) => t !== "below_market");
      await ctx.db.patch(row._id, {
        ...decisionFields(d),
        rehabEstimate: input.rehabTotal ?? undefined, // re-scoped with the current tiers/add-ons
        matchedRequirements: d.belowMarket ? [...tags, "below_market"] : tags,
        updatedAt: now,
      });
    }
    return {
      dryRun: !!dryRun,
      total: rows.length,
      kept: rows.length - dekept.length,
      dekept: dekept.length,
      skippedPromoted,
      exitMix,
      dekeptSample: dekept.slice(0, 25),
    };
  },
});

/**
 * Sweep rows stuck `pending` (an analyzeOne killed by the action time limit never
 * reaches its catch) to `failed` with an honest lastError, so a blocked night is
 * visible instead of green. Returns the swept count for the caller to log.
 */
export const sweepStalePending = internalMutation({
  args: { olderThanMs: v.optional(v.number()) },
  handler: async (ctx, { olderThanMs }) => {
    const cutoff = Date.now() - (olderThanMs ?? 6 * 60 * 60 * 1000);
    const pending = await ctx.db
      .query("monitorListings")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    let swept = 0;
    for (const row of pending) {
      if (row.updatedAt < cutoff) {
        await ctx.db.patch(row._id, {
          status: "failed" as const,
          lastError: "analysis timed out (swept by the next scan)",
          updatedAt: Date.now(),
        });
        swept++;
      }
    }
    return swept;
  },
});

/**
 * Rows due for a detail re-check (the rotation), oldest-due first, capped. The lower
 * bound is load-bearing: Convex sorts undefined BEFORE numbers, so lte(now) alone would
 * return every row outside the rotation.
 */
export const dueForRecheck = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_recheck", (q) => q.gt("recheckAt", 0).lte("recheckAt", now))
      .take(limit);
    return rows.map((r) => ({ _id: r._id, url: r.url }));
  },
});

/**
 * Apply one detail re-check against the FRESH stored row (pure recheckPatch: archive on
 * PENDING/SOLD/OFF_MARKET, revive on back-on-market, cut detection, next rotation slot).
 * detail omitted = the scrape failed (shell page) -> retry tomorrow, nothing archived.
 */
export const applyRecheck = internalMutation({
  args: {
    id: v.id("monitorListings"),
    detail: v.optional(v.object({ homeStatus: v.optional(v.string()), isPending: v.boolean(), price: v.optional(v.number()) })),
  },
  handler: async (ctx, { id, detail }): Promise<{ reanalyze: boolean; outcome: string }> => {
    const row = await ctx.db.get(id);
    if (!row) return { reanalyze: false, outcome: "missing" };
    const r = recheckPatch(row, detail ? { homeStatus: detail.homeStatus, isPending: detail.isPending, price: detail.price ?? null } : null, Date.now());
    await ctx.db.patch(id, r.patch);
    return { reanalyze: r.reanalyze, outcome: r.outcome };
  },
});

/**
 * One-time (operator) seeding: put the CURRENT active keepers into the re-check rotation,
 * spread over the cadence window so day one doesn't re-scrape all of them. New keepers
 * join automatically via analyzeOne. Run on prod after deploy (prod deploy key; a bare
 * `npx convex run` targets the dev deployment), dry run first, then without dryRun:
 *   CONVEX_DEPLOY_KEY=<prod> npx convex run monitorData:seedRecheck '{"dryRun":true}'
 * Rerun-safe: rows already in the rotation (recheckAt set) are skipped.
 */
export const seedRecheck = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .take(1000);
    const now = Date.now();
    let seeded = 0;
    for (const r of rows) {
      if (r.recheckAt != null) continue;
      const at = now + (seeded % MONITOR.recheckEveryDays) * 86_400_000 + 60_000;
      if (!dryRun) await ctx.db.patch(r._id, { recheckAt: at });
      seeded++;
    }
    return { dryRun: !!dryRun, total: rows.length, seeded };
  },
});

/** Fresh comps for a zip from the shared nightly cache, or null on miss/stale. */
export const getZipComps = internalQuery({
  args: { zip: v.string(), maxAgeMs: v.number() },
  handler: async (ctx, { zip, maxAgeMs }) => {
    const row = await ctx.db
      .query("zipComps")
      .withIndex("by_zip", (q) => q.eq("zip", zip))
      .first();
    if (!row || Date.now() - row.fetchedAt > maxAgeMs) return null;
    return row.comps;
  },
});

/** Upsert the shared per-zip comps cache (one row per zip). */
export const storeZipComps = internalMutation({
  args: { zip: v.string(), comps: v.array(v.any()) },
  handler: async (ctx, { zip, comps }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("zipComps")
      .withIndex("by_zip", (q) => q.eq("zip", zip))
      .first();
    if (row) await ctx.db.patch(row._id, { comps, fetchedAt: now });
    else await ctx.db.insert("zipComps", { zip, comps, fetchedAt: now });
  },
});

// ---- browser-facing (requireUser-gated) reads for /monitor ----

/** Active (un-archived) keepers, best deal on top — index-ordered, bounded. */
export const listKeepers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    // by_keeper_archived is ["keeper","archivedAt","dealScore"]: eq+eq then
    // desc-order walks dealScore high→low (score-less rows sort last).
    return await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .order("desc")
      .take(limit ?? 100);
  },
});

/** The most recently discovered listings (newest firstSeen first, capped). */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("monitorListings")
      .withIndex("by_firstSeen")
      .order("desc")
      .take(limit ?? 100);
  },
});

// ---- Phase 3: per-user triage (board / sheet / triage writes) ----

const passReasonV = v.union(
  v.literal("bad_area"),
  v.literal("arv_wrong"),
  v.literal("rehab_heavy"),
  v.literal("overpriced"),
  v.literal("other"),
);
const BOARD_LIMIT = 300;

async function triageFor(ctx: QueryCtx | MutationCtx, userId: string, listingId: Id<"monitorListings">) {
  return await ctx.db
    .query("monitorTriage")
    .withIndex("by_user_listing", (q) => q.eq("userId", userId).eq("listingId", listingId))
    .unique();
}
function pickTriage(t: Doc<"monitorTriage"> | null): TriageState | null {
  if (!t) return null;
  return { passedAt: t.passedAt, passReason: t.passReason, shortlistedAt: t.shortlistedAt, snoozedUntil: t.snoozedUntil };
}

/**
 * The /monitor board: active keepers (best score first) as a SLIM projection.
 * Reads ONLY monitorListings, so a triage write or markSeen never re-runs it
 * (Convex bills documents read; 06-08 quota lesson). Per-user state comes from
 * boardState and is merged on the client. The sheet reads the full doc via listingForMe.
 */
export const board = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const keepers = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .order("desc")
      .take(BOARD_LIMIT);
    return keepers.map((r) => ({
      _id: r._id,
      address: r.address,
      propCity: r.propCity,
      propZip: r.propZip,
      beds: r.beds,
      baths: r.baths,
      sqft: r.sqft,
      listPrice: r.listPrice,
      photo: r.photoUrls?.[0],
      bestExit: r.bestExit,
      dealScore: r.dealScore,
      roomVsList: r.roomVsList,
      flipMao: r.flipMao,
      flipMargin: r.flipMargin,
      cashFlow: r.cashFlow,
      dscr: r.dscr,
      capRate: r.capRate,
      spread: r.spread,
      zestimate: r.zestimate,
      firstSeen: r.firstSeen,
      promotedDealId: r.promotedDealId,
      hasOwnerSignal:
        (r.offMarketSignals?.length ?? 0) > 0 || r.offMarketBalances != null || r.offMarketConditionScore != null,
    }));
  },
});

/**
 * The caller's per-user board state: every triage row (prefix scan on
 * by_user_listing; rows are ~100 bytes) plus the "last looked" watermark. This is
 * the only board query a P/S keystroke or markSeen invalidates.
 */
export const boardState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("monitorTriage")
      .withIndex("by_user_listing", (q) => q.eq("userId", userId))
      .collect();
    const seen = await ctx.db
      .query("monitorSeen")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      triage: rows.map((t) => ({ listingId: t.listingId, ...pickTriage(t)! })),
      lastSeenAt: seen?.lastSeenAt ?? null,
    };
  },
});

/**
 * One listing + the caller's triage, for the deal sheet and the email deep link
 * (/monitor?id=...). Takes a plain string: a garbage or foreign id returns null
 * instead of throwing a validator error. Archived/non-keeper listings still open.
 */
export const listingForMe = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const lid = ctx.db.normalizeId("monitorListings", id);
    if (!lid) return null;
    const listing = await ctx.db.get(lid);
    if (!listing) return null;
    return { listing, triage: pickTriage(await triageFor(ctx, userId, lid)) };
  },
});

/** Shortlist / unshortlist / pass(reason) / snooze 7d / restore — for the caller only. */
export const setTriage = mutation({
  args: {
    listingId: v.id("monitorListings"),
    action: v.union(
      v.literal("shortlist"),
      v.literal("unshortlist"),
      v.literal("pass"),
      v.literal("snooze"),
      v.literal("restore"),
    ),
    reason: v.optional(passReasonV),
  },
  handler: async (ctx, { listingId, action, reason }): Promise<TriageState> => {
    const userId = await requireUser(ctx);
    if (!(await ctx.db.get(listingId))) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That listing no longer exists." });
    }
    if (action === "pass" && !reason) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Pick a reason to pass." });
    }
    const now = Date.now();
    const next = applyTriage(action === "pass" ? { kind: "pass", reason: reason! } : { kind: action }, now);
    const existing = await triageFor(ctx, userId, listingId);
    if (existing) {
      // Write every field: keys absent from `next` become undefined = removed.
      await ctx.db.patch(existing._id, {
        passedAt: next.passedAt,
        passReason: next.passReason,
        shortlistedAt: next.shortlistedAt,
        snoozedUntil: next.snoozedUntil,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("monitorTriage", { userId, listingId, ...next, updatedAt: now });
    }
    return next;
  },
});

/** Stamp the caller's "last looked at the board" time (drives "N new since you looked"). */
export const markSeen = mutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("monitorSeen")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { lastSeenAt: now });
    else await ctx.db.insert("monitorSeen", { userId, lastSeenAt: now });
    return now;
  },
});

/**
 * Admin "Run now" on /monitor: schedule one manual scan. `runMonitorScan`'s manual
 * trigger skips the cron/webhook guards, so this mutation guards itself (no fresh
 * running run, nothing started in the last 10 min). Costs Firecrawl + LLM credits,
 * so it is admin-only and the page confirms first.
 */
export const requestScan = mutation({
  args: {},
  // Explicit return type: references internal.monitorActions.* (circular-inference
  // cycle with monitorActions, lessons 2026-06-01).
  handler: async (ctx): Promise<{ scheduled: true }> => {
    await requireAdmin(ctx);
    const recent = await ctx.db.query("monitorRuns").withIndex("by_started").order("desc").first();
    const blocked = scanBlockedReason(recent, Date.now());
    if (blocked) throw new ConvexError({ code: "BUSY", message: blocked });
    await ctx.scheduler.runAfter(0, internal.monitorActions.runMonitorScan, { trigger: "manual" });
    return { scheduled: true };
  },
});

/**
 * Public (requireUser-gated) counterpart to the internal `setPromotedDeal`: the
 * /monitor page calls this right after `potentialData.promoteToPotential` succeeds
 * to stamp the returned deal id on the listing row, so the card flips to "In
 * pipeline". Same patch as the internal fn, but callable from the browser.
 */
export const markPromoted = mutation({
  args: {
    id: v.id("monitorListings"),
    promotedDealId: v.id("potentialDeals"),
  },
  handler: async (ctx, { id, promotedDealId }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { promotedDealId, updatedAt: Date.now() });
  },
});

/**
 * The /monitor header summary. Returns the latest run row (any status, as before)
 * plus a trailing-24h aggregate so the header reports the night's real result
 * instead of echoing one arbitrary run (e.g. a 0-new webhook retry). Null only
 * when no runs exist. Walks `by_started` desc and stops once startedAt leaves the
 * window (no history table-scan).
 */
export const latestRun = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = ctx.db.query("monitorRuns").withIndex("by_started").order("desc");
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let run: Doc<"monitorRuns"> | null = null;
    let newLast24h = 0;
    let runsLast24h = 0;
    for await (const r of rows) {
      if (run === null) run = r;
      if (r.startedAt < cutoff) break;
      newLast24h += r.newCount;
      runsLast24h += 1;
    }
    if (run === null) return null;
    return { run, newLast24h, runsLast24h };
  },
});

/**
 * The moat (shared body): cross-reference an on-market listing against the CRM's
 * off-market parcel spine. Search `parcels` for the address, take the best match,
 * then gather that parcel's distress signals, delinquent NCC balances, and
 * Street-View condition score. Read-only. Both the public `offMarketFor` (UI,
 * requireUser-gated) and the internal `offMarketForInternal` (the scheduled
 * analyze action, which has no user identity) wrap this one helper — one query
 * body, two thin auth wrappers. Returns a compact summary or null when no parcel matches.
 */
// Leading house number from a street address (e.g. "837 HASTING CT" -> "837").
// null when the string has no leading digits — never blocks the match in that case.
const houseNum = (s: string) => {
  const m = (s || "").trim().match(/^\d+/);
  return m ? m[0] : null;
};

async function crossRefOffMarket(
  ctx: QueryCtx,
  address: string,
  zip: string | undefined,
) {
  const queryText = normalizeAddress(zip ? `${address} ${zip}` : address);
  if (!queryText) return null;

  const parcel = await ctx.db
    .query("parcels")
    .withSearchIndex("search_text", (s) => s.search("searchText", queryText))
    .first();
  if (!parcel) return null;

  // House-number guard: the search index can return a same-street WRONG parcel
  // (e.g. "837 Hasting Ct" matching "839 Hasting Ct"). Only block when BOTH sides
  // parse to a number and they differ — an unparseable number never blocks (avoid
  // false negatives).
  const inputNum = houseNum(address);
  const parcelNum = houseNum(parcel.situsStreet);
  if (inputNum && parcelNum && inputNum !== parcelNum) return null;

  const prclid = parcel.prclid;

  const signalRows = await ctx.db
    .query("signalEvents")
    .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
    .collect();
  const signals = Array.from(
    new Set(signalRows.map((r) => r.type).filter((t) => !!t)),
  );

  const equity = await ctx.db
    .query("parcelEquity")
    .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
    .first();
  let balances: number | null = null;
  if (equity) {
    const parts = [
      equity.countyBalance,
      equity.schoolBalance,
      equity.sewerBalance,
    ].filter((n): n is number => typeof n === "number");
    balances = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  }

  const condition = await ctx.db
    .query("parcelCondition")
    .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
    .first();
  const conditionScore = condition?.score ?? null;

  return { prclid, signals, balances, conditionScore };
}

/** Public (UI) off-market cross-reference — requireUser-gated. */
export const offMarketFor = query({
  args: { address: v.string(), zip: v.optional(v.string()) },
  handler: async (ctx, { address, zip }) => {
    await requireUser(ctx);
    return crossRefOffMarket(ctx, address, zip);
  },
});

/**
 * Internal off-market cross-reference for the scheduled analyze action. Scheduled
 * actions carry NO user identity, so they cannot call the requireUser-gated
 * `offMarketFor`; this variant runs the same helper with no auth gate. Read-only.
 */
export const offMarketForInternal = internalQuery({
  args: { address: v.string(), zip: v.optional(v.string()) },
  handler: async (ctx, { address, zip }) => {
    return crossRefOffMarket(ctx, address, zip);
  },
});
