import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./helpers";

export const createRun = internalMutation({
  args: {
    type: v.union(v.literal("sheriff"), v.literal("legal")),
    label: v.string(),
    listingCount: v.number(),
    triggeredBy: v.string(),
  },
  handler: async (ctx, a) =>
    ctx.db.insert("scrapeRuns", {
      type: a.type,
      label: a.label,
      status: "running",
      listingCount: a.listingCount,
      enrichedCount: 0,
      startedAt: Date.now(),
      triggeredBy: a.triggeredBy,
    }),
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) =>
    ctx.db.patch(a.runId, { status: a.status, finishedAt: Date.now(), error: a.error }),
});

// Called once per enriched listing; flips the run to complete when all are done.
export const bumpEnriched = internalMutation({
  args: { runId: v.id("scrapeRuns") },
  handler: async (ctx, a) => {
    const run = await ctx.db.get(a.runId);
    if (!run) return;
    const enrichedCount = run.enrichedCount + 1;
    const done = enrichedCount >= run.listingCount;
    await ctx.db.patch(a.runId, {
      enrichedCount,
      ...(done ? { status: "complete" as const, finishedAt: Date.now() } : {}),
    });
  },
});

export const listRuns = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.db.query("scrapeRuns").order("desc").take(50);
  },
});

// Dashboard counts: listings per deal stage (sheriff) for "how many we looked at".
export const dashboardStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const sheriff = await ctx.db.query("sheriffListings").collect();
    const legal = await ctx.db.query("legalNotices").collect();
    const byStage = (rows: { dealStatus: string }[]) => {
      const m: Record<string, number> = { new: 0, reviewing: 0, contacted: 0, offer: 0, dead: 0 };
      for (const r of rows) m[r.dealStatus] = (m[r.dealStatus] ?? 0) + 1;
      return m;
    };
    return {
      sheriffTotal: sheriff.length,
      legalTotal: legal.length,
      sheriffByStage: byStage(sheriff),
      legalByStage: byStage(legal),
    };
  },
});
