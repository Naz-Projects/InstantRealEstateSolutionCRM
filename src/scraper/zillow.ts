// Zillow enrichment — ported from scrapers/zillow/zillow_scraper.py.
// Strategy (per project lessons): scrape the Zillow *search* URL with markdown;
// Firecrawl renders the full homedetails page. Extract fields from markdown and
// the canonical homedetails URL from the first matching link.

import { firecrawlScrape, withRetry } from "./firecrawl.js";
import type { ZillowData } from "./types.js";

/** Convert a property address into a Zillow search URL. */
export function buildZillowSearchUrl(address: string): string {
  let slug = address.replace(/[.,#]+/g, "");
  slug = slug.replace(/\s+/g, "-");
  slug = slug.replace(/-+/g, "-");
  slug = slug.replace(/^-+|-+$/g, "");
  return `https://www.zillow.com/homes/${slug}_rb/`;
}

/** Extract property fields from Zillow markdown. Pure + testable. */
export function extractFields(markdown: string): Partial<ZillowData> {
  const result: Partial<ZillowData> = {};

  const beds = markdown.match(/(\d+)\s*(?:beds?|bd)\b/i);
  if (beds) result.beds = beds[1];

  const baths = markdown.match(/(\d+(?:\.\d+)?)\s*(?:baths?|ba)\b/i);
  if (baths) result.baths = baths[1];

  let zest = markdown.match(/[Zz]estimate[^\n$]*\$\s*([\d,.]+\s*[MKmk]?)/);
  if (!zest) {
    zest = markdown.match(
      /\$([\d,.]+\s*[MKmk]?)[^\n]*[Zz]estimate|[Zz]estimate[^\n]*\$([\d,.]+\s*[MKmk]?)/,
    );
  }
  if (zest) result.zestimate = "$" + (zest[1] || zest[2]).trim().replace(/[.,]+$/, "");

  const sqft = markdown.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft)\b(?!\s*lot)/i);
  if (sqft) result.sqft = sqft[1] + " sqft";

  const lot = markdown.match(
    /([\d,.]+)\s*(?:sq\.?\s*ft\.?\s*lot|acres?|square\s*feet\s*lot|sqft\s*lot)/i,
  );
  if (lot) result.lotSize = lot[0].trim();

  return result;
}

/** Pull the canonical Zillow homedetails URL out of markdown or HTML. */
export function extractHomedetailsUrl(text: string): string | null {
  const abs = text.match(
    /(https?:\/\/(?:www\.)?zillow\.com\/homedetails\/[^\s"')#]+_zpid\/)/,
  );
  if (abs) return abs[1];
  const rel = text.match(/\/homedetails\/([^\s"')#]+_zpid\/)/);
  if (rel) return "https://www.zillow.com/homedetails/" + rel[1];
  return null;
}

/** True if a Zillow homedetails URL is for a Delaware property. */
export function isDelawareUrl(url: string): boolean {
  return url.includes("-DE-");
}

/**
 * Scrape Zillow for a property address. Throws on failure after retries.
 * Callers should validate `isDelawareUrl(zillowUrl)` to reject wrong-state matches.
 */
export async function scrapeZillow(address: string, apiKey: string, attempts = 2): Promise<ZillowData> {
  const url = buildZillowSearchUrl(address);

  return withRetry(
    async () => {
      const { markdown, rawHtml } = await firecrawlScrape({
        url,
        apiKey,
        formats: ["markdown", "rawHtml"],
        onlyMainContent: true,
        waitFor: 3000,
        timeoutMs: 60000,
        maxRetries: 1,
      });

      if (markdown.length > 200) {
        const fields = extractFields(markdown);
        const zillowUrl =
          extractHomedetailsUrl(markdown) || extractHomedetailsUrl(rawHtml) || url;
        return { address, zillowUrl, ...fields };
      }

      throw new Error("empty/short markdown — likely block or timeout");
    },
    { attempts, baseDelayMs: 2000, label: `Zillow ${address}` },
  );
}

/**
 * Pull a Zillow listing photo URL out of page content (markdown or rawHtml).
 * Returns the first photos.zillowstatic.com photo, preferring a universal .jpg
 * over the .webp of the same hero. Off-market pages have no such photo (Zillow
 * shows only a Street View og:image, handled by the caller) -> null. Pure + tested.
 */
export function extractImageUrl(text: string): string | null {
  const matches = text.match(
    /https?:\/\/photos\.zillowstatic\.com\/[^\s"')<>]+?\.(?:jpg|jpeg|png|webp)/gi,
  );
  if (!matches) return null; // .match() with /g returns null (never []) when nothing matches
  return matches.find((u) => /\.jpe?g$/i.test(u)) ?? matches[0];
}
