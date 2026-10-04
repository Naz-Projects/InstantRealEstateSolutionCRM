import { describe, it, expect, vi, afterEach } from "vitest";
import { scrapeZillowJson, scrapeRedfinMarkdown } from "../convex/monitorScrape";
import { MONITOR } from "../src/scraper/monitorListings";

// Every attempt returns a short "shell" page, so the helper retries through the
// whole budget and we can inspect each request body's maxAge.
function stubShellFetch() {
  const bodies: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ success: true, data: { rawHtml: "<html></html>", markdown: "" } }) };
  }));
  return bodies;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("monitorScrape maxAge (Firecrawl v2 cache freshness)", () => {
  it("Zillow: 1h maxAge on the first attempt, maxAge 0 on every retry", async () => {
    const bodies = stubShellFetch();
    const out = await scrapeZillowJson("https://www.zillow.com/x", "fc-test", { gaps: [0, 0, 0], timeoutMs: 1000 });
    expect(out).toBeNull();
    expect(bodies.map((b) => b.maxAge)).toEqual([3_600_000, 0, 0]);
    expect(MONITOR.scrapeMaxAgeMs).toBe(3_600_000);
  });
  it("Redfin comps: same freshness rule", async () => {
    const bodies = stubShellFetch();
    const out = await scrapeRedfinMarkdown("19805", "fc-test", { gaps: [0, 0], timeoutMs: 1000 });
    expect(out).toBeNull();
    expect(bodies.map((b) => b.maxAge)).toEqual([3_600_000, 0]);
  });
});
