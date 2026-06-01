# IRES CRM — Handoff (read me in the morning)

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
npm test             # 25 unit tests
npm run integration  # hits live Firecrawl: parses the real PDF + enriches a few listings
```

## Bring up the CRM (needs Docker)
Twenty is a server app (Postgres + Redis + Node), so it needs a Docker host — **not** Cloudflare
Workers. Local dev + the app build need Docker Desktop.

1. **Install Docker Desktop** (Windows: enables WSL2; may need a reboot + admin).
2. Follow `twenty-app/README.md`:
   - `npx create-twenty-app@latest ires-sheriff` (start the local instance on :2020)
   - copy in `twenty-app/application-config.ts`, `src/objects/*`, `src/logic-functions/*`, `src/scraper/*`
   - set `FIRECRAWL_API_KEY` as an app/workspace secret
   - `yarn twenty dev` (generates the typed client, syncs objects to the UI)
   - test: `yarn twenty dev:function:exec -n scrape-sheriff-sales -p '{"force": true}'`
   - watch listings appear and enrich live
3. Add a **Table** view + a **Kanban** view on `dealStatus`; wire the "Scrape Sheriff Sales This
   Week" button to POST `/s/sheriff/scrape`.

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
- Branding: IRES logo/wordmark/colors where Twenty supports theming.
- Legal Notices pipeline (same machinery + an LLM extraction step; OpenRouter/Anthropic key).
- Deal-pipeline reports (how many sales reviewed/contacted/offered per month).

## Key files
- `src/scraper/*` — the proven scraping core (source of truth).
- `twenty-app/*` — the Twenty app (objects, logic functions, app config).
- `docs/TWENTY-ARCHITECTURE.md` — current architecture.
- `docs/2026-06-01-ires-crm-automation-design.md` — original design (Convex sections superseded; data model/guardrails still apply).
- `tasks/todo.md` — phase checklist.
