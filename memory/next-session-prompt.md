# Next Session — Start Here

_Read `memory/memory.md` + `memory/lessons.md` first, then this._

## ★★★★ START HERE — 2026-06-14 (latest; two feature branches in flight, NEITHER merged)

> NOTE: this note lives on branch `feat/p6-offers-contracts`. The P5 memory updates (lessons + todo + a
> next-session block) live on branch `feat/p5-contacts-skiptrace`. Both branch off `main`; when each merges,
> reconcile the memory files (append both lesson sets) and **regenerate `convex/_generated`** (both add tables
> to `schema.ts` — the SECOND to merge must regen against the merged tree + `npm run build`, never hand-merge `api.*`).

**P5 — contacts + skip-trace (Tracerfy): BUILT OFFLINE, branch `feat/p5-contacts-skiptrace` (9 commits, READY TO MERGE).**
Blocked only on the user loading the **Tracerfy key + ~$10** → then merge + deploy + ONE live trace to verify. The action
throws a clear "TRACERFY_API_KEY is not set" until then. Spec `docs/superpowers/specs/2026-06-12-contacts-skiptrace-design.md`,
plan `docs/superpowers/plans/2026-06-13-contacts-skiptrace.md`. Do NOT merge before the key (user decision: no key-less
erroring button in prod). 187 tests on that branch.

**P6 — offers + contracts e-sign: BUILT, branch `feat/p6-offers-contracts` (14 commits, READY TO MERGE per the final whole-feature review). NOT merged.**
Built 2026-06-14/15 via the Opus-subagent TDD flow (per-task spec+quality review; the security-critical contract data layer was
double-reviewed + hardened). **197 tests, build clean, strictly additive (+3734/−10; the −10 is the `main.tsx` auth-gate
restructure, no existing feature logic touched).** Spec `docs/superpowers/specs/2026-06-14-offers-contracts-esign-design.md`;
plan `docs/superpowers/plans/2026-06-14-offers-contracts-esign.md`. What shipped:
- **Offers** (`offers` table, pure `src/scraper/offers.ts`, `convex/offerData.ts`, `LeadOffers` panel): per-lead offer/counter
  thread, status machine, accepted→under_contract one-click.
- **Contracts e-sign** (BOTH seller PSA + buyer Assignment): pure `src/scraper/contracts.ts` (term builders + name-match +
  token/expiry/transition guards), `contracts` table, `convex/contractData.ts` (team auth fns + PUBLIC token-gated portal fns
  + Convex `_storage`), `ContractPDF.tsx` (`@react-pdf/renderer` templates), public `/sign/$token` portal `SignPortal.tsx`
  (mounted in `main.tsx` before the auth gate; `signature_pad` typed+drawn; ESIGN consent + forensic trail), `LeadContracts`
  panel (generate PSA/Assignment, send→mint token, copy signing link, download signed PDF, void). Delivery = **copy-link
  first** (works with no external dep); **optional Resend** email (`convex/contractActions.ts`, key-gated, no-op without
  `RESEND_API_KEY`). Storage = Convex built-in (no R2).
