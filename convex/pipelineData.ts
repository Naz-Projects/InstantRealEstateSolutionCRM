import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser } from "./helpers";

// Wholesaling pipeline v1 — lead workflow state + the cash-buyer CRM.
// Shared-team model (same as flip/properties): any signed-in member acts on any lead.
// Spec: docs/superpowers/specs/2026-06-11-wholesaling-pipeline-crm.md.

const stageV = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("negotiating"),
  v.literal("under_contract"),
  v.literal("marketing"),
  v.literal("assigned"),
  v.literal("closed"),
  v.literal("dead"),
);

/** Set/update a lead's workflow state (upsert by prclid; only provided fields change). */
export const setLeadStatus = mutation({
  args: {
    prclid: v.string(),
    stage: v.optional(stageV),
    notes: v.optional(v.string()),
    buyerId: v.optional(v.union(v.id("buyers"), v.null())), // null clears the assignment
    assignmentFee: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { prclid, stage, notes, buyerId, assignmentFee }) => {
    await requireUser(ctx);
    const existing = await ctx.db
      .query("leadStatus")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (stage !== undefined) patch.stage = stage;
    if (notes !== undefined) patch.notes = notes;
    if (buyerId !== undefined) patch.buyerId = buyerId ?? undefined;
    if (assignmentFee !== undefined) patch.assignmentFee = assignmentFee ?? undefined;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("leadStatus", {
      prclid,
      stage: stage ?? "new",
      notes: notes ?? undefined,
      buyerId: buyerId ?? undefined,
      assignmentFee: assignmentFee ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

/** All worked-lead statuses (small: only parcels a human has touched). */
export const leadStatuses = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("leadStatus").collect();
  },
});

// ---- buyers CRM ----

export const listBuyers = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { includeInactive }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("buyers").collect();
    return rows
      .filter((b) => includeInactive || b.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const upsertBuyer = mutation({
  args: {
    id: v.optional(v.id("buyers")),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    buyerType: v.union(v.literal("cash"), v.literal("landlord"), v.literal("flipper")),
    targetAreas: v.optional(v.string()),
    maxPrice: v.optional(v.number()),
    notes: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...fields }) => {
    await requireUser(ctx);
    if (id) {
      await ctx.db.patch(id, fields);
      return id;
    }
    return await ctx.db.insert("buyers", { ...fields, active: fields.active ?? true });
  },
});

export const deleteBuyer = mutation({
  args: { id: v.id("buyers") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    // Clear any lead assignments pointing at this buyer, then remove.
    const statuses = await ctx.db.query("leadStatus").collect();
    for (const s of statuses) {
      if (s.buyerId === id) await ctx.db.patch(s._id, { buyerId: undefined });
    }
    await ctx.db.delete(id);
  },
});
