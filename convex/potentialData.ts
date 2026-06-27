import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser } from "./helpers";
import { getAuthUser } from "./lib/getAuthUser";
import { dealDedupeKey } from "../src/scraper/potentialPipeline";

// "Potential" curated deals pipeline — V8 data layer (shared-team requireUser).
// Strictly additive: no existing fn or pipeline is touched. createdByEmail is
// stamped server-side (mirrors convex/offerData.ts).
// Spec: docs/superpowers/specs/2026-06-26-potential-deals-pipeline-design.md.

const stageV = v.union(
  v.literal("to_work"),
  v.literal("contacted"),
  v.literal("negotiating"),
  v.literal("under_contract"),
  v.literal("closed"),
  v.literal("dead"),
);

const activityTypeV = v.union(
  v.literal("call"),
  v.literal("door_knock"),
  v.literal("text"),
  v.literal("email"),
  v.literal("note"),
);

const sourceV = v.object({
  kind: v.union(
    v.literal("lead"),
    v.literal("sheriff"),
    v.literal("legal"),
    v.literal("manual"),
  ),
  refId: v.optional(v.string()),
});

/**
 * Promote a lead / sheriff / legal row (or a manual address) into the Potential
 * pipeline. De-duplicated by dedupeKey: if a deal already exists we return it
 * untouched (never overwrite an in-progress deal); else insert at "to_work".
 */
export const promoteToPotential = mutation({
  args: {
    source: sourceV,
    prclid: v.optional(v.string()),
    address: v.string(),
    ownerName: v.optional(v.string()),
    propCity: v.optional(v.string()),
    propZip: v.optional(v.string()),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    sqft: v.optional(v.number()),
    value: v.optional(v.number()),
    equity: v.optional(v.number()),
    score: v.optional(v.number()),
    topSignals: v.optional(v.array(v.string())),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireUser(ctx);
    if (!a.address.trim()) {
      throw new ConvexError({ code: "BAD_INPUT", message: "An address is required to add a deal." });
    }
    const dedupeKey = dealDedupeKey({ prclid: a.prclid, address: a.address });
    const existing = await ctx.db
      .query("potentialDeals")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (existing) {
      return { id: existing._id, alreadyExisted: true };
    }
    const me = await getAuthUser(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("potentialDeals", {
      prclid: a.prclid,
      dedupeKey,
      source: a.source,
      address: a.address,
      ownerName: a.ownerName,
      propCity: a.propCity,
      propZip: a.propZip,
      beds: a.beds,
      baths: a.baths,
      sqft: a.sqft,
      value: a.value,
      equity: a.equity,
      score: a.score,
      topSignals: a.topSignals,
      contactName: a.contactName,
      contactPhone: a.contactPhone,
      contactEmail: a.contactEmail,
      stage: "to_work",
      createdByEmail: me?.email,
      createdAt: now,
      updatedAt: now,
    });
    return { id, alreadyExisted: false };
  },
});

/** All deals for the board (small table). Newest-updated first. */
export const listDeals = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("potentialDeals").collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** The deal id for a dedupeKey (or null) — lets source pages show "In Pipeline". */
export const dealByDedupeKey = query({
  args: { dedupeKey: v.string() },
  handler: async (ctx, { dedupeKey }) => {
    await requireUser(ctx);
    if (!dedupeKey) return null;
    const row = await ctx.db
      .query("potentialDeals")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    return row ? row._id : null;
  },
});

/** One deal (drawer). */
export const getDeal = query({
  args: { id: v.id("potentialDeals") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    return await ctx.db.get(id);
  },
});

/** The touch log for a deal, newest first. */
export const activitiesForDeal = query({
  args: { dealId: v.id("potentialDeals") },
  handler: async (ctx, { dealId }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("dealActivities")
      .withIndex("by_deal", (q) => q.eq("dealId", dealId))
      .collect();
    return rows.sort((a, b) => b.occurredAt - a.occurredAt);
  },
});

/** Move a deal to a new stage. */
export const setDealStage = mutation({
  args: { id: v.id("potentialDeals"), stage: stageV },
  handler: async (ctx, { id, stage }) => {
    await requireUser(ctx);
    const deal = await ctx.db.get(id);
    if (!deal) throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found" });
    await ctx.db.patch(id, { stage, updatedAt: Date.now() });
  },
});

/** Patch contact / notes / editable snapshot fields (explicit allowed keys; no blind spread). */
export const updateDeal = mutation({
  args: {
    id: v.id("potentialDeals"),
    patch: v.object({
      contactName: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      notes: v.optional(v.string()),
      ownerName: v.optional(v.string()),
      value: v.optional(v.number()),
      equity: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireUser(ctx);
    const deal = await ctx.db.get(id);
    if (!deal) throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found" });
    const update: {
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      notes?: string;
      ownerName?: string;
      value?: number;
      equity?: number;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (patch.contactName !== undefined) update.contactName = patch.contactName;
    if (patch.contactPhone !== undefined) update.contactPhone = patch.contactPhone;
    if (patch.contactEmail !== undefined) update.contactEmail = patch.contactEmail;
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.ownerName !== undefined) update.ownerName = patch.ownerName;
    if (patch.value !== undefined) update.value = patch.value;
    if (patch.equity !== undefined) update.equity = patch.equity;
    await ctx.db.patch(id, update);
  },
});

/** Set or clear the next follow-up (undefined args clear the field). */
export const setNextFollowUp = mutation({
  args: {
    id: v.id("potentialDeals"),
    at: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, at, note }) => {
    await requireUser(ctx);
    const deal = await ctx.db.get(id);
    if (!deal) throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found" });
    await ctx.db.patch(id, {
      nextFollowUpAt: at,
      nextFollowUpNote: note,
      updatedAt: Date.now(),
    });
  },
});

/** Log a touch (default occurredAt = now); stamp createdByEmail + bump the deal. */
export const addActivity = mutation({
  args: {
    dealId: v.id("potentialDeals"),
    type: activityTypeV,
    outcome: v.optional(v.string()),
    note: v.optional(v.string()),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, { dealId, type, outcome, note, occurredAt }) => {
    await requireUser(ctx);
    const deal = await ctx.db.get(dealId);
    if (!deal) throw new ConvexError({ code: "NOT_FOUND", message: "Deal not found" });
    const me = await getAuthUser(ctx);
    const now = Date.now();
    const id = await ctx.db.insert("dealActivities", {
      dealId,
      type,
      outcome,
      note,
      occurredAt: occurredAt ?? now,
      createdByEmail: me?.email,
      createdAt: now,
    });
    await ctx.db.patch(dealId, { updatedAt: now });
    return id;
  },
});

/** Delete one logged touch. */
export const deleteActivity = mutation({
  args: { id: v.id("dealActivities") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.delete(id);
  },
});

/** Delete a deal and cascade-delete its activity log. */
export const deleteDeal = mutation({
  args: { id: v.id("potentialDeals") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const activities = await ctx.db
      .query("dealActivities")
      .withIndex("by_deal", (q) => q.eq("dealId", id))
      .collect();
    for (const a of activities) {
      await ctx.db.delete(a._id);
    }
    await ctx.db.delete(id);
  },
});
