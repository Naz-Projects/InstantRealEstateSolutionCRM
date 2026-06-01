# IRES CRM — Build Plan

**Foundation (decided):** self-hosted **Twenty** (open-source CRM) under `crm.instantrealestatesolution.com`, free.
Sheriff Sales automation = **native Twenty logic function** (cron/HTTP) reusing the runtime-agnostic TS scraping core.
Twenty Cloud (paid) is NOT used. Twenty needs a Docker host (own server / Oracle free tier) — not Cloudflare Workers.

## Phase 1 — Scraping core (DONE ✓ — foundation-agnostic, proven vs live Firecrawl)
- [x] Port firecrawl client, sheriff PDF parser, address cleaner, parcel parser, Zillow extractor, per-listing enricher to TS (`src/scraper/*`)
- [x] 27 unit tests pass (address/sheriff/parcel/zillow edge cases + PDF-derived saleMonth)
- [x] typecheck clean
- [x] Live integration test: 53 listings parsed, 3/3 enriched with real parcel + Zillow data, 0 errors
- [x] FIX: saleMonth derived from PDF "Gross List MM/DD/YYYY" header, not today's date (gate correctness)

## Phase 2 — Twenty SDK research (DONE ✓) · Phase 5 security review (DONE ✓ — clean)
- [x] Documented logic-functions, objects, triggers, CoreApiClient, secrets from official docs
- [x] Security agent review of new code: no high-confidence vulnerabilities

## Phase 2 — Twenty SDK research
- [ ] Scrape Twenty docs: logic functions API (define, triggers cron/HTTP/db-event), how to read/write objects from a function, secrets/env, front components, skills/agents
- [ ] Confirm self-host supports custom apps + logic functions (open-source parity)

## Phase 3 — Twenty app (WRITTEN to SDK spec ✓ — compile/run needs Docker)
- [~] `create-twenty-app` scaffold (USER: run tomorrow w/ Docker — drop these files in)
- [x] `SheriffSaleListing` object (all fields + dealStatus pipeline + exported field UIDs)
- [x] `ScrapeRun` object (run tracking)
- [x] Logic function: scrape-sheriff-sales (cron + HTTP button + AI tool, idempotent)
- [x] Logic function: enrich-sheriff-listing (DB-event fan-out, reuses src/scraper/enrich)
- [x] Front component: "Scrape Sheriff Sales This Week" button (headless + CommandModal) + pinned command-menu item
- [x] View: default table (wholesaler columns) + sidebar nav item  [Kanban-by-dealStatus = 1-click in UI / add via groups]
- [x] Idempotency guard (skip already-scraped month unless force)
- [ ] (Optional) AI skill/agent over the listings

## Phase 4 — Branding
- [x] IRES logo.svg + wordmark.svg + palette tokens (BRANDING.md); logoUrl wired in app manifest
- [~] Workspace logo/name/theme = one-click admin action in Twenty Settings (after workspace is up)

## Phase 5 — Test, review, security
- [ ] Local Twenty via Docker (USER: install Docker Desktop) → `yarn twenty dev` → trigger run → verify rows populate/enrich
- [ ] security-review skill on the app code
- [ ] advisor + agent review; fix findings

## Phase 6 — Handoff & deploy
- [ ] HANDOFF.md: install Docker, run local Twenty, sync app, then self-host deploy (Docker Compose on server) under crm.instantrealestatesolution.com via Cloudflare DNS/TLS
- [ ] Set FIRECRAWL_API_KEY as a Twenty/app secret in production
- [ ] Final commit

## DONE WHEN
Automation proven locally (✓ done at the core level); Twenty app code complete + correct per SDK; handoff + deploy guide written; security review clean. Full in-Twenty test happens once Docker is installed.
