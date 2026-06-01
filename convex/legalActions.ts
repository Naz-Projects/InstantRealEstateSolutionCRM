"use node";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

type LegalResult = {
  skipped?: boolean;
  weekDate?: string;
  existing?: number;
  created?: number;
  runId?: Id<"scrapeRuns">;
};
import { fetchLatestLegalNoticesPdf, extractLegalListings } from "../src/scraper/legalNotices";
import { scrapeZillow, isDelawareUrl } from "../src/scraper/zillow";
import { zillowAddress } from "../src/scraper/address";
import type { ZillowData } from "../src/scraper/types";

function fcKey(): string {
  const k = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!k) throw new Error("FIRECRAWL_API_KEY is not set");
  return k;
}
function orKey(): string {
  const k = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!k) throw new Error("OPENROUTER_API_KEY is not set");
  return k;
}

export const runLegalScrape = internalAction({
  args: { triggeredBy: v.string(), force: v.boolean(), limit: v.optional(v.number()) },
  handler: async (ctx, { triggeredBy, force, limit }): Promise<LegalResult> => {
    const runId = await ctx.runMutation(internal.runs.createRun, { type: "legal", triggeredBy });
    const log = (phase: string, message: string, level: "info" | "warn" | "error" = "info") =>
      ctx.runMutation(internal.runs.logEvent, { runId, phase, message, level });

    try {
      await ctx.runMutation(internal.runs.patchRun, { runId, phase: "fetch" });
      await log("fetch", "Fetching the latest New Castle County legal notices PDF…");
      const { pdfText, dateFound } = await fetchLatestLegalNoticesPdf(fcKey());
      const weekDate = dateFound ?? new Date().toISOString().split("T")[0];

      await ctx.runMutation(internal.runs.patchRun, { runId, phase: "extract", label: weekDate });
      await log("extract", "Running the AI agent to extract estate listings from the notices…");
      const all = await extractLegalListings(pdfText, orKey(), weekDate);
      const listings = limit ? all.slice(0, limit) : all;
      await ctx.runMutation(internal.runs.patchRun, { runId, listingCount: listings.length });
      await log(
        "extract",
        `AI extracted ${all.length} estate listing(s) for ${weekDate}${limit ? ` (limited to ${listings.length} this run)` : ""}.`,
      );

      if (!force) {
        const existing = await ctx.runQuery(internal.legalData.countByWeek, { weekDate });
        if (existing > 0) {
          await log("skip", `${weekDate} was already scraped (${existing} rows). Use "Force re-scrape" to refresh.`, "warn");
          await ctx.runMutation(internal.runs.finishRun, { runId, status: "complete" });
          return { skipped: true, weekDate, existing, runId };
        }
      } else {
        const cleared = await ctx.runMutation(internal.legalData.clearWeek, { weekDate });
        if (cleared > 0) await log("extract", `Cleared ${cleared} existing ${weekDate} row(s) for a clean refresh.`);
      }

      if (listings.length === 0) {
        await log("extract", "No estate listings extracted — the source PDF may have changed or be blocked.", "error");
        await ctx.runMutation(internal.runs.finishRun, { runId, status: "failed", error: "No listings extracted" });
        return { weekDate, created: 0, runId };
      }

      await ctx.runMutation(internal.runs.patchRun, { runId, phase: "enrich" });
      await log("enrich", `Enriching ${listings.length} properties with Zillow data…`);
      for (let i = 0; i < listings.length; i++) {
        const l = listings[i];
        const noticeId = await ctx.runMutation(internal.legalData.insertNotice, {
          runId,
          weekDate,
          title: l.title,
          ownerName: l.ownerName,
          address: l.address,
          personalRepresentative: l.personalRepresentative,
        });
        await ctx.scheduler.runAfter(i * 1500, internal.legalActions.enrichLegalOne, { noticeId, runId });
      }
      // Geocode the new rows for the map (idempotent; only missing-coord rows).
      await ctx.scheduler.runAfter(
        listings.length * 1500 + 5000,
        internal.geocodeActions.backfillGeocodes,
        { type: "legal" },
      );
      return { weekDate, created: listings.length, runId };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await log("error", `Scrape failed: ${message}`, "error");
      await ctx.runMutation(internal.runs.finishRun, { runId, status: "failed", error: message });
      return { runId };
    }
  },
});

export const enrichLegalOne = internalAction({
  // `runId` is the run to track this enrichment against — the scrape's run on a
  // normal pass, or a separate retry run when re-enriching only the failed rows.
  args: { noticeId: v.id("legalNotices"), runId: v.id("scrapeRuns") },
  handler: async (ctx, { noticeId, runId }): Promise<void> => {
    const rec = await ctx.runQuery(internal.legalData.getNotice, { noticeId });
    if (!rec) return;

    const tag = (rec.address || rec.ownerName || "listing").slice(0, 48);
    const log = (message: string, level: "info" | "warn" | "error" = "info") =>
      ctx.runMutation(internal.runs.logEvent, { runId, phase: "enrich", message, level });

    const addr = zillowAddress(rec.address);
    let zillow: Partial<ZillowData> = {};
    let errorCode: string | null = null;

    if (!addr) {
      errorCode = !rec.address || rec.address === "N/A" ? "NO ADDRESS" : "BAD ADDRESS";
      await log(`${tag}: skipping Zillow (${errorCode})`, "warn");
    } else {
      await log(`${tag}: checking Zillow…`);
      try {
        const zd = await scrapeZillow(addr, fcKey());
        if (zd.zillowUrl && !isDelawareUrl(zd.zillowUrl)) {
          errorCode = "WRONG STATE";
          await log(`${tag}: Zillow match was wrong state — discarded`, "warn");
        } else {
          zillow = zd;
          await log(`${tag}: Zillow found${zd.zestimate ? ` — ${zd.zestimate}` : ""}`);
        }
      } catch {
        errorCode = "SCRAPE FAILED";
        await log(`${tag}: Zillow lookup failed (blocked or unavailable)`, "error");
      }
    }

    const v2 = (val?: string) => val || errorCode || "NOT FOUND";
    await ctx.runMutation(internal.legalData.patchNotice, {
      noticeId,
      enrichmentStatus: errorCode ? "failed" : "enriched",
      fields: {
        zillowUrl: v2(zillow.zillowUrl),
        zestimate: v2(zillow.zestimate),
        beds: v2(zillow.beds),
        baths: v2(zillow.baths),
        sqft: v2(zillow.sqft),
      },
    });
    await ctx.runMutation(internal.runs.bumpEnriched, { runId, failed: errorCode !== null });
  },
});

export const devScrapeLegal = action({
  args: { force: v.optional(v.boolean()), limit: v.optional(v.number()) },
  handler: async (ctx, { force, limit }): Promise<LegalResult> => {
    if (process.env.IRES_DEV !== "1") throw new Error("devScrapeLegal is dev-only (set IRES_DEV=1)");
    return ctx.runAction(internal.legalActions.runLegalScrape, {
      triggeredBy: "dev",
      force: force ?? true,
      limit: limit ?? 3,
    });
  },
});
