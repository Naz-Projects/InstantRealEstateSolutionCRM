// Logic function: scrape-sheriff-sales
//
// Triggers:
//   - cron: weekdays ~7am ET (11:00 UTC) — the scheduled run
//   - httpRoute POST /s/sheriff/scrape — the "Scrape Sheriff Sales This Week" button
//   - tool: callable by Twenty AI / MCP ("scrape this month's sheriff sales")
//
// Flow: scrape the NCC PDF (Firecrawl) -> parse -> create one ScrapeRun +
// one SheriffSaleListing per property (status PENDING). Creating each listing
// fires the `enrich-sheriff-listing` function via a database-event trigger
// (the fan-out), so the table fills in live.
//
// ⚠️ The CoreApiClient is generated from your workspace schema at `yarn twenty dev`.
//    Exact mutation names/shapes (createScrapeRun / createSheriffSaleListing,
//    filter + totalCount) will be confirmed/typed at that point — adjust if the
//    generated client differs from the selection-sets below.

import { defineLogicFunction } from "twenty-sdk/define";
import type { RoutePayload } from "twenty-sdk/logic-function";
import { CoreApiClient } from "twenty-client-sdk/core";
import { fetchSheriffMarkdown, parseSheriffMarkdown } from "../scraper/sheriffParse.js";

export const SCRAPE_SHERIFF_SALES_UID = "a1c3e5f7-0911-4233-8557-79a1b3c5d7e1";

const handler = async (params: RoutePayload) => {
  const apiKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY app secret is not set");

  const force = Boolean((params.body as { force?: boolean } | null)?.force);
  const client = new CoreApiClient();

  const markdown = await fetchSheriffMarkdown(apiKey);
  const { listings, saleMonth } = parseSheriffMarkdown(markdown);

  // Idempotency guard: don't re-scrape a month we already have (unless force).
  if (!force) {
    const existing = await client.query({
      sheriffSaleListings: {
        __args: { filter: { saleMonth: { eq: saleMonth } }, first: 1 },
        totalCount: true,
      },
    });
    const count = (existing as { sheriffSaleListings?: { totalCount?: number } })
      .sheriffSaleListings?.totalCount ?? 0;
    if (count > 0) {
      return { skipped: true, reason: "already scraped", saleMonth, existing: count };
    }
  }

  const run = await client.mutation({
    createScrapeRun: {
      __args: {
        data: {
          name: `Sheriff Sales — ${saleMonth}`,
          runType: "SHERIFF",
          saleMonth,
          runStatus: "RUNNING",
          listingCount: listings.length,
          enrichedCount: 0,
          startedAt: new Date().toISOString(),
        },
      },
      id: true,
    },
  });
  const runId = (run as { createScrapeRun: { id: string } }).createScrapeRun.id;

  // Create listings as PENDING. Each create fires enrich-sheriff-listing.
  let created = 0;
  for (const l of listings) {
    await client.mutation({
      createSheriffSaleListing: {
        __args: {
          data: {
            name: l.address,
            runId,
            saleMonth,
            saleType: l.type,
            defendant: l.defendant,
            plaintiff: l.plaintiff,
            attorney: l.attorney,
            courtCaseNumber: l.courtCaseNumber,
            address: l.address,
            parcel: l.parcel,
            saleStatus: l.status,
            principal: l.principal,
            enrichmentStatus: "PENDING",
            dealStatus: "NEW",
          },
        },
        id: true,
      },
    });
    created++;
  }

  return { saleMonth, runId, created };
};

export default defineLogicFunction({
  universalIdentifier: SCRAPE_SHERIFF_SALES_UID,
  name: "scrape-sheriff-sales",
  description:
    "Scrape the New Castle County Sheriff Sale PDF for the current month and create a listing record per property. Each new listing is then automatically enriched with parcel and Zillow data. Call this to pull this week's/month's sheriff sales.",
  timeoutSeconds: 120,
  handler,
  httpRouteTriggerSettings: {
    path: "/sheriff/scrape",
    httpMethod: "POST",
    isAuthRequired: true,
  },
  cronTriggerSettings: {
    pattern: "0 11 * * 1-5", // weekdays 11:00 UTC (~7am ET); gate logic handled by idempotency guard
  },
  toolTriggerSettings: {},
});
