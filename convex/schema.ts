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
  users: defineTable({
    tokenIdentifier: v.string(), // Clerk subject once linked; "pending:<invitationId>" before
    name: v.string(),
    email: v.string(), // normalized lowercase
    role: v.union(v.literal("admin"), v.literal("member")),
    isActive: v.boolean(),
    clerkInvitationId: v.optional(v.string()),
    phone: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_invitation", ["clerkInvitationId"]),

  // One row per scrape execution — run history + progress tracking.
  scrapeRuns: defineTable({
    type: v.union(v.literal("sheriff"), v.literal("legal")),
    label: v.string(), // "June 2026" (sheriff) or "2026-05-26" (legal)
    status: v.union(v.literal("running"), v.literal("complete"), v.literal("failed")),
    listingCount: v.number(),
    enrichedCount: v.number(),
    // Optional (added later) so pre-existing run rows still validate.
    phase: v.optional(v.string()), // current pipeline phase for the progress stepper
    failedCount: v.optional(v.number()), // listings that failed to enrich
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    triggeredBy: v.string(),
  }).index("by_type", ["type"]),

  // Step-by-step progress events for a run — one row per step, streamed live to
  // the UI stepper. Separate table (not an array on the run doc) so the ~N
  // concurrent enrich actions don't contend writing the same document.
  scrapeEvents: defineTable({
    runId: v.id("scrapeRuns"),
    phase: v.string(),
    message: v.string(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
  }).index("by_run", ["runId"]),

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
    // map (geocoded lazily; optional so existing rows still validate)
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeStatus: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
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
    // map (geocoded lazily; optional so existing rows still validate)
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeStatus: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
    // workflow
    enrichmentStatus,
    dealStatus,
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_weekDate", ["weekDate"])
    .index("by_dealStatus", ["dealStatus"]),

  // Flip analyses — additive, self-contained. Reads sheriff/legal rows only at
  // creation (snapshot); never writes back to them.
  flipAnalyses: defineTable({
    source: v.object({
      kind: v.union(v.literal("sheriff"), v.literal("legal"), v.literal("manual")),
      listingId: v.optional(v.string()), // source row _id (string) — reference only
    }),
    // snapshot of property facts at creation
    address: v.string(),
    sqft: v.optional(v.number()),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    asIsValue: v.optional(v.number()), // parsed Zestimate snapshot
    // editable inputs
    arv: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    rehabTier: v.union(
      v.literal("cosmetic"),
      v.literal("moderate"),
      v.literal("gut"),
      v.literal("custom"),
    ),
    rehabPerSqft: v.number(),
    rehabOverride: v.optional(v.number()),
    contingencyPct: v.number(),
    assumptions: v.object({
      closingPct: v.number(),
      downPct: v.number(),
      loanPoints: v.number(),
      annualRate: v.number(),
      holdingMonths: v.number(),
      monthlyHolding: v.number(),
      sellAgentPct: v.number(),
      sellTransferPct: v.number(),
      sellClosingPct: v.number(),
    }),
    // comps (pulled on demand by the pullComps action)
    comps: v.optional(
      v.array(
        v.object({
          address: v.string(),
          soldDate: v.string(),
          soldPrice: v.number(),
          beds: v.optional(v.number()),
          baths: v.optional(v.number()),
          sqft: v.optional(v.number()),
          pricePerSqft: v.optional(v.number()),
        }),
      ),
    ),
    suggestedArv: v.optional(v.number()),
    compsPulledAt: v.optional(v.number()),
    compsError: v.optional(v.string()),
    // workflow (its OWN copy — never writes to the source listing)
    dealStatus,
    notes: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_dealStatus", ["dealStatus"]),
});
