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
  `DEMO_MAP_ID` in dev). **Two keys by design:** a referrer-restricted **browser** key (`VITE_GOOGLE_MAPS_API_KEY`,
  Maps JS + Street View Static) and a Geocoding-only **server** key (`GOOGLE_GEOCODING_API_KEY`, Convex env).
  Spec/plan: `docs/superpowers/{specs,plans}/2026-06-01-google-maps-street-view*`.

## Status (current — 2026-06-01)
- **Repo is on GitHub** (`origin` = Naz-Projects/InstantRealEstateSolutionCRM) and **Cloudflare builds the
  frontend from it via CI** (`convex/_generated` is committed so CI can typecheck without the Convex CLI — see lessons).
- Both pipelines + deal screens + maps run **live on the Convex dev deployment `fearless-donkey-585`**
  (project `instantrealestate`). 44 tests pass; tsc+vite build clean.
- **Pending:** (1) browser eyeball of the map/Street View; (2) **security** — split the single Google key into a
  referrer-restricted browser key + a Geocoding-only server key, then rotate (it was shared in chat); (3) Clerk
  auth (remove `IRES_DEV`) → Convex **prod** deploy → Cloudflare prod env vars (`VITE_CONVEX_URL`,
  `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`, `VITE_CLERK_PUBLISHABLE_KEY`). See `next-session-prompt.md`.
