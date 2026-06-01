import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireUser } from "./helpers";
import { dealStatus } from "./schema";
import { parseMoney } from "../src/scraper/deal";

export const startScrape = mutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }) => {
    const user = await requireUser(ctx);
    const running = await ctx.db
      .query("scrapeRuns")
      .withIndex("by_type", (q) => q.eq("type", "legal"))
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return { status: "already_running" as const, runId: running._id };

    await ctx.scheduler.runAfter(0, internal.legalActions.runLegalScrape, {
      triggeredBy: user,
      force: force ?? false,
    });
    return { status: "started" as const };
  },
});

export const countByWeek = internalQuery({
  args: { weekDate: v.string() },
  handler: async (ctx, { weekDate }) => {
    const rows = await ctx.db
      .query("legalNotices")
      .withIndex("by_weekDate", (q) => q.eq("weekDate", weekDate))
      .collect();
    return rows.length;
  },
});

export const insertNotice = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    weekDate: v.string(),
    title: v.string(),
    ownerName: v.string(),
    address: v.string(),
    personalRepresentative: v.string(),
  },
  handler: async (ctx, a) =>
    ctx.db.insert("legalNotices", {
      ...a,
      zillowUrl: "PENDING",
      zestimate: "PENDING",
      beds: "PENDING",
      baths: "PENDING",
      sqft: "PENDING",
      enrichmentStatus: "pending",
      dealStatus: "new",
      updatedAt: Date.now(),
    }),
});

// Force re-scrape replaces the week: delete its existing rows before re-inserting.
export const clearWeek = internalMutation({
  args: { weekDate: v.string() },
  handler: async (ctx, { weekDate }) => {
    const rows = await ctx.db
      .query("legalNotices")
      .withIndex("by_weekDate", (q) => q.eq("weekDate", weekDate))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});

export const getNotice = internalQuery({
  args: { noticeId: v.id("legalNotices") },
  handler: async (ctx, { noticeId }) => ctx.db.get(noticeId),
});

export const patchNotice = internalMutation({
  args: {
    noticeId: v.id("legalNotices"),
    enrichmentStatus: v.union(v.literal("enriched"), v.literal("failed")),
    fields: v.object({
      zillowUrl: v.string(),
      zestimate: v.string(),
      beds: v.string(),
      baths: v.string(),
      sqft: v.string(),
    }),
  },
  handler: async (ctx, a) =>
    ctx.db.patch(a.noticeId, { ...a.fields, enrichmentStatus: a.enrichmentStatus, updatedAt: Date.now() }),
});

export const listNotices = query({
  args: { weekDate: v.optional(v.string()) },
  handler: async (ctx, { weekDate }) => {
    await requireUser(ctx);
    if (weekDate) {
      return ctx.db
        .query("legalNotices")
        .withIndex("by_weekDate", (q) => q.eq("weekDate", weekDate))
        .collect();
    }
    return ctx.db.query("legalNotices").order("desc").take(500);
  },
});

export const setDealStatus = mutation({
  args: { noticeId: v.id("legalNotices"), dealStatus },
  handler: async (ctx, { noticeId, dealStatus }) => {
    await requireUser(ctx);
    await ctx.db.patch(noticeId, { dealStatus, updatedAt: Date.now() });
  },
});

// Distinct weeks present in the data, newest-first with row counts — drives the
// week tabs. `weekDate` is ISO (YYYY-MM-DD) so a plain string sort is chronological.
export const legalWeeks = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("legalNotices").collect();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.weekDate, (counts.get(r.weekDate) ?? 0) + 1);
    return [...counts.entries()]
      .map(([weekDate, count]) => ({ weekDate, count }))
      .sort((a, b) => b.weekDate.localeCompare(a.weekDate));
  },
});

// One week's notices with a parsed numeric Zestimate attached, sorted by value
// (highest Zestimate) first; rows with no value (blocked or not on Zillow) sink
// to the bottom. Legal has no foreclosure debt, so the value signal is the
// Zestimate — the play is an off-market purchase via the personal representative.
export const weekNotices = query({
  args: { weekDate: v.string() },
  handler: async (ctx, { weekDate }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("legalNotices")
      .withIndex("by_weekDate", (q) => q.eq("weekDate", weekDate))
      .collect();

    const withValue = rows.map((r) => ({
      ...r,
      value: parseMoney(r.zestimate),
      // Only a blocked lookup is worth retrying; "NOT FOUND" means it genuinely
      // isn't on Zillow. Keep this coupled to retryFailed's filter.
      flags: r.zestimate === "SCRAPE FAILED" ? ["needs-rescrape"] : [],
    }));
    withValue.sort((a, b) => {
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    });
    return withValue;
  },
});

// "Retry failed" button: re-enrich only the rows whose Zillow scrape was BLOCKED
// ("SCRAPE FAILED") for a week — cheaper than a full re-scrape and non-destructive
// (no clearWeek). "NOT FOUND" rows are skipped (a retry won't surface them).
export const retryFailed = mutation({
  args: { weekDate: v.string() },
  handler: async (ctx, { weekDate }) => {
    const user = await requireUser(ctx);

    const running = await ctx.db
      .query("scrapeRuns")
      .withIndex("by_type", (q) => q.eq("type", "legal"))
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return { status: "already_running" as const, retried: 0 };

    const rows = await ctx.db
      .query("legalNotices")
      .withIndex("by_weekDate", (q) => q.eq("weekDate", weekDate))
      .collect();
    const failed = rows.filter((r) => r.zestimate === "SCRAPE FAILED");
    if (failed.length === 0) return { status: "none" as const, retried: 0 };

    const runId = await ctx.db.insert("scrapeRuns", {
      type: "legal",
      label: `${weekDate} (retry)`,
      status: "running",
      phase: "enrich",
      listingCount: failed.length,
      enrichedCount: 0,
      failedCount: 0,
      startedAt: Date.now(),
      triggeredBy: user,
    });
    await ctx.db.insert("scrapeEvents", {
      runId,
      phase: "enrich",
      message: `Retrying ${failed.length} blocked propert${failed.length === 1 ? "y" : "ies"} in ${weekDate}…`,
      level: "info",
    });

    for (let i = 0; i < failed.length; i++) {
      await ctx.scheduler.runAfter(i * 2500, internal.legalActions.enrichLegalOne, {
        noticeId: failed[i]._id,
        runId,
      });
    }
    return { status: "started" as const, retried: failed.length };
  },
});
