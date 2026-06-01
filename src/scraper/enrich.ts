// Per-listing enrichment — ported from the n8n "Enrich with Parcel Data" and
// "Enrich with Zillow" nodes, including the parcel-address fallback and the
// 2-word error codes. This is the independent unit the Twenty logic function
// fans out over (one call per listing).

import { lookupParcel } from "./parcel.js";
import { scrapeZillow, isDelawareUrl } from "./zillow.js";
import { zillowAddress } from "./address.js";
import type { ParcelData, SheriffListing, ZillowData } from "./types.js";

export interface EnrichedListing extends SheriffListing {
  saleMonth: string;
  // Parcel
  ownerName: string;
  propertyAddress: string;
  assessmentTotal: string;
  countyBalanceDue: string;
  schoolBalanceDue: string;
  sewerBalanceDue: string;
  // Zillow
  zillowUrl: string;
  zestimate: string;
  beds: string;
  baths: string;
  sqft: string;
}

export async function enrichListing(
  listing: SheriffListing,
  saleMonth: string,
  apiKey: string,
): Promise<EnrichedListing> {
  // --- Parcel ---
  const cleanParcel =
    listing.parcel && listing.parcel !== "N/A"
      ? listing.parcel.replace(/[-.]/g, "")
      : "";

  let parcelData: Partial<ParcelData> = {};
  let parcelError: string | null = null;

  if (!cleanParcel) {
    parcelError = "NO PARCEL";
  } else {
    try {
      parcelData = await lookupParcel(cleanParcel, apiKey);
    } catch {
      parcelError = "SCRAPE FAILED";
    }
  }

  let finalAddress = listing.address;
  if (
    finalAddress.startsWith("ZIP_ONLY:") ||
    finalAddress === "N/A" ||
    /^\d{5}$/.test(finalAddress)
  ) {
    const pa = parcelData.propertyAddress ?? "";
    const csz = parcelData.cityStateZip ?? "";
    if (pa) {
      finalAddress = `${pa} ${csz}`.replace(/\s+/g, " ").trim();
    } else {
      finalAddress = finalAddress.replace("ZIP_ONLY:", "") || "NO ADDRESS";
    }
  }

  const pVal = (field: keyof ParcelData): string =>
    (parcelData[field] as string) || parcelError || "NOT FOUND";

  // --- Zillow ---
  const zAddr = zillowAddress(finalAddress);
  let zillow: Partial<ZillowData> = {};
  let zillowError: string | null = null;

  if (!zAddr) {
    if (
      !finalAddress ||
      finalAddress === "N/A" ||
      finalAddress.startsWith("NO ADDRESS")
    ) {
      zillowError = "NO ADDRESS";
    } else if (!/\bDE\b/.test(finalAddress)) {
      zillowError = "NO STATE";
    } else {
      zillowError = "BAD ADDRESS";
    }
  } else {
    try {
      const zd = await scrapeZillow(zAddr, apiKey);
      if (zd.zillowUrl && !isDelawareUrl(zd.zillowUrl)) {
        zillowError = "WRONG STATE";
      } else {
        zillow = zd;
      }
    } catch {
      zillowError = "SCRAPE FAILED";
    }
  }

  const zVal = (field: keyof ZillowData): string =>
    (zillow[field] as string) || zillowError || "NOT FOUND";

  return {
    ...listing,
    address: finalAddress,
    saleMonth,
    ownerName: pVal("ownerName"),
    propertyAddress: pVal("propertyAddress"),
    assessmentTotal: pVal("assessmentTotal"),
    countyBalanceDue: pVal("countyBalanceDue"),
    schoolBalanceDue: pVal("schoolBalanceDue"),
    sewerBalanceDue: pVal("sewerBalanceDue"),
    zillowUrl: zVal("zillowUrl"),
    zestimate: zVal("zestimate"),
    beds: zVal("beds"),
    baths: zVal("baths"),
    sqft: zVal("sqft"),
  };
}
