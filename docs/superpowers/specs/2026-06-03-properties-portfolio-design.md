# Properties (Portfolio) — Design Spec

_Date: 2026-06-03. Status: approved design, pre-implementation._
_Tracks the owned-asset half of the business: houses IRES has **acquired** ("won"), as actuals._

## Goal
A new top-level **Properties** section to manage houses IRES owns. Each property is a **flip** or a **rental**.
Track the real money: **expenses** going into the house and (for rentals) **income** received, on a unified
date-stamped ledger; for flips, run the lifecycle to a **sale** and show realized profit. List page + an
individual property page with a **photo of the house pulled from Zillow via Firecrawl**.

This is *actuals*, and it is distinct from the two existing concepts it sits beside:
- **Scrapers** (Sheriff Sales / Legal Notices) — *find* candidate deals (public records).
- **Flip Analyzer** (`/flip`, `flipAnalyses`) — *project* a deal pre-purchase (ARV − rehab − costs → MAO).
- **Properties** (this) — *manage what we already own* (real purchase price, real expenses, real sale/rent).

One house = one property. The views/leads/occupancy/units metrics in the reference screenshots are SaaS
property-management concepts IRES does not have; they are layout inspiration only, **not** a feature list.

## Hard constraints
1. **Additive only.** Do not modify the Sheriff Sales, Legal Notices, or Flip Analyzer pages, their Convex
   queries/actions, or their pipelines. Reading those rows read-only (to seed a property) is allowed; writing
   back to `sheriffListings` / `legalNotices` / `flipAnalyses` is not.
2. **Reuse by import (without changing):** `parseMoney` from `src/scraper/deal.ts`, `withRetry` /
   `firecrawlScrape` from `src/scraper/firecrawl.ts`, `buildZillowSearchUrl` from `src/scraper/zillow.ts`,
   `requireUser` from `convex/helpers.ts`.
3. The edits to existing files are **registration only**: two new tables beside the existing ones, two new
   routes, one new nav item, and one new pure helper (`extractImageUrl`) appended to `src/scraper/zillow.ts`.

## Decisions (locked with the user)
- **Rental income:** a **full income ledger** — log every income entry (rent, deposit, late fee, …)
  individually, date-stamped. No fixed `monthlyRent` field; the monthly picture comes from the ledger.
- **Flip outcome:** **track to sale.** Flip has a lifecycle `in_progress → sold`; recording a sale price yields
  realized profit = `salePrice + income − purchasePrice − expenses`.
- **Adding a property:** **manual entry OR seed from an existing record** — a Sheriff/Legal listing or a saved
  Flip Analysis carries over address / beds / baths / sqft / Zillow URL so the team doesn't retype.
- **Photos:** **Firecrawl pulls the house photo from Zillow** and we render directly from the image URL.
  Direct rendering means the URL can rot over time (Zillow rotates CDN paths); the mitigation is a manual
  **Refresh photo** (re-scrape) and a **paste photo URL** control. (Copying the image into Convex storage is a
  later option if rot becomes a problem — YAGNI now.)
- **Ledger shape:** ONE unified `propertyLedger` table with a `direction: "expense" | "income"` field, not two
  near-identical tables. Same shape for flip expenses and rental income; sums computed by direction.

## Scope
**In scope:** the `properties` + `propertyLedger` tables; the `summarizeProperty` pure math; a `/properties`
list (grid of cards, filter by deal type) and a `/properties/$id` detail page (photo, facts, status, financial
summary, add/list ledger entries, notes, refresh/paste photo); seed-from-listing/flip; Firecrawl image scrape.

**Out of scope (YAGNI):** receipt images on ledger entries, multi-photo galleries (one hero photo first),
recurring/auto rent posting, tenant/lease records, cap-rate/market analytics, CSV export, a portfolio dashboard
(the existing Dashboard is untouched). The unified ledger + pure summary keep these easy to add later.

---

## Architecture (files)
```
NEW   src/scraper/portfolio.ts          pure math: summarizeProperty() (+ types). No "use node", no deps.
NEW   tests/portfolio.test.ts           unit tests (mirrors tests/flip.test.ts)
EDIT  src/scraper/zillow.ts             ADD pure extractImageUrl(text) (beside extractHomedetailsUrl)
EDIT  tests/zillow.test.ts              ADD extractImageUrl cases
NEW   convex/propertyData.ts            V8 queries + mutations (gated by requireUser) + internal helpers
NEW   convex/propertyActions.ts         "use node" — scrapePropertyImage internalAction
NEW   src/web/Properties.tsx            the /properties list page
NEW   src/web/PropertyDetail.tsx        the /properties/$id detail page
EDIT  convex/schema.ts                  ADD properties + propertyLedger tables (existing tables unchanged)
EDIT  src/web/app.tsx                   ADD routes: /properties -> Properties, /properties/$id -> PropertyDetail
EDIT  src/components/app-shared.tsx     ADD nav item { title:"Properties", path:"/properties", icon: Building2 }
```
`portfolio.ts` is a pure module (like `deal.ts`/`flip.ts`), safe to run inside a Convex V8 query.

