"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { firecrawlScrape, withRetry } from "../src/scraper/firecrawl.js";
import { buildZillowSearchUrl, extractImageUrl } from "../src/scraper/zillow.js";

function fcKey(): string {
  const k = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!k) throw new Error("FIRECRAWL_API_KEY is not set (npx convex env set FIRECRAWL_API_KEY ...)");
  return k;
}

// Google Street View Static URL from an address (off-market fallback when Zillow has
// no listing photo). Uses the single domain-restricted Maps key (same one geocoding
// uses); Street View Static accepts location=<address>, so no geocoding is needed.
// The browser loads it as <img src>, so the referrer-restricted key is authorized.
function streetViewUrl(address: string, key: string): string {
  const params = new URLSearchParams({
    size: "640x480",
    location: address,
    source: "outdoor",
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

// Fetch a property's house photo. ALWAYS scrapes the SEARCH URL built from the address
// (the stored zillowUrl is a homedetails URL, which 403s on a direct scrape). Active
// listings -> a Zillow photo; off-market -> a Street View thumbnail; neither -> failed
// (UI placeholder). Scheduled by an already-authed mutation, so no user re-check.
export const scrapePropertyImage = internalAction({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }): Promise<void> => {
    const p = await ctx.runQuery(internal.propertyData.getForImage, { id });
    if (!p || !p.address) {
      await ctx.runMutation(internal.propertyData.setImage, { id, status: "failed" });
      return;
    }

    let zillowPhoto: string | null = null;
    try {
      const { markdown, rawHtml } = await withRetry(
        () =>
          firecrawlScrape({
            url: buildZillowSearchUrl(p.address),
            apiKey: fcKey(),
            formats: ["markdown", "rawHtml"],
            onlyMainContent: true,
            waitFor: 3000,
            timeoutMs: 60000,
            maxRetries: 1,
          }),
        { attempts: 2, baseDelayMs: 2000, label: `Zillow image ${p.address}` },
      );
      zillowPhoto = extractImageUrl(rawHtml) ?? extractImageUrl(markdown);
    } catch {
      zillowPhoto = null; // block/timeout/no-Firecrawl-key — fall through to Street View
    }

    if (zillowPhoto) {
      await ctx.runMutation(internal.propertyData.setImage, { id, imageUrl: zillowPhoto, status: "ok" });
      return;
    }

    const gk = (process.env.GOOGLE_GEOCODING_API_KEY ?? "").trim();
    if (gk) {
      await ctx.runMutation(internal.propertyData.setImage, {
        id,
        imageUrl: streetViewUrl(p.address, gk),
        status: "ok",
      });
    } else {
      await ctx.runMutation(internal.propertyData.setImage, { id, status: "failed" });
    }
  },
});
