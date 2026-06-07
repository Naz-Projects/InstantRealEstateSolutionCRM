# Source Matrix — Wholesaling Lead Engine (Phase 0)

_Date: 2026-06-06. Status: **Phase 0 research COMPLETE.** Read with the spec
[`docs/superpowers/specs/2026-06-06-wholesaling-lead-engine-design.md`](../docs/superpowers/specs/2026-06-06-wholesaling-lead-engine-design.md)
and plan [`docs/superpowers/plans/2026-06-06-wholesaling-lead-engine-phase0.md`](../docs/superpowers/plans/2026-06-06-wholesaling-lead-engine-phase0.md)._

**How this was verified:** this dev sandbox blocks local outbound HTTP, so every endpoint below was hit from a
**throwaway Convex `internalAction` on the cloud dev deployment** (`fearless-donkey-585`) via `npx convex run`
(the probe `convex/probePhase0.ts` was removed after; not committed). Per-source *existence/ToS* via harness WebSearch.
**All counts/fields below are real responses observed 2026-06-06**, not assumed.

## Headline result — the win is bigger than the spec assumed
The NCC ArcGIS server exposes a **`CustomMaps` folder of free, public, queryable Feature Layers** — a whole suite of
**distress signals already keyed to `PRCLID`/`PARCELID`**, several with **date fields** (so they're cheap *dated-delta*
feeds, not per-parcel scrapes). This means **Phases 2–3 (code violations, vacancy, tax-delinquent/monition, rentals,
structured sheriff sales) are FREE + serverless** — no browser, no Firecrawl, no paid API. The only signals that still
need a browser/paid path are **assessed value + tax/sewer balances** (per-parcel, Reblaze site) and **upstream court
lis-pendens** (CourtConnect). The "ingest broad, surface narrow" foundation can be built almost entirely on free JSON.

Base for all NCC layers: `https://gis.nccde.org/agsserver/rest/services/CustomMaps/<Service>/MapServer/<id>/query`
(ArcGIS REST: `where`, `outFields`, `orderByFields`, `resultRecordCount`/`resultOffset` paging, `returnCountOnly`, `f=json`).

---

## The matrix (one row per signal / data need)

