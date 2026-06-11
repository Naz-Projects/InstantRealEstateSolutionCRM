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

// ---- funnel KPIs (dashboard + board) ----

/** Lead counts by stage + pipeline fee totals + follow-up urgency counts. */
export const funnelStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const statuses = await ctx.db.query("leadStatus").collect();
    const byStage: Record<string, number> = {};
    let pipelineFees = 0;
    let closedFees = 0;
    for (const s of statuses) {
      byStage[s.stage] = (byStage[s.stage] ?? 0) + 1;
      if (s.assignmentFee) {
        if (s.stage === "closed") closedFees += s.assignmentFee;
        else if (s.stage === "marketing" || s.stage === "assigned") pipelineFees += s.assignmentFee;
      }
    }
    const openFollowUps = await ctx.db
      .query("followUps")
      .withIndex("by_done_due", (q) => q.eq("done", false))
      .collect();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const today = Math.floor(now / DAY);
    let overdue = 0;
    let dueToday = 0;
    for (const f of openFollowUps) {
      const d = Math.floor(f.dueAt / DAY);
      if (d < today) overdue++;
      else if (d === today) dueToday++;
    }
    return { byStage, pipelineFees, closedFees, overdue, dueToday, openFollowUps: openFollowUps.length };
  },
});

// ---- follow-up tasks (P2) ----

export const addFollowUp = mutation({
  args: { prclid: v.string(), note: v.string(), dueAt: v.number() },
  handler: async (ctx, { prclid, note, dueAt }) => {
    await requireUser(ctx);
    return await ctx.db.insert("followUps", {
      prclid,
      note: note.trim(),
      dueAt,
      done: false,
      createdAt: Date.now(),
    });
  },
});

export const setFollowUpDone = mutation({
  args: { id: v.id("followUps"), done: v.boolean() },
  handler: async (ctx, { id, done }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { done });
  },
});

/** All OPEN follow-ups (small), due-soonest first — badges + per-lead lists join client-side. */
export const openFollowUps = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db
      .query("followUps")
      .withIndex("by_done_due", (q) => q.eq("done", false))
      .order("asc")
      .take(500);
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
