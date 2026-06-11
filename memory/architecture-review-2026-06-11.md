# Architecture Review — Wholesaling Lead Engine (2026-06-11)

_Requested: "review the architecture, find anything new/improved to make the pipeline more robust, scalable,
easy to use." Verdict up front: **the 4-layer architecture (spine → signal streams → scoring → tiered
enrichment) is right — no rewrite.** It is exactly the list-stacking model PropStream/BatchLeads sell.
The improvements below are targeted upgrades, in priority order. Research was live-verified via web
search + page fetches on 2026-06-11; per-source confidence noted._

## 1. Quota economics — the blocker, now solved on two fronts (CODE DONE)

**Convex pricing facts (page-verified, convex.dev/pricing + docs, June 2026):**
- Free tier/mo: 1M function calls · **1 GB database I/O (the binding constraint)** · 0.5 GB storage ·
  20 GB-hr action compute. Exceeding → warning emails, then deployments **hard-disabled** (data kept).
  Usage is metered **per TEAM (all projects summed)**, not per project. Reset timing not documented
  (assume billing-cycle month).
- **Starter plan (Jun 2025): $0 base, add a card, pay-as-you-go** (~10% premium over Pro rates), never blocks.
  Pro: $25/dev/mo incl. 25M calls / 50 GB I/O / 50 GB storage. Spend limits supported.
- **One full 203k seed ≈ 0.17–0.25 GB write I/O ≈ 17–25% of the free month — or ≈ $0.05–$0.15 on Starter/Pro.**
  The 4× debug re-seeds ≈ the whole free I/O budget → that's exactly what burned June.
- 203k rows resident ≈ 0.17 GB storage (~34% of free 0.5 GB) — fine.
- `npx convex import` (JSONL, `--replace`/`--append`) bypasses function calls entirely (bills only bandwidth)
  — the cheap path for the one-time prod seed.

**Code fixes shipped (branch `feat/lead-engine-phase1-spine`):**
- `d7aae65` — `seedSpine` takes `maxPages` (debug runs can never accidentally full-seed).
- `8af7cbc` — **differential upsert**: unchanged rows get NO write (previously every row got a `lastSeen`
  patch → every refresh = 203k writes; `lastSeen` is read nowhere). A full attribute refresh now writes
  only actually-changed parcels (likely a few hundred) + ~204 page fetches. The "heavier periodic
  re-seed" for attribute changes is now cheap by construction.

**⚠ Remaining hidden steady-state cost:** weekly `syncSpine`'s `storedActivePrclidsInRange` `.collect()`s
FULL parcel docs across all ranges — Convex reads bill whole-document bytes, so each weekly CDC run reads
~0.17 GB → **~0.7 GB/mo ≈ 70% of the free I/O cap by itself.** Options: (a) **upgrade to Starter — $0.14/mo
cost, recommended**; (b) monthly CDC cadence instead of weekly; (c) a compact keys-only side table
(`prclid`+`active`, ~8 MB/scan) — only worth building if staying on free tier permanently.

**Recommendation: put a card on the account (Starter at minimum).** Every cost in this engine is pennies
in dollars; only the free tier's hard ceiling makes them existential.

## 2. Pre-foreclosure (CourtConnect) is SERVERLESS-BUILDABLE — no browser (major upgrade)

The spec assumed lis-pendens needed a browser scrape. **Live-verified 2026-06-11: it doesn't.**
- Delaware CourtConnect (`courtconnect.courts.delaware.gov/cc/cconnect/...`) is a plain-HTML app:
  **no login, no CAPTCHA, no JS — simple GET URLs** (party-name search + filing-date range + `PageNo`
  pagination; `partial_ind=checked` makes name stems match, e.g. `last_name=bank` → BANK OF AMERICA rows).
- **NCC mortgage foreclosures = case type "LM - MORTGAGE", case numbers `N<yy>L-MM-NNN`** (the `L` civil
  docket; verified on live docket N26L-06-009, "INITIAL FILING MORTGAGE FORECLOSURE", writ to NCC Sheriff).
  ⚠ The `case_type=LM` URL param **silently returns zero** — filter client-side on `^N\d{2}L-`.
- ⚠ No all-filings-by-date query (party name is mandatory). Workaround: weekly sweep over a curated list of
  ~30–60 plaintiff name stems (bank, wilmington savings, midfirst, nationstar, pennymac, deutsche, mellon,
  federal national, lakeview, carrington, freedom, newrez, us bank, wells, mtglq, …), trailing 7–10 day
  date window, dedupe by case number, **join defendant names → parcel spine** (owner-name match) for address/absentee.
- **Lead time: a new `L` filing lands ~4–7+ months before the sheriff sale** (LSCD foreclosure-guide verified;
  scire facias timeline + optional mediation) — the earliest public signal, months ahead of the PDF we scrape.
