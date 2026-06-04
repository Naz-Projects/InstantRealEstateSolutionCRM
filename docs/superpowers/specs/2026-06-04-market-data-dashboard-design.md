# Market Data Dashboard — Design Spec

_Date: 2026-06-04. Status: proposed design, pre-implementation (awaiting user approval)._
_Research basis: this session's web research — FRED API (free), Redfin Data Center, Zillow Research; see Sources at the bottom._

## Goal
Add **live public market data** to the Dashboard so the team always sees current context without leaving the CRM:
the **mortgage rate**, the **Fed funds rate**, **how many houses are on the market in each Delaware county**
(New Castle / Kent / Sussex), and basic **market temperature** (days on market, median list price, price cuts).
The numbers **refresh themselves on a schedule** — nobody clicks anything.

This is an *additive* feature: a new table, a new fetch action, a new monthly cron, and new Dashboard widgets.
It does **not** touch the Sheriff / Legal / Flip / Properties pipelines, their tables, queries, or pages.

## What the user asked for (this session)
1. "How many houses are on the market right now" — Wilmington / Newark / New Castle County / county-by-county, **Delaware only**.
2. Other data a real-estate company watches — an interest-rate widget, market news, etc. (researched below).
3. "How can we pull these **automatically** so it's always the latest" + "an **API** to get this number **every month or so**, just something useful in the dashboard."

→ The headline answer is **FRED** (St. Louis Fed). It publishes Delaware housing data **per county** and the live
mortgage rate as a clean, free JSON API — a perfect fit for the CRM's existing `cron → action → store → reactive UI`
pattern (same wiring as the scrape buttons).

## Phasing (decided with the user: build in this order)
- **v1 (this spec) = FRED only.** One source, one action, one cron. Delivers rates + DE county inventory + market
  temperature. 100% free, most reliable to automate, no scraping. **This is what we build now.**
