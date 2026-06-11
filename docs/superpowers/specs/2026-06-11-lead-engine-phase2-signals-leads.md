# Lead Engine Phase 2 — Signal Event-Streams, Leads & Scoring (spec)

_Date: 2026-06-11. Status: approved direction (user decisions 2026-06-11: Convex upgraded to paid;
CourtConnect sweep approved with throttling; scope = code violations + pre-foreclosure together,
violations built first). Builds on the Phase 1 spine (branch `feat/lead-engine-phase1-spine`).
Research basis: `memory/source-matrix.md` (Phase 0) + `memory/architecture-review-2026-06-11.md`
(CourtConnect live-verified serverless; Convex cost model)._

## Goal
Turn the parcel spine into a **lead engine**: attach dated **distress signals** to parcels and surface
**scored leads**. Ingest broad, surface narrow — a parcel becomes a visible lead only once ≥1 signal
attaches; stacked signals rank higher (list stacking). Two signal sources this phase:

1. **Code violations** — `CustomMaps/CodeEnforcement_CodeCases/MapServer/0` (~2,852 cases; free ArcGIS
   JSON; dated cursor `APDTTM` via `where=APDTTM > TIMESTAMP 'YYYY-MM-DD HH:MM:SS'`; `PRCLID`-keyed).
