---
name: monitor-web
description: Operate the "Monitor the Web" Zillow deal-finder — register/update the daily Firecrawl Monitor on the New Castle County new-listings search, trigger a manual scan, and inspect the keepers it found (deal score, best exit, spread). Use when the user says "run the web monitor", "scan Zillow for deals", "monitor zillow", "check the monitor", "set up the Firecrawl monitor", or wants the daily on-market deal scan.
---

# Monitor the Web (Zillow NCC deal-finder)

Daily on-market counterpart to the off-market `/leads` engine. A **Firecrawl Monitor** scrapes the
New Castle County (NCC) newest-listings Zillow search once a day at **8 PM ET**, POSTs to the Convex
webhook `https://<deployment>.convex.site/firecrawl-monitor`, and that triggers `runMonitorScan`:
diff new ZPIDs → per-listing detail scrape + comps → conservative-ARV multi-exit underwriting
(flip + rental) → DeepSeek text judge → keeper decision. Keepers surface on the **`/monitor`** page
(ranked by deal score) and in the daily email digest. A daily Convex cron is the safety net if the
webhook doesn't fire; an in-handler Redfin fallback covers a Zillow block. Spec:
`docs/superpowers/specs/2026-06-30-monitor-web-zillow-design.md`.

**Credit discipline:** the search index is 1 (rarely a few) pages/day at `proxy:enhanced` (~5 credits/page,
~40 listings/page); only brand-new / price-dropped ZPIDs get the (paid) per-listing detail scrape + comps.
Budget ~150-250 credits/day on the 100k/month key. `maxPages` bounds a manual scan's spend.

## 0. Preconditions
- Backend live on the target deployment: `monitorListings` + `monitorRuns` tables, `convex/http.ts`
  (`/firecrawl-monitor`), `convex/monitorData.ts`, `convex/monitorActions.ts`, the daily cron.
- Target = PROD by default. Set the deploy key in EVERY bash block (shell env does not persist):
  `export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"`.
- Env vars set on the deployment (see §4). `createFirecrawlMonitor` and `runMonitorScan` throw a clear
  `CONFIG` error when `FIRECRAWL_API_KEY` is unset — nothing runs key-less.

## 1. Create / update the Firecrawl Monitor (one-time setup)
Registers the daily Monitor with the NCC search URL + the Convex webhook + the signing secret. Idempotent
setup — re-run to update. Uses `CONVEX_SITE_URL` if the deployment has it set, else pass `siteUrl`
(the `*.convex.site` HTTP-actions domain, NOT `*.convex.cloud`).

```bash
cd <repo-or-worktree-root>
export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"
# CONVEX_SITE_URL is usually set on the deployment; if not, pass the site URL explicitly:
npx convex run monitorActions:createFirecrawlMonitor '{"siteUrl":"https://<deployment>.convex.site"}'
# → {"ok":true,"id":"..."}   (or {"ok":false,"error":"..."} on an HTTP/parse failure)
```
This POSTs `/v2/monitor` with: daily 8 PM `America/New_York` schedule · a `scrape` target on the NCC
newest-listings search (`buildSearchUrl({})`, `proxy:"enhanced"`) · webhook `<site>/firecrawl-monitor`
for `monitor.page` + `monitor.check.completed`, signed with `FIRECRAWL_WEBHOOK_SECRET` (the HMAC key
`convex/http.ts` verifies) · 30-day retention. The DeepSeek layer is our judge, so the Monitor's native
`goal`/`judge` is NOT used.

**CLI alternative** (equivalent, from the `firecrawl` skill) — create the Monitor by hand with the same
NCC search URL, webhook, and secret:
```bash
firecrawl monitor create \
  --url 'https://www.zillow.com/new-castle-county-de/?searchQueryState=...' \
  --schedule 'daily at 8:00 PM' --timezone 'America/New_York' \
  --proxy enhanced \
  --webhook 'https://<deployment>.convex.site/firecrawl-monitor' \
  --webhook-secret "$FIRECRAWL_WEBHOOK_SECRET"
```
(Prefer `createFirecrawlMonitor` — it bakes the exact NCC `searchQueryState` and body shape.)