- **v2 (separate spec later) = the genuine FRED gaps** — median **sale** price, sale-to-list %, % price drops, and
  **city-level Wilmington / Newark** (FRED's Realtor.com series are county/state only), plus **ZORI rent** for the
  rental side. Source: page-scrape the Redfin **county/city market page** via Firecrawl — the exact pattern
  `src/scraper/comps.ts` already uses for Redfin — **not** the 100MB+ bulk TSV (that won't fit a serverless action).

Phasing this way means the headline asks ship without being blocked on the bulk-file question, and matches CLAUDE.md's
simplicity rule.

## Why FRED, and the freshness caveat (honest)
FRED's county series come from a monthly Realtor.com release and **update on different cadences** — some lag.
From this session's research:
- **Fresh:** `ACTLISCOU10003` (New Castle active listings) → Jan 2026; `MEDDAYONMARDE` (DE median days on market) → Apr 2026; `MORTGAGE30US` / `FEDFUNDS` (always current).
- **Possibly lagging:** county-level new-listing / total-listing / median-listing-price derivatives (some snapshots ended 2024–2025).

Design consequence — **the feature is freshness-honest, not freshness-blind:**
1. The action stores each series' **real latest-observation date**, and the UI shows **"as of {date}"** under every number.
2. v1's **confirmed-fresh core** (rates + per-county active listings + DE days-on-market) always shows.
3. "Market-temperature extras" (new listings, median list price, price-reduced share) are fetched too, but **each is
   shown only if its latest observation is within a freshness window** (e.g. ≤ 100 days old); otherwise it's hidden,
   never shown stale. The first live run against the dev deployment tells us the real dates (this sandbox has no network),
   and we keep whatever is fresh.

> Note: I could not curl FRED from this machine (sandbox blocks outbound HTTP). The Convex action runs in Convex's
> cloud, which **does** have network — so the live fetch works there. The pure parser is unit-tested against fixtures.

## FRED access method
Use the **official FRED API** (documented, JSON, free): `GET https://api.stlouisfed.org/fred/series/observations`
with `series_id`, `api_key`, `file_type=json`, `sort_order=desc`, `limit=25`. One free, instant key
(`FRED_API_KEY`, a 32-char string) goes into **Convex env, dev + prod** (mirrors how Firecrawl/OpenRouter keys are set).
The parser also accepts FRED's **no-key `fredgraph.csv?id=…`** download as a graceful fallback if the key is ever
missing (CSV is trivial to parse), but the keyed JSON API is the primary, ToS-clean path.

---

## Architecture (files)
```
NEW   src/scraper/fred.ts          pure: SERIES catalog + parseFredJson()/parseFredCsv() + pickLatest()/deltas()/isFresh()
NEW   tests/fred.test.ts           unit tests over real FRED-shaped fixtures (no network)
NEW   convex/marketData.ts         V8: upsertMetric (internalMutation) + dashboardMetrics (public query, requireUser)
NEW   convex/marketActions.ts      "use node": refreshMarketData — fetch each series from FRED, upsert
NEW   src/components/market-widgets.tsx   Dashboard market section (reads api.marketData.dashboardMetrics)
EDIT  convex/schema.ts             ADD marketMetrics table (existing tables unchanged)
EDIT  convex/crons.ts              ADD monthly cron → internal.marketActions.refreshMarketData
EDIT  src/components/dashboard.tsx ADD <MarketWidgets/> section (existing cards/charts unchanged)
```
`fred.ts` is a pure module (like `deal.ts`/`flip.ts`), safe to import from both the Convex action and tests.
Pattern split honored (lessons): V8 query/mutation in `marketData.ts`, `"use node"` fetch in `marketActions.ts`.

## Data model — new `marketMetrics` table
One document **per series**, upserted each run (clean replace of the snapshot — same idempotency philosophy as the
scrapers). Stores latest + a short history for a sparkline and MoM/YoY deltas — no row-per-observation table needed.
```ts
marketMetrics: defineTable({
  metric: v.string(),        // our stable key, e.g. "mortgage30", "activeListings", grouped in the UI
  seriesId: v.string(),      // FRED id, e.g. "ACTLISCOU10003"
  region: v.string(),        // "US" | "Delaware" | "New Castle" | "Kent" | "Sussex"
  group: v.union(            // which dashboard widget it feeds
    v.literal("rates"), v.literal("inventory"), v.literal("temperature")),
  label: v.string(),         // display label, e.g. "30-yr fixed mortgage"
  unit: v.union(             // formatting hint
    v.literal("percent"), v.literal("usd"), v.literal("count"), v.literal("days")),
  latestDate: v.string(),    // "YYYY-MM-DD" of the latest observation (drives "as of …")
  latestValue: v.number(),
  priorValue: v.optional(v.number()),    // previous observation → MoM/WoW delta
  yearAgoValue: v.optional(v.number()),  // ~12 monthly obs back → YoY delta (when available)
  history: v.array(v.object({ date: v.string(), value: v.number() })), // last ~24 (oldest→newest) for sparkline
  source: v.string(),        // attribution, e.g. "FRED · Freddie Mac PMMS" / "FRED · Realtor.com"
  fetchedAt: v.number(),     // Date.now() of this refresh
}).index("by_metric", ["metric"])
```

## `src/scraper/fred.ts` — pure core (the testable heart)
```ts
// Catalog: stable key → how to fetch + label it. v1 list (extras flagged "verify on first live run").
export const FRED_SERIES = [
  // rates (confirmed fresh)
  { metric:"mortgage30", seriesId:"MORTGAGE30US", region:"US", group:"rates",
    label:"30-yr fixed mortgage", unit:"percent", source:"FRED · Freddie Mac PMMS" },
  { metric:"fedFunds",  seriesId:"FEDFUNDS",     region:"US", group:"rates",
    label:"Fed funds rate", unit:"percent", source:"FRED · Federal Reserve" },
  // inventory — "how many houses are on the market", county-by-county (confirmed fresh)
  { metric:"activeListings", seriesId:"ACTLISCOU10003", region:"New Castle", group:"inventory",
    label:"Active listings", unit:"count", source:"FRED · Realtor.com" },
  { metric:"activeListings", seriesId:"ACTLISCOU10001", region:"Kent",       group:"inventory", label:"Active listings", unit:"count", source:"FRED · Realtor.com" },
  { metric:"activeListings", seriesId:"ACTLISCOU10005", region:"Sussex",     group:"inventory", label:"Active listings", unit:"count", source:"FRED · Realtor.com" },
  { metric:"activeListings", seriesId:"ACTLISCOUDE",     region:"Delaware",  group:"inventory", label:"Active listings", unit:"count", source:"FRED · Realtor.com" },
  // market temperature (confirmed-fresh DE state + verify-on-first-run extras)
  { metric:"daysOnMarket",  seriesId:"MEDDAYONMARDE", region:"Delaware", group:"temperature",
    label:"Median days on market", unit:"days", source:"FRED · Realtor.com" },
  { metric:"medListPrice",  seriesId:"MEDLISPRIDE",   region:"Delaware", group:"temperature",
    label:"Median list price", unit:"usd", source:"FRED · Realtor.com" },           // verify freshness
  { metric:"priceReduced",  seriesId:"PRIREDCOUDE",   region:"Delaware", group:"temperature",
    label:"Listings with price cuts", unit:"count", source:"FRED · Realtor.com" },  // verify freshness
];

parseFredJson(body): { date:string, value:number }[]   // FRED JSON → observations, drop "." (missing) values, oldest→newest
parseFredCsv(text):  { date:string, value:number }[]   // no-key fredgraph.csv fallback, same shape
pickLatest(obs):     { latestDate, latestValue, priorValue, yearAgoValue, history }  // history = last 24
isFresh(date, maxDays): boolean                          // for the temperature extras gate
```
All pure, null-safe (FRED uses `"."` for missing — never produce NaN), no Convex/Node imports.

## Convex `convex/marketData.ts` (V8)
- `upsertMetric` (**internalMutation**) — given a parsed metric doc, find by `metric`+`seriesId`+`region` and patch,
  else insert. Called by the action.
- `dashboardMetrics` (**query, `requireUser`**) — returns the metrics grouped for the UI:
  `{ rates: [...], inventoryByCounty: [...], temperature: [...fresh only...] }`, each item carrying
  `latestValue, latestDate, deltas, unit, label, region, history, source`. Hides any `temperature` item whose
  `latestDate` fails `isFresh`. No writes.

## Convex `convex/marketActions.ts` (`"use node"`)
- `refreshMarketData` (**internalAction**, explicit `Promise<...>` return type per the circular-inference lesson):
  for each entry in `FRED_SERIES`, fetch `…/fred/series/observations?series_id=&api_key=&file_type=json&sort_order=desc&limit=25`
  (fallback to `fredgraph.csv?id=` if `FRED_API_KEY` unset), parse, `pickLatest`, and
  `ctx.runMutation(internal.marketData.upsertMetric, …)`. Tolerant: one series failing (404/empty) is logged and
  skipped, never aborts the rest. Idempotent: re-running just refreshes the snapshots. Reads `FRED_API_KEY` from env.
- An optional `runMarketRefresh` public mutation behind `requireUser` can power a manual **"Refresh market data"**
  button later (mirrors the scrape buttons) — **out of scope for v1** (cron is enough; YAGNI).

## Cron (`convex/crons.ts`)
Add one monthly job (FRED's county data is monthly; the rate is weekly but monthly cadence is what the user asked for):
```ts
crons.cron("market data monthly", "0 12 1 * *",   // 1st of each month, 12:00 UTC ≈ 8am ET
  internal.marketActions.refreshMarketData, {});
```
(First population on deploy: run once via `npx convex run marketActions:refreshMarketData` with the deploy key —
same way `users:seedAdmin` / `geocodeActions:backfillGeocodes` were invoked.)

## UI — `src/components/market-widgets.tsx` + Dashboard section
A new **"Delaware market"** section on the Dashboard (above the pipeline charts), dark "Industrial Precision" shadcn,
lucide icons only, **no emojis**. Reuses `formater.ts` + the existing `delta`/`indicator` utils. Renders only when
`api.marketData.dashboardMetrics` has data (skeleton while loading; nothing if the table is empty pre-first-run).
- **Rates row** — two compact StatCards: *30-yr mortgage* (e.g. "6.53%") and *Fed funds*, each with a tiny sparkline
  (recharts, `isAnimationActive={false}` so it renders in headless screenshots — lessons) + an "as of {date}" footnote
  and the WoW/MoM delta colored up/down (`Percent` / `Landmark` lucide icons).
- **Inventory card** — "Homes on the market" with a small per-county breakdown (New Castle / Kent / Sussex bars or a
  4-row mini-table incl. Delaware total), each with its "as of {date}". This is the user's headline ask.
- **Temperature card** — median days on market + (if fresh) median list price + listings with price cuts; each item
  hidden when its series is stale, so the card only ever shows current numbers.
- Footer line: small muted **attribution** — "Source: FRED (Federal Reserve), Freddie Mac PMMS, Realtor.com" — Redfin/
  Zillow attribution gets added in v2 when those sources appear.

## Error handling & edge cases
- A series returning 404/empty/all-missing → logged + skipped; other widgets still populate (no all-or-nothing).
- FRED `"."` missing markers → filtered in the parser (never NaN; the StatCards show "—" if a whole series is absent).
- Stale temperature extras → gated out by `isFresh` so the dashboard never shows a number from 2024 as if it were today.
- Empty table (before the first cron/seed run) → the whole Market section renders nothing (graceful), the rest of the
  Dashboard is unchanged.
- `FRED_API_KEY` missing → parser falls back to the no-key CSV endpoint, so it degrades rather than breaks.

## Testing & verification
- `tests/fred.test.ts`: `parseFredJson`/`parseFredCsv` over real-shaped fixtures (incl. `"."` rows, single-obs series),
  `pickLatest` (latest/prior/yearAgo selection, 24-cap history, oldest→newest order), `isFresh` boundaries. Pure, no network.
- Build chain (lessons): `npx convex dev --once` (validate convex/ + regenerate `_generated`) → `npm run build` → `npm test`
  (existing 75 stay green + new FRED tests pass). In isolation if a parallel session is active (worktree +
  `CONVEX_AGENT_MODE=anonymous`, per the concurrency lesson).
- Live: after deploy, run `marketActions:refreshMarketData` once against **dev**, inspect `marketMetrics` for real
  latest-dates (this confirms which "verify-on-first-run" extras are fresh and stay), then screenshot the Dashboard.
- Confirm the Sheriff/Legal/Flip/Properties pages and `runs.dashboardStats` are behaviorally unchanged.

## Success criteria
1. The Dashboard shows a **Delaware market** section: live 30-yr mortgage + Fed funds, **active listings for New Castle /
   Kent / Sussex / Delaware**, and median days on market — each labeled with its real "as of" date.
2. The numbers **refresh automatically monthly** via the new cron, with no user action; re-runs are idempotent.
3. No new manual data entry; one free `FRED_API_KEY` in Convex env (dev + prod) is the only new secret.
4. Stale series are **hidden**, never shown as current. Attribution is visible.
5. `npm run build` + `npm test` green; zero behavioral change to Sheriff / Legal / Flip / Properties / existing dashboard.
6. v2 (Redfin/Zillow page-scrape for sale price, sale-to-list, city-level Wilmington/Newark, rents) is documented as the
   next step but **not** built here.

## Sources
- FRED API docs & key (free): https://fred.stlouisfed.org/docs/api/fred/series_observations.html · https://fred.stlouisfed.org/docs/api/api_key.html
- FRED series: `MORTGAGE30US`, `FEDFUNDS`, `ACTLISCOU10003` (New Castle), `ACTLISCOU10001` (Kent), `ACTLISCOU10005` (Sussex), `ACTLISCOUDE` (Delaware), `MEDDAYONMARDE`
- Redfin Data Center (v2): https://www.redfin.com/news/data-center/downloads/
- Zillow Research ZHVI/ZORI (v2): https://www.zillow.com/research/data/
