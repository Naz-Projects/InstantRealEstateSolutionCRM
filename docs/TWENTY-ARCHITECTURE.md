# IRES CRM on Twenty — Architecture (current target)

**Foundation:** self-hosted **Twenty** (open-source CRM) under `crm.instantrealestatesolution.com`.
Free. Fully owned. The Sheriff Sales automation runs as **native Twenty logic functions**.

## Why Twenty (recap)
- #1 open-source CRM (48.8k★), production-grade, Notion-like UI.
- Gives us for free: auth, roles/permissions, custom objects, Table/Kanban views, CSV import,
  REST/GraphQL API, **native MCP server** (Claude/ChatGPT read+write the CRM), workflow engine.
- Extensible in TypeScript: objects, **logic functions** (server-side TS on cron/HTTP/DB-event),
  front components, AI skills/agents.
- **Twenty Cloud is the makers' paid managed hosting — we do NOT use it.** We self-host the
  identical free open-source software.

## Data flow

```
                 ┌──────────────────── Twenty (self-hosted, Docker) ────────────────────┐
 weekday cron ──▶│ scrape-sheriff-sales (logic fn)                                       │
 "Scrape" button │   Firecrawl: scrape NCC PDF → parse table → clean addresses           │
   POST /s/…  ──▶│   create ScrapeRun + N SheriffSaleListing records (status PENDING)     │
 AI/MCP tool  ──▶│                         │                                             │
                 │                         ▼  (each create fires a DB-event trigger)      │
                 │ enrich-sheriff-listing (logic fn, one per record = fan-out)            │
                 │   Firecrawl: NCC parcel lookup + Zillow → update record (ENRICHED)     │
                 │                         │                                             │
                 │   Table + Kanban views ◀┘  (reactive — fills in live)                  │
                 │   dealStatus pipeline: New → Reviewing → Contacted → Offer → Dead       │
                 └──────────────────────────────────────────────────────────────────────┘
                                           │ fetch()
                                           ▼
                                     Firecrawl cloud  (PDF · parcel browser-actions · Zillow)
```

## Components
- **Objects:** `sheriffSaleListing` (scraped+enriched fields + `dealStatus` + `notes`), `scrapeRun` (tracking).
- **scrape-sheriff-sales:** triggers = cron (weekday 11:00 UTC ≈ 7am ET) + HTTP route `/s/sheriff/scrape` (the button) + AI tool. Idempotent (skips an already-scraped month unless `force`).
- **enrich-sheriff-listing:** trigger = `sheriffSaleListing.created`. Independent unit per listing (~15-20s), so no long job / timeout cliff; the table fills in live.
- **Scraping core** (`twenty-app/src/scraper/*`): runtime-agnostic TS, proven against live Firecrawl. The Firecrawl key is read from `process.env.FIRECRAWL_API_KEY` (an app/workspace secret).

## Hosting model (important)
Twenty is a **stateful server app** (NestJS + PostgreSQL + Redis + BullMQ worker), run via
**Docker Compose**. It **cannot** run on Cloudflare Workers/Pages like the Convex/Clerk/TanStack
CRMs (BlueRock/Peak Web/Yachts Direct). It needs a Docker host:
- A server you own, or **Oracle Cloud Always-Free** ARM tier (free, ample), or a ~$5/mo VPS.
- Cloudflare still fronts it: DNS + proxy + free TLS, `crm.instantrealestatesolution.com` → origin.

## Security posture
- Firecrawl key is a server-side secret (never in the browser); logic functions read it from env.
- All scraping targets are **public** county/Zillow data — no credentials, no logins.
- Twenty handles auth (Clerk-equivalent built in), roles, and field/row permissions.
- HTTP-route trigger uses `isAuthRequired: true` so only authenticated workspace users can fire scrapes.
