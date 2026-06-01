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
- `src/scraper/*` — **runtime-agnostic scraping core** (Firecrawl client, sheriff parse, address clean,
  parcel, zillow, legalNotices, enrich — `enrichListing` takes an optional `onEvent` progress callback).
  Proven against live Firecrawl. Reused by the Convex actions.
- `convex/*` — `schema`, `sheriffData`/`sheriffActions`, `legalData`/`legalActions`, `runs` (run lifecycle +
  events + `latestRun`/`listEvents` queries), `crons`, `auth.config`, `helpers`. (`*Actions` are `"use node"`;
  `*Data` are V8 queries/mutations.)
- `src/web/*` — React app: `main` (Convex provider), `app` (router + IRES shell), `pages` (Dashboard,
  Sheriff Sales, Legal Notices), `ScrapeProgress` (live stepper).
- `src/components/ui/stepper.tsx` + `src/lib/utils.ts` (`cn`) — shadcn scaffolding (`@/` alias →
  `src`; shadcn semantic tokens added to `src/web/index.css` `@theme`).

## Sheriff "cushion" deal screen (session 3)
`src/scraper/deal.ts` (`computeDeal`, unit-tested) turns a row into a deal: parse money, sale-type-aware
cost-to-clear (TAX: cost=principal; MTG/JUDG: principal+balances), cushion = Zestimate − cost, tier
(good/ok/thin/**verify**/bad/unknown), risk flags. Risk-flagged rows (tiny-principal junior-foreclosure traps)
are downgraded to "verify" so they never rank #1. `sheriffData.monthListings` returns rows+deal sorted
clean-deals-first. The Sheriff table is the buyer's screen: `#` · Cushion(color) · Property · Type · Size ·
Worth · Debt · Liens · Notes(dropdown) · Zillow · Deal; clickable column sort; split-button scrape menu
(scrape / retry-failed / force). Retries (`withRetry`) harden the parcel + Zillow scrapes against Reblaze blocks.
**UI uses lucide-react icons only — never emojis** (`~/.claude` memory `never-use-emojis`).

## Status (2026-06-01, session 4)
Both pipelines proven **live end-to-end on the real Convex dev deployment** `fearless-donkey-585`
(project `instantrealestate`). **Sheriff Sales** has the full deal screen (cushion/tiers/sort/retry/icons,
monthly tabs, live progress). **Legal Notices is now at parity** (session 4): weekly tabs (`legalWeeks`),
value-sorted table (`weekNotices` — sorted by Zestimate, NO cushion since legal has no foreclosure debt),
`retryFailed`, `enrichLegalOne` runId refactor, shared split scrape button (`ScrapeMenu`) + generalized
`PeriodTabs`. Frontend builds (tsc+vite) + 39 tests pass; live `legalWeeks`/`weekNotices` verified.
**Work not yet committed.** One open item: visual eyeball of both pages in `npm run dev` (shared Sheriff
components were refactored — tsc-clean but pixels unseen). Clerk + Cloudflare + prod deploy still remain.
