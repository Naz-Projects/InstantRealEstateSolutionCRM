"use node";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

type ScrapeResult = {
  skipped?: boolean;
  saleMonth?: string;
  existing?: number;
  created?: number;
  runId?: Id<"scrapeRuns">;
};
import { fetchSheriffMarkdown, parseSheriffMarkdown } from "../src/scraper/sheriffParse";
import { enrichListing } from "../src/scraper/enrich";
import type { SheriffListing } from "../src/scraper/types";

function fcKey(): string {
  const k = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!k) throw new Error("FIRECRAWL_API_KEY is not set (npx convex env set FIRECRAWL_API_KEY ...)");
  return k;
}

// Scrape the NCC sheriff PDF -> parse -> insert PENDING rows -> fan out enrichment.
export const runSheriffScrape = internalAction({
  args: { triggeredBy: v.string(), force: v.boolean(), limit: v.optional(v.number()) },
  handler: async (ctx, { triggeredBy, force, limit }): Promise<ScrapeResult> => {
    const apiKey = fcKey();
    const markdown = await fetchSheriffMarkdown(apiKey);
    const parsed = parseSheriffMarkdown(markdown);
    const saleMonth = parsed.saleMonth;
    // `limit` keeps test runs cheap (enrich only the first N).
    const listings = limit ? parsed.listings.slice(0, limit) : parsed.listings;

    if (!force) {
      const existing = await ctx.runQuery(internal.sheriffData.countByMonth, { saleMonth });
      if (existing > 0) return { skipped: true, saleMonth, existing };
    }

    const runId = await ctx.runMutation(internal.runs.createRun, {
      type: "sheriff",
      label: saleMonth,
      listingCount: listings.length,
      triggeredBy,
    });

    for (let i = 0; i < listings.length; i++) {
      const l = listings[i];
      const listingId = await ctx.runMutation(internal.sheriffData.insertListing, {
        runId,
        saleMonth,
        saleType: l.type,
        attorney: l.attorney,
        plaintiff: l.plaintiff,
        courtCaseNumber: l.courtCaseNumber,
        defendant: l.defendant,
        address: l.address,
        parcel: l.parcel,
        saleStatus: l.status,
        principal: l.principal,
      });
      // Stagger enrichment to respect Firecrawl / NCC rate limits.
      await ctx.scheduler.runAfter(i * 1500, internal.sheriffActions.enrichSheriffOne, {
        listingId,
        saleMonth,
      });
    }
    return { saleMonth, created: listings.length, runId };
  },
});

export const enrichSheriffOne = internalAction({
  args: { listingId: v.id("sheriffListings"), saleMonth: v.string() },
  handler: async (ctx, { listingId, saleMonth }): Promise<void> => {
    const apiKey = fcKey();
    const rec = await ctx.runQuery(internal.sheriffData.getListing, { listingId });
    if (!rec) return;

    const listing: SheriffListing = {
      type: rec.saleType,
      attorney: rec.attorney,
      plaintiff: rec.plaintiff,
      courtCaseNumber: rec.courtCaseNumber,
      defendant: rec.defendant,
      address: rec.address,
      parcel: rec.parcel,
      status: rec.saleStatus,
      principal: rec.principal,
    };

    try {
      const e = await enrichListing(listing, saleMonth, apiKey);
      await ctx.runMutation(internal.sheriffData.patchListing, {
        listingId,
        enrichmentStatus: "enriched",
        fields: {
          address: e.address,
          ownerName: e.ownerName,
          propertyAddress: e.propertyAddress,
          assessmentTotal: e.assessmentTotal,
          countyBalanceDue: e.countyBalanceDue,
          schoolBalanceDue: e.schoolBalanceDue,
          sewerBalanceDue: e.sewerBalanceDue,
          zillowUrl: e.zillowUrl,
          zestimate: e.zestimate,
          beds: e.beds,
          baths: e.baths,
          sqft: e.sqft,
        },
      });
    } catch {
      const failed = "SCRAPE FAILED";
      await ctx.runMutation(internal.sheriffData.patchListing, {
        listingId,
        enrichmentStatus: "failed",
        fields: {
          address: rec.address,
          ownerName: failed,
          propertyAddress: failed,
          assessmentTotal: failed,
          countyBalanceDue: failed,
          schoolBalanceDue: failed,
          sewerBalanceDue: failed,
          zillowUrl: failed,
          zestimate: failed,
          beds: failed,
          baths: failed,
          sqft: failed,
        },
      });
    }
    await ctx.runMutation(internal.runs.bumpEnriched, { runId: rec.runId });
  },
});

// DEV-ONLY: run the full scrape from the CLI without auth. Inert unless IRES_DEV=1.
export const devScrapeSheriff = action({
  args: { force: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, { force, limit }): Promise<ScrapeResult> => {
    if (process.env.IRES_DEV !== "1") throw new Error("devScrapeSheriff is dev-only (set IRES_DEV=1)");
    return ctx.runAction(internal.sheriffActions.runSheriffScrape, {
      triggeredBy: "dev",
      force: force ?? true,
      limit: limit ?? 3,
    });
  },
});
