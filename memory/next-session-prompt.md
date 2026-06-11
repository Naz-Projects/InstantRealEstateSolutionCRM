# Next Session — Start Here

_Read `memory/memory.md` + `memory/lessons.md` first, then this._

## ★ ACTIVE INITIATIVE — Wholesaling Lead Engine — PHASE 2 IS NEXT (PICK UP HERE)
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
