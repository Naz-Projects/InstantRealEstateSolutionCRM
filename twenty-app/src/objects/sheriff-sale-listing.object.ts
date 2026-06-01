// Custom object: Sheriff Sale Listing.
// One record per property in the NCC monthly sheriff-sale PDF, enriched with
// parcel + Zillow data and carrying a wholesaling deal-pipeline status.
//
// NOTE: validate against `yarn twenty dev` once a Twenty server is running —
// base fields (id, name, createdAt, updatedAt, ...) are added automatically.

import { defineObject, FieldType } from "twenty-sdk/define";

enum EnrichmentStatus {
  PENDING = "PENDING",
  ENRICHED = "ENRICHED",
  FAILED = "FAILED",
}

enum DealStatus {
  NEW = "NEW",
  REVIEWING = "REVIEWING",
  CONTACTED = "CONTACTED",
  OFFER = "OFFER",
  DEAD = "DEAD",
}

export const SHERIFF_SALE_LISTING_UID = "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b01";

// Field universalIdentifiers — exported so views/indexes can reference them.
export const SSL = {
  runId: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b02",
  saleMonth: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b03",
  saleType: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b04",
  defendant: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b05",
  plaintiff: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b06",
  attorney: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b07",
  courtCaseNumber: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b08",
  address: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b09",
  parcel: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0a",
  saleStatus: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0b",
  principal: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0c",
  ownerName: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0d",
  propertyAddress: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0e",
  assessmentTotal: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0f",
  countyBalanceDue: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b10",
  schoolBalanceDue: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b11",
  sewerBalanceDue: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b12",
  zillowUrl: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b13",
  zestimate: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b14",
  beds: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b15",
  baths: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b16",
  sqft: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b17",
  enrichmentStatus: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b18",
  dealStatus: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b19",
  notes: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b1a",
} as const;

const text = (uid: string, name: string, label: string, icon = "IconAbc") => ({
  universalIdentifier: uid,
  name,
  type: FieldType.TEXT,
  label,
  icon,
  isNullable: true,
});

export default defineObject({
  universalIdentifier: SHERIFF_SALE_LISTING_UID,
  nameSingular: "sheriffSaleListing",
  namePlural: "sheriffSaleListings",
  labelSingular: "Sheriff Sale Listing",
  labelPlural: "Sheriff Sale Listings",
  description: "A property from the NCC sheriff-sale PDF, enriched with parcel + Zillow data.",
  icon: "IconGavel",
  fields: [
    text(SSL.runId, "runId", "Scrape Run Id", "IconLink"),
    text(SSL.saleMonth, "saleMonth", "Sale Month", "IconCalendar"),
    text(SSL.saleType, "saleType", "Type", "IconTag"),
    text(SSL.defendant, "defendant", "Defendant", "IconUser"),
    text(SSL.plaintiff, "plaintiff", "Plaintiff", "IconUser"),
    text(SSL.attorney, "attorney", "Attorney", "IconBriefcase"),
    text(SSL.courtCaseNumber, "courtCaseNumber", "Court Case #", "IconHash"),
    text(SSL.address, "address", "Address", "IconMapPin"),
    text(SSL.parcel, "parcel", "Parcel", "IconHash"),
    text(SSL.saleStatus, "saleStatus", "Sale Status", "IconInfoCircle"),
    text(SSL.principal, "principal", "Principal", "IconCash"),
    text(SSL.ownerName, "ownerName", "Owner", "IconUser"),
    text(SSL.propertyAddress, "propertyAddress", "Property Address", "IconHome"),
    text(SSL.assessmentTotal, "assessmentTotal", "Assessment Total", "IconCash"),
    text(SSL.countyBalanceDue, "countyBalanceDue", "County Balance", "IconCash"),
    text(SSL.schoolBalanceDue, "schoolBalanceDue", "School Balance", "IconCash"),
    text(SSL.sewerBalanceDue, "sewerBalanceDue", "Sewer Balance", "IconCash"),
    text(SSL.zillowUrl, "zillowUrl", "Zillow Link", "IconLink"),
    text(SSL.zestimate, "zestimate", "Zestimate", "IconCash"),
    text(SSL.beds, "beds", "Beds", "IconBed"),
    text(SSL.baths, "baths", "Baths", "IconBath"),
    text(SSL.sqft, "sqft", "Sqft", "IconRuler"),
    {
      universalIdentifier: SSL.enrichmentStatus,
      name: "enrichmentStatus",
      type: FieldType.SELECT,
      label: "Enrichment",
      icon: "IconRefresh",
      defaultValue: `'${EnrichmentStatus.PENDING}'`,
      options: [
        { value: EnrichmentStatus.PENDING, label: "Pending", position: 0, color: "gray" },
        { value: EnrichmentStatus.ENRICHED, label: "Enriched", position: 1, color: "green" },
        { value: EnrichmentStatus.FAILED, label: "Failed", position: 2, color: "red" },
      ],
    },
    {
      universalIdentifier: SSL.dealStatus,
      name: "dealStatus",
      type: FieldType.SELECT,
      label: "Deal Status",
      icon: "IconTargetArrow",
      defaultValue: `'${DealStatus.NEW}'`,
      options: [
        { value: DealStatus.NEW, label: "New", position: 0, color: "blue" },
        { value: DealStatus.REVIEWING, label: "Reviewing", position: 1, color: "orange" },
        { value: DealStatus.CONTACTED, label: "Contacted", position: 2, color: "purple" },
        { value: DealStatus.OFFER, label: "Offer Made", position: 3, color: "green" },
        { value: DealStatus.DEAD, label: "Dead", position: 4, color: "red" },
      ],
    },
    text(SSL.notes, "notes", "Notes", "IconNotes"),
  ],
});
