# Next Session — Start Here

_Read `memory/memory.md` + `memory/lessons.md` first, then this._

## Where we are — production is live
The IRES CRM is **live in production** at **https://crm.instantrealestatesolution.com** — Convex prod
`pastel-crocodile-994`, Cloudflare Workers project `instant-real-estate-solution-crm`, Clerk **production**
instance (invite-only). Sign in as `nazhossain16@gmail.com` (seeded owner/admin). Dev = `fearless-donkey-585`
(Clerk dev `optimal-frog-32`); `IRES_DEV` removed (dev secured). All work merged to `main` + pushed; **64 tests**
pass; build clean. The dark **"Industrial Precision"** shadcn UI is on main/prod (the old `ui/shadcn-foundation`
work is long since merged — ignore any stale "merge ui/shadcn-foundation" note).

## Most recent work — Flip Analyzer + ARV-from-comps (shipped this session, 2026-06-03)
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
1. **Confirm the last Cloudflare build went green.** The push of `ff15cdf` (ARV-from-comps) triggers CF Workers
   Build `npx convex deploy --cmd 'npm run build'`, which deploys **backend (prod Convex) + frontend** in one shot.
   The CF `CONVEX_DEPLOY_KEY` was stale earlier (rotated) and the user fixed it — verify this build succeeded
   (CF → Workers Builds log). If it 401s again, the CF env key is wrong (see Gotchas).
2. **Live smoke-test `/flip` on prod** (never clicked through in a running app — only unit-tested + reviewed):
   create an analysis from a Sheriff + a Legal listing + a manual DE address; edit ARV/rehab/sqft/assumptions →
   MAO/profit/ROI/grade update live; **Pull comps → Use as ARV**; Save → reopen → delete. Confirm the sidebar logo
   + property combobox render; confirm `/sheriff` and `/legal` are unchanged.
3. **Push the held memory commit.** `memory.md`/`todo.md` updates for ARV-from-comps are **committed locally but
   not pushed** (`git rev-list --count origin/main..main` = 1) — held so they wouldn't race the in-flight CF build.
   `git push origin main` when ready (it's doc-only; re-triggers a CF build).

### Parallel work in progress — owned-property portfolio (another session)
A **separate** "owned-property portfolio" feature is being built in an **isolated git worktree**:
`.claude/worktrees/properties` on branch **`feat/properties-portfolio`** (flip/rental, unified ledger, Zillow
photos — spec+plan at `docs/superpowers/{specs,plans}/…owned-property-portfolio…`). Its **docs** commits are already
on `main`; its **code** stays in the worktree until that session merges it. **Do not touch that worktree/branch.**
When it merges to `main`, it FFs cleanly (shared ancestry). Heads-up: it may also add tables/UI — coordinate if you
touch `convex/schema.ts` or the shell.

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
