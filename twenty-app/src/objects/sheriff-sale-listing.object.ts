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
    // --- Run linkage + scrape source ---
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b02", "runId", "Scrape Run Id", "IconLink"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b03", "saleMonth", "Sale Month", "IconCalendar"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b04", "saleType", "Type", "IconTag"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b05", "defendant", "Defendant", "IconUser"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b06", "plaintiff", "Plaintiff", "IconUser"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b07", "attorney", "Attorney", "IconBriefcase"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b08", "courtCaseNumber", "Court Case #", "IconHash"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b09", "address", "Address", "IconMapPin"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0a", "parcel", "Parcel", "IconHash"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0b", "saleStatus", "Sale Status", "IconInfoCircle"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0c", "principal", "Principal", "IconCash"),
    // --- Parcel enrichment ---
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0d", "ownerName", "Owner", "IconUser"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0e", "propertyAddress", "Property Address", "IconHome"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b0f", "assessmentTotal", "Assessment Total", "IconCash"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b10", "countyBalanceDue", "County Balance", "IconCash"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b11", "schoolBalanceDue", "School Balance", "IconCash"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b12", "sewerBalanceDue", "Sewer Balance", "IconCash"),
    // --- Zillow enrichment ---
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b13", "zillowUrl", "Zillow Link", "IconLink"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b14", "zestimate", "Zestimate", "IconCash"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b15", "beds", "Beds", "IconBed"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b16", "baths", "Baths", "IconBath"),
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b17", "sqft", "Sqft", "IconRuler"),
    // --- Workflow / pipeline ---
    {
      universalIdentifier: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b18",
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
      universalIdentifier: "9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b19",
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
    text("9c2f1a40-1b6e-4c2a-8f10-7a1e2d3c4b1a", "notes", "Notes", "IconNotes"),
  ],
});
