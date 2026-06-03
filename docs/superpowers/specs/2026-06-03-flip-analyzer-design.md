# Flip Analyzer — Design Spec

_Date: 2026-06-03. Status: approved design, pre-implementation._
_Research basis: [`memory/flip-decision-features.md`](../../../memory/flip-decision-features.md) (Tier 1 features #1 Flip P&L + #2 tiered rehab estimator)._

## Goal
A new, self-contained **Flip Analyzer** page that lets the team decide whether to flip a property and at
what maximum offer. It turns a property into a flip P&L: **ARV − rehab − full cost stack → MAO, profit, ROI,
grade**. It is an *additive* feature — it consumes data from the existing Sheriff Sales and Legal Notices
records read-only, but does not modify those pages, their queries, their pipelines, or `deal.ts`.

## Hard constraints (from the user)
1. **Do not modify** the Sheriff Sales or Legal Notices pages, their Convex queries/actions, or `src/scraper/deal.ts`.
2. **Do not insert** anything into those two pages. The new feature is its own page.
3. **Do not combine** features. Reading existing data is allowed; writing back to `sheriffListings` /
   `legalNotices` is not.
4. Reuse (by import, without changing) is allowed: `parseMoney` from `deal.ts`, and the formatting helpers in
   `src/components/formater.ts`.

The three edits to existing files (below) are **registration only** — adding a new table beside the existing
ones, one new route, one new nav item. No existing table, route, page, query, or pipeline is altered.

## Scope
**In scope:** Flip P&L (#1) and the tiered $/sqft rehab estimator with manual override (#2), saved per analysis,
runnable on an existing Sheriff/Legal listing **or** a manually entered address.

**Out of scope (YAGNI — the pure `computeFlip` makes these easy to add later):** scenario/sensitivity
comparison, itemized line-item rehab worksheets, lender/partner PDF reports, and ARV-from-comps (the separate
Tier-2 build / build-vs-buy decision tracked in `memory/next-initiative-offmarket.md`).

## Decisions (locked with the user)
- **Persistence:** save each analysis to a new `flipAnalyses` table.
- **ARV:** manual entry, pre-filled with the property's as-is Zestimate as an editable anchor.
- **Property scope:** from a Sheriff/Legal listing (auto-fills facts) **or** a manual address.
- **Rehab depth:** tiered $/sqft (Cosmetic / Moderate / Gut) + manual override; no itemized worksheet now.
- **Holding-cost taxes:** an editable monthly figure — NOT derived from the parcel `*BalanceDue` fields, which
  are *delinquent arrears*, not annual property tax (reusing them would be wrong).
- **Grade** is driven by profit margin; the 70%-rule check surfaces as a flag (not a separate screen).

---

## Architecture (files)
```
NEW   src/scraper/flip.ts            pure math: REHAB_TIERS, FLIP_DEFAULTS, estimateRehab(), computeFlip()
NEW   tests/flip.test.ts             unit tests (mirrors tests/deal.test.ts)
NEW   convex/flipData.ts             V8 queries + mutations (gated by requireUser)
NEW   src/web/FlipAnalyzer.tsx       the /flip page (its own file; pages.tsx is untouched)
EDIT  convex/schema.ts               ADD flipAnalyses table (existing tables unchanged)
EDIT  src/web/app.tsx                ADD route: /flip -> FlipAnalyzer
EDIT  src/components/app-shared.tsx  ADD nav item: { title: "Flip Analyzer", path: "/flip", icon: Calculator }  // lucide Calculator
```
`flip.ts` is a `"use node"`-free pure module (like `deal.ts`), safe to run inside a Convex V8 query.

## Data model — new `flipAnalyses` table
All money fields are stored as parsed `number | null` (we parse listing strings at creation). The snapshot
makes each record self-contained (immune to a later re-scrape of the source listing) and lets manual and
listing-based deals share one shape.

```ts
flipAnalyses: defineTable({
  // provenance (link is optional so manual deals stand alone)
  source: v.object({
    kind: v.union(v.literal("sheriff"), v.literal("legal"), v.literal("manual")),
    listingId: v.optional(v.string()),        // _id string of the source row, for reference only
  }),
  // snapshot of property facts at creation
  address: v.string(),
  sqft: v.optional(v.number()),               // parsed; null when unknown
  beds: v.optional(v.string()),
  baths: v.optional(v.string()),
  asIsValue: v.optional(v.number()),          // parsed Zestimate snapshot
  // editable inputs
  arv: v.optional(v.number()),                // pre-filled = asIsValue, user adjusts
  purchasePrice: v.optional(v.number()),
  rehabTier: v.union(v.literal("cosmetic"), v.literal("moderate"), v.literal("gut"), v.literal("custom")),
  rehabPerSqft: v.number(),                    // from the tier default; editable
  rehabOverride: v.optional(v.number()),       // if set, used instead of perSqft * sqft
  contingencyPct: v.number(),                  // default 0.10
  assumptions: v.object({
    closingPct: v.number(),                    // purchase-side closing, fraction of purchase
    downPct: v.number(),                       // fraction of purchase paid as down payment
    loanPoints: v.number(),                    // fraction of loan amount
    annualRate: v.number(),                    // hard-money annual interest, fraction
    holdingMonths: v.number(),
    monthlyHolding: v.number(),                // taxes+insurance+utilities+misc, $/month
    sellAgentPct: v.number(),                  // fraction of ARV
    sellTransferPct: v.number(),               // fraction of ARV (DE seller transfer tax portion)
    sellClosingPct: v.number(),                // fraction of ARV
  }),
  // workflow (its OWN copy — never writes to the source listing)
  dealStatus,                                  // reuse the shared union from schema.ts
  notes: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_dealStatus", ["dealStatus"])
```
Computed outputs (MAO, profit, ROI, grade, …) are **not** stored — `computeFlip()` derives them in the query.

## `flip.ts` — pure math (the heart of the feature)

### Constants
```ts
// per-sqft midpoints from the research; all editable per analysis
REHAB_TIERS = {
  cosmetic: { perSqft: 18, label: "Cosmetic", range: "$10-25/sqft" },
  moderate: { perSqft: 42, label: "Moderate", range: "$25-60/sqft" },
  gut:      { perSqft: 95, label: "Full Gut", range: "$60-150+/sqft" },
}
FLIP_DEFAULTS = {
  contingencyPct: 0.10,
  closingPct: 0.02, downPct: 0.10, loanPoints: 0.02, annualRate: 0.11,
  holdingMonths: 6, monthlyHolding: 400,
  sellAgentPct: 0.05, sellTransferPct: 0.02, sellClosingPct: 0.01,
}
```

### `estimateRehab(perSqft, sqft, contingencyPct, override?)`
- `base = override ?? (perSqft * sqft)`  (override wins; if sqft is null and no override → base = null)
- `contingency = base * contingencyPct`
- returns `{ base, contingency, total: base + contingency }` (or nulls when base is null)

### `computeFlip(input)` -> `FlipMetrics`
Inputs: `arv, purchasePrice, rehabTotal, assumptions`. Steps:
```
closingCost    = purchasePrice * closingPct
downPayment    = purchasePrice * downPct
loanAmount     = (purchasePrice - downPayment) + rehabTotal      // hard money funds rest of purchase + 100% rehab
points         = loanAmount * loanPoints
interest       = loanAmount * annualRate * (holdingMonths / 12)
financingCost  = points + interest
holdingCost    = monthlyHolding * holdingMonths
sellingCost    = arv * (sellAgentPct + sellTransferPct + sellClosingPct)

mao            = arv * 0.70 - rehabTotal                          // 70%-rule offer ceiling
totalCost      = purchasePrice + closingCost + rehabTotal + financingCost + holdingCost + sellingCost
profit         = arv - totalCost
cashInvested   = downPayment + closingCost + points + interest + holdingCost
roi            = cashInvested > 0 ? profit / cashInvested : null
annualizedRoi  = (roi != null && holdingMonths > 0) ? roi * (12 / holdingMonths) : null
margin         = arv > 0 ? profit / arv : null
```

Grade (from `margin`), plus flags:
```
dataComplete = arv != null && purchasePrice != null && rehabTotal != null
grade:
  unknown  if !dataComplete
  bad      if margin <= 0
  thin     if 0 < margin < 0.10
  ok       if 0.10 <= margin < 0.20
  good     if margin >= 0.20
flags (independent of grade):
  "missing-arv" | "missing-purchase" | "missing-rehab" (-> missing inputs)
  "over-70%-rule"  if purchasePrice > mao
  "thin-margin"    if 0 < margin < 0.10
  "negative-profit" if profit <= 0
```
All money parsing reuses `parseMoney` from `deal.ts`; nulls propagate (no NaN), mirroring `deal.ts`.

## Convex `flipData.ts` (all gated by `requireUser`)
- `listAnalyses()` — every saved analysis with `computeFlip()` metrics attached; sorted best grade then highest
  profit first (same ranking style as `sheriffData.monthListings`).
- `getAnalysis(id)` — one analysis + metrics.
- `createFromSheriff({ listingId: v.id("sheriffListings") })` and `createFromLegal({ listingId: v.id("legalNotices") })`
  — typed ids so `ctx.db.get(listingId)` is read-only and type-clean (two thin mutations avoid an `Id` cast).
  Each snapshots address/sqft/beds/baths/asIsValue (parsed via `parseMoney`), seeds `arv = asIsValue`,
  `rehabTier="moderate"` + its perSqft, `contingencyPct` + `assumptions` from `FLIP_DEFAULTS`,
  `dealStatus="new"`, and stores the id string in `source.listingId`. Returns the new analysis id.
- `createManual({ address, sqft?, beds?, baths?, asIsValue? })` — same defaults, manual facts, `source.kind="manual"`.
- `updateAnalysis({ id, patch })` — patch editable inputs (arv, purchase, rehabTier/perSqft/override,
  contingencyPct, assumptions, notes); bump `updatedAt`.
- `setFlipDealStatus({ id, dealStatus })`, `deleteAnalysis({ id })`.

The property **picker** for "create from listing" reuses the existing read-only `sheriffData.sheriffMonths` /
`monthListings` and the Legal equivalents — no new query there, no modification.

## UI — `/flip` (dark "Industrial Precision" shadcn, lucide icons only, no emojis)
- **Saved-analyses table** (shadcn Table inside a Card): Address · Source chip (Sheriff/Legal/Manual) · ARV ·
  Rehab · MAO · Profit (colored by grade) · ROI · Annualized · grade Badge · deal-status select. Sortable;
  best-first by default. Reuses `formatFullCurrency` / `formatPercent`.
- **New analysis** button → choose **From a listing** (searchable Select of recent Sheriff/Legal rows) or
  **Manual address** (small form). Creates the record, opens its editor.
- **Analysis editor** (Card): inputs — ARV (pre-filled), Purchase, Rehab tier dropdown + sqft + override box,
  and a collapsible **Assumptions** panel pre-filled with `FLIP_DEFAULTS`. A **live results panel** shows MAO,
  profit, ROI, annualized ROI, margin, grade badge, and any flags. Save / Delete.
- Empty state when no analyses exist yet.

## Error handling & edge cases
- Listing facts are strings with sentinels (`PENDING` / `NOT FOUND` / `SCRAPE FAILED`): `parseMoney` returns
  `null` for those, so unknown facts become blank editable fields rather than NaN.
- Missing ARV/purchase/rehab → `grade="unknown"`, results show "—" with the relevant `missing-*` flag.
- Divide-by-zero guarded (ROI when `cashInvested<=0`, margin/annualized when denominator is 0).
- Deleting the source listing later does not break an analysis (it is a self-contained snapshot; the
  `listingId` is reference-only).

## Testing & verification
- `tests/flip.test.ts`: `estimateRehab` (each tier, contingency, override, null sqft); `computeFlip` full-input
  golden case, partial inputs, `over-70%-rule` flag, grade thresholds at boundaries (0, 0.10, 0.20), and
  null/divide-by-zero guards. Mirrors `tests/deal.test.ts` style.
- Build chain (per lessons): `npx convex dev --once` (validate + regen `_generated`) → `npm run build` →
  `npm test` (existing 44 stay green + new tests pass).
- Visual: screenshot `/flip` (headless lesson) and confirm Sheriff/Legal pages render unchanged.

## Success criteria
1. A new `/flip` page exists in the nav; Sheriff/Legal pages and pipelines are byte-for-byte behaviorally unchanged.
2. I can create an analysis from a Sheriff listing and from a Legal listing (auto-filled) and from a manual address.
3. Editing ARV / rehab tier / assumptions updates MAO, profit, ROI, and grade live, and persists on save.
4. The math matches hand-computed golden cases in the unit tests.
5. `npm run build` + `npm test` green; no changes to `deal.ts`, `sheriffData.ts`, `legalData.ts`, `pages.tsx`.