| # | Signal / data need | Endpoint (verified) | Access | Dated-delta feed? (cursor field) | Key fields | Geo (NCC?) | Cost / ToS |
|---|---|---|---|---|---|---|---|
| 1 | **Parcel spine + owner mailing + absentee** | `BaseMaps/Base_Layers/MapServer/0` ("Parcels") **or** `CustomMaps/Ownership/MapServer/0` ("Owners") | **Free API** | No edit-date → **CDC by `PRCLID` key-diff** | `PRCLID`, situs (`ADDRESS/STNO/STNAME/PROPCITY/PROPSTATE/PROPZIP`), `PROPCLASS`, `LOTSZ`, **`CNTCTLAST`=full owner-name string**, owner mailing `OWNADDR/OWNCITY/OWNSTATE/OWNZIP`, `PRIMADDR` | ✅ all 203,752 | Free, public |
| 2 | **Code violations / property-maintenance** | `CustomMaps/CodeEnforcement_CodeCases/MapServer/0` ("CODE CASES"); helper views in `CustomMaps/Code_Enforcement/MapServer` (9 Open Cases, 11 Cases-added-last-30-days) | **Free API** | **YES** — `last_edited_date` / `created_date` / `APDTTM` (epoch-ms Date) | `PRCLID`, `ADDR`, `APTYPE`/`APDESC` (e.g. "HIGH WEED AND GRASS"), `STAT` (O=open), `APDTTM`, `created_date`, `last_edited_date`, `YEARSOPEN`, `INSPECTIONS` | ✅ 2,852 cases (1,051 added in last 30d) | Free, public |
| 3 | **Vacancy (parcel-level)** | `CustomMaps/Code_Enforcement/MapServer/6` ("Vacant Properties") | **Free API** | Re-pull (small set) — funnel-grade | `PRCLID`, `PROP_CLASS`, `DESCRIPTION`, `APNO` | ✅ 859 vacant | Free, public |
| 4 | **Vacant + tax-delinquent (curated lead list)** | `CustomMaps/SheriffSales/MapServer/1` ("Vacant Monitions Candidates") | **Free API** | Re-pull (tiny) — has `DATE_PAID` | `PARCELID`, `Address`, `MAILING_LOCATION`, `STATUS`/`Category`, `CE_PAYMENT`, `TOTAL_PAID`, `DATE_PAID`, `ATTORNEY` | ✅ 76 candidates | Free, public |
| 5 | **Sheriff sales (structured — replaces PDF parse)** | `CustomMaps/SheriffSales/MapServer/0` ("Sheriff Sales") | **Free API** | Re-pull monthly (small) | `PARCELID`/`PRCLID`, `ADDRESS`, `MAILING_LOCATION`, `CASENUMBER`, `PLANTIFF`, `ATTORNEY`, `COMMENTS` | ✅ 53 (matches live PDF) | Free, public |
| 6 | **Rental units / tired-landlord** | `CustomMaps/RentalUnits/MapServer/0` ("Rental Units"); also `CustomMaps/SFDLicensing/MapServer/*` (SFD rental licensing by year) | **Free API** | `EXPDATE` (license expiry) | `PRCLID`, `RENTALID`, `STAT`, `APDESC`, `ADDR`, `EXPDATE` | ✅ 39,424 units | Free, public |
| 7 | **Permits (rehab activity + new construction)** | `CustomMaps/Permits/MapServer` (0 Open, 2 Expired, 4 **New Construction**, 5 ADUs, …) | **Free API** | permit dates per layer | parcel id + permit type/status | ✅ | Free, public |
| 8 | **Assessed / market value** | NCC parcel site `www3.newcastlede.gov/parcel/search/` (Reblaze) — **NOT on any free ArcGIS layer** (confirmed: NCC `BaseMaps/0` and FirstMap `DE_StateParcels` both lack it) | **Browser** (Firecrawl browser-actions / Scrapling) or **paid** (ATTOM/CoreLogic) | Per-parcel only | assessed value, sales history, year built, beds/baths, building sketch | ✅ per-parcel | Free-but-browser (funnel-only) or paid |
| 9 | **Tax & sewer balances** | Same Reblaze NCC parcel site (parcel detail shows tax + sewer bills) | **Browser** or paid | Per-parcel only | county/school/sewer balances | ✅ per-parcel | Funnel-only browser |
| 10 | **Pre-foreclosure / lis-pendens (UPSTREAM)** | Delaware CourtConnect `courts.delaware.gov/docket.aspx` (Superior Court, judicial-foreclosure filings); NCC Recorder of Deeds `newcastlede.gov/144/Document-Search` | **Browser/scrape** (likely; verify CAPTCHA/ToS) | **YES** — filing date / case-type filter | case #, parties, filing date, property | ✅ (NCC Superior Court) | Free public records; access = scrape — **Phase 2/5 live probe** |
| 11 | **Probate / inherited** | NCC Register of Wills "Wills Finder" `newcastlede.gov/152/Register-of-Wills`; **+ existing weekly Legal Notices PDF (already ingested)** | Browser/per-record; **the Legal Notices PDF IS our current dated feed** | Legal Notices = weekly; Wills Finder = per-record | decedent, personal rep, "late of" address | ✅ | Free; we already have the PDF feed |
| 12 | **Monition / tax-delinquent sale list** | NCC "Sale Lists" `newcastlede.gov/188/Sale-Lists` (PDF, sheriff-run) — **but row 4 "Vacant Monitions Candidates" + the existing sheriff PDF already cover this** | Free PDF (scrape) | Published per-sale (dated) | parcel, balance, sale date | ✅ | Free; overlaps existing pipeline |
| 13 | **Skip-trace (phones/emails)** | BatchData / REISkip / Homesage (Phase 5) | **Paid API** | n/a | mobile/landline, email, relatives, **DNC flags** | national | ~$0.10–0.15/hit; **TCPA/DNC-gated** |
| 14 | **AVM / comps (ARV)** | Existing Redfin scrape (`src/scraper/comps.ts`) + Zillow (`zillow.ts`); ATTOM/HouseCanary as paid alt | Scrape (have it) or paid | n/a | sold comps, zestimate | ✅ | Free (have it) or paid |
| 15 | **Vacancy (HUD/USPS) — REJECTED for parcel use** | `huduser.gov/portal/datasets/usps.html` | Restricted (gov/non-profit login) **+ Census-tract aggregate only (no addresses)** | Quarterly | tract vacant counts | tract, not parcel | **Don't use** — row 3 ("Vacant Properties", 859, parcel-level, free) is strictly better |

---

## Per-signal verdict: dated-feed vs funnel-only (the §B sort)
- **Cheap dated-delta streams (free, serverless, pull-since-watermark):** code violations (2), rentals (6, `EXPDATE`),
  permits (7), lis-pendens (10, filing-date filter — *if* scrapable). These never require touching the 200k.
- **Small full re-pulls (free, tiny sets):** vacancy (3, 859), vacant-monition candidates (4, 76), sheriff sales (5, 53),
  probate via the existing weekly Legal Notices PDF (11). Re-pull the whole (small) layer each run; diff is trivial.
