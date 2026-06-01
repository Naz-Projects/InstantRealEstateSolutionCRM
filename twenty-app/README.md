# IRES Sheriff Sales — Twenty App (draft source)

This folder holds the **Twenty app** source: custom objects + logic functions that
turn a self-hosted Twenty instance into the IRES Sheriff Sales CRM. It reuses the
proven scraping core in `src/scraper/` (a copy of the repo-root `../src/scraper`,
verified end-to-end against live Firecrawl).

> **Status:** written to the Twenty SDK spec from the official docs, but **not yet
> compiled** — that requires a running Twenty server (Docker) so the CLI can
> generate the typed `CoreApiClient`. Treat the `client.mutation/query` selection-sets
> as drafts to confirm at `yarn twenty dev`.

## What's here

```
application-config.ts                         app manifest (defineApplication)
src/objects/sheriff-sale-listing.object.ts    the main record type (+ dealStatus pipeline)
src/objects/scrape-run.object.ts              run history / tracking
src/logic-functions/scrape-sheriff-sales…     cron + button (/s/sheriff/scrape) + AI tool
src/logic-functions/enrich-sheriff-listing…   db-event fan-out: enrich each new listing
src/scraper/*                                 proven Firecrawl pipeline (PDF, parcel, Zillow)
```

## How to bring it up (tomorrow, once Docker is installed)

1. **Install Docker Desktop** and start it.
2. Scaffold a Twenty app and run a local server:
   ```bash
   npx create-twenty-app@latest ires-sheriff
   # choose "Yes" to start a local Twenty instance (pulls the dev image on port 2020)
   ```
3. **Copy these files** into the scaffold (overwriting `application-config.ts`,
   adding `src/objects/*`, `src/logic-functions/*`, `src/scraper/*`).
4. Set the Firecrawl key as an app secret/env var so `process.env.FIRECRAWL_API_KEY`
   resolves inside the logic functions (see Twenty docs → Config; or workspace env).
5. Sync + generate the typed client:
   ```bash
   yarn twenty dev
   ```
   Fix any `CoreApiClient` selection-set mismatches the generator flags (mutation
   names / arg shapes). Objects appear in the UI under your app.
6. **Test the scrape:**
   ```bash
   yarn twenty dev:function:exec -n scrape-sheriff-sales -p '{"force": true}'
   yarn twenty dev:function:logs
   ```
   Watch `sheriffSaleListing` records appear, then enrich live (owner/assessment/Zillow).
7. Add a **Kanban view** on `dealStatus` and a **Table view** for the listings; wire
   the "Scrape Sheriff Sales This Week" button as a record/page action or workflow
   that POSTs to `/s/sheriff/scrape`.

## Known items to validate / tune

- **Function timeout:** per-listing enrichment is ~15-20s; `timeoutSeconds: 120` is set.
  If your deployment caps it lower, split parcel/Zillow into two chained functions.
- **Fan-out concurrency:** ~50 listings → ~50 enrichment invocations. Mind Firecrawl
  concurrency; throttle via the queue if needed.
- **Mutation shapes:** `create*/update*` arg shapes are confirmed by the generated client.
- **Legal Notices** is a fast-follow: same pattern, add an LLM extraction step.