## Data model — two new tables

### `properties`
Money fields are `number` (parsed at entry). Beds/baths are strings to match the listing snapshots that seed
them. `status` is one union covering both deal types; the UI offers only the valid states per `dealType`.
```ts
properties: defineTable({
  dealType: v.union(v.literal("flip"), v.literal("rental")),
  status: v.union(
    v.literal("in_progress"),   // flip
    v.literal("sold"),          // flip
    v.literal("active"),        // rental (occupied/owned)
    v.literal("vacant"),        // rental
  ),
  // provenance (mirrors flipAnalyses.source; refId is reference-only)
  source: v.object({
    kind: v.union(v.literal("manual"), v.literal("sheriff"), v.literal("legal"), v.literal("flip")),
    refId: v.optional(v.string()),
  }),
  // facts (snapshot)
  address: v.string(),
  beds: v.optional(v.string()),
  baths: v.optional(v.string()),
  sqft: v.optional(v.number()),
  // financials
  purchasePrice: v.optional(v.number()),
  acquiredDate: v.optional(v.number()),
  salePrice: v.optional(v.number()),        // flip only, set when sold
  soldDate: v.optional(v.number()),
  // photo (scraped from Zillow; rendered directly from imageUrl)
  zillowUrl: v.optional(v.string()),        // source for the image + a reference link
  imageUrl: v.optional(v.string()),
  imageStatus: v.optional(v.union(v.literal("pending"), v.literal("ok"), v.literal("failed"))),
  // workflow
  notes: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_dealType", ["dealType"])
  .index("by_status", ["status"])
```

### `propertyLedger` (unified expense + income)
```ts
propertyLedger: defineTable({
  propertyId: v.id("properties"),
  direction: v.union(v.literal("expense"), v.literal("income")),
  category: v.string(),                     // free text from a suggested set per direction (see UI)
  amount: v.number(),                       // positive; direction gives the sign
  date: v.number(),                         // entry date (user-entered, ms epoch)
  description: v.optional(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
}).index("by_property", ["propertyId"])
```
Deleting a property must also delete its ledger rows (done in the `deleteProperty` mutation; no orphans).

## `portfolio.ts` — pure math
```ts
export type Direction = "expense" | "income";
export type LedgerLike = { direction: Direction; amount: number };
export type PropertyFinancials = {
  dealType: "flip" | "rental";
  status: "in_progress" | "sold" | "active" | "vacant";
  purchasePrice?: number | null;
  salePrice?: number | null;
};

export type PortfolioSummary = {
  totalExpenses: number;        // sum of expense amounts
  totalIncome: number;          // sum of income amounts
  invested: number;             // (purchasePrice ?? 0) + totalExpenses  (running money-in)
  // flip-only (null when not a sold flip with a sale price)
  realizedProfit: number | null;
  roi: number | null;           // realizedProfit / invested, when invested > 0
  // rental-only
  netCashFlow: number | null;   // totalIncome - totalExpenses (null for flips)
  grade: "good" | "ok" | "thin" | "bad" | "pending";
};

export function summarizeProperty(p: PropertyFinancials, ledger: LedgerLike[]): PortfolioSummary
```
Rules:
- `totalExpenses` / `totalIncome` = summed by direction (0 when none).
- `invested = (purchasePrice ?? 0) + totalExpenses`.
- **Flip:** `netCashFlow = null`. If `status === "sold"` and `salePrice != null`:
  `realizedProfit = salePrice + totalIncome − (purchasePrice ?? 0) − totalExpenses`;
  `roi = invested > 0 ? realizedProfit / invested : null`. Otherwise `realizedProfit = null`, `roi = null`.
- **Rental:** `netCashFlow = totalIncome − totalExpenses`; `realizedProfit = null`, `roi = null`.
- **grade** (drives the headline color, mirrors flip grades):
  - flip not yet sold → `pending`; sold → `bad` if profit ≤ 0, `thin` if margin < 0.10, `ok` if < 0.20,
    else `good`, where `margin = realizedProfit / invested`.
  - rental → `pending` when `totalIncome == 0` (nothing collected yet); `bad` when `netCashFlow < 0`;
    else `good`. (Threshold buckets on cash flow aren't meaningful without a time period — keep it honest and
    simple now; refine once we track per-period cash flow.)
