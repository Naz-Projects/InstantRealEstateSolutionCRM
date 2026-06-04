# IRES CRM — Project Memory

_Read this first. It's the "what & why" so you don't have to reverse-engineer the codebase._

## What this is
A CRM for **Instant Real Estate Solution (IRES)** — a Delaware / New Castle County (NCC) real-estate
**wholesaling, flipping, and buy-and-rent** business. The CRM's headline feature is one-click automations:
a team member clicks **"Scrape Sheriff Sales This Week"** (or Legal Notices) and the system scrapes the
county data, enriches it, and shows it live in the CRM — with a **deal pipeline** to track which
properties we've reviewed, contacted, made offers on, etc.

## Why it exists (origin)
It started as a **Python + n8n + Railway** pipeline that scraped NCC sheriff-sale and legal-notice PDFs,
enriched them with Zillow + parcel data, and dumped rows into Google Sheets + email. That was fragile
(n8n/Railway flakiness, not team-friendly, needed Docker/self-hosting). **Goal: replace all of that with
one CRM the non-technical team controls** — owned by us, free, serverless, everything in one place.

## The stack (the user's standard — don't deviate)
- **Convex** — backend, reactive DB, serverless functions, cron. (No server, no Docker, scales to zero.)
- **Clerk** — auth.
- **TanStack Router + React + Tailwind** — frontend.
- **Cloudflare** — hosting (frontend). Same pattern as the user's other CRMs (BlueRock, Peak Web, Yachts Direct).
- **Firecrawl** — the only scraper (cloud API: PDF scrape, NCC parcel browser-actions, Zillow). It runs the
  headless browser in its cloud, so we never run a browser ourselves.
- **OpenRouter** — LLM extraction, used ONLY for Legal Notices (prose → structured listings).

> A serverless CRM was briefly almost built on self-hosted **Twenty** (open-source CRM) for its UI, but
> dropped — Twenty needs a 24/7 Docker server, the opposite of serverless. Its source is archived in
> `docs/twenty-app-archived/` for UI reference only. **Do not re-propose Twenty/Docker.**

## Two automation pipelines
1. **Sheriff Sales** — monthly NCC "Current Sheriff Sale Listing" PDF → parse table → clean addresses →
   enrich each with NCC **parcel** data (owner, assessment, county/school/sewer balances) + **Zillow**
   (zestimate, beds/baths/sqft).
2. **Legal Notices** — weekly NCC estate/probate PDF → **LLM-extract** estate listings (deceased "late of"
   address + personal rep) → **Zillow** enrich.

## How it's wired (the pattern)
Button → **Clerk-authed Convex mutation** (`startScrape`, records intent, refuses concurrent runs) →
schedules an **internalAction** → the action scrapes + parses + inserts rows (status `pending`) → **fans
out** one `enrich` action per row via `ctx.scheduler` → each enriches and patches its row → the reactive
UI fills in live. Idempotent: skips an already-scraped month/week unless forced.

## Data model (Convex `convex/schema.ts`)
- `scrapeRuns` — one per execution (type, label, status, `phase`, counts incl. `failedCount`) → run history / live progress.
- `scrapeEvents` — step-by-step log rows (`runId`, `phase`, `message`, `level`) streamed live to the UI stepper. Separate table (not an array on the run) to avoid OCC contention from the fan-out enrich actions.
- `sheriffListings` — scraped + parcel + Zillow fields + `dealStatus` + `notes`.
- `legalNotices` — scraped + Zillow fields + `dealStatus` + `notes`.
- Shared pipeline: `dealStatus` = new → reviewing → contacted → offer → dead.

## Live progress (how the stepper works)
Each action creates its run FIRST (phase `starting`), then patches `phase` and appends `scrapeEvents` at every
step (fetch → parse / AI-extract → per-listing parcel→Zillow sub-steps via an `onEvent` callback on the core
`enrichListing`), and always finalizes (complete/failed) in try/catch. Force re-scrape = `clearMonth`/`clearWeek`
deletes the period's rows, then re-inserts (clean replace). The UI subscribes to `runs.latestRun` + `runs.listEvents`
and renders one unified shadcn **stepper** (`src/web/ScrapeProgress.tsx`): real phase drives the active step,
time-easing animates within a step, enrich shows real n/total, errors show red. **Verified live** (forced limit:10
sheriff → 10/10 enriched, events incl. real "blocked" errors). NOTE: source has ~53 June sheriff listings.

