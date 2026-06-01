// Logic function: scrape-legal-notices
// Triggers: weekly cron (Mondays ~7am ET) + HTTP button (/s/legal/scrape) + AI tool.
// Flow: Firecrawl the NCC Legal Notices page -> latest weekly PDF -> LLM-extract
// estate listings (OpenRouter) -> create LegalNotice records (PENDING). Each
// create fires enrich-legal-notice (Zillow) via a database-event trigger.

import { defineLogicFunction } from "twenty-sdk/define";
import type { RoutePayload } from "twenty-sdk/logic-function";
import { CoreApiClient } from "twenty-client-sdk/core";
import { fetchLatestLegalNoticesPdf, extractLegalListings } from "../scraper/legalNotices.js";
import { toLegalCreateData } from "../scraper/crmMap.js";

export const SCRAPE_LEGAL_NOTICES_UID = "2b3c4d5e-6f70-4a1b-8c2d-3e4f5a6b7c80";

const handler = async (params: RoutePayload) => {
  const firecrawlKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  const openrouterKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!firecrawlKey) throw new Error("FIRECRAWL_API_KEY app secret is not set");
  if (!openrouterKey) throw new Error("OPENROUTER_API_KEY app secret is not set");

  const force = Boolean((params.body as { force?: boolean } | null)?.force);
  const client = new CoreApiClient();

  const { pdfText, dateFound } = await fetchLatestLegalNoticesPdf(firecrawlKey);
  const listings = await extractLegalListings(pdfText, openrouterKey, dateFound);

  // Idempotency: skip a week we already ingested (unless force).
  if (!force && dateFound) {
    const existing = await client.query({
      legalNotices: {
        __args: { filter: { weekDate: { eq: dateFound } }, first: 1 },
        totalCount: true,
      },
    });
    const count = (existing as { legalNotices?: { totalCount?: number } }).legalNotices?.totalCount ?? 0;
    if (count > 0) return { skipped: true, reason: "already scraped", weekDate: dateFound, existing: count };
  }

  await client.mutation({
    createScrapeRun: {
      __args: {
        data: {
          name: `Legal Notices — ${dateFound ?? "latest"}`,
          runType: "LEGAL",
          saleMonth: dateFound ?? "",
          runStatus: "RUNNING",
          listingCount: listings.length,
          enrichedCount: 0,
          startedAt: new Date().toISOString(),
        },
      },
      id: true,
    },
  });

  let created = 0;
  for (const l of listings) {
    await client.mutation({
      createLegalNotice: { __args: { data: toLegalCreateData(l) }, id: true },
    });
    created++;
  }

  return { weekDate: dateFound, created };
};

export default defineLogicFunction({
  universalIdentifier: SCRAPE_LEGAL_NOTICES_UID,
  name: "scrape-legal-notices",
  description:
    "Scrape the latest New Castle County weekly Legal Notices PDF, LLM-extract estate/probate listings, and create a Legal Notice record per listing (then auto-enriched with Zillow).",
  timeoutSeconds: 120,
  handler,
  httpRouteTriggerSettings: { path: "/legal/scrape", httpMethod: "POST", isAuthRequired: true },
  cronTriggerSettings: { pattern: "0 11 * * 1" }, // Mondays ~7am ET
  toolTriggerSettings: {},
});
