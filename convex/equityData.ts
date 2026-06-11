import { v } from "convex/values";
import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./helpers";

// P4 equity gate — V8 data layer for the parcelEquity enrichment table.
// Shared-team model (same as pipelineData): any signed-in member acts on any lead.

/** Spine row for the enrich action (address + prclid). */
export const getParcelInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    return await ctx.db
      .query("parcels")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
  },
});

/** CLI/live-verify reader (deploy-key access bypasses function auth). */
export const getEquityInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    return await ctx.db
      .query("parcelEquity")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
  },
});

/**
 * Upsert enrichment results by prclid — only provided fields change, so the
 * value scrape and the balances scrape can land independently (partial success
 * is fine). `lastError: null` clears a stale error after a clean run.
 */
export const storeEnrichment = internalMutation({
  args: {
    prclid: v.string(),
    value: v.optional(v.number()),
    valueSource: v.optional(v.union(v.literal("zestimate"), v.literal("comps"))),
    valueAt: v.optional(v.number()),
    countyBalance: v.optional(v.number()),
    schoolBalance: v.optional(v.number()),
    sewerBalance: v.optional(v.number()),
    assessedValue: v.optional(v.number()),
    balancesAt: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { prclid, lastError, ...fields }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) patch[k] = val;
    }
    if (lastError !== undefined) patch.lastError = lastError ?? undefined;
    const existing = await ctx.db
      .query("parcelEquity")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("parcelEquity", { prclid, ...patch } as any);
  },
});

/** Team-entered known liens (e.g. mortgage payoff from the docket). null clears. */
export const setManualLiens = mutation({
  args: {
    prclid: v.string(),
    amount: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { prclid, amount, note }) => {
    await requireUser(ctx);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (amount !== undefined) patch.manualLiens = amount ?? undefined;
    if (note !== undefined) patch.manualLiensNote = note ?? undefined;
    const existing = await ctx.db
      .query("parcelEquity")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("parcelEquity", { prclid, ...patch } as any);
  },
});
