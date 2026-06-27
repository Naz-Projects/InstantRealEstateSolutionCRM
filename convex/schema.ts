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
    suggestedPricePerSqft: v.optional(v.number()),
    compsPulledAt: v.optional(v.number()),
    compsError: v.optional(v.string()),
    // workflow (its OWN copy — never writes to the source listing)
    dealStatus,
    notes: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_dealStatus", ["dealStatus"]),

  // Owned properties (acquired/"won") — flip or rental. Actuals, distinct from
  // flipAnalyses (pre-purchase projection). Photo scraped from Zillow.
  properties: defineTable({
    dealType: v.union(v.literal("flip"), v.literal("rental")),
    status: v.union(
      v.literal("in_progress"), // flip
      v.literal("sold"),        // flip
      v.literal("active"),      // rental
      v.literal("vacant"),      // rental
    ),
    source: v.object({
      kind: v.union(
        v.literal("manual"),
        v.literal("sheriff"),
        v.literal("legal"),
        v.literal("flip"),
      ),
      refId: v.optional(v.string()), // source row _id (string) — reference only
    }),
    address: v.string(),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    sqft: v.optional(v.number()),
    zestimate: v.optional(v.string()), // Zillow Zestimate (string, e.g. "$245,000")
    purchasePrice: v.optional(v.number()),
    acquiredDate: v.optional(v.number()),
    salePrice: v.optional(v.number()), // flip, set when sold
    soldDate: v.optional(v.number()),
    zillowUrl: v.optional(v.string()), // reference link + (search built from address is the scrape target)
    imageUrl: v.optional(v.string()),
    imageStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ok"), v.literal("failed")),
    ),
    notes: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dealType", ["dealType"])
    .index("by_status", ["status"]),

  // Public market data (FRED), one row per series, refreshed monthly by cron.
  // Additive context for the dashboard — no link to the deal pipelines.
  marketMetrics: defineTable({
    metric: v.string(), // stable UI key; regions can share one (e.g. activeListings)
    seriesId: v.string(), // FRED series id — unique per row
    region: v.string(), // "US" | "Delaware" | "New Castle" | "Kent" | "Sussex"
    group: v.union(
      v.literal("rates"),
      v.literal("inventory"),
      v.literal("temperature"),
    ),
    label: v.string(),
    unit: v.union(
      v.literal("percent"),
      v.literal("usd"),
      v.literal("count"),
      v.literal("days"),
    ),
    latestDate: v.string(), // "YYYY-MM-DD" of the latest observation
    latestValue: v.number(),
    priorValue: v.optional(v.number()), // previous observation (MoM/WoW)
    yearAgoValue: v.optional(v.number()), // ~12 obs back (YoY) when available
    history: v.array(v.object({ date: v.string(), value: v.number() })), // sparkline
    source: v.string(), // attribution
    fetchedAt: v.number(),
  }).index("by_seriesId", ["seriesId"]),

  // Unified per-property ledger: expenses AND income, date-stamped. One shape for
  // flip costs and rental income; sums are computed by direction in portfolio.ts.
  propertyLedger: defineTable({
    propertyId: v.id("properties"),
    direction: v.union(v.literal("expense"), v.literal("income")),
    category: v.string(),
    amount: v.number(), // positive; direction gives the sign
    date: v.number(), // entry date (ms epoch)
    description: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_property", ["propertyId"]),

  // Parcel "spine" — every NCC parcel from the free ArcGIS layer, keyed on PRCLID.
  // Slowly-changing: seeded once, kept fresh by a PRCLID key-diff CDC. `absentee`
  // (owner mailing ≠ situs) is derived. Additive; no link to the scrape pipelines.
  // See memory/source-matrix.md + docs/superpowers/plans/2026-06-07-lead-engine-phase1*.
  parcels: defineTable({
    prclid: v.string(), // natural key (APN) — NEVER the ArcGIS OBJECTID
    situsStreet: v.string(),
    propCity: v.string(),
    propState: v.string(),
    propZip: v.string(),
    propClass: v.string(),
    lotSz: v.optional(v.number()),
    ownerName: v.string(), // CNTCTLAST (full owner-name string)
    ownerAddr: v.string(),
    ownerAddr2: v.string(),
    ownerCity: v.string(),
    ownerState: v.string(),
    ownerZip: v.string(),
    ownerCountry: v.string(),
    absentee: v.boolean(),
    absenteeReason: v.string(), // out-of-state | in-state-absentee | owner-occupant | undetermined
    searchText: v.string(), // situs + city + zip + owner + prclid (for the search index)
    contentHash: v.string(), // change detection for the CDC
    firstSeen: v.number(),
    lastSeen: v.number(),
    active: v.boolean(), // false once a PRCLID vanishes from the source (split/merge)
  })
    .index("by_prclid", ["prclid"])
    .index("by_owner", ["ownerName"])
    .index("by_active", ["active"])
    .searchIndex("search_text", { searchField: "searchText" }),

  // Progress/counters for the parcel seed + CDC sync (one row per run). Counters are
  // maintained incrementally because Convex can't cheaply COUNT ~203k docs.
  parcelSync: defineTable({
    kind: v.union(v.literal("seed"), v.literal("sync")),
    status: v.union(v.literal("running"), v.literal("complete"), v.literal("failed")),
    cursor: v.optional(v.string()), // last PRCLID processed (keyset resume point)
    total: v.optional(v.number()), // source count (returnCountOnly) for progress
    processed: v.number(),
    inserted: v.number(),
    updated: v.number(),
    absentee: v.number(), // absentee parcels seen this run
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_started", ["startedAt"]),

  // Distress-signal events (lead engine Phase 2) — one row per signal observation,
  // attached to a parcel by PRCLID ("" = unmatched, kept for review). A parcel with
  // ≥1 event IS a lead (derived reactively — no stored leads table). Mirrors
  // src/scraper/signals.ts. Spec: docs/superpowers/specs/2026-06-11-lead-engine-phase2-*.
  signalEvents: defineTable({
    prclid: v.string(),
    category: v.union(
      v.literal("financial"),
      v.literal("life-event"),
      v.literal("physical"),
      v.literal("situational"),
    ),
    type: v.string(), // "code-violation" | "pre-foreclosure" | …
    source: v.string(), // provenance, e.g. "ncc-arcgis-codecases"
    externalKey: v.string(), // natural idempotency key (upsert target)
    observedDate: v.number(), // ms — recency for scoring
    status: v.string(), // source-specific state (e.g. "O" open, "NEW-NEW")
    matchConfidence: v.optional(
      v.union(v.literal("exact"), v.literal("strong"), v.literal("weak")),
    ),
    payload: v.any(),
    firstSeen: v.number(),
    lastSeen: v.number(),
  })
    .index("by_prclid", ["prclid"])
    .index("by_externalKey", ["externalKey"])
    .index("by_type", ["type"])
    .index("by_observedDate", ["observedDate"]),

  // One watermark row per signal source — where the next incremental pull starts.
  // Pulls overlap a few days + upsert by externalKey, so a missed run loses nothing.
  signalWatermarks: defineTable({
    source: v.string(),
    watermark: v.string(), // ISO datetime the next pull starts from
    lastRunAt: v.number(),
    lastResult: v.string(), // short human-readable run summary (observability)
  }).index("by_source", ["source"]),

  // Human workflow state per lead (wholesaling pipeline v1) — one row per worked
  // parcel. Leads stay DERIVED (signals ⋈ parcels); this holds only what humans set.
  // Stage list mirrors src/scraper/wholesalePipeline.ts — keep in sync.
  leadStatus: defineTable({
    prclid: v.string(),
    stage: v.union(
      v.literal("new"),
      v.literal("contacted"),
      v.literal("negotiating"),
      v.literal("under_contract"),
      v.literal("marketing"),
      v.literal("assigned"),
      v.literal("closed"),
      v.literal("dead"),
    ),
    notes: v.optional(v.string()),
    buyerId: v.optional(v.id("buyers")), // disposition: assigned cash buyer
    assignmentFee: v.optional(v.number()), // $ wholesale fee on the assignment
    updatedAt: v.number(),
  }).index("by_prclid", ["prclid"]),

  // Follow-up tasks per lead (pipeline P2) — the "next action" discipline.
  followUps: defineTable({
    prclid: v.string(),
    note: v.string(),
    dueAt: v.number(), // ms
    done: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_prclid", ["prclid"])
    .index("by_done_due", ["done", "dueAt"]),

  // Cash-buyer CRM (disposition side) — who we wholesale TO.
  buyers: defineTable({
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    buyerType: v.union(v.literal("cash"), v.literal("landlord"), v.literal("flipper")),
    targetAreas: v.optional(v.string()), // free text: zips/cities they buy in
    maxPrice: v.optional(v.number()),
    notes: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_active", ["active"]),

  // P4 equity gate — funnel-only enrichment per parcel (value + delinquent
  // balances + manual liens). Separate from `parcels` ON PURPOSE: the spine's
  // contentHash CDC must never touch scraped/hand-entered data. Tiny table:
  // only leads someone chose to enrich. Spec: 2026-06-11-equity-gate-design.md.
  parcelEquity: defineTable({
    prclid: v.string(),
    value: v.optional(v.number()), // as-is value in dollars
    valueSource: v.optional(v.union(v.literal("zestimate"), v.literal("comps"))),
    valueAt: v.optional(v.number()), // ms — when the value was scraped
    countyBalance: v.optional(v.number()),
    schoolBalance: v.optional(v.number()),
    sewerBalance: v.optional(v.number()),
    assessedValue: v.optional(v.number()), // county assessment total (context)
    balancesAt: v.optional(v.number()), // ms — when balances were scraped
    manualLiens: v.optional(v.number()), // team-entered known liens/payoff $
    manualLiensNote: v.optional(v.string()),
    lastError: v.optional(v.string()), // last enrich failure (visible, never silent)
    updatedAt: v.number(),
  }).index("by_prclid", ["prclid"]),

  // P7 vision condition scoring — funnel-only, separate from the spine (the CDC never
  // touches it), mirrors parcelEquity. Written ONLY by conditionActions.scoreCondition.
  // ISOLATED: not read by /leads or scoring. Spec: 2026-06-21-vision-condition-scoring-design.md.
  parcelCondition: defineTable({
    prclid: v.string(),
    score: v.optional(v.number()), // 0–100 distress (higher = worse)
    flags: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
    description: v.optional(v.string()), // longer evidence-grounded narrative (v2 rubric)
    confidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    rubricVersion: v.optional(v.number()), // which rubric produced this row (v2 = 2)
    model: v.optional(v.string()), // which model scored it
    imageStorageId: v.optional(v.id("_storage")), // the exact Street View image scored
    hasImagery: v.optional(v.boolean()), // false ⇒ no Street View coverage (not an error)
    rawResponse: v.optional(v.string()), // capped raw model output (debug/eval)
    scoredAt: v.optional(v.number()),
    lastError: v.optional(v.string()), // last failure, visible — never silent
    updatedAt: v.number(),
  }).index("by_prclid", ["prclid"]),

  // P6 offers — negotiation thread to the OWNER, prclid-keyed (funnel-only, mirrors parcelEquity).
  // Status transitions guarded by src/scraper/offers.ts. Spec: 2026-06-14-offers-contracts-esign-design.md.
  offers: defineTable({
    prclid: v.string(),
    amount: v.number(),
    status: v.union(
      v.literal("pending"), v.literal("countered"), v.literal("accepted"),
      v.literal("rejected"), v.literal("withdrawn"), v.literal("expired"),
    ),
    counterAmount: v.optional(v.number()),
    earnestMoney: v.optional(v.number()),
    closingDate: v.optional(v.string()),
    inspectionDays: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdByEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_prclid", ["prclid"]),

  // P6 contracts — PSA (seller) + Assignment (buyer) with a serverless e-sign lifecycle.
  // PORTAL fns are gated by `publicToken` (unguessable), NOT auth. terms = frozen snapshot at send.
  // Spec: 2026-06-14-offers-contracts-esign-design.md.
  contracts: defineTable({
    prclid: v.string(),
    type: v.union(v.literal("psa"), v.literal("assignment")),
    status: v.union(
      v.literal("draft"), v.literal("sent"), v.literal("signed"),
      v.literal("declined"), v.literal("voided"),
    ),
    terms: v.object({
      propertyAddress: v.string(),
      buyerEntity: v.string(),
      sellerName: v.optional(v.string()),
      price: v.optional(v.number()),
      earnestMoney: v.optional(v.number()),
      closingDate: v.optional(v.string()),
      inspectionDays: v.optional(v.number()),
      assigneeName: v.optional(v.string()),
      assignmentFee: v.optional(v.number()),
      underlyingContractRef: v.optional(v.string()),
    }),
    signerName: v.string(),
    signerEmail: v.optional(v.string()),
    signerRole: v.union(v.literal("seller"), v.literal("buyer")),
    publicToken: v.optional(v.string()),
    tokenCreatedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    acceptedByName: v.optional(v.string()),
    acceptedUserAgent: v.optional(v.string()),
    acknowledgments: v.optional(v.object({ bindingContract: v.boolean() })),
    signatureMode: v.optional(v.union(v.literal("typed"), v.literal("drawn"))),
    signedStorageId: v.optional(v.id("_storage")),
    signedFilename: v.optional(v.string()),
    declinedAt: v.optional(v.number()),
    declineReason: v.optional(v.string()),
    createdByEmail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_prclid", ["prclid"])
    .index("by_token", ["publicToken"]),

  // Captured application errors surfaced on the Admin → Error Log page. Written
  // best-effort by the client ErrorBoundary (crashes), page catch-blocks (handled
  // failures), and autonomous backend actions (cron). Admins triage + resolve.
  errorLogs: defineTable({
    message: v.string(), // human-readable summary (real wording, never raw code)
    source: v.union(
      v.literal("boundary"), // React render crash caught by the ErrorBoundary
      v.literal("handled"),  // a caught failure from a user action (mutation/action)
      v.literal("uncaught"), // a window error / unhandled promise rejection
      v.literal("server"),   // an autonomous backend/cron failure (no UI to show it)
    ),
    severity: v.union(v.literal("error"), v.literal("warning")),
    context: v.optional(v.string()),        // where it happened, e.g. "startScrape"
    route: v.optional(v.string()),          // window.location.pathname
    stack: v.optional(v.string()),          // truncated technical detail
    componentStack: v.optional(v.string()), // React component stack (boundary only)
    userEmail: v.optional(v.string()),      // stamped server-side from the caller
    userAgent: v.optional(v.string()),
    resolved: v.boolean(),
    createdAt: v.number(),
  }).index("by_resolved", ["resolved"]),
});
