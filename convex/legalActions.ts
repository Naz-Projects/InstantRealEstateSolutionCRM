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
    const { pdfText, dateFound } = await fetchLatestLegalNoticesPdf(fcKey());
    const weekDate = dateFound ?? new Date().toISOString().split("T")[0];
    const all = await extractLegalListings(pdfText, orKey(), weekDate);
    const listings = limit ? all.slice(0, limit) : all;

    if (!force) {
      const existing = await ctx.runQuery(internal.legalData.countByWeek, { weekDate });
      if (existing > 0) return { skipped: true, weekDate, existing };
    }

    const runId = await ctx.runMutation(internal.runs.createRun, {
      type: "legal",
      label: weekDate,
      listingCount: listings.length,
      triggeredBy,
    });

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
      await ctx.scheduler.runAfter(i * 1500, internal.legalActions.enrichLegalOne, { noticeId });
    }
    return { weekDate, created: listings.length, runId };
  },
});

export const enrichLegalOne = internalAction({
  args: { noticeId: v.id("legalNotices") },
  handler: async (ctx, { noticeId }): Promise<void> => {
    const rec = await ctx.runQuery(internal.legalData.getNotice, { noticeId });
    if (!rec) return;

    const addr = zillowAddress(rec.address);
    let zillow: Partial<ZillowData> = {};
    let errorCode: string | null = null;

    if (!addr) {
      errorCode = !rec.address || rec.address === "N/A" ? "NO ADDRESS" : "BAD ADDRESS";
    } else {
      try {
        const zd = await scrapeZillow(addr, fcKey());
        if (zd.zillowUrl && !isDelawareUrl(zd.zillowUrl)) errorCode = "WRONG STATE";
        else zillow = zd;
      } catch {
        errorCode = "SCRAPE FAILED";
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
    await ctx.runMutation(internal.runs.bumpEnriched, { runId: rec.runId });
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