- **Legal posture:** generated PSA/Assignment templates are attorney-review STARTING POINTS, "not legal advice" disclaimer baked in.
- **NEXT ACTIONS:** (1) MERGE decision — P6 has NO external blocker (copy-link works without any key), so it can merge to
  main + deploy now (a USER decision). (2) Manual click-through (auth-gated SPA, never clicked live): add offer→accept→Generate
  PSA→Send→copy `/sign/<token>`→open logged-out→review→sign typed+drawn→signed PDF downloads + status flips; Assignment from
  an assigned buyer; decline/void/expiry. (3) OPTIONAL email: set `RESEND_API_KEY`/`RESEND_FROM`/`PORTAL_BASE_URL` (+`RESEND_TO`)
  on Convex to enable auto-email. **Backlog nits (cosmetic, from the final review — ship-as-is OK):** assignment `terms.underlyingContractRef`
  is never set (the assignment doc doesn't name its PSA) · a no-op ternary in SignPortal `typedName` · a stale "P6 Task C3 adds…"
  comment in LeadsPage · `acceptContract` orphans the uploaded blob on a duplicate (two-tab) submit (benign Convex storage leak).

**Standing directive (unchanged):** all implementation via Opus 4.8 subagents; main loop orchestrates (spec/plan/dispatch/review/git).

## ★★ START HERE — full state as of end-of-session 2026-06-11 (everything below is LIVE ON PROD)

### What the CRM is now
The IRES CRM is a **full wholesaling pipeline, live in production** (https://crm.instantrealestatesolution.com,
Convex prod `pastel-crocodile-994`, all of `main` through `09c30c7` pushed; CF Workers builds deploy backend+frontend
on push). **Convex is on a PAID plan** (user upgraded 2026-06-11 — quota is no longer a constraint; a full 203k
re-seed costs ~$0.05–0.15). Everything merged; branch `feat/lead-engine-phase1-spine` is fully merged into `main`.

### What's live on prod (all verified via CLI with the prod deploy key from `.env.local` `CONVEX_DEPLOY_KEY_PROD`)
- **Parcel spine:** 203,740 NCC parcels, 53,299 absentee (26%). Weekly keys-only CDC cron (Sun). Seed is
  resumable (`seedSpine {syncId, afterPrclid}`) + capped (`maxPages`) + differential (unchanged rows = no write).
- **Signal engine:** `signalEvents` = **1,951** on prod — 1,886 code violations (ArcGIS CodeCases, `APDTTM`
  watermark, key `cc:<APNO>:<PRCLID>`) + pre-foreclosure from **51 CourtConnect cases (35 matched to parcels via
  conservative defendant↔owner token matching, 16 on the unmatched review list)**. Weekly crons Mon (violations) +
  Tue (foreclosure sweep, ~32 lender stems, `^N\d{2}L-` filter, 4–7 months before auction). Watermark only advances
  on a CLEAN sweep (partial stem failures re-sweep next run — that fix is live and proven).
- **Leads UX:** `/leads` — derived scored leads (stack × 90d-half-life recency × absentee ×1.5; config
  `src/scraper/leadScore.ts`), table + **Kanban board** toggle, stage machine
  (new→contacted→negotiating→under_contract→marketing→assigned→closed→dead) with notes + buyer assignment + fee,
  follow-up tasks w/ overdue/today badges, signal timeline per lead, unmatched-filings section, **direct-mail CSV
  export**, lead→`/flip?address=` handoff. `/buyers` cash-buyer CRM. Dashboard `FunnelWidget` (stage counts +
  pipeline/closed fees + follow-up urgency). **Score legend** docked in the sidebar footer (collapsible, persisted,
  reads SCORE_CONFIG live).
- **Tests:** 152 vitest, build clean. All pure logic TDD'd on live-captured fixtures (`tests/fixtures/`).

### The architecture (stable — do not re-derive)
4 layers: **spine** (parcels, PRCLID-keyed) → **signal event-streams** (open vocabulary, `signalEvents` +
`signalWatermarks`, watermark+overlap+idempotent-upsert) → **derived scored leads** (no stored leads table;
`leadStatus`/`followUps`/`buyers` hold only human workflow state, all keyed to prclid) → **tiered funnel-only
enrichment** (never run paid/browser against the 203k). Key docs: 4-layer spec (2026-06-06) ·
`memory/architecture-review-2026-06-11.md` (Convex cost model, CourtConnect research, equity-gate verdict: NO free
bulk assessed-value roll; NCC bulk `Structure_Details.zip`/`Owners.zip` downloads exist) ·
`docs/superpowers/specs/2026-06-11-lead-engine-phase2-signals-leads.md` (signal engine design) ·
**`docs/superpowers/specs/2026-06-11-wholesaling-pipeline-crm.md` (the gap analysis + P1–P8 roadmap — THE plan)**.

### WHAT'S NEXT (in order — updated 2026-06-12)
0. **STANDING DIRECTIVE (user, 2026-06-11):** ALL coding/implementation goes to **Opus 4.8 subagents**
   (`model: "opus"` on every implementer/reviewer dispatch); the main loop only orchestrates (specs, plans,
   dispatch, review coordination, git/deploy). Saved in auto-memory `implementation-via-opus-subagents`.
1. **User verification on prod** (never clicked through in a browser): /leads table+board (stages, notes,
   follow-ups, CSV) + **NEW P4 equity features** (expand lead → Pull value & balances → equity badge + score shift;
   min-equity filter; Enrich top N dialog; manual liens; legend equity rows), /buyers CRUD, flip handoff, dashboard
   funnel card; confirm the CF Workers build went green (stale `CONVEX_DEPLOY_KEY` in CF env = silently serves the
   old bundle; prod BACKEND was also deployed manually 2026-06-12, so only the frontend depends on CF).
2. **Pipeline roadmap** (each additive; P3 deferred, P4 done):
   ~~P3 outreach log~~ **DEFERRED to end-of-pipeline bucket** (design saved:
   `docs/superpowers/specs/2026-06-11-outreach-log-design.md`) ·
   ~~P4 equity gate~~ **SHIPPED 2026-06-12** (`85f4a12`; spec/plan `2026-06-11-equity-gate*`) ·
   **P5 contacts + skip-trace** (paid ~$0.10/hit, build the DNC/TCPA compliance module FIRST) ·
   **P6 offers/contracts** (offer history per lead, e-sign later) ·
   **P7 vision condition scoring** (Street View + LLM vision ≈ $1/1k houses, just another signalEvents source) ·
   **P8 buyer-match** (lead⋈buyers on area/price; the blast-email half → end bucket) ·
   **END bucket:** email notifications/alerts (P3 alerts + P8 blast, Resend) + mobile UI pass.
3. **More free signals** (stack on the same table, parsers mirror codeCases.ts): vacant (859), vacant-monition (76),
   rentals/tired-landlord (39k, `EXPDATE`), permits. Cheap wins.
4. **Probe `Structure_Details.zip`** (NCC bulk daily download — year-built/size attrs the spine lacks) — fields unknown.
5. **Backlog:** sheriff-PDF augment via `SheriffSales/0` layer · marker clustering · leadStatus stage-change
  timestamps for days-in-stage KPIs · LLC-defendant entity matching for the unmatched list.

### Operational gotchas (learned this session — see lessons.md)
- `npx convex run` on a LONG action (foreclosure sweep, seed) often reports "✖ Failed … Error" client-side while the
  action COMPLETES server-side — verify via `signalData:signalStatsInternal` / `parcelData:statsInternal`, not exit codes.
- A stalled self-rescheduling chain (counter frozen + status "running") = the action was killed (e.g. hung fetch) —
  ALL external fetches now have `AbortSignal.timeout(30_000)`; resume seeds with `{syncId, afterPrclid}` from the row.
- CourtConnect ToS: "no commercial use" gray zone — internal use only, ~32 GETs/week, sequential + 400ms pacing. Keep it tiny.
- Prod CLI ops: `export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"` then `npx convex run …`.

## (superseded 2026-06-11 — kept for context) Wholesaling Lead Engine — Phase 2 planning
**Status (2026-06-08): Phase 0 DONE · Phase 1 BUILT + LIVE-VERIFIED on DEV** (branch `feat/lead-engine-phase1-spine`,
**NOT merged, NOT on prod**). Turn the CRM into a NCC **wholesaling lead engine** — ingest ALL parcels + attach **distress
signals** → score leads → reach owners **off-market**.

> ⚠⚠ **CONVEX FREE-TIER QUOTA EXHAUSTED** — debugging the seed re-ran the full 203k load ~4× and maxed the dev monthly
> quota; the user is BLOCKED on Convex. **Do NOT run ANY Convex ops or re-seed** until it resets (monthly billing cycle) or
> the plan is upgraded — they only add to usage. **All file-based work is safe** (specs, plans, pure modules + vitest,
> `npm run build`). Code-cases (Phase 2) is a TINY feed (~2,852) so it's cheap even when Convex is back.
> **DONE 2026-06-11 (quota-safety code, on branch):** `seedSpine maxPages` cap (`d7aae65`) + **differential upsert** — a full
> refresh now writes only changed rows, not 203k (`8af7cbc`). **OPEN USER DECISION: Convex plan** — Starter ($0 base,
> pay-as-you-go, recommended) ends the hard-block risk; one full seed ≈ $0.05–0.15. Note the weekly `syncSpine` range-diff
> reads FULL docs ≈ 0.7 GB/mo ≈ 70% of free I/O by itself. Full numbers: `memory/architecture-review-2026-06-11.md` §1.

**GIT STATE — everything is LOCAL (nothing pushed to origin, nothing on prod):**
- `main`: research/docs only (spec `ce11b62`, Phase 0 source matrix, distress catalog, enrichment/vision).
- **`feat/lead-engine-phase1-spine` ← CHECK OUT THIS BRANCH to continue** (has everything on main PLUS the Phase 1 build + these docs).
- **Pending user decisions:** push to origin? merge Phase 1 → prod + ONE-TIME prod seed? (User: **keep on branch for now**.)

**WHAT'S DONE:**
- **Phase 0** — `memory/source-matrix.md`: NCC ArcGIS `CustomMaps` is a free `PRCLID`-keyed distress-feed suite (DON'T re-probe).
- **Phase 1** — branch `feat/lead-engine-phase1-spine`; plan `docs/superpowers/plans/2026-06-07-lead-engine-phase1-spine-search.md`.
  Pure `src/scraper/arcgisParcels.ts` (keyset + **explicit field list, NEVER `outFields=*`** — one ArcGIS field is corrupt in a
  dense region & 400s `*`; absentee derive; content hash; key-diff; **13 tests**). `parcels`/`parcelSync` schema,
  `convex/parcelData.ts` (search/upsert/stats) + `convex/parcelActions.ts` (`seedSpine` resumable + adaptive halving + retry;
  `syncSpine` cheap keys-only CDC) + weekly cron + `/parcels` search page (`src/web/ParcelSearch.tsx`: owner/address/parcel#
  search + absentee flags + owner-portfolio view). **Verified on dev:** **203,739 parcels, 53,293 absentee (26%)**; search index
  + CDC new/vanished all proven. 111 tests, build clean. **Additive — zero change to Sheriff/Legal/Flip/Properties.**

**READ before Phase 2:** the 4-layer spec · `memory/distress-signals.md` (signal catalog + **LIST STACKING** + equity-as-gate) ·
`memory/lead-engine-enrichment-and-vision.md` (free→paid→satellite/CV tiers + saleable-product vision) ·
**`memory/architecture-review-2026-06-11.md` (architecture review: Convex cost model · CourtConnect pre-foreclosure is
SERVERLESS-buildable, no browser, `LM`/`^N\d{2}L-` case filter, plaintiff-stem sweep, 4–7 mo lead time, ToS gray zone ·
NO free bulk assessed-value roll (equity stays funnel-only) · NEW bulk `Structure_Details.zip`/`Owners.zip` downloads ·
vision condition scoring ≈ $1/1,000 houses · direct-mail CSV export quick win).**

## ★ THE NEXT LAYER — Phase 2: Signal Event-Streams → Leads → Scoring
This is where the spine becomes a real LEAD ENGINE (spec layers 2+3): attach distress SIGNALS to parcels and surface SCORED
leads. **Ingest broad, surface narrow** — a parcel becomes a visible lead only once a signal attaches; multiple stacked
signals = higher intent (list stacking).

**START with CODE VIOLATIONS** (the Phase 0 winner: free, dated, `PRCLID`-keyed, distress-grade, stacks with absentee, TINY/cheap):
- Source `CustomMaps/CodeEnforcement_CodeCases/MapServer/0` (~2,852). **Dated cursor `APDTTM`** via
  `where=APDTTM > TIMESTAMP 'YYYY-MM-DD HH:MM:SS'` (verified). Fields: `PRCLID`, `ADDR`, `APTYPE`/`APDESC` ("HIGH WEED AND GRASS"), `STAT` (O=open), `APDTTM`.

**Proposed design (write the Phase 2 spec → plan → TDD build; mirror the Phase 1 patterns):**
1. **`signalEvents` table** — generic, 1 row/signal: `prclid` (joins the spine), `category` (financial|life-event|physical|
   situational, per distress-signals.md), `type` ("code-violation"), `source`, `observedDate` (ms, for recency), `externalKey`
   (idempotency, e.g. `APNO`), `payload`. Indexes `by_prclid`, `by_type`, `by_observedDate`. One parcel → many events (stacking).
2. **Pure `src/scraper/codeCases.ts`** (vitest) — parse a CodeCases feature → `SignalEvent` (type "code-violation", category
   "physical", `observedDate` from `APDTTM`, payload {apdesc, stat, apno}). Build the dated-watermark query URL. Mirrors `arcgisParcels.ts`.
3. **`convex/signalData.ts`** (upsert-event-by-`externalKey`, list events for a parcel, watermark get/set) +
   **`convex/signalActions.ts`** (`"use node"` `syncCodeCases` = pull since stored `APDTTM` watermark → upsert events; idempotent;
   small feed = cheap, NOT a 203k job). Weekly cron.
4. **Leads + scoring** — a parcel with ≥1 signal is a lead. Score = stacked-signal count × recency × **absentee (from spine)**;
   RULES first, config-driven weights (ML later). **Decide in the spec: derived reactive query (parcels⋈signalEvents) vs a
   stored `leads` table** — lean derived-first (simpler, live, no extra writes; matters for quota).
5. **UI** — a **Leads** page (filter by signal/score/absentee) + a signals timeline on a parcel; reuse the `/parcels` shell + search.
6. Built TDD; the pure `codeCases.ts` + schema are **offline/cheap** — build them while Convex is over quota; defer the live
   `syncCodeCases` run until Convex is back (it's a tiny feed, low cost).

**LATER layers (each its own spec — the full architecture, already researched):** more free signals (vacant `Code_Enforcement/6`,
vacant-monition `SheriffSales/1`, rentals/tired-landlord `RentalUnits/0`, permits) → all STACK; **T1 court scrape** (pre-foreclosure
lis-pendens via DE CourtConnect, free; bankruptcy via PACER cheap; ⚠ DE divorce is CONFIDENTIAL); **T2/T3** per-parcel assessed
value + tax/sewer balances (Reblaze browser, funnel-only) + skip-trace (paid, **DNC/TCPA-gated**) → the **EQUITY GATE** (value −
liens = the ranking multiplier); **T4 imagery/CV** condition scoring (cheap DIY Street View + LLM-vision → Cape Analytics later);
outreach (direct mail first — owner mailing is free from the spine). Full map: `memory/lead-engine-enrichment-and-vision.md`.

**EXACT NEXT STEPS (do in order):**
1. ~~(quota safety) `maxPages` on `seedSpine`~~ **DONE 2026-06-11** (`d7aae65`), plus differential upsert (`8af7cbc`).
2. **User decisions** (see architecture-review §Decisions): Convex Starter upgrade? CourtConnect sweep OK (ToS gray zone)?
3. **Write the Phase 2 spec** (`docs/superpowers/specs/<date>-lead-engine-phase2-signals-leads.md`) — design above PLUS the
   **CourtConnect pre-foreclosure stream** (shared `signalEvents` schema; pure `codeCases.ts` + `courtConnect.ts` parsers both
   offline-testable; plaintiff-stem list as config; weekly action ≈ 60 small GETs). Decide derived-vs-stored leads (lean derived)
   + rules-scoring weights. Include the **direct-mail CSV export** as the Phase 2 UI quick win. → **writing-plans** → **TDD build**
   the pure parsers + schema (offline). **Defer live sync runs until Convex is usable** (then both feeds are cheap).
4. Only once Convex is usable again: merge Phase 1(+2), ONE-TIME prod seed (~$0.05–0.15 on Starter; or JSONL + `npx convex import`),
   live click-through `/parcels` + Leads.

⚠ **Dev sandbox blocks local outbound HTTP** — verify endpoints via a throwaway cloud-dev Convex action (`npx convex run`),
NOT local curl/WebFetch — **but mind the quota** (probing costs too; code-cases is tiny vs the 203k spine). The Phase 0 probe
technique + the `outFields=*`/keyset/field-list gotchas are in lessons 2026-06-07/08.

**Scraping-tool context (eval — see lessons 2026-06-06):** the NCC parcel ASP.NET site (Reblaze) needs a **real browser**
(Scrapling `StealthyFetcher`+`page_action` drives it free, but a browser must be HOSTED → conflicts with serverless — which
is why the free ArcGIS API is the spine path). Keep Firecrawl for Zillow. Full verdict:
`C:\Users\nazho\Desktop\scraping-test\output\ires\VERDICT-ires.md`.

## Where we are — production is live
The IRES CRM is **live in production** at **https://crm.instantrealestatesolution.com** — Convex prod
`pastel-crocodile-994`, Cloudflare Workers project `instant-real-estate-solution-crm`, Clerk **production**
instance (invite-only). Sign in as `nazhossain16@gmail.com` (seeded owner/admin). Dev = `fearless-donkey-585`
(Clerk dev `optimal-frog-32`); `IRES_DEV` removed (dev secured). All work merged to `main` + pushed; **75 tests**
pass; build clean. The dark **"Industrial Precision"** shadcn UI is on main/prod (the old `ui/shadcn-foundation`
work is long since merged — ignore any stale "merge ui/shadcn-foundation" note).

## Most recent work — Properties portfolio + address autocomplete (shipped to prod, 2026-06-03)
Two more additive features, both **merged to `main` + deployed to prod** (75 tests, build clean):
1. **Properties / Portfolio** (`/properties`) — manage houses IRES *owns* (flip|rental); list + detail pages,
   unified expense/income ledger (`propertyLedger`), flip→sale realized profit/ROI, rental net cash flow, photo
   from Zillow (legacy listing photo) with a **Google Street View fallback** for off-market houses, seed-from
   Sheriff/Legal/Flip. New `properties`+`propertyLedger` tables, `convex/propertyData.ts`+`propertyActions.ts`,
   pure `src/scraper/portfolio.ts`. Built **subagent-driven + TDD in an isolated worktree** alongside the comps
   session (see lessons.md: worktree + `CONVEX_AGENT_MODE=anonymous`; second merge regenerates `_generated`).
   Spec/plan: `docs/superpowers/{specs,plans}/2026-06-03-properties-portfolio*`. (Details: `memory.md` → "Properties / Portfolio".)
2. **Address autocomplete + UX** — `src/web/AddressAutocomplete.tsx` (Google Places autocomplete on the manual
   address fields of Properties + Flip; **legacy** `AutocompleteService` — the key has legacy "Places API", not
   New); global `cursor: pointer`; 8/9 plain `<select>`s → shadcn `Select` (map InfoWindow stays native).
- **Pending verification:** live-click `/properties` AND the address autocomplete on prod (auth-gated, never
  clicked through in a running app); confirm prod key has **Street View Static** enabled (off-market photos).

## Most recent work — Flip Analyzer + ARV-from-comps (earlier this session, 2026-06-03)
Built two additive features end-to-end (brainstorm → spec → plan → subagent-driven TDD → review → merge → deploy),
**without touching** the Sheriff/Legal pages, their pipelines, or `deal.ts`:
1. **Flip Analyzer** (`/flip`) — turns a property (Sheriff/Legal listing OR manual address) into a flip P&L:
   ARV − tiered rehab − full cost stack → **MAO / profit / ROI / grade**, live as you edit. Saved in a new
   `flipAnalyses` table; `convex/flipData.ts` is read-only on sheriff/legal. Pure math in `src/scraper/flip.ts`.
   Property picker = shadcn Popover+Command combobox. (Details: `memory.md` → "Flip Analyzer".)
2. **ARV from comps** — "Pull comps" scrapes recent **Redfin** `sold-6mo` listings near the property (Firecrawl,
   on demand), parses them (`src/scraper/comps.ts`), suggests an ARV (median $/sqft × sqft), and **"Use as ARV"**
   pre-fills the field. `convex/compsActions.ts` (`pullComps`). Chose **scrape over a paid API** (RentCast/ATTOM).
Specs/plans: `docs/superpowers/{specs,plans}/2026-06-03-flip-analyzer*` and `…-arv-from-comps*`.
Research menu of more flip features: `memory/flip-decision-features.md`.

### ★ FIRST next steps (do these first)
Everything below (Flip Analyzer, ARV-from-comps, Properties, autocomplete) is **already merged + deployed to prod**
(last confirmed-live bundle `index-DFC2G_Eo.js`). The remaining work is verification + housekeeping:
1. **Live smoke-test on prod** (auth-gated; none of these were clicked through in a running app):
   - **`/properties`** — add a manual flip + rental, seed one from a Sheriff listing, add expense & income ledger
     entries, mark a flip sold → profit/ROI, delete.
   - **Address autocomplete** — type into the Properties / Flip manual address field; Google suggestions should
     appear (legacy Places API). If none appear, the key has neither legacy nor New Places enabled.
   - **`/flip`** — create from Sheriff/Legal/manual; edit inputs → live MAO/profit/ROI; Pull comps → Use as ARV.
   - Confirm `/sheriff` + `/legal` are unchanged.
2. **Housekeeping (see `todo.md` → Housekeeping):** decide on the untracked shadcn-skill artifacts (`.agents/`,
   `.claude/`, `_preview.png`, `skills-lock.json`) — gitignore or commit; delete the orphaned worktree dir
   `.claude/worktrees/properties` (holds a stray `.env.local`).
3. **This session's doc commit may be local-only** — `git status` / `git rev-list --count origin/main..main`;
   `git push origin main` if you want the memory updates on origin (doc-only re-triggers a CF build).

### (Resolved) The owned-property portfolio worktree — now MERGED + deployed
The Properties feature that was built in the isolated worktree `.claude/worktrees/properties` has been **merged to
`main` and deployed** (see "Most recent work" above). The branch is deleted; the worktree was removed (a leftover
orphan dir `.claude/worktrees/properties` may remain locked on disk with a stray `.env.local` copy — delete it:
`Remove-Item -Recurse -Force .claude\worktrees\properties`). Nothing pending here.

## ★ NEXT BIG INITIATIVE — Off-Market & Pre-Foreclosure Acquisition Engine (research → build)
Find distressed / motivated-seller houses (esp. **pre-foreclosure**) **before they hit the MLS**, reach the owner
first, run the flip math, automate it. Today's pipelines are *late/public* (Sheriff = the auction; Legal = one
probate source). The win is moving **upstream**: the house we catch at the sheriff sale had a foreclosure complaint
filed in court **months earlier**.
- **Full research + build plan: [`memory/next-initiative-offmarket.md`](next-initiative-offmarket.md)** (5 data
  layers · signal taxonomy · how the big firms do it · CRM architecture: new `leads`/`contacts` tables, skip-trace,
  scoring, alerts · build-vs-buy + TCPA/DNC decisions).
- **Concrete first step:** the **pre-foreclosure (lis-pendens) scraper for New Castle County** (DE courts docket +
  NCC Recorder of Deeds) → a unified **`leads`** pipeline + **`contacts`/skip-trace** + basic lead scoring.
- **Mindset:** research-first — verify each DE/NCC source is scrapable within ToS; design DNC/TCPA compliance
  **before** any automated outreach (fines ~$500–$1,500/message).

## Smaller next picks (from `memory/todo.md` + `memory/flip-decision-features.md`)
- **Flip Analyzer polish (Tier 1):** scenario/sensitivity (best/worst side-by-side), buy-box/grade filter, lender
  PDF report. All reuse the pure `computeFlip` — cheap.
- **Tier 2 flip data:** condition-adjusted AVM, **rent comps → flip-vs-BRRRR** exit comparison, AI rehab-from-photos.
- **Kanban deal board**, dashboard charts, AI "Deal Analyst" (OpenRouter), notifications, CSV export.

## Post-launch punch list (carried over)
1. **Finish the Google Maps key rotation.** ONE domain-restricted key → Cloudflare `VITE_GOOGLE_MAPS_API_KEY`
   (redeploy) **and** Convex `GOOGLE_GEOCODING_API_KEY` on **prod + dev**. Enable Maps JS + Geocoding + Street View
   Static; restrictions `https://crm.instantrealestatesolution.com/*` + `http://localhost:5173/*`.
2. **Rotate the other chat-shared keys** — Firecrawl, OpenRouter, Anthropic, Convex dev/prod deploy, Clerk secret.
   **When rotating the prod Convex deploy key, ALSO update Cloudflare's `CONVEX_DEPLOY_KEY` build env** (a stale one
   there 401s every push build — bit us this session).
3. **Create a real `VITE_GOOGLE_MAPS_MAP_ID`** (vector Map ID) → Cloudflare → kills the DEMO watermark.
4. **Fix `backfillGeocodes` silent `catch{}`** (`convex/geocodeActions.ts`) — surface REQUEST_DENIED / expired key.
5. **E2E-test the invite flow on prod** (Admin → invite → accept on `/accept-invite` → lands as member).

## Run / deploy
```bash
cd C:\Users\nazho\Desktop\ires-crm
npm install
npx convex dev        # terminal 1 — syncs functions to dev (fearless-donkey-585)
npm run dev           # terminal 2 — http://localhost:5173 (sign in via Clerk dev)
```
- **Deploy (frontend + backend) = `git push origin main`.** Cloudflare Workers Build runs
  `npx convex deploy --cmd 'npm run build'` → deploys the prod Convex backend **then** builds + serves the frontend.
  (This is the BlueRock "backend-deploy-on-push" model; the old "backend deploys manually" note is superseded.)
- **Manual prod backend deploy (optional):** `CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)" npx convex deploy`.
  The **prod** deploy key is in `.env.local` as **`CONVEX_DEPLOY_KEY_PROD`** (the plain `CONVEX_DEPLOY_KEY` there is the **dev** key).
- **Geocode missing rows:** the "Geocode N missing" map button, or `… npx convex run geocodeActions:backfillGeocodes '{"type":"sheriff"}'`.
- `npm test` (64). The Windows `UV_HANDLE_CLOSING` Convex-CLI assertion is cosmetic — trust the output.

## Gotchas (also in lessons.md)
- **CF build deploys backend+frontend via `npx convex deploy --cmd 'npm run build'` on push** — it needs a **valid
  prod `CONVEX_DEPLOY_KEY` in Cloudflare's build env**. A failed build keeps serving the last good bundle (no
  breakage, just no update). (Supersedes the old "`convex deploy --cmd` errors on Workers" note — it works; it only
  failed on a *stale key*.)
