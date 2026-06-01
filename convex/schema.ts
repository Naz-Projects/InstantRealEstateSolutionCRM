import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Deal pipeline shared by both record types.
export const dealStatus = v.union(
  v.literal("new"),
  v.literal("reviewing"),
  v.literal("contacted"),
  v.literal("offer"),
  v.literal("dead"),
);

export const enrichmentStatus = v.union(
  v.literal("pending"),
  v.literal("enriched"),
  v.literal("failed"),
);

export default defineSchema({
  // One row per scrape execution — run history + progress tracking.
  scrapeRuns: defineTable({
    type: v.union(v.literal("sheriff"), v.literal("legal")),
    label: v.string(), // "June 2026" (sheriff) or "2026-05-26" (legal)
    status: v.union(v.literal("running"), v.literal("complete"), v.literal("failed")),
    listingCount: v.number(),
    enrichedCount: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    triggeredBy: v.string(),
  }).index("by_type", ["type"]),

  // Sheriff sale listings (parcel + Zillow enriched).
  sheriffListings: defineTable({
    runId: v.id("scrapeRuns"),
    saleMonth: v.string(),
    // scraped
    saleType: v.string(),
    attorney: v.string(),
    plaintiff: v.string(),
    courtCaseNumber: v.string(),
    defendant: v.string(),
    address: v.string(),
    parcel: v.string(),
    saleStatus: v.string(),
    principal: v.string(),
    // parcel enrichment
    ownerName: v.string(),
    propertyAddress: v.string(),
    assessmentTotal: v.string(),
    countyBalanceDue: v.string(),
    schoolBalanceDue: v.string(),
    sewerBalanceDue: v.string(),
    // zillow enrichment
    zillowUrl: v.string(),
    zestimate: v.string(),
    beds: v.string(),
    baths: v.string(),
    sqft: v.string(),
    // workflow
    enrichmentStatus,
    dealStatus,
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_saleMonth", ["saleMonth"])
    .index("by_dealStatus", ["dealStatus"]),

  // Legal notices (estate/probate, Zillow enriched).
  legalNotices: defineTable({
    runId: v.id("scrapeRuns"),
    weekDate: v.string(),
    title: v.string(),
    ownerName: v.string(),
    address: v.string(),
    personalRepresentative: v.string(),
    // zillow enrichment
    zillowUrl: v.string(),
    zestimate: v.string(),
    beds: v.string(),
    baths: v.string(),
    sqft: v.string(),
    // workflow
    enrichmentStatus,
    dealStatus,
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_weekDate", ["weekDate"])
    .index("by_dealStatus", ["dealStatus"]),
});