- No NaN: guard every divide (`invested > 0`); nulls propagate, mirroring `deal.ts`/`flip.ts`.

The current-month / monthly view is **not** in the summary — the ledger rows are date-stamped, so the detail
page shows income/expenses over time directly; a "this month" figure is filtered in the query/UI if needed.

## `extractImageUrl(text)` — pure, appended to `zillow.ts`
We scrape the Zillow **search** URL (our lessons: homedetails URLs return 403, so we cannot fall back to the
listing page for a clean `og:image`). The reliable target is an actual listing photo on the Zillow CDN.
```ts
export function extractImageUrl(text: string): string | null {
  // 1) a real listing photo on the Zillow CDN (preferred)
  const photo = text.match(/https?:\/\/photos\.zillowstatic\.com\/[^\s"')<>]+?\.(?:jpg|jpeg|png|webp)/i);
  if (photo) return photo[0];
  // 2) fallback: the og:image meta tag (may be a generic map/logo on a search page)
  const og = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1];
  return null;
}
```
**Implementation step 1 (blocking, before building the action/UI on top): run one real Firecrawl scrape
against a known DE address and inspect the `rawHtml`/`markdown`** to confirm `photos.zillowstatic.com` photo
URLs are present and which one is the hero. Adjust the regex/source to what Firecrawl actually returns. If no
reliable photo is found, the feature degrades to the placeholder + manual paste-URL control (below) — it does
not block the rest of the feature.

## Convex `propertyData.ts` (V8 queries/mutations, all gated by `requireUser`)
- `listProperties()` — all properties with `summarizeProperty()` attached; sorted newest-first (`order("desc")`).
  Returns each property's ledger totals so cards render without N client queries (compute per-row by reading
  `propertyLedger` `by_property`).
- `getProperty({ id })` — one property + its summary + its ledger entries (sorted by `date` desc).
- `candidates()` — recent `sheriffListings` + `legalNotices` + `flipAnalyses` rows (`{id, address}` each,
  grouped) for the seed-from-existing picker. Read-only (reuse the `flipData.candidates` style; add flips).
