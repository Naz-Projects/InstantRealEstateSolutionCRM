import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireUser } from "./helpers";
import { normalizeAddress } from "../src/scraper/potentialPipeline";

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
  wholesaleSpread: v.optional(v.number()),
  // decision
  dealScore: v.optional(v.number()),
  bestExit: v.optional(v.string()),
  riskFlags: v.optional(v.array(v.string())),
  keeper: v.optional(v.boolean()),
  aiKeep: v.optional(v.boolean()),
  matchedRequirements: v.optional(v.array(v.string())),
  aiReason: v.optional(v.string()),
  aiConditionNotes: v.optional(v.string()),
  aiConfidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  aiModel: v.optional(v.string()),
  // off-market cross-reference match
  offMarketPrclid: v.optional(v.string()),
  offMarketSignals: v.optional(v.array(v.string())),
  offMarketBalances: v.optional(v.number()),
  offMarketConditionScore: v.optional(v.number()),
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
 * firstSeen/lastSeen/updatedAt). Repeat zpid → bump lastSeen; if this scan's
 * listPrice is strictly below the stored one, record the drop (prevListPrice =
 * old, listPrice = new) so the analyze step can re-surface it as a motivated
 * seller. On a repeat we do NOT overwrite the analyzed fields with card data.
 */
export const upsertListing = internalMutation({
  args: listingUpsertArgs,
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("monitorListings")
      .withIndex("by_zpid", (q) => q.eq("zpid", args.zpid))
      .first();

    if (!existing) {
      const id = await ctx.db.insert("monitorListings", {
        ...args,
        status: "pending" as const,
        firstSeen: now,
        lastSeen: now,
        updatedAt: now,
      });
      return { id, isNew: true, priceDropped: false };
    }

    const patch: {
      lastSeen: number;
      updatedAt: number;
      prevListPrice?: number;
      listPrice?: number;
    } = { lastSeen: now, updatedAt: now };

    let priceDropped = false;
    if (
      args.listPrice != null &&
      existing.listPrice != null &&
      args.listPrice < existing.listPrice
    ) {
      priceDropped = true;
      patch.prevListPrice = existing.listPrice;
      patch.listPrice = args.listPrice; // move current price down so the drop can't re-fire daily
    }
    await ctx.db.patch(existing._id, patch);
    return { id: existing._id, isNew: false, priceDropped };
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

/** Patch one listing with any analysis/valuation/exit/decision output. */
export const patchAnalysis = internalMutation({
  args: { id: v.id("monitorListings"), fields: analysisFields },
  handler: async (ctx, { id, fields }) => {
    await ctx.db.patch(id, { ...fields, updatedAt: Date.now() });
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

/** Finalize a run with its counts (source override for the Redfin fallback). */
export const finishRun = internalMutation({
  args: {
    id: v.id("monitorRuns"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    scanned: v.number(),
    newCount: v.number(),
    analyzedCount: v.number(),
    keeperCount: v.number(),
    emailedCount: v.number(),
    source: v.optional(v.union(v.literal("zillow"), v.literal("redfin"))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...rest }) => {
    await ctx.db.patch(id, { ...rest, finishedAt: Date.now() });
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

// ---- browser-facing (requireUser-gated) reads for /monitor ----

/** Keepers, best deal on top. Small set — collect + sort by dealScore desc. */
export const listKeepers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper", (q) => q.eq("keeper", true))
      .collect();
    rows.sort((a, b) => (b.dealScore ?? -Infinity) - (a.dealScore ?? -Infinity));
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
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

/** One listing (the /monitor card drawer). */
export const getListing = query({
  args: { id: v.id("monitorListings") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    return await ctx.db.get(id);
  },
});

/** The latest run for the /monitor header summary (null before the first run). */
export const latestRun = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db
      .query("monitorRuns")
      .withIndex("by_started")
      .order("desc")
      .first();
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
