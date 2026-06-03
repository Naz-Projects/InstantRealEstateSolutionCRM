import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUser } from "./helpers";
import { dealStatus } from "./schema";
import { parseMoney } from "../src/scraper/deal";
import {
  computeFlip,
  estimateRehab,
  REHAB_TIERS,
  FLIP_DEFAULTS,
} from "../src/scraper/flip";

const assumptionsValidator = v.object({
  closingPct: v.number(),
  downPct: v.number(),
  loanPoints: v.number(),
  annualRate: v.number(),
  holdingMonths: v.number(),
  monthlyHolding: v.number(),
  sellAgentPct: v.number(),
  sellTransferPct: v.number(),
  sellClosingPct: v.number(),
});

// Attach the computed rehab estimate + flip metrics to a stored analysis.
function withMetrics(a: Doc<"flipAnalyses">) {
  const rehab = estimateRehab(a.rehabPerSqft, a.sqft ?? null, a.contingencyPct, a.rehabOverride ?? null);
  const metrics = computeFlip({
    arv: a.arv ?? null,
    purchasePrice: a.purchasePrice ?? null,
    rehabTotal: rehab.total,
    assumptions: a.assumptions,
  });
  return { ...a, rehab, metrics };
}

export const listAnalyses = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("flipAnalyses").order("desc").collect();
    const withM = rows.map(withMetrics);
    const RANK: Record<string, number> = { good: 0, ok: 1, thin: 2, bad: 3, unknown: 4 };
    withM.sort((x, y) => {
      const rx = RANK[x.metrics.grade] ?? 9;
      const ry = RANK[y.metrics.grade] ?? 9;
      if (rx !== ry) return rx - ry;
      const px = x.metrics.profit;
      const py = y.metrics.profit;
      if (px === null && py === null) return 0;
      if (px === null) return 1;
      if (py === null) return -1;
      return py - px;
    });
    return withM;
  },
});

export const getAnalysis = query({
  args: { id: v.id("flipAnalyses") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const a = await ctx.db.get(id);
    return a ? withMetrics(a) : null;
  },
});

// Recent sheriff + legal rows to populate the "create from listing" picker.
// Read-only — does not modify those tables.
export const candidates = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const sheriff = await ctx.db.query("sheriffListings").order("desc").take(200);
    const legal = await ctx.db.query("legalNotices").order("desc").take(200);
    const pick = (r: { _id: string; address: string }) => ({ id: r._id, address: r.address });
    return { sheriff: sheriff.map(pick), legal: legal.map(pick) };
  },
});

function seed(
  source: Doc<"flipAnalyses">["source"],
  facts: { address: string; sqft?: number; beds?: string; baths?: string; asIsValue?: number },
  createdBy: string,
) {
  const now = Date.now();
  return {
    source,
    address: facts.address,
    sqft: facts.sqft,
    beds: facts.beds,
    baths: facts.baths,
    asIsValue: facts.asIsValue,
    arv: facts.asIsValue, // pre-fill ARV with the as-is Zestimate as an anchor
    purchasePrice: undefined,
    rehabTier: "moderate" as const,
    rehabPerSqft: REHAB_TIERS.moderate.perSqft,
    rehabOverride: undefined,
    contingencyPct: FLIP_DEFAULTS.contingencyPct,
    assumptions: FLIP_DEFAULTS.assumptions,
    dealStatus: "new" as const,
    notes: undefined,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export const createFromSheriff = mutation({
  args: { listingId: v.id("sheriffListings") },
  handler: async (ctx, { listingId }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Sheriff listing not found");
    return ctx.db.insert(
      "flipAnalyses",
      seed(
        { kind: "sheriff", listingId: String(listingId) },
        {
          address: l.address,
          sqft: parseMoney(l.sqft) ?? undefined,
          beds: l.beds,
          baths: l.baths,
          asIsValue: parseMoney(l.zestimate) ?? undefined,
        },
        user,
      ),
    );
  },
});

export const createFromLegal = mutation({
  args: { listingId: v.id("legalNotices") },
  handler: async (ctx, { listingId }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Legal notice not found");
    return ctx.db.insert(
      "flipAnalyses",
      seed(
        { kind: "legal", listingId: String(listingId) },
        {
          address: l.address,
          sqft: parseMoney(l.sqft) ?? undefined,
          beds: l.beds,
          baths: l.baths,
          asIsValue: parseMoney(l.zestimate) ?? undefined,
        },
        user,
      ),
    );
  },
});

export const createManual = mutation({
  args: {
    address: v.string(),
    sqft: v.optional(v.number()),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    asIsValue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return ctx.db.insert("flipAnalyses", seed({ kind: "manual" }, args, user));
  },
});

export const updateAnalysis = mutation({
  args: {
    id: v.id("flipAnalyses"),
    patch: v.object({
      arv: v.optional(v.union(v.number(), v.null())),
      purchasePrice: v.optional(v.union(v.number(), v.null())),
      rehabTier: v.optional(
        v.union(v.literal("cosmetic"), v.literal("moderate"), v.literal("gut"), v.literal("custom")),
      ),
      rehabPerSqft: v.optional(v.number()),
      rehabOverride: v.optional(v.union(v.number(), v.null())),
      contingencyPct: v.optional(v.number()),
      assumptions: v.optional(assumptionsValidator),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireUser(ctx);
    const a = await ctx.db.get(id);
    if (!a) throw new Error("Analysis not found");
    await ctx.db.patch(id, {
      arv: "arv" in patch ? patch.arv ?? undefined : a.arv,
      purchasePrice: "purchasePrice" in patch ? patch.purchasePrice ?? undefined : a.purchasePrice,
      rehabTier: patch.rehabTier ?? a.rehabTier,
      rehabPerSqft: patch.rehabPerSqft ?? a.rehabPerSqft,
      rehabOverride: "rehabOverride" in patch ? patch.rehabOverride ?? undefined : a.rehabOverride,
      contingencyPct: patch.contingencyPct ?? a.contingencyPct,
      assumptions: patch.assumptions ?? a.assumptions,
      notes: patch.notes ?? a.notes,
      updatedAt: Date.now(),
    });
  },
});

export const setFlipDealStatus = mutation({
  args: { id: v.id("flipAnalyses"), dealStatus },
  handler: async (ctx, { id, dealStatus }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { dealStatus, updatedAt: Date.now() });
  },
});

export const deleteAnalysis = mutation({
  args: { id: v.id("flipAnalyses") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.delete(id);
  },
});