- `createManual({ dealType, address, beds?, baths?, sqft?, purchasePrice?, zillowUrl? })`,
  `createFromSheriff({ listingId })`, `createFromLegal({ listingId })`, `createFromFlip({ analysisId })` —
  typed ids; snapshot facts (address/beds/baths/sqft, and the source's `zillowUrl` when present), set
  `status` to the deal-type default (`flip→in_progress`, `rental→active`), `imageStatus="pending"`, store the
  source id string in `source.refId`. After insert, **schedule** `internal.propertyActions.scrapePropertyImage`
  (`ctx.scheduler.runAfter(0, …)`) when an address or zillowUrl exists (mirrors the post-scrape geocode
  schedule). Returns the new property id.
- `updateProperty({ id, patch })` — edit facts/financials/status/notes/zillowUrl; bump `updatedAt`.
- `markSold({ id, salePrice, soldDate })` — flip → `status:"sold"` + sale fields.
- `setPhotoUrl({ id, imageUrl })` — manual paste; sets `imageStatus:"ok"`.
- `refreshPropertyImage({ id })` — sets `imageStatus:"pending"` and schedules the scrape action again.
- `addLedgerEntry({ propertyId, direction, category, amount, date, description? })`,
  `deleteLedgerEntry({ id })`.
- `deleteProperty({ id })` — delete the property AND its `propertyLedger` rows (no orphans).
- **internal**: `getForImage({ id })` (action reads address/zillowUrl), `setImage({ id, imageUrl?, status })`
  (action patches the result).

## Convex `propertyActions.ts` (`"use node"`)
```ts
export const scrapePropertyImage = internalAction({ args: { id: v.id("properties") }, handler: async (ctx, {id}) => {
  const key = process.env.FIRECRAWL_API_KEY (via fcKey() guard, like sheriffActions)
  const p = await ctx.runQuery(internal.propertyData.getForImage, { id });
  const url = p.zillowUrl ?? buildZillowSearchUrl(p.address);
  try {
    const { markdown, rawHtml } = await firecrawlScrape({ url, apiKey: key, formats: ["markdown","rawHtml"],
      onlyMainContent: true, waitFor: 3000, timeoutMs: 60000, maxRetries: 1 });  // wrap in withRetry like scrapeZillow
    const imageUrl = extractImageUrl(rawHtml) ?? extractImageUrl(markdown);
    await ctx.runMutation(internal.propertyData.setImage, imageUrl
      ? { id, imageUrl, status: "ok" } : { id, status: "failed" });
  } catch { await ctx.runMutation(internal.propertyData.setImage, { id, status: "failed" }); }
}});
```
Auth: this is an `internalAction` scheduled by an already-authed mutation (same trust model as
`runSheriffScrape`), so it does not re-check the user.

## UI — `/properties` and `/properties/$id` (dark "Industrial Precision" shadcn, lucide icons, no emojis)

### `/properties` — `Properties.tsx` (list)
- Page header (icon + title + one-line description), like `FlipAnalyzer`.
- **Filter tabs**: All / Flips / Rentals (count badges). (Status sub-filter optional, later.)
- **Add property**: a button opening a small form/popover — choose **Manual** (deal type + address + optional
  beds/baths/sqft/purchase/Zillow URL) or **From existing** (a searchable combobox of Sheriff/Legal/Flip
  candidates, like `FlipAnalyzer`'s `PropertyCombobox`). Creating navigates to the new `/properties/$id`.
- **Grid of cards** (Openrent-style): hero photo (or lucide `Home` placeholder when missing/pending/failed),
  address, `dealType` + `status` badges, and a headline metric — flip: Invested (or Profit once sold,
  grade-colored); rental: Net cash flow. Card click → detail page.

### `/properties/$id` — `PropertyDetail.tsx`
- Back link; hero photo (with **Refresh photo** + **Paste photo URL** controls; placeholder when none).
- **Facts** + editable fields (deal type, status [valid states for the type], beds/baths/sqft, purchase price,
  acquired date; flip adds **Mark sold** → sale price + date). Notes textarea. Save.
- **Financial summary cards** (from `summarizeProperty`): flip → Invested · Expenses · (Sale price · Realized
  profit · ROI when sold), grade-colored; rental → Total income · Total expenses · Net cash flow.
- **Ledger** (shadcn Table): date · direction · category · amount (income green / expense red) · description ·
  delete. An **Add entry** row/inline form: direction toggle, category (suggested set — expense: Purchase,
  Rehab/Materials, Labor, Permits, Taxes, Insurance, Utilities, Financing, Closing, Other; income: Rent,
  Deposit, Late fee, Other), amount, date, description.

## Error handling & edge cases
- Listing/flip facts are strings with sentinels (`PENDING` / `NOT FOUND` / `SCRAPE FAILED`); `parseMoney`
  returns `null`, so unknown facts become blank editable fields, never NaN.
- Missing purchase price → `invested` = expenses only; ROI shown as "—".
- Image scrape failure or no Zillow match → `imageStatus:"failed"`, placeholder shown, paste-URL still works.
- Image URL rot → covered by Refresh photo (re-scrape) + paste URL.
- Divide-by-zero guarded (ROI when `invested ≤ 0`).
- Deleting a property removes its ledger rows in the same mutation.

## Testing & verification
- `tests/portfolio.test.ts`: `summarizeProperty` — flip in-progress (profit/roi null, invested = purchase +
  expenses), flip sold (golden profit + ROI, margin grade boundaries), rental (net cash flow, pending when no
  income, bad when negative), empty ledger, missing purchase price (no divide-by-zero).
- `tests/zillow.test.ts`: `extractImageUrl` — a `photos.zillowstatic.com` photo URL (preferred over og:image),
  og:image fallback, and no-match → null.
- Build chain (per lessons): `npx convex dev --once` (validate convex/ + regen `_generated`) → `npm run build`
  → `npm test` (existing tests stay green + new pass).
- Manual smoke (dev): create a flip from a Sheriff listing + a manual rental; confirm photo appears (or
  placeholder + paste works); add expense & income entries; mark a flip sold → profit/ROI; delete a property.
- Visual: screenshot `/properties` + a detail page (headless lesson); confirm Sheriff/Legal/Flip pages unchanged.

## Success criteria
1. A new **Properties** nav item + `/properties` list and `/properties/$id` detail exist; Sheriff/Legal/Flip
   pages and pipelines are behaviorally unchanged.
2. I can add a property manually and by seeding from a Sheriff/Legal listing and a Flip Analysis.
3. A property's house **photo is pulled from Zillow** and rendered (verified against a real scrape); failures
   degrade to a placeholder + working paste/refresh.
4. I can record expenses and (for rentals) income on the unified ledger; the financial summary updates.
5. A flip can be marked **sold** and shows realized profit + ROI matching the unit-tested golden cases.
6. `npm run build` + `npm test` green; no changes to `deal.ts`, `flip.ts`, `sheriffData.ts`, `legalData.ts`,
   `flipData.ts`, or `pages.tsx`.
