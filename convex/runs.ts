import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./helpers";

const level = v.union(v.literal("info"), v.literal("warn"), v.literal("error"));

// Created at the very start of a scrape (before fetch) so fetch failures and
// idempotency skips are still recorded against a visible run.
export const createRun = internalMutation({
  args: {
    type: v.union(v.literal("sheriff"), v.literal("legal")),
    triggeredBy: v.string(),
  },
  handler: async (ctx, a) =>
    ctx.db.insert("scrapeRuns", {
      type: a.type,
      label: "",
      status: "running",
      phase: "starting",
      listingCount: 0,
      enrichedCount: 0,
      failedCount: 0,
      startedAt: Date.now(),
      triggeredBy: a.triggeredBy,
    }),
});

// Patch run metadata as the pipeline learns it (label/count after parse, phase per step).
export const patchRun = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    label: v.optional(v.string()),
    phase: v.optional(v.string()),
    listingCount: v.optional(v.number()),
  },
  handler: async (ctx, { runId, ...rest }) => {
    const patch = Object.fromEntries(Object.entries(rest).filter(([, val]) => val !== undefined));
    await ctx.db.patch(runId, patch);
  },
});

// Append one step event for the live progress log.
export const logEvent = internalMutation({
  args: { runId: v.id("scrapeRuns"), phase: v.string(), message: v.string(), level: v.optional(level) },
  handler: async (ctx, a) =>
    ctx.db.insert("scrapeEvents", {
      runId: a.runId,
      phase: a.phase,
      message: a.message,
      level: a.level ?? "info",
    }),
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  // Leave `phase` as-is: for a failed run it marks which step died (UI shows it
  // red); for a completed/skipped run the status already drives the "done" view.
  handler: async (ctx, a) => ctx.db.patch(a.runId, { status: a.status, finishedAt: Date.now(), error: a.error }),
});

// Called once per processed listing; tracks success vs failure and flips the
// run to complete when every listing has been processed.
export const bumpEnriched = internalMutation({
  args: { runId: v.id("scrapeRuns"), failed: v.boolean() },
  handler: async (ctx, { runId, failed }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const enrichedCount = run.enrichedCount + (failed ? 0 : 1);
    const failedCount = (run.failedCount ?? 0) + (failed ? 1 : 0);
    const done = enrichedCount + failedCount >= run.listingCount;
    await ctx.db.patch(runId, {
      enrichedCount,
      failedCount,
      ...(done ? { status: "complete" as const, phase: "done", finishedAt: Date.now() } : {}),
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

// The most recent run of a type — drives the live progress stepper on each page.
export const latestRun = query({
  args: { type: v.union(v.literal("sheriff"), v.literal("legal")) },
  handler: async (ctx, { type }) => {
    await requireUser(ctx);
    return ctx.db
      .query("scrapeRuns")
      .withIndex("by_type", (q) => q.eq("type", type))
      .order("desc")
      .first();
  },
});

// Step events for a run, oldest-first, for the live log.
export const listEvents = query({
  args: { runId: v.id("scrapeRuns") },
  handler: async (ctx, { runId }) => {
    await requireUser(ctx);
    return ctx.db
      .query("scrapeEvents")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("asc")
      .take(500);
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
