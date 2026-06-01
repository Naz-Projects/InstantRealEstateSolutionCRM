// Logic function: enrich-sheriff-listing
//
// Trigger: databaseEvent `sheriffSaleListing.created` — the fan-out. One
// invocation per new listing, so enrichment runs as independent, parallel
// units (no single long-running job, no timeout cliff). The reactive table
// updates live as each record finishes.
//
// Flow: read the new record -> enrichListing() (NCC parcel lookup + Zillow via
// Firecrawl) -> update the record with the enriched fields + status.
//
// ⚠️ Per-listing enrichment is ~15-20s (parcel browser-actions + Zillow), so
//    timeoutSeconds is set high. If your Twenty deployment caps function
//    timeout lower, split parcel and Zillow into two chained functions, or run
//    enrichment from an external worker via the REST/GraphQL API.
// ⚠️ updateSheriffSaleListing arg shape is confirmed by the generated client at
//    `yarn twenty dev` — adjust { id, data } vs { recordId, data } if needed.

import { defineLogicFunction } from "twenty-sdk/define";
import type {
  DatabaseEventPayload,
  ObjectRecordCreateEvent,
} from "twenty-sdk/logic-function";
import { CoreApiClient } from "twenty-client-sdk/core";
import { enrichListing } from "../scraper/enrich.js";
import type { SheriffListing } from "../scraper/types.js";

export const ENRICH_SHERIFF_LISTING_UID = "b2d4f6a8-1022-4344-9668-8ab2c4d6e8f2";

interface ListingRecord {
  id: string;
  saleMonth?: string;
  saleType?: string;
  attorney?: string;
  plaintiff?: string;
  courtCaseNumber?: string;
  defendant?: string;
  address?: string;
  parcel?: string;
  saleStatus?: string;
  principal?: string;
}

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<ListingRecord>>,
) => {
  const apiKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY app secret is not set");

  const rec = event.properties.after;
  const client = new CoreApiClient();

  const listing: SheriffListing = {
    type: rec.saleType ?? "N/A",
    attorney: rec.attorney ?? "N/A",
    plaintiff: rec.plaintiff ?? "N/A",
    courtCaseNumber: rec.courtCaseNumber ?? "N/A",
    defendant: rec.defendant ?? "N/A",
    address: rec.address ?? "N/A",
    parcel: rec.parcel ?? "N/A",
    status: rec.saleStatus ?? "N/A",
    principal: rec.principal ?? "N/A",
  };

  let enrichmentStatus = "ENRICHED";
  let enriched;
  try {
    enriched = await enrichListing(listing, rec.saleMonth ?? "", apiKey);
  } catch {
    enrichmentStatus = "FAILED";
    await client.mutation({
      updateSheriffSaleListing: {
        __args: { id: rec.id, data: { enrichmentStatus } },
        id: true,
      },
    });
    return { id: rec.id, enriched: false };
  }

  await client.mutation({
    updateSheriffSaleListing: {
      __args: {
        id: rec.id,
        data: {
          address: enriched.address,
          ownerName: enriched.ownerName,
          propertyAddress: enriched.propertyAddress,
          assessmentTotal: enriched.assessmentTotal,
          countyBalanceDue: enriched.countyBalanceDue,
          schoolBalanceDue: enriched.schoolBalanceDue,
          sewerBalanceDue: enriched.sewerBalanceDue,
          zillowUrl: enriched.zillowUrl,
          zestimate: enriched.zestimate,
          beds: enriched.beds,
          baths: enriched.baths,
          sqft: enriched.sqft,
          enrichmentStatus,
        },
      },
      id: true,
    },
  });

  return { id: rec.id, enriched: true };
};

export default defineLogicFunction({
  universalIdentifier: ENRICH_SHERIFF_LISTING_UID,
  name: "enrich-sheriff-listing",
  description:
    "When a Sheriff Sale Listing is created, enrich it with NCC parcel data (owner, assessment, balances) and Zillow data (zestimate, beds/baths/sqft).",
  timeoutSeconds: 120,
  handler,
  databaseEventTriggerSettings: {
    eventName: "sheriffSaleListing.created",
  },
});
