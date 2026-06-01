// Custom object: Sheriff Sale Listing.
// One record per property in the NCC monthly sheriff-sale PDF, enriched with
// parcel + Zillow data and carrying a wholesaling deal-pipeline status.
//
// Fields are inlined (not built via a helper) so each `type` stays a literal —
// Twenty's field manifest is a discriminated union keyed on `type`.
// Base fields (id, name, createdAt, updatedAt, ...) are added automatically.

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

export default defineObject({
  universalIdentifier: SHERIFF_SALE_LISTING_UID,
  nameSingular: "sheriffSaleListing",
  namePlural: "sheriffSaleListings",
  labelSingular: "Sheriff Sale Listing",
  labelPlural: "Sheriff Sale Listings",
  description: "A property from the NCC sheriff-sale PDF, enriched with parcel + Zillow data.",
  icon: "IconGavel",
  fields: [
    { universalIdentifier: SSL.runId, name: "runId", type: FieldType.TEXT, label: "Scrape Run Id", icon: "IconLink", isNullable: true },
    { universalIdentifier: SSL.saleMonth, name: "saleMonth", type: FieldType.TEXT, label: "Sale Month", icon: "IconCalendar", isNullable: true },
    { universalIdentifier: SSL.saleType, name: "saleType", type: FieldType.TEXT, label: "Type", icon: "IconTag", isNullable: true },
    { universalIdentifier: SSL.defendant, name: "defendant", type: FieldType.TEXT, label: "Defendant", icon: "IconUser", isNullable: true },
    { universalIdentifier: SSL.plaintiff, name: "plaintiff", type: FieldType.TEXT, label: "Plaintiff", icon: "IconUser", isNullable: true },
    { universalIdentifier: SSL.attorney, name: "attorney", type: FieldType.TEXT, label: "Attorney", icon: "IconBriefcase", isNullable: true },
    { universalIdentifier: SSL.courtCaseNumber, name: "courtCaseNumber", type: FieldType.TEXT, label: "Court Case #", icon: "IconHash", isNullable: true },
    { universalIdentifier: SSL.address, name: "address", type: FieldType.TEXT, label: "Address", icon: "IconMapPin", isNullable: true },
    { universalIdentifier: SSL.parcel, name: "parcel", type: FieldType.TEXT, label: "Parcel", icon: "IconHash", isNullable: true },
    { universalIdentifier: SSL.saleStatus, name: "saleStatus", type: FieldType.TEXT, label: "Sale Status", icon: "IconInfoCircle", isNullable: true },
    { universalIdentifier: SSL.principal, name: "principal", type: FieldType.TEXT, label: "Principal", icon: "IconCash", isNullable: true },
    { universalIdentifier: SSL.ownerName, name: "ownerName", type: FieldType.TEXT, label: "Owner", icon: "IconUser", isNullable: true },
    { universalIdentifier: SSL.propertyAddress, name: "propertyAddress", type: FieldType.TEXT, label: "Property Address", icon: "IconHome", isNullable: true },
    { universalIdentifier: SSL.assessmentTotal, name: "assessmentTotal", type: FieldType.TEXT, label: "Assessment Total", icon: "IconCash", isNullable: true },
    { universalIdentifier: SSL.countyBalanceDue, name: "countyBalanceDue", type: FieldType.TEXT, label: "County Balance", icon: "IconCash", isNullable: true },
    { universalIdentifier: SSL.schoolBalanceDue, name: "schoolBalanceDue", type: FieldType.TEXT, label: "School Balance", icon: "IconCash", isNullable: true },
    { universalIdentifier: SSL.sewerBalanceDue, name: "sewerBalanceDue", type: FieldType.TEXT, label: "Sewer Balance", icon: "IconCash", isNullable: true },
    { universalIdentifier: SSL.zillowUrl, name: "zillowUrl", type: FieldType.TEXT, label: "Zillow Link", icon: "IconLink", isNullable: true },
    { universalIdentifier: SSL.zestimate, name: "zestimate", type: FieldType.TEXT, label: "Zestimate", icon: "IconCash", isNullable: true },
    { universalIdentifier: SSL.beds, name: "beds", type: FieldType.TEXT, label: "Beds", icon: "IconBed", isNullable: true },
    { universalIdentifier: SSL.baths, name: "baths", type: FieldType.TEXT, label: "Baths", icon: "IconBath", isNullable: true },
    { universalIdentifier: SSL.sqft, name: "sqft", type: FieldType.TEXT, label: "Sqft", icon: "IconRuler", isNullable: true },
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
    { universalIdentifier: SSL.notes, name: "notes", type: FieldType.TEXT, label: "Notes", icon: "IconNotes", isNullable: true },
  ],
});