- **Funnel-only (browser/paid, only for already-flagged parcels):** assessed value (8), tax/sewer balances (9),
  skip-trace (13). **Never run against the 200k** — only the parcels that already carry a free signal.

## The two hard problems — now even cheaper
- **New parcels:** still **CDC by `PRCLID` key-diff** on the spine (proven below). Bonus: `Permits/4 "New Construction"`
  is a free *leading* indicator of upcoming new parcels.
- **New signals on a clean parcel:** **subscribe to the dated feeds** above (code cases `last_edited_date`, the
  "Cases added last 30 days" view, permit dates) — **no 200k re-scan**, exactly as designed.

---

## Spine-sync proof (Deliverable 2 — observed 2026-06-06)
Against `BaseMaps/Base_Layers/MapServer/0`:
- **Total parcels: `203,752`** (`returnCountOnly=true`).
- **PRCLID-only key page (1000):** ~**39 KB** ⇒ full key list ≈ 204 pages × 39 KB ≈ **~8 MB** total (cheap recurring CDC diff).
  ⚠ **Pagination of a single narrow field REQUIRES `orderByFields=PRCLID`** — without it the server returns
  `error 400 "Failed to execute query."` (a 200-status ArcGIS error body). `outFields=*` paginates without an explicit order.
- **Full-field page (1000):** ~**820 KB** ⇒ full one-time seed ≈ 204 × 820 KB ≈ **~167 MB** (or use the user's CSV export).
- **42 fields**; value/owner-ish present = only `TAXAREA` ⇒ **assessed value / sale / year-built are NOT here** (use `CustomMaps/Ownership` for clean owner-mailing; values need row 8).
- **Absentee derivation sound** on the sample (e.g. `PRCLID 0600100003`: situs Wilmington **DE**, owner Chadds Ford **PA** ⇒ out-of-state absentee).
- **FirstMap `PlanningCadastre/DE_StateParcels`** (statewide) is thinner — only `PIN, ACRES, COUNTY, UPDATED` — **no owner/value**; its `UPDATED` (edit-date) could be a geometry-change cursor but carries no attributes we need. ⇒ **stick with the NCC layer for the spine.**

## Open questions / next live probes (defer to the phase that needs them)
- **Lis-pendens (10):** confirm CourtConnect is scrapable within ToS (CAPTCHA? rate limit?) and whether case-type +
  filing-date filtering is queryable — the only *upstream* signal not already free via GIS. Live-probe in the Phase 2/5 spike.
- **Assessed value (8):** decide free-browser (Firecrawl/Scrapling on the Reblaze parcel site, funnel-only) vs paid
  (ATTOM/CoreLogic) — Phase 5 build-vs-buy. (Spike already showed the Reblaze site needs a real browser.)
- Confirm `CustomMaps` layers' **ToS / update cadence** (they're public ArcGIS but verify polite rate limits + how
  fresh each is) before relying on them for alerts.

## Recommendation — what to build next (Phase 1 → Phase 2)
1. **Phase 1 (spine + search):** `parcels` table fed by the free `BaseMaps/Base_Layers/0` (or `CustomMaps/Ownership/0`)
   via `PRCLID` CDC; absentee derived; parcel + owner search page. *(As specced — now de-risked: the spine is proven.)*
2. **Phase 2 (first signal):** **code violations** — `CodeEnforcement_CodeCases/0` is a free, dated, `PRCLID`-keyed feed
   (use `last_edited_date` as the watermark; or the "Cases added last 30 days" view) → first `signalEvents` + lead scoring.
   Highest leverage-per-effort: free, dated, serverless, distress-grade, and it stacks with absentee from the spine.
3. **Quick win available (separate, optional):** the existing brittle Sheriff-PDF parse can be **replaced** by the
   structured `SheriffSales/0` layer (`PARCELID`+`CASENUMBER`+`PLANTIFF`) — improves the live pipeline at low risk.
4. Stack signals: absentee (spine) + vacant (3) + code case (2) + on the monition list (4) = top-priority lead.

## Sources
- NCC ArcGIS: `https://gis.nccde.org/agsserver/rest/services` (folders incl. `CustomMaps`; `LU_Eng`/`PublicWorks` = token-secured 499).
- DE FirstMap: `https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels`.
- Web (existence/ToS): NCC Code Enforcement, Delaware CourtConnect `courts.delaware.gov/docket.aspx`, NCC Register of
  Wills, NCC Sale Lists, HUD/USPS vacancy. Signal taxonomy: [`memory/next-initiative-offmarket.md`](next-initiative-offmarket.md).