## Code map
- `src/scraper/*` — **runtime-agnostic core** (Firecrawl client, sheriff parse, address clean, parcel,
  zillow, legalNotices, enrich — `enrichListing` takes an optional `onEvent` callback; `deal.ts` cushion
  math; `geocode.ts` address→`{lat,lng}` DE-validated). Pure + unit-tested; reused by the Convex actions.
- `convex/*` — `schema`, `sheriffData`/`sheriffActions`, `legalData`/`legalActions`, `geocodeData`/`geocodeActions`,
  `runs` (run lifecycle + events + `latestRun`/`listEvents`), `crons`, `auth.config`, `helpers`.
  (`*Actions` are `"use node"`; `*Data` are V8 queries/mutations.)
- `src/web/*` — React app: `main` (Convex provider), `app` (router + IRES shell), `pages` (Dashboard,
  Sheriff Sales, Legal Notices), `ScrapeProgress` (live stepper, collapsible log), `PropertyMap` +
  `StreetViewModal` (Google map + Street View), `dealStages` (shared pipeline stages).
- `src/components/ui/stepper.tsx` + `src/lib/utils.ts` (`cn`) — shadcn scaffolding (`@/` alias →
  `src`; shadcn semantic tokens added to `src/web/index.css` `@theme`).

## UI foundation — shadcn/ui (2026-06-03)
> **THEME UPDATE (same day):** the app was then converted from the light navy/green look to a dark
> **"Industrial Precision"** theme — deep black (`--background #0a0a0a`, `--card #161616`, `--muted #1c1c1c`),
> **teal** accents (`--color-teal #2D9C84` / `--color-teal-glow #3AB89E`: card frames, active nav/tab, links,
> focus, charts) and **metallic-yellow** primary CTAs (`--primary #FACC15` via the `.btn-metal-yellow` class).
> Font is **Inter**; a 3% `feTurbulence` noise grain (`body::after`) + `fadeInUp` card entry + teal hover-glow.
> Driven by `class="dark"` on `<html>` + the palette in the `.dark` block of `src/web/index.css`. The legacy
> Sheriff/Legal/Admin/map/dialog pages were migrated from hardcoded light classes to the dark tokens. The
> sidebar is now near-black with spaced nav and a teal (not yellow) active highlight. (Details/gotchas in
> lessons.md 2026-06-03.) The navy/green description below is the superseded first pass.

The app now has a **real shadcn/ui foundation** (was a partial hand-rolled setup). `components.json`
(style `radix-nova`, base **radix**, Tailwind v4, css `src/web/index.css`, alias `@`, iconLibrary lucide,
registry `@efferd → https://efferd.com/r/new-york/{name}.json`). Installed the **`@efferd/dashboard-3`** block
(cascades `@efferd/app-shell-3` + base components: sidebar, card, chart, table, badge, avatar, dropdown-menu,
select, breadcrumb, collapsible, tooltip, separator, kbd, sheet, skeleton, input, button — all in
`src/components/ui/`; recharts for charts). Reusable utils kept: `delta.tsx`, `formater.ts`, `indicator.tsx`.
- **Theming:** shadcn owns the semantic tokens; `--primary` = IRES green `#16a34a` (so `bg-primary` is green
  everywhere), navy kept as `--color-ink`/`--color-ink-2`, the `--sidebar*` tokens are **navy** (brand anchor,
  green active item), `--chart-1..5` = green/navy/amber/blue/slate. The old brand `accent` class (= green) was
  migrated to `primary` across the existing pages; the stepper keeps shadcn-neutral `accent`. (See lessons for
  the token-collision trap — Tailwind v4 silently drops/overrides.)
- **Shell** (`src/components/app-*.tsx`): `AppShell` = `SidebarProvider` + navy `AppSidebar` (logo + role-gated
  nav via TanStack `Link`: Dashboard/Sheriff/Legal/Admin) + sticky `AppHeader` (sidebar toggle + breadcrumb +
  Clerk-wired `NavUser` dropdown), `variant="inset"` (white rounded content panel floating on navy). Wired into
  the router: `src/web/app.tsx` root route renders `AppShell` around `<Outlet/>`; wrapped in `TooltipProvider`.
