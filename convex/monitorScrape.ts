// Runtime-agnostic scrape helpers for the Monitor-the-Web pipeline.
// NO "use node" and NO Convex functions — just exported async functions that
// the Task-10 monitor action imports. Reuses the shared (proxy-aware) Firecrawl
// client so there is one scrape path, plus the pure __NEXT_DATA__ parser and
// the Redfin sold-comps URL builder.

import { firecrawlScrape } from "../src/scraper/firecrawl";
import { extractNextData } from "../src/scraper/monitorListings";
import { buildRedfinSoldUrl } from "../src/scraper/comps";

// A real Zillow page carries the full __NEXT_DATA__ blob (hundreds of KB); a
// hydration shell returns HTTP 200 but < ~50 KB with no parseable JSON. Treat
// that (or a scrape error) as transient and re-issue with spaced, jittered gaps.
const SHELL_MIN_HTML = 50_000;
const ZILLOW_RETRY_GAPS_MS = [0, 12_000, 28_000, 50_000] as const;
// Long timeout: proxy:enhanced + waitFor makes a single scrape slow.
const SCRAPE_TIMEOUT_MS = 150_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scrape a Zillow URL (search index or detail) and return its parsed
 * `__NEXT_DATA__` object, or null if every attempt yields a hydration shell or
 * error. Re-issues the whole scrape on failure with spaced increasing gaps
 * (0 → 12s → 28s → 50s) plus jitter. When this returns null the caller falls
 * back to search-card data.
 */
export async function scrapeZillowJson(
  url: string,
  apiKey: string,
): Promise<any | null> {
  for (let i = 0; i < ZILLOW_RETRY_GAPS_MS.length; i++) {
    const gap = ZILLOW_RETRY_GAPS_MS[i];
    if (gap > 0) await sleep(gap + Math.floor(Math.random() * 3000)); // + jitter
    try {
      const { rawHtml } = await firecrawlScrape({
        url,
        apiKey,
        formats: ["rawHtml", "markdown"],
        proxy: "enhanced",
        waitFor: 5000,
        timeoutMs: SCRAPE_TIMEOUT_MS,
        maxRetries: 0, // the spaced loop here is the retry
      });
      if (rawHtml.length >= SHELL_MIN_HTML) {
        const nextData = extractNextData(rawHtml);
        if (nextData) return nextData;
      }
      // otherwise: hydration shell → fall through to the next spaced attempt
    } catch {
      // transient block / timeout → fall through to the next spaced attempt
    }
  }
  return null;
}

/**
 * Scrape recent Redfin sold listings near `zip` (same URL as the Flip
 * Analyzer's comps pull) and return the raw markdown, or "" on failure.
 * Parsing (parseRedfinComps/selectComps/suggestArv) happens in the caller.
 */
export async function scrapeRedfinMarkdown(
  zip: string,
  apiKey: string,
): Promise<string> {
  try {
    const { markdown } = await firecrawlScrape({
      url: buildRedfinSoldUrl(zip),
      apiKey,
      formats: ["markdown"],
      onlyMainContent: true,
      proxy: "auto",
      waitFor: 3000,
      timeoutMs: SCRAPE_TIMEOUT_MS,
      maxRetries: 1,
    });
    return markdown;
  } catch {
    return "";
  }
}