- **ToS caveat:** CourtConnect's disclaimer says "Any commercial use of data obtained through the use of this
  site is strictly prohibited." No robots.txt/automation clause. Internal lead-gen at ~60 gentle GETs/week is
  a documented gray zone — throttle politely, keep volume tiny, revisit if productizing the DATA itself.
- Related free feed: **CivilView NCC sheriff sales** `salesweb.civilview.com/Sales/SalesSearch?countyId=24`
  (structured, daily) — late-stage supplement to the PDF. Buy-fallback baseline: Foreclosure.com $39.80/mo.
- No official bulk/API access exists (File&ServeXpress = $6/search, $20/doc — litigator tool, not a feed).
- Recorder of Deeds (PAXWorld) = login + $1/page images ($100/mo sub) — enrichment only (mortgage presence
  for free-and-clear detection), NOT the foreclosure signal (DE is judicial; the court filing IS the signal).

**→ Phase 2 should ship TWO signal streams:** code violations (as planned — trivial, dated, PRCLID-keyed)
AND the CourtConnect foreclosure sweep (pure parser is offline-testable; the weekly fetch is ~60 small GETs
from a Convex action). Both are rows in the same `signalEvents` table.

## 3. Equity gate — confirmed: NO free bulk assessed-value source (stop hunting), but a NEW bulk find

- The county publishes values **per-parcel only** (Reblaze "personal search"); the 2025 Tyler reassessment
  published a methodology PDF, not a roll; no downloadable roll on the reassessment page (page-verified).
  mydetax.com / newcastlecounty.io built their data from the same public per-parcel records (i.e., scraping).
- **NEW (page-verified via the NCC hub DCAT catalog, 50 datasets):** NCC publishes **bulk daily-updated
  zipped downloads**: `Parcels_GDB.zip` / `Parcels_SHP.zip`, **`Owners.zip`**, and
  **`Structure_Details.zip` ("Building Details — structure information and building attributes")** at
  `gis.nccde.org/agsserver/rest/directories/arcgisoutput/downloads/zipped/`. Structure details likely carry
  year-built/size/building attributes the REST spine lacks — **probe its field list** (download once
  manually or via cloud action) — free bulk enrichment for value/condition modeling. Assessed value
  unlikely inside, unverified.
- Equity strategy stands: **funnel-only** — value via existing Zillow/comps scrapers or the per-parcel county
  page (browser, only for flagged leads); delinquent tax balances free from monition/sale-list PDFs for
  exactly the distressed subset; mortgage-presence (free-and-clear) via Recorder per-doc when justified.

## 4. Vision/LLM tier — T4 condition scoring is now pennies; pull it forward (funnel-only)

- We already hold a Google key with **Street View Static**. A vision pass over flagged parcels:
  Claude **Haiku 4.5 = $1/MTok in, $5/MTok out**; one image ≈ ~1.6k tokens; **Batch API = 50% off** →
  **≈ $0.001/house, ~$1 per 1,000 houses** for an overgrown-yard/boarded-window/tarped-roof/junk score.
  Output = one more `signalEvents` row (category "physical", type "cv-condition") — zero schema change.
  (OpenRouter equivalents similar; use structured-output JSON schema so scores parse reliably.)
- Same structured-outputs upgrade applies to the existing Legal Notices extraction (reliability win).
- This was scheduled "Phase 6+/maybe" — at ~$1/1,000 it can ship right after Phase 2 scoring exists.

## 5. Ease-of-use wins for actually wholesaling (small, high-ROI)

1. **Leads = derived reactive query** (parcels ⋈ signalEvents), as already leaning — no stored leads table,
   no extra writes (quota), always live.
2. **One-click direct-mail CSV export** of any filtered lead set (owner mailing addresses are already in the
   spine; direct mail is the planned first outreach channel). Tiny feature, immediate revenue relevance.
3. One small shared helper for ArcGIS signal sources (config: layer URL, key field, date-cursor field,
   mapper → SignalEvent) so signals #2..#7 are config + a mapper, not new modules. Config objects, not a framework.
4. Later: email alert cron on new high-score leads; signals timeline on the parcel page.

## What NOT to change (validated by this review)
PRCLID-keyed CDC · keyset pagination + explicit field lists · ingest-broad/surface-narrow · derived-first
leads · serverless-only · additive phases. The moat is the stacked-signal assembly, exactly as designed.

## Decisions needed from the user
1. **Convex plan:** add a card (Starter $0-base, recommended) or Pro $25/mo — unblocks everything; without it
   even steady-state weekly CDC eats ~70% of free I/O.
2. CourtConnect ToS gray zone — proceed with the gentle internal-use weekly sweep? (Recommended: yes, throttled.)
3. Phase 2 scope: code violations + CourtConnect together, or violations first? (Recommended: spec both —
   the signalEvents schema is shared; build violations first, foreclosures second.)
4. Push branch to origin / merge to prod timing (one-time prod seed ≈ $0.05–0.15 on Starter, ~16 min).