- **Dashboard** (`src/components/dashboard.tsx`): fully rebuilt on real Convex data (`runs.dashboardStats` +
  `runs.listRuns`) — 4 stat cards, **pipeline-by-stage** grouped bar (Sheriff green vs Legal navy), **source**
  donut, **recent-runs** table with status badges. No fabricated deltas. Replaced the old mock dashboard + the
  efferd support-desk mock components (deleted).
- **Logo:** real IRES marks from the live site in `public/`: `ires-logo-onnavy.png` (navy bg — sidebar +
  sign-in), `ires-logo-dark.png` (light bg), `ires-icon.png` (square, collapsed sidebar).
- **Status:** committed on branch **`ui/shadcn-foundation`** (NOT merged; prod still serves the old UI).
  `npm run build` + `tsc` clean, 44 tests pass. Verified visually (headless screenshots): sign-in gate,
  dashboard, and Sheriff page inside the new shell (kept-page features intact — two-row header reads as
  intentional). The collapsed-sidebar icon was generated but not yet seen rendered.

## Sheriff "cushion" deal screen
`src/scraper/deal.ts` (`computeDeal`, unit-tested) turns a row into a deal: parse money, sale-type-aware
cost-to-clear (TAX: cost=principal; MTG/JUDG: principal+balances), cushion = Zestimate − cost, tier
(good/ok/thin/**verify**/bad/unknown), risk flags. Risk-flagged rows (tiny-principal junior-foreclosure traps)
are downgraded to "verify" so they never rank #1. `sheriffData.monthListings` returns rows+deal sorted
clean-deals-first. The Sheriff table is the buyer's screen: `#` · Cushion(color) · Property · Type · Size ·
Worth · Debt · Liens · Notes(dropdown) · Zillow · Deal; clickable column sort; split-button scrape menu
(scrape / retry-failed / force). Retries (`withRetry`) harden the parcel + Zillow scrapes against Reblaze blocks.
**UI uses lucide-react icons only — never emojis** (`~/.claude` memory `never-use-emojis`).

## Maps & Street View
Both pages have a **collapsible map panel** — an "Open map" button above the table (hidden by default; click
to show the Google map on top of the table, not a separate tab). Each property is a **Zillow-style price pill**
colored by deal quality (Sheriff = cushion tier; Legal = value bucket). Click a pin → InfoWindow with the
address, the **Zestimate** (Sheriff; the pill already shows the cushion, so the popup shows the worth instead),
size, a Street View thumbnail, a Zillow link, and an inline deal-status select. An **"Open Street View"** button
opens an interactive panorama (`StreetViewModal`, coverage-checked w/ fallback). The table also has a **Map
column**: clicking it opens the map focused on that exact row and auto-opens its Street View.
- Geocoding (address → stored `lat`/`lng`/`geocodeStatus`): pure DE-validated `src/scraper/geocode.ts` →
  `convex/geocodeActions.backfillGeocodes` (idempotent; auto-scheduled after each scrape + a manual
  "Geocode N missing" button) via `convex/geocodeData.ts`. **Verified live: 74/74 rows geocoded, 0 failed.**
