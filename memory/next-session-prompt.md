# Next Session — Start Here

_Read `memory/memory.md` + `memory/lessons.md` first, then this._

## ★ ACTIVE INITIATIVE (2026-06-06) — Wholesaling Lead Engine — PHASE 1 IS NEXT (PICK UP HERE)
**Status: spec APPROVED + COMMITTED (`ce11b62`) · Phase 0 research COMPLETE · Phase 1 NOT started.** Turn the CRM into a
**New Castle County wholesaling lead engine** — ingest ALL parcels + attach **distress signals** → score leads → reach
owners **off-market**. Builds ON [`memory/next-initiative-offmarket.md`](next-initiative-offmarket.md).

**READ FIRST:** the spec [`docs/superpowers/specs/2026-06-06-wholesaling-lead-engine-design.md`](../docs/superpowers/specs/2026-06-06-wholesaling-lead-engine-design.md)
(4-layer north-star) · the **Source Matrix [`memory/source-matrix.md`](source-matrix.md)** (Phase 0 result) · the Phase 0 plan
[`docs/superpowers/plans/2026-06-06-wholesaling-lead-engine-phase0.md`](../docs/superpowers/plans/2026-06-06-wholesaling-lead-engine-phase0.md).

**PHASE 0 RESULT — the win is bigger than the spec assumed (verified live; DON'T re-probe):** the NCC ArcGIS
**`CustomMaps` folder** (`https://gis.nccde.org/agsserver/rest/services/CustomMaps`) is a **free, public, `PRCLID`-keyed
suite of distress feeds**, several **dated** (cheap delta, no 200k re-scan):
- `CodeEnforcement_CodeCases/0` — **2,852** code cases, dated (`last_edited_date`/`created_date`/`APDTTM`), `APDESC`
  (e.g. "HIGH WEED AND GRASS"), `STAT`; helper views `Code_Enforcement/MapServer` (6 Vacant Properties **859**, 9 Open
  Cases, **11 "Cases added last 30 days" 1,051**, 8 Resolved-with-Fees-Owed). ← **Phase 2 signal winner.**
- `SheriffSales/0` — **53**, *structured* (`PARCELID`,`CASENUMBER`,`PLANTIFF`) → **can replace the brittle sheriff-PDF parse**.
- `SheriffSales/1 Vacant Monitions Candidates` — **76** curated vacant+tax-delinquent. `RentalUnits/0` — **39,424** (`EXPDATE`).
  `Permits/4 New Construction`. `Ownership/0` — **203,752** (`CNTCTLAST` = full owner-name string + mailing + absentee).
- **Spine proof:** `BaseMaps/Base_Layers/MapServer/0` = **203,752** parcels; PRCLID-only key page ~39 KB (full key list ~8 MB
  ⇒ cheap CDC diff; **MUST add `orderByFields=PRCLID`** to page a single field, else ArcGIS 400s); full seed ~167 MB; only
  `TAXAREA` value-ish. FirstMap `DE_StateParcels` thinner (no owner/value) → use the NCC layer.
- **Still NOT free (funnel-only / verify-later):** **assessed value + tax/sewer balances** (Reblaze per-parcel site →
  Firecrawl/Scrapling browser, only for flagged parcels) and **upstream court lis-pendens** (CourtConnect scrape — verify ToS).

**Locked decisions:** Phase 1 = ArcGIS parcel + absentee + **parcel/owner SEARCH page**, additive alongside the live
Firecrawl parcel scrape (cutover later). NCC first. **Serverless only** (no Docker/VPS — hard rule). CDC key = **`PRCLID`,
never `OBJECTID`**. **Ingest broad, surface narrow.**

**EXACT NEXT STEP (do in order):**
1. **Write the Phase 1 spec** (`docs/superpowers/specs/2026-06-06-lead-engine-phase1-spine-search.md`): `parcels` table
   (`prclid` unique, situs, owner-mailing, `ownerName`=`CNTCTLAST`, `absentee`+reason, `contentHash`, `firstSeen/lastSeen/active`),
   pure `src/scraper/arcgisParcels.ts` (URL build, feature→Parcel, absentee derive, hash), `convex/parcelData.ts` (upsert-by-prclid,
   search) + `convex/parcelActions.ts` (`"use node"` `syncSpine` = paginate PRCLID keys w/ `orderByFields` → diff → enrich
   new/changed), weekly cron, a **parcel+owner search page** (reuse `PropertyMap`/Street View, dark shadcn). Additive; no change
   to Sheriff/Legal/Flip/Properties or the Firecrawl parcel path.
2. → **writing-plans** skill → TDD build (consider an isolated worktree if concurrent sessions are possible;
   `CONVEX_AGENT_MODE=anonymous` for isolated codegen). Live-prove the sync (count in / count stored / spot-checked absentee).
3. Then **Phase 2** (code-violations signal) gets its own spec→plan.

⚠ **This dev sandbox BLOCKS local outbound HTTP** — verify any new endpoint via a throwaway cloud-dev Convex action
(`npx convex run`), NOT local curl/WebFetch (the Phase 0 probe technique; see lessons 2026-06-06). The real `syncSpine`
runs in Convex cloud (has network), so it's unaffected.

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