- **`convex/_generated` + `wrangler.jsonc` are committed on purpose** (CF CI). Don't gitignore `_generated`.
- After changing `convex/`, run `npx convex dev --once` (validates + regenerates `_generated`) THEN `npm run build`.
- Convex `"use node"` files = actions only; V8 queries/mutations in `*Data.ts`. Annotate action return types (TS7023).
- **Flip analyses are shared-team** (any signed-in member can view/edit/delete/pull-comps on any analysis — same
  `requireUser`-only model as all `flipData` mutations; no per-user ownership). An automated IDOR flag on `pullComps`
  is **not applicable** for this design. If per-user privacy is ever wanted, it's a cross-cutting change.
- **One domain-restricted Google key** serves browser map + server geocoding (no Website restriction on the
  Geocoding web service). Diagnose geocode failures by curling the Geocoding API with the key.
- **Clerk:** restricted/invite-only sign-up, but "Sign-up with email" must stay ON. The `convex` JWT template (with
  the **email** claim) must exist on each instance.
- **Untracked artifacts** still in the tree (`.agents/`, `.claude/`, `_preview.png`, `skills-lock.json`) — decide
  gitignore-vs-commit. The recurring `M convex/_generated/api.d.ts` is LF↔CRLF drift (cosmetic; a `.gitattributes`
  normalize would end it).
