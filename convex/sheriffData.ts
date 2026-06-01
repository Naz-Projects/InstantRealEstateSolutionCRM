import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireUser } from "./helpers";
import { dealStatus } from "./schema";

// The button: record intent + kick off the scrape action. Refuses concurrent runs.
export const startScrape = mutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }) => {
    const user = await requireUser(ctx);
    const running = await ctx.db
      .query("scrapeRuns")
      .withIndex("by_type", (q) => q.eq("type", "sheriff"))
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return { status: "already_running" as const, runId: running._id };

    await ctx.scheduler.runAfter(0, internal.sheriffActions.runSheriffScrape, {
      triggeredBy: user,
      force: force ?? false,
    });
    return { status: "started" as const };
  },
});

export const countByMonth = internalQuery({
  args: { saleMonth: v.string() },
  handler: async (ctx, { saleMonth }) => {
    const rows = await ctx.db
      .query("sheriffListings")
      .withIndex("by_saleMonth", (q) => q.eq("saleMonth", saleMonth))
      .collect();
    return rows.length;
  },
});

export const insertListing = internalMutation({
  args: {
    runId: v.id("scrapeRuns"),
    saleMonth: v.string(),
    saleType: v.string(),
    attorney: v.string(),
    plaintiff: v.string(),
    courtCaseNumber: v.string(),
    defendant: v.string(),
    address: v.string(),
    parcel: v.string(),
    saleStatus: v.string(),
    principal: v.string(),
  },
  handler: async (ctx, a) =>
    ctx.db.insert("sheriffListings", {
      ...a,
      ownerName: "PENDING",
      propertyAddress: "PENDING",
      assessmentTotal: "PENDING",
      countyBalanceDue: "PENDING",
      schoolBalanceDue: "PENDING",
      sewerBalanceDue: "PENDING",
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

export const getListing = internalQuery({
  args: { listingId: v.id("sheriffListings") },
  handler: async (ctx, { listingId }) => ctx.db.get(listingId),
});

export const patchListing = internalMutation({
  args: {
    listingId: v.id("sheriffListings"),
    enrichmentStatus: v.union(v.literal("enriched"), v.literal("failed")),
    fields: v.object({
      address: v.string(),
      ownerName: v.string(),
      propertyAddress: v.string(),
      assessmentTotal: v.string(),
      countyBalanceDue: v.string(),
      schoolBalanceDue: v.string(),
      sewerBalanceDue: v.string(),
      zillowUrl: v.string(),
      zestimate: v.string(),
      beds: v.string(),
      baths: v.string(),
      sqft: v.string(),
    }),
  },
  handler: async (ctx, a) =>
    ctx.db.patch(a.listingId, {
      ...a.fields,
      enrichmentStatus: a.enrichmentStatus,
      updatedAt: Date.now(),
    }),
});

export const listListings = query({
  args: { saleMonth: v.optional(v.string()) },
  handler: async (ctx, { saleMonth }) => {
    await requireUser(ctx);
    if (saleMonth) {
      return ctx.db
        .query("sheriffListings")
        .withIndex("by_saleMonth", (q) => q.eq("saleMonth", saleMonth))
        .collect();
    }
    return ctx.db.query("sheriffListings").order("desc").take(500);
  },
});

export const setDealStatus = mutation({
  args: { listingId: v.id("sheriffListings"), dealStatus },
  handler: async (ctx, { listingId, dealStatus }) => {
    await requireUser(ctx);
    await ctx.db.patch(listingId, { dealStatus, updatedAt: Date.now() });
  },
});