- Library `@vis.gl/react-google-maps`. AdvancedMarkers need a Map ID (`VITE_GOOGLE_MAPS_MAP_ID`; falls back to
  `DEMO_MAP_ID` with a "development only" watermark). **ONE domain-restricted key serves both** the browser map
  (`VITE_GOOGLE_MAPS_API_KEY`) and server-side geocoding (`GOOGLE_GEOCODING_API_KEY` = same value) — a
  Website/referrer restriction is NOT enforced on the Geocoding web service (2026-06-02 lesson; supersedes the
  earlier "two keys" note). Enable on the key: Maps JS + Geocoding + Street View Static.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-06-01-google-maps-street-view*`.

## Flip Analyzer (deal-decision screen) — 2026-06-03
A new **additive** `/flip` page that turns a property into a **flip P&L** — the "should I flip this, and at what
max offer?" lens (distinct from the Sheriff *auction cushion* in `deal.ts`, which is `Zestimate(as-is) − cost-to-clear`).
Inputs: **ARV** (manual, pre-filled from the as-is Zestimate), **tiered rehab** (Cosmetic/Moderate/Gut $/sqft +
editable sqft + 10% contingency + manual override), purchase price, and an editable cost-stack (closing/financing/
holding/selling). Live outputs: **MAO (70% rule)**, profit, ROI, annualized ROI, margin, a good/ok/thin/bad **grade**
+ flags (over-70%-rule, thin-margin, negative-profit). Saved per analysis; runs on a Sheriff/Legal listing
(auto-filled read-only snapshot) **or** a manual address.
- **Code:** pure math `src/scraper/flip.ts` (`REHAB_TIERS`, `FLIP_DEFAULTS`, `estimateRehab`, `computeFlip`;
  unit-tested in `tests/flip.test.ts`, imported by BOTH the Convex query and the React page so the live preview ==
  saved metrics). New `flipAnalyses` table + `convex/flipData.ts` (queries/mutations, **read-only** on sheriff/legal).
  Page `src/web/FlipAnalyzer.tsx` (+ `/flip` route in `app.tsx`, nav item in `app-shared.tsx`). Property picker =
  shadcn **Popover+Command** combobox w/ autocomplete (added `popover`/`command`/`dialog` ui components).
- **Constraint honored:** purely additive — the Sheriff/Legal pages, their actions, and `deal.ts` are untouched
  (verified by `git diff`). Built subagent-driven + TDD; independently code-reviewed (APPROVED).
- **Docs:** `docs/superpowers/{specs,plans}/2026-06-03-flip-analyzer*`; research menu `memory/flip-decision-features.md`.
- **Shipped:** merged to `main`; **deployed to prod** (backend `npx convex deploy` to `pastel-crocodile-994`;
  frontend via Cloudflare on push). The **prod** Convex deploy key is in `.env.local` as `CONVEX_DEPLOY_KEY_PROD`
  (`CONVEX_DEPLOY_KEY` there is the **dev** key). UI polish (2026-06-03): removed the centered top-bar logo, full
  sidebar logo (replaced the cut `ires-icon.png` with `ires-logo-onnavy.png`, hidden when collapsed), Flip header
  blended to `bg-background`, searchable combobox. **[TODO: live smoke-test `/flip` on prod.]**
- **ARV from comps (2026-06-03, shipped):** a "Pull comps" button scrapes recent **Redfin** `sold-6mo` listings near
  the property (Firecrawl, on demand), parses them (`src/scraper/comps.ts`: `parseRedfinComps`/`selectComps`/
  `suggestArv`, +10 tests), computes a suggested ARV (median $/sqft × subject sqft), caches on the row, and **"Use
  as ARV"** pre-fills the ARV field (you adjust up for reno). New `convex/compsActions.ts` (`pullComps`, gated) +
  `flipAnalyses` comp fields + `flipData.getAnalysisInternal`/`storeComps`. Additive; reviewed (APPROVED). The
  comps/analyses are **shared-team** (any member acts on any analysis — same auth model as the other flipData
  mutations; the automated IDOR flag does not apply). Build-vs-buy: chose **scrape** over RentCast/ATTOM. Merged +
  pushed (CF `convex deploy --cmd` deploys backend+frontend). Docs: `docs/superpowers/{specs,plans}/2026-06-03-arv-from-comps*`.

## Properties / Portfolio (owned-asset management) — 2026-06-03
Manage houses IRES **owns** — separate from the scrapers (*find* deals) and the Flip Analyzer (*project* deals):
this tracks **actuals**. `/properties` (card grid, filter All/Flips/Rentals) + `/properties/$id` detail.
- **Data:** `properties` table (`dealType` flip|rental; `status` in_progress|sold|active|vacant; facts; purchase/
  sale; `source` provenance manual|sheriff|legal|flip; `imageUrl`/`imageStatus`; `zillowUrl`). `propertyLedger` —
  ONE unified table, `direction:expense|income`, date-stamped (rental income = a full ledger, not a fixed rent).
- **Math:** `src/scraper/portfolio.ts` (pure, tested) — `summarizeProperty`: flip invested→realized profit+ROI on
  sale; rental net cash flow; grades. Computed in the query, not stored.
- **Photo:** `extractImageUrl` in `zillow.ts` pulls a `photos.zillowstatic.com` listing photo (active listings);
  `convex/propertyActions.ts` `scrapePropertyImage` (scheduled on create + a Refresh button) **always scrapes the
  SEARCH URL** (homedetails 403s), and for **off-market** houses (the common case — no Zillow photo) falls back to
  a **Google Street View Static** URL built from the address with `GOOGLE_GEOCODING_API_KEY` (the one domain-
  restricted key; needs Street View Static enabled). Else placeholder + manual paste-URL.
- **Backend:** `convex/propertyData.ts` (queries/mutations, all `requireUser`; `deleteProperty` cascades ledger;
  `candidates` reads sheriff/legal/flip read-only for the seed picker). **Additive** — no change to existing pipelines.
- **Built** subagent-driven + TDD in an **isolated git worktree** (a parallel session shipped ARV-from-comps to
  `main` concurrently — see [[concurrent-agents-convex-isolation]] in auto-memory: use a worktree +
  `CONVEX_AGENT_MODE=anonymous`; the second merge regenerates `_generated`). 75 tests, build clean, final review
  READY TO MERGE. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-03-properties-portfolio*`. **Pending:** live
  prod smoke-test; confirm prod key has Street View Static enabled (else off-market photos = placeholder).

