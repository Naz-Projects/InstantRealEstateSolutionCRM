// Custom object: Legal Notice — one estate/probate listing from the NCC weekly
// legal-notices PDF (deceased owner + "late of" address + personal rep),
// Zillow-enriched, with the same wholesaling deal pipeline.

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

export const LEGAL_NOTICE_UID = "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b01";

export const LN = {
  weekDate: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b02",
  title: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b03",
  ownerName: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b04",
  address: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b05",
  personalRepresentative: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b06",
  zillowUrl: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b07",
  zestimate: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b08",
  beds: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b09",
  baths: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b0a",
  sqft: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b0b",
  enrichmentStatus: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b0c",
  dealStatus: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b0d",
  notes: "1a2b3c4d-5e6f-4a8b-9c01-2d3e4f5a6b0e",
} as const;

export default defineObject({
  universalIdentifier: LEGAL_NOTICE_UID,
  nameSingular: "legalNotice",
  namePlural: "legalNotices",
  labelSingular: "Legal Notice",
  labelPlural: "Legal Notices",
  description: "An estate/probate listing from the NCC weekly legal notices, Zillow-enriched.",
  icon: "IconScale",
  fields: [
    { universalIdentifier: LN.weekDate, name: "weekDate", type: FieldType.TEXT, label: "Week", icon: "IconCalendar", isNullable: true },
    { universalIdentifier: LN.title, name: "title", type: FieldType.TEXT, label: "Title", icon: "IconFileText", isNullable: true },
    { universalIdentifier: LN.ownerName, name: "ownerName", type: FieldType.TEXT, label: "Deceased / Owner", icon: "IconUser", isNullable: true },
    { universalIdentifier: LN.address, name: "address", type: FieldType.TEXT, label: "Address", icon: "IconMapPin", isNullable: true },
    { universalIdentifier: LN.personalRepresentative, name: "personalRepresentative", type: FieldType.TEXT, label: "Personal Rep", icon: "IconUserCheck", isNullable: true },
    { universalIdentifier: LN.zillowUrl, name: "zillowUrl", type: FieldType.TEXT, label: "Zillow Link", icon: "IconLink", isNullable: true },
    { universalIdentifier: LN.zestimate, name: "zestimate", type: FieldType.TEXT, label: "Zestimate", icon: "IconCash", isNullable: true },
    { universalIdentifier: LN.beds, name: "beds", type: FieldType.TEXT, label: "Beds", icon: "IconBed", isNullable: true },
    { universalIdentifier: LN.baths, name: "baths", type: FieldType.TEXT, label: "Baths", icon: "IconBath", isNullable: true },
    { universalIdentifier: LN.sqft, name: "sqft", type: FieldType.TEXT, label: "Sqft", icon: "IconRuler", isNullable: true },
    {
      universalIdentifier: LN.enrichmentStatus,
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
      universalIdentifier: LN.dealStatus,
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
    { universalIdentifier: LN.notes, name: "notes", type: FieldType.TEXT, label: "Notes", icon: "IconNotes", isNullable: true },
  ],
});
