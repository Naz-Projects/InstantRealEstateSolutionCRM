# Wholesaling Lead Engine — Architecture & Phase 0/1 Design Spec

_Date: 2026-06-06. Status: proposed design, pre-implementation (awaiting user approval)._
_Research basis: live probes of the NCC ArcGIS REST server (`gis.nccde.org/agsserver`), the
existing initiative doc [`memory/next-initiative-offmarket.md`](../../../memory/next-initiative-offmarket.md),
and the prior Scrapling-vs-Firecrawl evaluation. Builds ON the off-market engine plan; does not replace it._

## Goal
Turn the IRES CRM into a **Delaware (New Castle County first) real-estate wholesaling lead engine**: ingest
public parcel data for the *whole* county, attach **distress signals** (absentee owner, tax/sewer delinquency,
code violations, pre-foreclosure, probate, vacancy), **score** the resulting leads, and surface the motivated
sellers so the team can reach owners **off-market, before the competition** — then door-knock / direct-mail /
call, and buy to wholesale or flip. Built the **cheapest, most-serverless, lowest-maintenance** way (no $1k/mo
data subscriptions; open data + free APIs first), **phase by phase**, **without breaking the live CRM**.

## What the user asked for (this session)
1. A **new pipeline** built around the NCC ArcGIS Hub ([`apps-nccde.hub.arcgis.com`](https://apps-nccde.hub.arcgis.com/))
   that exposes parcel info per address — easier than the Reblaze-protected parcel site. Build it additively,
   prove it, then retire the old Firecrawl parcel scrape.
2. A **parcel + person (owner) search** page.
3. Scale to **finding leads across the county** by distress flags (overgrown grass / code violations, tax & sewer
   balances, etc.) → flag distressed/likely-pre-foreclosure owners.
4. Two senior-level efficiency requirements (the load-bearing design constraints):
   - Ingest **new** parcels (new construction → new parcel numbers) **without re-scraping all ~200k**.
   - Detect **new signals** on previously-clean parcels (a violation appears next month) **without re-scanning all ~200k**.
5. Plan hard / research first; build in phases; reuse our skills; **do not repeat past mistakes** (see Constraints).

## Grounded data findings (verified this session, not assumed)
The NCC ArcGIS server has a **rich, free, queryable Parcels layer** and a thin one; the important one is:

**`BaseMaps/Base_Layers/MapServer/0` ("Parcels")** — `Query` enabled, `supportsPagination=true`, maxRecordCount 1000:
- **Keys/situs:** `PRCLID` (parcel #/APN), `PARCELNO`, `SHORTPRCL`, `ADDRESS`, `STNO/STNAME`, `PROPCITY/PROPSTATE/PROPZIP`, `PROPCLASS` (land use), `LOTSZ/LOTDPTH/LOTFRONTAG`, `SUBDIV`, `TAXAREA`, `INCORP`.
- **Owner MAILING address:** `OWNADDR`, `OWNADDR2`, `OWNCITY`, `OWNSTATE`, `OWNZIP`, `OWNCOUNTRY`, plus `CNTCTLAST` (owner last name).
- **NOT present:** full owner name, **assessed/market value**, sale price/date, year built, tax/sewer **balances**, code violations.
- **No editor tracking, no reliable edit-date** (only `EXPDATE`); unique key for our purposes = **`PRCLID`** (the ESRI `OBJECTID` is **not** stable — see Constraints).

**Implication — the single most important architectural fact:**
- **FREE + serverless, for all ~200k parcels:** the complete **spine** (parcel #, situs address, class, lot) +
  **owner mailing address** + **absentee-owner detection** (owner mailing ≠ situs / `OWNSTATE` ≠ DE). Absentee/
  out-of-state ownership is a **top-tier motivated-seller signal**, and we get it for the whole county at zero cost,
  no scraping, no browser, no Firecrawl. Owner mailing addresses also feed **direct mail** (our cheapest outreach).
- **NOT in the free layer (needs other sources / per-parcel enrichment):** full owner name, assessed value, sale
  history, tax/sewer balances, code violations. Where those live (free dated feed vs per-parcel-only vs browser-gated)
  is **Phase 0's job to map** — not assumed here.

## Core principle: *ingest broad, surface narrow*
The **spine** ingests **every** parcel cheaply — including new development we don't care about today. A parcel only
becomes a **visible lead** once it accumulates a **distress signal** (filter at the scoring layer, not at ingestion).
So the foundation is **complete for 2–3 years from now at zero extra cost today** — the "build the foundation right"
requirement, satisfied structurally.

## North-star architecture (four layers)
1. **Parcel spine** (slowly-changing dimension): one row per `PRCLID` — situs, class, lot, owner-mailing, a
   **content hash**, `firstSeen`/`lastSeen`, `active`. Source: the free ArcGIS Parcels layer.
2. **Signal event-streams**: each distress source (code violations, lis-pendens/foreclosure, tax-delinquent,
   probate, vacancy) ingested as **dated events**, attached to a parcel by `PRCLID`. One parcel can stack many signals.
3. **Lead derivation + scoring**: parcel + stacked signals → a scored `lead` (reactive Convex; the UI updates live).
   Absentee/equity/tenure flags derived from the spine; rules-based score first (stacked signals × recency × equity).
4. **Tiered enrichment**: expensive per-parcel data (full owner, assessment, balances, skip-trace) is fetched **only
   for the funnel** (parcels already carrying a signal / on a watchlist / in target geo), on a cadence — **never the full 200k**.

All four run on the **existing serverless stack** (Convex reactive DB + crons + actions, TanStack/shadcn UI). The
spine + signal streams are **free HTTP/JSON** (Convex actions `fetch` them directly — no browser, no host). A browser
(Scrapling worker or Firecrawl) is introduced **only if Phase 0 proves a needed source has no free/API path** — and
even then only against the small funnel, never the 200k.

## The two hard problems — solved (these are load-bearing)

### A. New parcels (new construction) without re-scraping 200k → **CDC by natural key**
A scheduled sync pulls **only the key list** from the ArcGIS layer (`where=1=1&outFields=PRCLID&returnGeometry=false`,
paginated at 1000 — a tiny payload), and **diffs it against the stored `PRCLID` set**:
- new `PRCLID`s → new construction/subdivision → **enrich only those** (a handful per run),
- vanished `PRCLID`s → parcel merged/split/retired → mark `active=false` (a normal event, **not** an error),
- unchanged → skip.
Key on **`PRCLID`, never `OBJECTID`** (county ETL truncate-and-reload reassigns OIDs → would falsely flag all 200k as new).
Initial seed = the user's **CSV export** (one-time) **or** a one-time paginated pull (~200 calls); the recurring delta is
the cheap key-diff. (Content-hash on the full row catches the rare in-place attribute change on the spine.)

### B. New signals on a clean parcel without re-scanning 200k → **subscribe to change, don't poll**
We **never poll the 200k**. Per signal, one of two mechanisms (Phase 0 decides which applies):
- **(a) Source has a dated/filterable feed** (new code-violation cases, new foreclosure filings, new tax-delinquent
  list): pull only records **since our stored watermark** (last-run timestamp / last-seen case id) — a handful of dated
  rows — and attach to the parcel by `PRCLID`.
- **(b) Source is per-parcel only (no feed):** re-check **only the funnel** (already-flagged / watchlist / target geo)
  on a **tiered cadence** (hot=daily, warm=weekly, cold=monthly). The 200k cold parcels are never re-checked for this signal.

→ Phase 0's organizing question per signal is therefore **"dated feed, or per-parcel only?"** — that dichotomy
mechanically sorts each signal into *cheap-stream* vs *funnel-only* and reveals which (if any) sources force a browser.

## Phased roadmap
- **Phase 0 — Research spike (next; NO app code).** Produce the **Source Matrix** + verify the spine mechanics. Detailed below.
- **Phase 1 — Parcel spine + absentee + search (build; additive; serverless/free).** `parcels` table, `PRCLID` CDC sync
  action + cron, absentee/owner-mailing derivation, a **parcel + owner search page**. Prove it live. The old Firecrawl
  parcel enrich **stays untouched** until a later cutover.
- **Phase 2 —** first **signal event-stream** source (lis-pendens/foreclosure *or* code violations, per Phase 0) → unified
  `leads` + `signalEvents` tables + rules scoring.
- **Phase 3 —** more signals (tax-delinquent, probate-expand, vacancy).
- **Phase 4 —** Leads pipeline UI (Kanban, signal-stacking, dedup, dashboard).
- **Phase 5 —** contacts + skip-trace + assessment/equity (paid + **DNC/TCPA-compliant** — the one place "free" may not hold).
- **Phase 6 —** outreach (start with **direct mail** — owner mailing addresses are already free from the spine), DNC/TCPA-gated.
- **Phase 7 —** cutover: retire the old Firecrawl parcel scrape once the new engine subsumes Sheriff/Legal enrichment.

Each phase gets **its own spec → plan → build → prove** cycle. This spec details **Phase 0** and sketches **Phase 1**;
Phases 2–7 are deferred (scoring/skip-trace/outreach are explicitly **not** designed here).

## Phase 0 — detailed design (the immediate deliverable)
**Type:** research + read-only probing. **No Convex code, no schema, no UI.** Output is a committed document + tiny throwaway probe outputs.

**Deliverable 1 — the Source Matrix** (`memory/source-matrix.md`): one row per distress signal / data need:

| signal / data | endpoint(s) | access (free API / scrape / browser / paid) | dated-delta feed? (Y/N + the date/cursor field) | fields available | geo (NCC?) | rate limit / ToS | est. cost |

Rows to fill (at minimum): parcel spine, owner mailing/absentee (✓ already proven free), **assessed value / full owner**,
**tax & sewer balances**, **code violations / property-maintenance**, **lis-pendens / foreclosure filings**, **tax-delinquent/monition**,
**probate (Register of Wills)**, **vacancy (HUD/USPS)**. For each, answer the §B question: *dated feed or per-parcel only?*

**Deliverable 2 — spine-sync proof:** confirm (read-only) against `BaseMaps/Base_Layers/MapServer/0`:
- a paginated `PRCLID`-only pull works and returns the full key set (record the total count + payload size),
- `returnCountOnly` + pagination behave (so the recurring diff is cheap),
- the absentee derivation is sound on a sample (situs vs `OWNADDR/OWNSTATE`),
- whether assessed value / full owner exist on **any** free layer (FirstMap / Hub-hosted / a secured layer) — the branch
  decider for Phase 5 (serverless enrichment vs browser/paid).

**Constraint for Phase 0 testing:** this dev sandbox **blocks arbitrary outbound HTTP** (lessons.md 2026-06-04) — verify
API reachability/shape via the harness `WebFetch`/`WebSearch` and/or a **deployed Convex action** (`npx convex run`), not
local `curl`. (Convex cloud has network; that's where the real fetch will run.)

**Success criteria:** the matrix is complete enough that, for every signal, we know its access method, whether it's a
cheap stream or funnel-only, and whether it forces a browser/paid path — i.e. Phase 1+ can be specced without further discovery.

## Phase 1 — sketch (next spec after Phase 0)
- **`parcels` table** (Convex): `prclid` (indexed, unique), situs fields, `propClass`, `lotSz`, owner-mailing fields,
  `ownerLast`, `absentee` (derived bool + reason), `contentHash`, `firstSeen`, `lastSeen`, `active`.
- **`src/scraper/arcgisParcels.ts`** (pure, tested): build the ArcGIS query URL, parse a feature → `Parcel`, derive
  `absentee`, compute `contentHash`. Runtime-agnostic (mirrors the existing `src/scraper/*` pattern).
- **`convex/parcelData.ts`** (V8 queries/mutations: upsert-by-prclid, search) + **`convex/parcelActions.ts`** (`"use node"`:
  `syncSpine` = paginate keys → diff → enrich new/changed; idempotent, resumable via the existing `scrapeRuns`/events pattern).
- **Cron:** weekly `syncSpine` (key-diff CDC).
- **UI:** a **Search page** — by parcel # OR owner (last) name → parcel facts + absentee flag + the owner's *other* parcels
  (absentee-portfolio view). Reuse `PropertyMap`/Street View. Dark shadcn theme.
- **Additive + isolated:** new files/tables only; **no change** to Sheriff/Legal/Flip/Properties pipelines, `deal.ts`,
  or the existing Firecrawl parcel path. Built TDD; live-proven before any cutover.

## Constraints & lessons to honor (do-not-repeat list)
- **Serverless only** — Convex/Clerk/TanStack/Cloudflare. **No Docker/VPS/self-hosted server** (lessons 2026-06-01). A
  Scrapling **browser worker** is introduced **only** if Phase 0 proves a needed source forces a browser AND it's worth it;
  default is free HTTP APIs callable from Convex actions + Firecrawl as the bounded fallback for the funnel.
- **CDC key = `PRCLID`, never `OBJECTID`** (OIDs reassign on county reload → false full-resync).
- **Convex gotchas:** `"use node"` files = actions only (split `*Data.ts` / `*Actions.ts`); **annotate action return types**
  (TS7023); **commit `convex/_generated`** (CI); after changing `convex/` run `npx convex dev --once` then `npm run build`;
  validate/regenerate in isolation with `CONVEX_AGENT_MODE=anonymous npx convex dev --once`; throw `ConvexError` (not `Error`)
  for user-facing messages; create the run first + always finalize in try/catch.
- **Bot-protected per-parcel sources** (if used): retry at the **operation** level (block page = HTTP 200), throttle concurrency.
- **Outreach is regulated:** **DNC/TCPA/state** compliance is designed **before** any automated contact (Phase 6); fines ~$500–$1,500/msg.
- **Source ToS/rate limits:** verify each source is publicly accessible + within ToS in Phase 0; throttle politely.
- **Build additively in an isolated worktree** when concurrent sessions are possible; stage explicit paths (no `git add -A`).

## Error handling & testing
- **Phase 0:** read-only; no production impact. Probes are throwaway; the matrix is the artifact.
- **Phase 1:** pure parsing/derivation/hash logic is **unit-tested** (`tests/arcgisParcels.test.ts`) with captured ArcGIS
  feature fixtures. `syncSpine` is **idempotent + resumable** (watermark/cursor + `scrapeRuns`); a partial/failed page never
  corrupts the set (upsert-by-`prclid`, finalize in try/catch). Live-prove the sync (count in, count stored, a spot-checked
  absentee) before trusting it; **never** cut over the old path until the new one is proven.

## Deferred decisions (later phases, explicitly not decided here)
Assessed-value/AVM source (free layer vs paid vs Zillow scrape) · skip-trace provider + DNC/TCPA design · scoring weights
(rules → ML propensity later) · outreach channel/vendor · multi-county (Kent/Sussex) generalization · old-pipeline cutover timing.

## Sources
- NCC ArcGIS Parcels layer: `https://gis.nccde.org/agsserver/rest/services/BaseMaps/Base_Layers/MapServer/0` ·
  NCC GIS Hub: [`apps-nccde.hub.arcgis.com`](https://apps-nccde.hub.arcgis.com/) · Delaware FirstMap open data: [`opendata.firstmap.delaware.gov`](https://opendata.firstmap.delaware.gov/)
- Existing initiative research: [`memory/next-initiative-offmarket.md`](../../../memory/next-initiative-offmarket.md)
  (distress-signal taxonomy, big-firm methods, build-vs-buy, TCPA/DNC, DE/NCC source list).
- Prior scraping evaluation (Scrapling vs Firecrawl; parcel-site needs a browser): sandbox `scraping-test/output/ires/VERDICT-ires.md`.
