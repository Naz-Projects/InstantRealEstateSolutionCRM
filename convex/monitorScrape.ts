// "Monitor the Web" (Zillow NCC deal-finder) — Firecrawl v2 scrape helper. Plain,
// runtime-agnostic module (uses global fetch, Node 18+) — NOT a Convex function file:
// no "use node", no queries/mutations/actions. Imported by convex/monitorActions.ts
// (Task 10) for both the search/detail JSON scrape and the Redfin comps scrape.
//
// Talks to Firecrawl's REST **v2** `/scrape` endpoint directly (per the plan,
// docs/superpowers/plans/2026-06-30-monitor-web-zillow.md: "Firecrawl: REST v2
// https://api.firecrawl.dev/v2/scrape ..."). This is deliberately NOT the shared
// `firecrawlScrape` client in src/scraper/firecrawl.ts, which still targets the v1
// endpoint for the existing NCC-parcel/comps pipelines — `proxy` (basic/enhanced/
// auto) is a v2-only field (confirmed against Firecrawl's docs), so routing it
// through the v1 client would silently send a proxy mode the API doesn't recognize
// and defeat the whole point of this module (getting past Zillow's bot-block).
//
// Zillow (and, less often, Redfin) sometimes serve a bot-block "shell" page on an
// HTTP-200 response: short HTML with no usable data. Firecrawl's own internal HTTP
// retry can't catch that (it's a content problem, not a transport error), so this
// module retries the WHOLE scrape at the operation level with spaced gaps — long
// enough to give Firecrawl's proxy rotation a chance to clear the block before the
// next attempt, unlike the tight backoff in src/scraper/firecrawl.ts's withRetry.

import { extractNextData } from "../src/scraper/monitorListings";
import { buildRedfinSoldUrl } from "../src/scraper/comps";

const FIRECRAWL_V2_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const RETRY_GAPS_MS = [0, 12_000, 28_000, 50_000];
const SHELL_MIN_LEN = 50_000;
const FETCH_TIMEOUT_MS = 150_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface V2ScrapeData {
  rawHtml: string;
  markdown: string;
}

/**
 * POST Firecrawl REST v2 scrape. Returns rawHtml/markdown, or null on any
 * failure (HTTP error, network error/timeout, or an unsuccessful response) —
 * every failure mode is treated as transient/retryable by the callers below.
 */
async function firecrawlV2Scrape(
  url: string,
  apiKey: string,
  proxy: "enhanced" | "auto",
): Promise<V2ScrapeData | null> {
  try {
    const res = await fetch(FIRECRAWL_V2_SCRAPE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["rawHtml", "markdown"],
        proxy,
        waitFor: 5000,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      success?: boolean;
      data?: { rawHtml?: string; markdown?: string };
    };
    if (!json.success || !json.data) return null;

    return { rawHtml: json.data.rawHtml ?? "", markdown: json.data.markdown ?? "" };
  } catch {
    return null;
  }
}

/**
 * Scrape a Zillow search or detail URL and return its parsed `__NEXT_DATA__` JSON.
 * A bot-block shell (rawHtml under 50k chars, or no parseable `__NEXT_DATA__`) is
 * treated as retryable, not a hard failure: retries with spaced gaps
 * [0, 12s, 28s, 50s] + jitter (Firecrawl `proxy:"enhanced"`, `waitFor:5000`).
 * Returns the nextData object, or null after all retries are exhausted (the caller
 * falls back to search-card data).
 */
export async function scrapeZillowJson(url: string, apiKey: string): Promise<any | null> {
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

  for (const gap of RETRY_GAPS_MS) {
    if (gap > 0) await sleep(gap + Math.random() * 2000);
    const data = await firecrawlV2Scrape(url, apiKey, "enhanced");
    if (!data || data.rawHtml.length < SHELL_MIN_LEN) continue;
    const nextData = extractNextData(data.rawHtml);
    if (!nextData) continue;
    return nextData;
  }
  return null;
}

/**
 * Scrape a ZIP's Redfin "recently sold" page (`buildRedfinSoldUrl`) and return its
 * markdown (the source `parseRedfinComps` parses). Same spaced shell/transient retry
 * as `scrapeZillowJson` (Firecrawl `proxy:"auto"`, `waitFor:5000`). Returns the
 * markdown string, or null after all retries are exhausted.
 */
export async function scrapeRedfinMarkdown(zip: string, apiKey: string): Promise<string | null> {
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

  const url = buildRedfinSoldUrl(zip);
  for (const gap of RETRY_GAPS_MS) {
    if (gap > 0) await sleep(gap + Math.random() * 2000);
    const data = await firecrawlV2Scrape(url, apiKey, "auto");
    if (!data || data.rawHtml.length < SHELL_MIN_LEN) continue;
    return data.markdown;
  }
  return null;
}
