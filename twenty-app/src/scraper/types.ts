// Shared types for the scraping pipeline. Mirrors the original Pydantic schemas
// (ZillowData, ParcelData) and the n8n listing shape. Runtime-agnostic.

export interface SheriffListing {
  type: string;
  attorney: string;
  plaintiff: string;
  courtCaseNumber: string;
  defendant: string;
  address: string;
  parcel: string;
  status: string;
  principal: string;
}

export interface ParcelData {
  parcelNumber: string;
  propertyAddress?: string;
  cityStateZip?: string;
  ownerName?: string;
  ownerAddress?: string;
  propertyClass?: string;
  subdivision?: string;
  lotSize?: string;
  lotDepth?: string;
  lotFrontage?: string;
  assessmentLand?: string;
  assessmentStructure?: string;
  assessmentTotal?: string;
  countyBalanceDue?: string;
  schoolBalanceDue?: string;
  sewerBalanceDue?: string;
}

export interface ZillowData {
  address: string;
  zillowUrl?: string;
  zestimate?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
  lotSize?: string;
}

// Error codes written into empty cells — max 2 words (preserved from original).
export type ErrorCode =
  | "SCRAPE FAILED"
  | "NOT FOUND"
  | "NO ADDRESS"
  | "WRONG STATE"
  | "NO PARCEL"
  | "NO STATE"
  | "BAD ADDRESS";