## Status (current — 2026-06-02) — LIVE IN PRODUCTION
- **Prod is live:** **https://crm.instantrealestatesolution.com** (Cloudflare Workers project
  `instant-real-estate-solution-crm`) on Convex **prod** `pastel-crocodile-994`. Clerk **production** instance
  wired; sign-in verified; owner admin `nazhossain16@gmail.com`; **invite-only** (restricted sign-up).
- **Shipped this session:** Clerk auth (dev+prod) + a full **admin user-management** feature (`users` table,
  invite/role/deactivate/delete, `getAuthUser`/`requireAdmin`, `requireUser` upgraded to reject
  non-provisioned/inactive callers). Merged to `main` + pushed; dev **secured** (`IRES_DEV` removed); 44 tests pass.
- **Cloudflare build fix:** `convex/_generated` is committed + a root **`wrangler.jsonc`** (serves `./dist` as an
  SPA), so `npx wrangler deploy` serves fresh builds. Backend deploys are **manual** `npx convex deploy`.
- **Post-launch punch list (see next-session-prompt.md):** finish the Maps-key rotation (new key → Cloudflare
  `VITE_GOOGLE_MAPS_API_KEY` + Convex `GOOGLE_GEOCODING_API_KEY` on prod+dev), create a real
  `VITE_GOOGLE_MAPS_MAP_ID` (kills the DEMO watermark), make `backfillGeocodes` surface hard errors, rotate the
  other chat-shared keys, e2e-test the invite flow on prod.

## Deployments & keys (reference — secrets live in dashboards/.env.local, NOT the repo)
- **Convex:** dev `fearless-donkey-585` · prod `pastel-crocodile-994` (project `instantrealestate`). CLI→prod:
  `CONVEX_DEPLOY_KEY='prod:pastel-crocodile-994|…' npx convex deploy|env set|run …` (key value in `.env.local`).
  `npx convex run` can invoke **internal** functions with the deploy key (e.g. `users:seedAdmin`, `geocodeActions:backfillGeocodes`).
- **Cloudflare:** Workers project `instant-real-estate-solution-crm` → `crm.instantrealestatesolution.com`. Build
  `npm run build`, deploy `npx wrangler deploy`, `wrangler.jsonc` (`name` MUST match the project). CF env:
  `CONVEX_DEPLOY_KEY`(prod), `VITE_CONVEX_URL=https://pastel-crocodile-994.convex.cloud`, `VITE_CLERK_PUBLISHABLE_KEY`(pk_live), `VITE_GOOGLE_MAPS_API_KEY`.
- **Clerk:** dev `optimal-frog-32.clerk.accounts.dev` · prod issuer `https://clerk.instantrealestatesolution.com`.
  JWT template `convex` (claims `{aud:convex, email, name}`) on BOTH. Convex env (both): `CLERK_JWT_ISSUER_DOMAIN`,
  `CLERK_SECRET_KEY` (sk_live on prod), `CLERK_INVITE_REDIRECT_URL`. Prod = restricted sign-up + email sign-up ON.
- **Google:** ONE domain-restricted Maps key serves BOTH the browser map AND server geocoding
  (`GOOGLE_GEOCODING_API_KEY` = same value as `VITE_GOOGLE_MAPS_API_KEY`). Enable: Maps JS + Geocoding + Street
  View Static (not Places/Directions). Website restrictions: prod domain + `http://localhost:5173/*`.
