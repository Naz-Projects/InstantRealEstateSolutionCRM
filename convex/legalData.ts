import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireUser } from "./helpers";
import { dealStatus } from "./schema";

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
