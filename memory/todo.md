# IRES CRM — Todo & Ideas

Track what's built and what's still ahead. `[x]` done · `[ ]` planned · `[~]` blocked on the user.

## ✅ Built & verified
- [x] Scraping core (`src/scraper/*`) — Firecrawl client, sheriff PDF parse, address cleaning, NCC parcel lookup, Zillow extract, Legal Notices LLM extraction, per-listing enrich. Runtime-agnostic TS.
- [x] Proven LIVE: Sheriff Sales (53 listings parsed; parcel + Zillow enrichment) and Legal Notices (21 estate listings via OpenRouter). 31 unit/integration tests pass.
- [x] Convex backend: schema (`scrapeRuns`, `sheriffListings`, `legalNotices` + dealStatus), scrape + fan-out enrich actions (reuse the core), run tracking, weekday/weekly cron, Clerk auth config, `IRES_DEV` dev bypass.
- [x] Deployed to the real Convex **dev** deployment `fearless-donkey-585`; **e2e tested there** — both pipelines: scrape → DB rows → enriched (owner/assessment/Zillow), 3/3 each.
- [x] Frontend: Vite + React + TanStack Router + Tailwind + Convex client, IRES branding. Dashboard (pipeline funnels + recent runs), Sheriff Sales + Legal Notices pages with scrape buttons, live tables, deal-status pipeline. Typechecks, builds, serves against live backend.

## ~ Blocked on user (the morning setup — see next-session-prompt.md)
- [~] Clerk: publishable key, `ConvexProviderWithClerk`, real `CLERK_JWT_ISSUER_DOMAIN`, sign-in gate, **remove `IRES_DEV`**.
- [~] Convex prod deploy (`npx convex deploy`, prod key) + prod env vars.
- [~] Cloudflare deploy of `dist/` + point `crm.instantrealestatesolution.com`.
- [~] Rotate all API/deploy keys shared in chat.

## [ ] Next features (near-term)
- [ ] **Kanban deal-pipeline board** (drag listings across new→reviewing→contacted→offer→dead).
- [ ] **Dashboard charts** — deals per stage per month, total equity in pipeline, run history trend.
- [ ] **"Force re-scrape"** toggle in the UI (calls `startScrape({force:true})`).
- [ ] **AI "Deal Analyst"** — chat/agent over the listings (rank by equity vs. liens). LLM via OpenRouter; surface in-app and/or via an MCP-style endpoint.
- [ ] Per-listing **notes + activity log** (calls, offers, status changes with timestamps).
- [ ] **Fan-out throttling** at scale — bound concurrent enrichment (Convex workpool/scheduler stagger) so ~50+ listings don't trip Firecrawl/NCC rate limits.

## [ ] Future / bigger ideas
- [ ] **Contacts & relations** — owners/defendants as records, skip-tracing, link to listings; full CRM relations.
- [ ] **Notifications** — email/SMS when a new high-equity or low-lien deal lands.
- [ ] **CSV / sheet export** (parity with the old Google-Sheets output; optional dual-write during cutover).
- [ ] **Map view** of listings (Mapbox/Leaflet).
- [ ] **Cross-run dedup** — flag a property that recurs across months.
- [ ] **Multi-county / multi-source** expansion beyond New Castle County.
- [ ] **Email parsing** of the old workflow's report emails, if still needed.

## Notes
- A legacy `tasks/` dir and `docs/` design files exist from earlier phases; `memory/` is the source of truth going forward.
- Twenty app source is archived in `docs/twenty-app-archived/` (UI reference only — not used).
