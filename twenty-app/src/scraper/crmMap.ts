// The scraper -> CRM data contract. These pure functions produce the exact
// `data` objects the Twenty logic functions send to CoreApiClient when creating
// and updating Sheriff Sale Listing records. Extracted here so the mapping is
// unit-tested offline (the GraphQL transport itself is Twenty's code + needs a
// running server; this is everything up to that wire).

import type { SheriffListing, ZillowData } from "./types.js";
import type { EnrichedListing } from "./enrich.js";
import type { LegalListing } from "./legalNotices.js";

export interface ListingCreateData {
  name: string;
  runId: string;
  saleMonth: string;
  saleType: string;
  defendant: string;
  plaintiff: string;
  attorney: string;
  courtCaseNumber: string;
  address: string;
  parcel: string;
  saleStatus: string;
  principal: string;
  enrichmentStatus: "PENDING";
  dealStatus: "NEW";
}

/** Map a freshly-parsed listing to the create payload (status PENDING). */
export function toListingCreateData(
  l: SheriffListing,
  saleMonth: string,
  runId: string,
): ListingCreateData {
  return {
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
  };
}

export interface ListingUpdateData {
  address: string;
  ownerName: string;
  propertyAddress: string;
  assessmentTotal: string;
  countyBalanceDue: string;
  schoolBalanceDue: string;
  sewerBalanceDue: string;
  zillowUrl: string;
  zestimate: string;
  beds: string;
  baths: string;
  sqft: string;
  enrichmentStatus: "ENRICHED";
}

/** Map an enriched listing to the update payload (status ENRICHED). */
export function toListingUpdateData(e: EnrichedListing): ListingUpdateData {
  return {
    address: e.address,
    ownerName: e.ownerName,
    propertyAddress: e.propertyAddress,
    assessmentTotal: e.assessmentTotal,
    countyBalanceDue: e.countyBalanceDue,
    schoolBalanceDue: e.schoolBalanceDue,
    sewerBalanceDue: e.sewerBalanceDue,
    zillowUrl: e.zillowUrl,
    zestimate: e.zestimate,
    beds: e.beds,
    baths: e.baths,
    sqft: e.sqft,
    enrichmentStatus: "ENRICHED",
  };
}

// ---- Legal Notices (estate/probate) -> CRM ----

export interface LegalCreateData {
  name: string;
  weekDate: string;
  title: string;
  ownerName: string;
  address: string;
  personalRepresentative: string;
  enrichmentStatus: "PENDING";
  dealStatus: "NEW";
}

export function toLegalCreateData(l: LegalListing): LegalCreateData {
  return {
    name: l.ownerName,
    weekDate: l.weekDate ?? "",
    title: l.title,
    ownerName: l.ownerName,
    address: l.address,
    personalRepresentative: l.personalRepresentative,
    enrichmentStatus: "PENDING",
    dealStatus: "NEW",
  };
}

export interface LegalUpdateData {
  zillowUrl: string;
  zestimate: string;
  beds: string;
  baths: string;
  sqft: string;
  enrichmentStatus: "ENRICHED" | "FAILED";
}

/** Map a Zillow result (or an error code) to the legal-notice update payload. */
export function toLegalUpdateData(
  zillow: Partial<ZillowData>,
  errorCode: string | null,
): LegalUpdateData {
  const v = (val?: string) => val || errorCode || "NOT FOUND";
  return {
    zillowUrl: v(zillow.zillowUrl),
    zestimate: v(zillow.zestimate),
    beds: v(zillow.beds),
    baths: v(zillow.baths),
    sqft: v(zillow.sqft),
    enrichmentStatus: errorCode ? "FAILED" : "ENRICHED",
  };
}