2. **Pre-foreclosure (the #1 upstream signal)** — DE CourtConnect mortgage-foreclosure filings
   (`LM` case type, case numbers `^N\d{2}L-`), found via a weekly **plaintiff-stem sweep** (plain GET,
   no browser/captcha), joined to the spine by **defendant-name ↔ owner-name match**. 4–7 months ahead
   of the sheriff sale. ToS gray zone acknowledged → tiny volume (~60 GETs/week), polite pacing, internal use.

## Data model

### `signalEvents` (new table) — one row per signal observation on a parcel
- `prclid: string` — joins the spine. **`""` when unmatched** (a foreclosure case whose defendant
  matched no parcel) so nothing is lost; surfaced on a needs-review list later.
- `category: "financial" | "life-event" | "physical" | "situational"` (per distress-signals.md).
- `type: string` — `"code-violation"` | `"pre-foreclosure"` (open vocabulary for later sources).
- `source: string` — `"ncc-arcgis-codecases"` | `"de-courtconnect"`.
- `externalKey: string` — idempotency key. Code case: `cc:<APNO>` (falls back to `cc:<PRCLID>:<APDTTM>`
  if APNO is absent). Foreclosure: `fc:<caseNo>:<prclid>` (one event per matched parcel; `fc:<caseNo>` when unmatched).
- `observedDate: number` (ms) — recency for scoring (APDTTM / filing date).
- `status: string` — open/closed-ish per source (`STAT` for code cases; case status for foreclosures). Upsert refreshes it.
- `matchConfidence: optional "exact" | "strong" | "weak"` — foreclosure name-match quality (absent for PRCLID-keyed sources).
- `payload: any` (v.any()) — source fields (apdesc, addr, caseNo, plaintiff, defendants…). Provenance baked in.
- Indexes: `by_prclid`, `by_externalKey`, `by_type`, `by_observedDate`.

### `signalWatermarks` (new table) — one row per source
- `source: string` (indexed, unique), `watermark: string` (ISO date the next pull starts from),
  `lastRunAt: number`, `lastResult: string` (short summary for observability).
- Pulls use **overlap** (watermark − 3 days) + idempotent upsert-by-externalKey, so a missed run never loses rows.

### Leads = DERIVED, not stored
A lead is `parcels ⋈ signalEvents` computed in a reactive query. No stored leads table (no extra writes,
always live, schema stays small). Revisit only if event volume makes the query heavy (it won't at ~3–5k events).

## Pure modules (offline-testable, `src/scraper/*`, mirrors Phase 1)
- **`codeCases.ts`** — `buildCodeCasesUrl({sinceIso?, afterObjectId?})` (explicit field list — NEVER
  `outFields=*`; `TIMESTAMP` literal where-clause; `orderByFields` + `resultRecordCount` paging),
  `parseCodeCaseFeature(attrs) → SignalEvent`-shape (category "physical", observedDate from epoch-ms
  `APDTTM`, status from `STAT`).
- **`courtConnect.ts`** —
  - `PLAINTIFF_STEMS: string[]` — curated lender stems (bank, wilmington savings, midfirst, nationstar,
    pennymac, deutsche, mellon, federal national, lakeview, carrington, freedom, newrez, us bank, wells,
    mtglq, …). Config data, editable without code changes elsewhere.
  - `buildPartySearchUrl({stem, beginDate, endDate, pageNo})` — DD-MON-YYYY dates, `partial_ind=checked`.
  - `parsePartySearchHtml(html) → CourtCase[]` — case number, caption, party name/type, filing date,
    case status. **Filter `^N\d{2}L-` client-side** (the `case_type=LM` URL param silently returns zero).
  - `isForeclosureCase(caseNo)` — the `^N\d{2}L-` test.
  - `normalizeOwnerName(s)` + `matchDefendantToOwners(defendant, owners[]) → {prclid, confidence}[]` —
    uppercase, strip punctuation/suffixes, exact-normalized ⇒ "exact"; last name + first-token containment
    ⇒ "strong"; last-name-only single-candidate ⇒ "weak". Conservative: prefer unmatched over wrong-parcel.
- **`leadScore.ts`** — `SCORE_CONFIG` (per-type weight: pre-foreclosure 50, code-violation 20, …;
  recency half-life 90 days; absentee ×1.5; stack bonus per extra signal) + `computeLeadScore(signals, parcel)`.
  Config-driven so weights tune without logic edits. Imported by BOTH the Convex query and any UI preview.

## Convex layer
- **`convex/signalData.ts`** (V8): `upsertEventsBatch` (by `externalKey`; insert or patch status/payload/
  observedDate; never duplicates), `getWatermark`/`setWatermark`, `eventsForParcel(prclid)`,
  internal range/listing helpers for the sync actions, `leads` query (auth-gated): pull recent/open events
  via `by_observedDate` (capped `take`), group by prclid, fetch matched parcels by `by_prclid`, compute
  `computeLeadScore`, filter (type / absentee / min-stack), sort desc. Returns lead rows incl. owner mailing
  fields (the CSV export needs them) + the per-lead signal list.
- **`convex/signalActions.ts`** (`"use node"`):
  - `syncCodeCases` — read watermark (default: full backfill, the layer is ~2,852 rows ≈ 3 pages), page
    the dated query, parse, upsert in CHUNK batches, set watermark to max APDTTM seen. Explicit return type.
  - `syncForeclosures` — read watermark (default: trailing 30 days), for each stem GET the party search
    (sequential, ~400ms pause between requests — polite), parse, keep `^N\d{2}L-` PLAINTIFF rows, dedupe
    by case number, fetch defendant rows from the same parsed page (same case number), name-match
    defendants → owners via the spine `by_owner`-adjacent lookup (normalized compare against candidate
    owners from a search-index probe), upsert events, set watermark. Errors per-stem are tolerated
    (continue; report counts) — one bad page never kills the sweep; total failure logs via `logServerError`.
- **Crons:** weekly `syncCodeCases` (Mon 10:00 UTC) + weekly `syncForeclosures` (Tue 10:00 UTC).
- Mirrors Phase 1 patterns: create-nothing-on-skip is fine here (small feeds, no run-stepper UI needed;
  watermark row carries observability). `ConvexError` for user-facing failures.

## UI — `/leads` page (+ nav item)
- Reuses the `/parcels` shell style (dark Industrial Precision, shadcn, lucide icons ONLY — never emojis).
- Table sorted by score: Score · Address · Owner (absentee badge) · Signals (type chips + dates) · # stacked.
- Filters: signal type, absentee-only, min stacked count.
- **"Export mail list" button** — client-side CSV of the CURRENT filtered set: owner name, mailing
  address lines, city/state/zip, situs address, score, signal types. (Direct mail = first outreach channel;
  addresses are already in the spine — zero backend work.)
- A lead row expands to the signal timeline (event list w/ dates + payload highlights). Unmatched
  foreclosures (prclid "") appear under a collapsed "Unmatched filings" section for manual review.

## Constraints & gotchas honored
- Serverless only; no browser anywhere in this phase. Explicit ArcGIS field lists; `TIMESTAMP` literal
  (epoch-ms `where` 400s); keyset/orderBy paging. CDC keys natural (`APNO`/case number), never OBJECTID.
- `"use node"` files = actions only; explicit action return types; `npx convex dev --once` then build.
- Quota: feeds are tiny (≈3k + ≈60 GETs) — but still chunk upserts (250) and avoid unbounded `.collect()`s.
- CourtConnect: ≤ ~60 requests/run, sequential w/ delay, identifiable plain GETs, weekly. Internal use only.
- Additive: ZERO change to Sheriff/Legal/Flip/Properties/parcel pipelines (Phase 1 files untouched except
  `schema.ts` + `crons.ts` additions and the nav/router shell for `/leads`).

## Testing & verification
- TDD: fixtures captured live (one CodeCases JSON page; one CourtConnect result HTML) before parser code.
- Unit: URL builders (dates, encoding, paging), parsers (real fixtures + null-edge rows), name normalizer/
  matcher (exact/strong/weak/none cases), score math (weights, decay, stacking), CSV row builder.
- Live (dev, now unblocked): full `syncCodeCases` backfill (~2,852 events expected ≈ matches layer count);
  one `syncForeclosures` sweep (expect dozens of `N26L-*`); `/leads` shows stacked absentee+violation
  parcels at top; CSV downloads. Then `npx convex data signalEvents` spot-checks.

## Out of scope (later phases, unchanged)
Equity gate (funnel-only value/balances), skip-trace/outreach (DNC/TCPA), vision condition scoring
(~$1/1k houses — next after this), more GIS signals (vacant/rentals/monition stack on this same table),
needs-review matching UI beyond the collapsed list, prod deploy (separate decision).
