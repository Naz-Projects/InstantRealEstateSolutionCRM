// Firecrawl REST client. Uses global fetch (Node 18+, Twenty/Workers V8 runtime),
// so this module is runtime-agnostic — no SDK dependency, no "use node".
//
// Firecrawl is the only external dependency of the whole pipeline. It runs the
// headless browser in its own cloud, which is how the parcel lookup bypasses the
// Reblaze bot protection on the NCC site.

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";

export interface FirecrawlAction {
  type: "click" | "write" | "wait" | "press" | "scroll" | "screenshot";
  selector?: string;
  text?: string;
  milliseconds?: number;
  key?: string;
}

export interface FirecrawlScrapeOptions {
  url: string;
  apiKey: string;
  formats?: string[];
  actions?: FirecrawlAction[];
  waitFor?: number;
  onlyMainContent?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface FirecrawlResult {
  markdown: string;
  rawHtml: string;
  links: string[];
}

/**
 * Scrape a URL via Firecrawl, with retry + timeout. Returns markdown/rawHtml/links.
 * Throws on failure after all retries.
 */
export async function firecrawlScrape(
  opts: FirecrawlScrapeOptions,
): Promise<FirecrawlResult> {
  const {
    url,
    apiKey,
    formats = ["markdown"],
    actions,
    waitFor,
    onlyMainContent,
    timeoutMs = 60000,
    maxRetries = 2,
  } = opts;

  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

  const body: Record<string, unknown> = { url, formats };
  if (actions) body.actions = actions;
  if (waitFor !== undefined) body.waitFor = waitFor;
  if (onlyMainContent !== undefined) body.onlyMainContent = onlyMainContent;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(FIRECRAWL_SCRAPE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Firecrawl HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        success?: boolean;
        data?: { markdown?: string; rawHtml?: string; links?: string[] };
        error?: string;
      };

      if (!json.success || !json.data) {
        throw new Error(`Firecrawl returned no data: ${json.error ?? "unknown"}`);
      }

      return {
        markdown: json.data.markdown ?? "",
        rawHtml: json.data.rawHtml ?? "",
        links: json.data.links ?? [],
      };
    } catch (err) {
      lastError = err;
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Firecrawl failed after ${maxRetries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}
