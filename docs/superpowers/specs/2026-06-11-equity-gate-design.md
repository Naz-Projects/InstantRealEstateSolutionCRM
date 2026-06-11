# P4 — Equity Gate (Design)

_Date: 2026-06-11. Status: APPROVED (user, this session). The fourth pipeline phase from
`2026-06-11-wholesaling-pipeline-crm.md`: funnel-only property value + delinquent balances + manual
liens → equity, displayed on /leads and multiplied into the lead score. Strictly additive._

## Locked scope decisions (user-confirmed)
1. **Trigger:** manual per-lead "Pull value & balances" button + an "Enrich top N" batch button on the
   filtered /leads view, **capped at 50 per click**, behind the branded `ConfirmDialog` showing count +
   approximate Firecrawl credits. Nothing runs unattended. (Funnel-only rule: never against the 203k.)
2. **Value source:** Zillow **zestimate** primary (existing `scrapeZillow`, 1 Firecrawl call). If no
   zestimate but sqft is known, **fall back to Redfin comps** median $/sqft × sqft (existing `comps.ts`
   parse/select/suggest functions). No value obtainable → equity stays "unknown".
3. **Liens v1:** auto **county/school/sewer delinquent balances** via the existing `lookupParcel` NCC
   scrape (1 Firecrawl browser-action call, Reblaze retry built in) + a **manual known-liens field**
   (amount + note) per lead for what the team finds (e.g. mortgage from the foreclosure docket).
   Recorder of Deeds (paid, login) deferred.
4. **Score effect:** equity-ratio buckets **multiply the score** (config in `SCORE_CONFIG`, surfaces in
   the sidebar legend automatically) AND a **min-equity filter** + equity column on /leads. No hard gate.

## Approach chosen (A of 3)
Dedicated **`parcelEquity` table keyed by prclid**. Rejected: (B) fields on `parcels` — would entangle
hand-entered + scraped data with the spine's `contentHash` differential upsert (a full re-seed must never
touch enrichment); (C) `signalEvents` rows — enrichment is not a distress signal; would pollute scoring
inputs. Funnel-only keeps `parcelEquity` tiny, so the leads query preloads it into a Map (no N+1).

## Schema (additive)
`parcelEquity`: `{ prclid, value?, valueSource? ("zestimate"|"comps"), valueAt?, countyBalance?,
schoolBalance?, sewerBalance?, assessedValue?, balancesAt?, manualLiens?, manualLiensNote?, lastError?,
updatedAt }` — index `by_prclid`. Numbers stored as numbers (parse once in the action), unlike the
string money fields on `sheriffListings`.

## Pure logic (TDD, both sides import the same module)
- **`src/scraper/equity.ts`** — `computeEquity({ value, taxBalances, manualLiens })` →
  `{ equity, equityRatio, basis: "taxes-only" | "incl-manual-liens" }`, null-safe: no value → equity and
  ratio null. `equityBucket(ratio)` → `"high" | "medium" | "low" | "unknown"` (null → unknown).
- **`src/scraper/leadScore.ts`** — `SCORE_CONFIG` gains
  `equityBuckets: { highMin: 0.5, mediumMin: 0.2 }` and
  `equityMultipliers: { high: 1.5, medium: 1.2, low: 0.5, unknown: 1.0 }`.
  `computeLeadScore(signals, parcel, now, equity?)` — optional arg; existing callers/tests unbroken;
  omitted/unknown equity → multiplier 1.0 (identical scores to today until a lead is enriched).
- **`src/components/score-legend.tsx`** — add an equity-multipliers row (it already reads `SCORE_CONFIG`).

## Enrichment action (`convex/equityActions.ts`, `"use node"`; modeled on `pullComps`)
- `enrichEquity({ prclid })` (requireUser-gated public action): read the spine row → address =
  situs street + city + zip. (1) `scrapeZillow` → zestimate/sqft; no zestimate + known sqft →
  comps fallback (`parseRedfinComps`/`selectComps`/`suggestArv`, one extra call only in the fallback
  case). (2) `lookupParcel` → county/school/sewer balances + assessed value. Store via internal
  mutation; **partial success is fine** (value without balances and vice versa); per-field failures land
  in `lastError` on the row — visible, never silent (geocode-lesson). All fetches go through
  `firecrawlScrape` (timeouts + retries built in).
- `enrichBatch({ prclids })`: validate length ≤ 50, fan out `enrichEquity` via `ctx.scheduler.runAfter`
  with the existing 2,500 ms stagger. Batch errors are per-parcel, never batch-fatal.
- ⚠ **Plan verify-step:** confirm ArcGIS `PRCLID` format matches the NCC site's parcel-search input
  (the sheriff flow strips `-`/`.` before lookup); reconcile in a tiny pure helper if needed.

## Data layer (`convex/equityData.ts`, V8)
- `setManualLiens({ prclid, amount?, note? })` — requireUser mutation (clearable).
- Internal `storeEnrichment` mutation (upsert by prclid) + whatever small internal readers the action needs.
- **`signalData.leads`**: preload all `parcelEquity` rows into a Map (same pattern as `leadStatus`),
  compute equity/bucket per lead, pass equity into `computeLeadScore`, return
  `{ value, valueSource, valueAt, balances, manualLiens, equity, equityRatio, equityBucket, basis }`
  on each lead row; new optional `minEquityRatio` arg (0–1) filters server-side **before** the 200-row
  cap: a lead passes when its computed `equityRatio` ≥ the threshold; **unknown-equity leads are
  excluded whenever the filter is set** (can't prove equity ⇒ filtered out).

## UI (/leads)
- **Equity column:** value · equity $ · ratio badge colored by bucket · basis tag
  ("taxes-only" / "incl. liens"); "—" when unknown; data age shown (valueAt/balancesAt).
- **Expanded lead detail:** "Pull value & balances" button (busy + inline error from `lastError`) +
  editable known-liens amount/note (saves via `setManualLiens`).
- **Toolbar:** "Enrich top N" (N = min(filtered count, 50)) behind `ConfirmDialog` (count + ~credits);
  min-equity filter mapping to `minEquityRatio`: any (unset) / positive (0) / ≥20% (0.2) / ≥50% (0.5).
- **Mail CSV export** gains value/equity columns (same `buildMailCsv` path).

## Error handling
Per-parcel scrape failures → `parcelEquity.lastError` + UI surfacing; user-facing throws are
`ConvexError` (prod-redaction lesson); systemic/unexpected failures → `logServerError`. Reblaze
block-page handling and `withRetry` come free from the existing scrapers.

## Testing & verification
- Vitest: `equity.ts` (compute/buckets/null-safety), extended `leadScore` tests (each bucket ×
  multiplier, optional-arg back-compat), any parcel-format helper. Full suite + `tsc` + build green;
  `npx convex dev --once` before frontend build (codegen lesson).
- Live on dev: enrich 2–3 real leads end-to-end (one zestimate hit, one comps fallback if findable,
  one NCC balances pull), check /leads column + filter + score change + legend, batch of ~3 with
  stagger, manual liens round-trip.

## Deferred (documented, not built)
Recorder of Deeds mortgage/free-and-clear lookup · staleness/auto-refresh cron · derived
"tax-delinquent" `signalEvents` row when balances are large (good v1.1 list-stacking add: one
flag-controlled upsert once balances exist) · equity in the Kanban card layout (column view only in v1).

## Untouched
Sheriff/Legal/Flip/Properties pipelines, parcel seed/sync, all existing tables. Purely additive.
