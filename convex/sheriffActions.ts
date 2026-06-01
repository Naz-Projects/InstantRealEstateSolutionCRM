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
// The run is created up front (phase "starting") so fetch failures and skips are
// recorded, and it's always finalized (complete/failed) so the button never locks.
export const runSheriffScrape = internalAction({
  args: { triggeredBy: v.string(), force: v.boolean(), limit: v.optional(v.number()) },
  handler: async (ctx, { triggeredBy, force, limit }): Promise<ScrapeResult> => {
    const runId = await ctx.runMutation(internal.runs.createRun, { type: "sheriff", triggeredBy });
    const log = (phase: string, message: string, level: "info" | "warn" | "error" = "info") =>
      ctx.runMutation(internal.runs.logEvent, { runId, phase, message, level });

    try {
      const apiKey = fcKey();
      await ctx.runMutation(internal.runs.patchRun, { runId, phase: "fetch" });
      await log("fetch", "Fetching the New Castle County sheriff sale PDF…");
      const markdown = await fetchSheriffMarkdown(apiKey);

      await ctx.runMutation(internal.runs.patchRun, { runId, phase: "parse" });
      await log("parse", "Parsing the sheriff sale listings table…");
      const parsed = parseSheriffMarkdown(markdown);
      const saleMonth = parsed.saleMonth;
      const listings = limit ? parsed.listings.slice(0, limit) : parsed.listings;
      await ctx.runMutation(internal.runs.patchRun, { runId, label: saleMonth, listingCount: listings.length });
      await log(
        "parse",
        `Found ${parsed.listings.length} listings for ${saleMonth}${limit ? ` (limited to ${listings.length} this run)` : ""}.`,
      );

      if (!force) {
        const existing = await ctx.runQuery(internal.sheriffData.countByMonth, { saleMonth });
        if (existing > 0) {
          await log("skip", `${saleMonth} was already scraped (${existing} rows). Use "Force re-scrape" to refresh.`, "warn");
          await ctx.runMutation(internal.runs.finishRun, { runId, status: "complete" });
          return { skipped: true, saleMonth, existing, runId };
        }
      } else {
        const cleared = await ctx.runMutation(internal.sheriffData.clearMonth, { saleMonth });
        if (cleared > 0) await log("parse", `Cleared ${cleared} existing ${saleMonth} row(s) for a clean refresh.`);
      }

      if (listings.length === 0) {
        await log("parse", "No listings parsed — the source PDF may have changed or be blocked.", "error");
        await ctx.runMutation(internal.runs.finishRun, { runId, status: "failed", error: "No listings parsed" });
        return { saleMonth, created: 0, runId };
      }

      await ctx.runMutation(internal.runs.patchRun, { runId, phase: "enrich" });
      await log("enrich", `Enriching ${listings.length} properties with county parcel + Zillow data…`);
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
        // Stagger enrichment to limit peak concurrency on the NCC parcel site
        // (Reblaze rate-limits volume); combined with per-lookup retries this is
        // what keeps the scrape from failing rows at scale.
        await ctx.scheduler.runAfter(i * 2500, internal.sheriffActions.enrichSheriffOne, { listingId, saleMonth, runId });
      }
      // Geocode the new rows for the map once enrichment has had time to fill the
      // cleaned propertyAddress. Backfill is idempotent and only touches rows
      // missing coords, so an early run (raw address) is harmless.
      await ctx.scheduler.runAfter(
        listings.length * 2500 + 5000,
        internal.geocodeActions.backfillGeocodes,
        { type: "sheriff" },
      );
      return { saleMonth, created: listings.length, runId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await log("error", `Scrape failed: ${message}`, "error");
      await ctx.runMutation(internal.runs.finishRun, { runId, status: "failed", error: message });
      return { runId };
    }
  },
});

export const enrichSheriffOne = internalAction({
  // `runId` is the run to track this enrichment against — the scrape's run on a
  // normal pass, or a separate retry run when re-enriching only the failed rows.
  args: { listingId: v.id("sheriffListings"), saleMonth: v.string(), runId: v.id("scrapeRuns") },
  handler: async (ctx, { listingId, saleMonth, runId }): Promise<void> => {
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

    const onEvent = async (ev: { message: string; level: "info" | "warn" | "error" }) => {
      await ctx.runMutation(internal.runs.logEvent, { runId, phase: "enrich", message: ev.message, level: ev.level });
    };

    let failed = false;
    try {
      const e = await enrichListing(listing, saleMonth, apiKey, onEvent);
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
      failed = true;
      const failedVal = "SCRAPE FAILED";
      await onEvent({ message: `${rec.address}: enrichment failed`, level: "error" });
      await ctx.runMutation(internal.sheriffData.patchListing, {
        listingId,
        enrichmentStatus: "failed",
        fields: {
          address: rec.address,
          ownerName: failedVal,
          propertyAddress: failedVal,
          assessmentTotal: failedVal,
          countyBalanceDue: failedVal,
          schoolBalanceDue: failedVal,
          sewerBalanceDue: failedVal,
          zillowUrl: failedVal,
          zestimate: failedVal,
          beds: failedVal,
          baths: failedVal,
          sqft: failedVal,
        },
      });
    }
    await ctx.runMutation(internal.runs.bumpEnriched, { runId, failed });
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
