# IRES CRM — Handoff (read me in the morning)

## ⚠️ Status & caveats (read first — honest framing)
- **Scraping core = PROVEN.** Ported, unit-tested (27 tests), and verified end-to-end against
  **live Firecrawl** (real PDF → 53 listings → real parcel + Zillow enrichment). This is solid.
- **`saleMonth` gate = FIXED + tested.** `saleMonth` is now derived from the PDF header
  (`Gross List 06/09/2026 …` → "June 2026"), NOT from today's date. This is what the scheduler +
  idempotency key on, so a scheduled run before the county publishes the new month won't mislabel
  rows or falsely mark a month "done." (Earlier draft had this bug; fixed.)
- **Twenty app = TYPECHECKS against the real SDK + passes Twenty's own `dev:typecheck` (offline).**
  I installed `twenty-sdk`/`twenty-client-sdk` v2.8.0 and ran both `tsc` and `npx twenty dev:typecheck`
  → **"✓ No type errors found."** This caught and fixed two real bugs (wrong `twenty-sdk/command`
  import path → `twenty-sdk/front-component`; a field-manifest type-widening issue in the object).
  Objects, both logic functions, the button (front component + command), table view, sidebar nav, and
  app config all validate against the actual SDK types. **Still pending (Docker-gated):** the *strict*
  `CoreApiClient` is generated from the live workspace schema at `yarn twenty dev:build`/`dev`, which
  gives the exact mutation field names their final check; and the runtime + in-CRM end-to-end test
  need the server running. It's validated code, not yet a running app.
- **Fan-out concurrency = OPERATIONAL RISK, not yet validated.** `enrich-sheriff-listing` triggers on
  `sheriffSaleListing.created`, so ~53 enrichments fire near-simultaneously. Our own lessons note the
  NCC parcel site rate-limits after ~3 rapid requests; going through Firecrawl's cloud changes the IP
  but leans on Firecrawl's concurrency limits with **no throttle**. At scale this could produce mass
  `SCRAPE FAILED`. Add a queue/concurrency cap (Twenty worker config) or stagger enrichment before
  relying on it in production.

## TL;DR of where things stand
- ✅ **Automation works locally, proven against live Firecrawl.** The full Sheriff Sales
  pipeline (PDF → parse → address clean → parcel + Zillow enrichment) is ported to TypeScript,
  unit-tested (25 tests), and verified end-to-end (53 listings parsed, 3/3 enriched with real data).
- ✅ **Twenty app source written** (objects + logic functions + button + fan-out enrichment),
  reusing that core. Not yet compiled — needs Docker (below).
- ⏭️ **Foundation decision:** self-hosted **Twenty** (free, open source) under
  `crm.instantrealestatesolution.com`, automation as native Twenty logic functions.
  **Twenty Cloud (paid) is not used.**

## 🔒 Do this first
- **Rotate the OpenRouter key** you pasted (`sk-or-v1-…`) — it was shared in plaintext. It's only
  needed for the future Legal Notices LLM step, not Sheriff Sales.
- Secrets are stored only in `.env.local` (gitignored). The Firecrawl key powers the automation.

## Verify the automation yourself right now (no Docker needed)
```bash
cd C:\Users\nazho\Desktop\ires-crm
npm install          # if needed
npm test             # 27 unit tests
npm run integration  # hits live Firecrawl: parses the real PDF + enriches a few listings
```

## Bring up the CRM (needs Docker)
Twenty is a server app (Postgres + Redis + Node), so it needs a Docker host — **not** Cloudflare
Workers. Local dev + the app build need Docker Desktop.

1. **Install Docker Desktop** (Windows: enables WSL2; may need a reboot + admin).
2. Follow `twenty-app/README.md`:
   - `npx create-twenty-app@latest ires-sheriff` (start the local instance on :2020)
   - copy in the whole `twenty-app/` tree: `application-config.ts`, `public/*`, and `src/*`
     (`objects`, `logic-functions`, `front-components`, `command-menu-items`, `views`,
     `navigation-menu-items`, `shared`, `scraper`)
   - set `FIRECRAWL_API_KEY` as an app/workspace secret
   - `yarn twenty dev` (generates the typed client, syncs objects + UI to the workspace)
   - test: `yarn twenty dev:function:exec -n scrape-sheriff-sales -p '{"force": true}'`
   - watch listings appear and enrich live; the **"Scrape Sheriff Sales This Week"** quick-action
     button, the table view, and the sidebar entry are already coded and should appear in the UI
3. Add a **Kanban** pipeline view grouped by `dealStatus` (1-click in the UI), and set the
   workspace logo/name/theme in Settings (upload `public/wordmark.svg`). See `twenty-app/BRANDING.md`.

## Self-host for production (free, your subdomain)
1. **Host:** a server you own, **Oracle Cloud Always-Free** ARM VM (free), or a ~$5/mo VPS.
2. Deploy Twenty via **Docker Compose** (Twenty docs → Self-host → Docker Compose): app + worker +
   PostgreSQL + Redis.
3. **DNS/TLS via Cloudflare:** point `crm.instantrealestatesolution.com` at the server; Cloudflare
   proxy + free TLS in front. (Use a reverse proxy like Caddy/Traefik on the origin for certs if
   not terminating at Cloudflare.)
4. Install the IRES Sheriff Sales app to the production workspace (`npx twenty app:publish`), set the
   `FIRECRAWL_API_KEY` secret there, and confirm the weekday cron is active.

## What I'd tackle next (after you've got Twenty up)
- Validate/adjust the `CoreApiClient` mutation selection-sets against the generated client.
- Throttle the fan-out enrichment (see concurrency caveat above).
- Kanban pipeline view + workspace branding (logo/wordmark/colors are coded — apply theme in Settings).
- Legal Notices pipeline (same machinery + an LLM extraction step; OpenRouter/Anthropic key).
- Deal-pipeline reports (how many sales reviewed/contacted/offered per month).

## Key files
- `src/scraper/*` — the proven scraping core (source of truth).
- `twenty-app/*` — the Twenty app (objects, logic functions, app config).
- `docs/TWENTY-ARCHITECTURE.md` — current architecture.
- `docs/2026-06-01-ires-crm-automation-design.md` — original design (Convex sections superseded; data model/guardrails still apply).
- `tasks/todo.md` — phase checklist.
