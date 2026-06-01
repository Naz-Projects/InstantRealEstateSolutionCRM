import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireUser } from "./helpers";
import { dealStatus } from "./schema";
import { computeDeal } from "../src/scraper/deal";

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

// Force re-scrape replaces the month: delete its existing rows before re-inserting.
export const clearMonth = internalMutation({
  args: { saleMonth: v.string() },
  handler: async (ctx, { saleMonth }) => {
    const rows = await ctx.db
      .query("sheriffListings")
      .withIndex("by_saleMonth", (q) => q.eq("saleMonth", saleMonth))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Distinct sale months present in the data, newest-first with row counts —
// drives the month tabs. Chronological by parsing the "Month YYYY" label.
export const sheriffMonths = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("sheriffListings").collect();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.saleMonth, (counts.get(r.saleMonth) ?? 0) + 1);
    const sortKey = (label: string) => {
      const [name, year] = label.split(" ");
      const mi = MONTH_NAMES.indexOf(name);
      return mi >= 0 && year ? parseInt(year, 10) * 12 + mi : -1;
    };
    return [...counts.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => sortKey(b.month) - sortKey(a.month));
  },
});

// One month's listings with the computed deal "cushion" attached, sorted best
// (biggest cushion) first; rows with incomplete data (unknown cushion) sink to
// the bottom. This is the table the buyer scans top-down.
export const monthListings = query({
  args: { saleMonth: v.string() },
  handler: async (ctx, { saleMonth }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("sheriffListings")
      .withIndex("by_saleMonth", (q) => q.eq("saleMonth", saleMonth))
      .collect();

    const TIER_RANK: Record<string, number> = { good: 0, ok: 1, thin: 2, verify: 3, bad: 4, unknown: 5 };
    const withDeal = rows.map((r) => ({ ...r, deal: computeDeal(r) }));
    withDeal.sort((a, b) => {
      // Reliable, clean deals first; flagged "verify" rows (e.g. tiny-principal
      // junior foreclosures) sink below them even if their raw cushion is huge.
      const ra = TIER_RANK[a.deal.tier] ?? 9;
      const rb = TIER_RANK[b.deal.tier] ?? 9;
      if (ra !== rb) return ra - rb;
      const av = a.deal.cushion;
      const bv = b.deal.cushion;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av; // biggest cushion first within a tier
    });
    return withDeal;
  },
});

export const setDealStatus = mutation({
  args: { listingId: v.id("sheriffListings"), dealStatus },
  handler: async (ctx, { listingId, dealStatus }) => {
    await requireUser(ctx);
    await ctx.db.patch(listingId, { dealStatus, updatedAt: Date.now() });
  },
});

// "Retry failed" button: re-enrich only the rows whose parcel OR Zillow scrape
// was BLOCKED ("SCRAPE FAILED") for a month — much cheaper than a full re-scrape
// and non-destructive (no clearMonth). "NOT FOUND" rows are skipped (the data
// genuinely isn't there, so a retry won't help).
export const retryFailed = mutation({
  args: { saleMonth: v.string() },
  handler: async (ctx, { saleMonth }) => {
    const user = await requireUser(ctx);

    const running = await ctx.db
      .query("scrapeRuns")
      .withIndex("by_type", (q) => q.eq("type", "sheriff"))
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return { status: "already_running" as const, retried: 0 };

    const rows = await ctx.db
      .query("sheriffListings")
      .withIndex("by_saleMonth", (q) => q.eq("saleMonth", saleMonth))
      .collect();
    const failed = rows.filter((r) => r.ownerName === "SCRAPE FAILED" || r.zestimate === "SCRAPE FAILED");
    if (failed.length === 0) return { status: "none" as const, retried: 0 };

    const runId = await ctx.db.insert("scrapeRuns", {
      type: "sheriff",
      label: `${saleMonth} (retry)`,
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
      message: `Retrying ${failed.length} blocked propert${failed.length === 1 ? "y" : "ies"} in ${saleMonth}…`,
      level: "info",
    });

    for (let i = 0; i < failed.length; i++) {
      await ctx.scheduler.runAfter(i * 2500, internal.sheriffActions.enrichSheriffOne, {
        listingId: failed[i]._id,
        saleMonth,
        runId,
      });
    }
    return { status: "started" as const, retried: failed.length };
  },
});