## 2. Trigger a manual scan
Runs the SAME scan path the webhook/cron use (scrape → diff → upsert → staggered `analyzeOne` fan-out →
digest). `maxPages` bounds credit spend — start with 1 page (~40 listings, ~5 credits) for a smoke test.

```bash
cd <repo-or-worktree-root>
export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"
npx convex run monitorActions:runMonitorScan '{"trigger":"manual","maxPages":1}'
# → {"scanned":N,"newCount":N,"keeperCount":0}   (keepers fill in async via analyzeOne)
```
`analyzeOne` runs are staggered and slow (spaced Zillow retries + comps + DeepSeek), so `keeperCount`
is 0 at return — the rows and the run counters fill in over the following minutes. The CLI may report a
client-side timeout while the action completes server-side; verify via the run row / table (§3), not the
exit code. (Dev-only alternative when `IRES_DEV=1`: `npx convex run monitorActions:devMonitorScan '{"maxPages":1}'`.)

## 3. Inspect results
The table dump uses the deploy key (bypasses the auth-gated UI queries), so it works from the CLI:
```bash
cd <repo-or-worktree-root>
export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"
npx convex data monitorListings --format jsonl --limit 100   # status · keeper · dealScore · bestExit · spreadPct
npx convex data monitorRuns --format jsonl --limit 10         # trigger · scanned/new/keeper counts · status
```
Read the per-row fields: `status` (pending|analyzed|failed|skipped), `keeper`, `dealScore`, `bestExit`
(FLIP|RENTAL|WHOLESALE|PASS), `spreadPct`, `riskFlags`, `lastError`. The **`/monitor` page** is the
authed in-app surface (keepers first, run-summary header, Promote to Potential / Open in Flip Analyzer);
its `monitorData:latestRun` / `listKeepers` queries are `requireUser`-gated (no CLI read).

## 4. Env vars (on the target Convex deployment)
- `FIRECRAWL_API_KEY` — required; the 100k-credit/month Zillow key (`proxy:enhanced`). All scan/setup
  actions throw a `CONFIG` error without it.
- `OPENROUTER_API_KEY` — required for the DeepSeek judge. Without it the judge is skipped and only the
  deterministic keeper gate decides (no fabricated verdict).
- `MONITOR_LLM_MODEL` — optional, default `deepseek/deepseek-v3.2` (fallback `deepseek/deepseek-chat-v3-0324`).
- `FIRECRAWL_WEBHOOK_SECRET` — the HMAC-SHA256 signing secret; MUST match the value passed to the Monitor's
  webhook so `convex/http.ts` accepts the delivery. A missing/mismatched secret → the webhook 401s (the
  daily cron still covers the scan).
- `CONVEX_SITE_URL` — optional; the `*.convex.site` webhook host used by `createFirecrawlMonitor` when
  `siteUrl` isn't passed.
- Digest (optional, key-gated — the page works without them): `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_TO`,
  `PORTAL_BASE_URL`.

## 5. Tuning knobs
- **`MONITOR` config const** in `src/scraper/monitorListings.ts` — the deal thresholds and search box:
  `priceCeiling` (500000), `minListPrice` (1000), `spreadThreshold` (0.15 = below-market equity bar),
  `flipMarginBar` (0.12), `capRateBar` (0.06), `dozDays` ("7" days-on-Zillow), `sort` ("days"),
  `regionId`/`regionType`/`ncc_bounds` (the NCC search region). Edit here to retune the buy box without
  touching logic; the pure module is unit-tested, so re-run `npm test` after changing it.
- **`MONITOR_LLM_MODEL`** env — swap the judge model (e.g. to the `deepseek-chat-v3-0324` fallback).
- **`maxPages`** arg — how many search pages a manual scan pulls (credit ceiling for a run).

## Notes / guardrails
- ONE shared scan path for every trigger (webhook / cron / manual); the webhook only triggers a re-scrape
  (its payload is not trusted), the cron no-ops if a complete run finished in the last 20h.
- No fabrication: the DeepSeek verdict is sanitized server-side (tolerant parse; unparseable → visible
  `lastError`, `keep=false`), and the deterministic spread/flip/rental gates always still decide.
- Zillow prohibits scraping — keep the volume modest (1 search pull/day + new-only detail scrapes),
  internal use, Redfin fallback. Documented in the spec; flag to the client (not legal advice).
