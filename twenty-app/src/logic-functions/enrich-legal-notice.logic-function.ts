// Logic function: enrich-legal-notice
// Trigger: databaseEvent `legalNotice.created` (fan-out, one per record).
// Estate notices only need Zillow enrichment (no parcel lookup) — the deceased's
// "late of" address goes straight to Zillow.

import { defineLogicFunction } from "twenty-sdk/define";
import type { DatabaseEventPayload, ObjectRecordCreateEvent } from "twenty-sdk/logic-function";
import { CoreApiClient } from "twenty-client-sdk/core";
import { scrapeZillow, isDelawareUrl } from "../scraper/zillow.js";
import { zillowAddress } from "../scraper/address.js";
import { toLegalUpdateData } from "../scraper/crmMap.js";
import type { ZillowData } from "../scraper/types.js";

export const ENRICH_LEGAL_NOTICE_UID = "3c4d5e6f-7081-4a2b-9c3d-4e5f6a7b8c90";

interface LegalRecord {
  id: string;
  address?: string;
}

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<LegalRecord>>,
) => {
  const apiKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY app secret is not set");

  const rec = event.properties.after;
  const client = new CoreApiClient();

  const addr = zillowAddress(rec.address ?? "");
  let zillow: Partial<ZillowData> = {};
  let errorCode: string | null = null;

  if (!addr) {
    errorCode = !rec.address || rec.address === "N/A" ? "NO ADDRESS" : "BAD ADDRESS";
  } else {
    try {
      const zd = await scrapeZillow(addr, apiKey);
      if (zd.zillowUrl && !isDelawareUrl(zd.zillowUrl)) errorCode = "WRONG STATE";
      else zillow = zd;
    } catch {
      errorCode = "SCRAPE FAILED";
    }
  }

  await client.mutation({
    updateLegalNotice: {
      __args: { id: rec.id, data: toLegalUpdateData(zillow, errorCode) },
      id: true,
    },
  });

  return { id: rec.id, enriched: !errorCode };
};

export default defineLogicFunction({
  universalIdentifier: ENRICH_LEGAL_NOTICE_UID,
  name: "enrich-legal-notice",
  description: "When a Legal Notice is created, enrich it with Zillow data for the deceased's address.",
  timeoutSeconds: 90,
  handler,
  databaseEventTriggerSettings: { eventName: "legalNotice.created" },
});
