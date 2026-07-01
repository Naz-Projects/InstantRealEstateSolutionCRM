# Monitor the Web — daily Zillow new-listing flip finder (design)

_Date: 2026-06-30. Status: design, pending user review → implementation plan._
_Zillow ground truth: `docs/superpowers/research/2026-06-30-zillow-structure.md`._
_Firecrawl capability research + all design decisions: brainstorm (chat 2026-06-30)._

## 1. Goal

Every day, automatically watch **new for-sale listings in New Castle County (NCC), DE**, judge each
against IRES's buy box with an **AI layer**, and surface **only the keepers** into the CRM — never the
hundreds/week of irrelevant listings. A keeper is a house listed **below what the neighborhood is worth**
(instant equity) and/or one that **needs work / shows a motivated seller**. Keepers land on a new
**`/monitor`** page and a daily **email digest**, with one-click promotion into the existing Potential board.

This is the **on-market** counterpart to the existing **off-market** `/leads` wholesaling engine, and is
kept fully separate from it. It reuses the flip/comps brains (`flip.ts`, `comps.ts`) and the Firecrawl
scrape path.

## 2. Locked decisions (from the brainstorm)

| Decision | Value |
|---|---|
| Surface | New `/monitor` page + one-click **Promote to Potential** (reuses `potentialData.promoteToPotential`) |
| Scheduler / trigger | **Firecrawl Monitor (Webmonitor)** → Convex HTTP webhook (HMAC) → `runMonitorScan`; **daily Convex cron = safety net** running the same scan if the webhook didn't fire |
| Scrape source | **Zillow primary, Redfin fallback** (in-handler, when Zillow returns a block/empty page) |
| Buy box | **NCC** (regionId 2986) · **≤ $500,000** · **all home types** · **no** beds/baths min · **no** year-built cap |
| Keeper rule | **OR**: below-market **spread ≥ 15%** (comps-value − list, % below comps) **OR** fixer/needs-work **OR** distressed/motivated |
| "Worth" anchor | **Sold comps** (median $/sqft × this home's sqft, via `comps.ts`/Redfin) **cross-checked vs the Zillow Zestimate** |
| AI layer | **DeepSeek via OpenRouter** — default `deepseek/deepseek-v3.2`, fallback `deepseek/deepseek-chat-v3-0324`; env `MONITOR_LLM_MODEL`; prompt-instructed JSON + tolerant parse + validate/retry; judges **condition/distress from text only — never does the math** |
| Scrape time | once daily **20:00 America/New_York** (8 PM ET); Days-on-Zillow ≤ 7 + ZPID dedupe absorbs portal syndication lag |
| Alerts | **Daily email digest** via Resend (key-gated, no-op when unset; mirrors `contractActions`) + the `/monitor` page as the in-app review surface |
| Skills | Refresh the `firecrawl` skill (Monitor/changeTracking/webhooks) + new `monitor-web` op skill |
| Credits | New **100k-credit/month** Firecrawl key; Zillow needs `proxy: enhanced` (~5 credits/page) |

## 3. Architecture & data flow

```
[Firecrawl Monitor]  scrape, daily 20:00 America/New_York, proxy:enhanced, on the NCC search URL
        │  POST monitor.page / monitor.check.completed  (X-Firecrawl-Signature: sha256=HMAC)
        ▼
convex/http.ts  httpAction  /firecrawl-monitor
        │  verify HMAC (FIRECRAWL_WEBHOOK_SECRET) → 200 fast → schedule:
        ▼
internal.monitorActions.runMonitorScan        ◀── daily Convex CRON (safety net): runs this if no
        │   (ONE shared scan path, any trigger)     successful monitorRuns row in the last ~24h
        ├─ scrape NCC search URL via firecrawlScrape({proxy:"enhanced"})   (Zillow; block/empty → Redfin)
        ├─ parseSearchCards(markdown) → cards[]   (ZPID, address, price, beds/baths/sqft, listDate, brokerage)
        ├─ ZPID diff vs monitorListings → NEW cards only;  upsert lastSeen on repeats
        ├─ free rule pre-filter: drop > $500k, missing price/address  (type=all → no type cut)
        ├─ insert NEW rows (status:"pending"); fan out analyzeOne(zpid) staggered (mirror sheriff enrich)
        │      • detail-scrape (zillow.ts search-URL technique; → description, facts, price-history, zestimate)
        │      • comps via comps.ts (cached per-ZIP this run) → comps-value (median $/sqft × sqft)
        │      • compute spread = compsValue − listPrice; spreadPct; belowMarket = spreadPct ≥ 0.15
        │      • DeepSeek judge(listing facts + numbers + description + 4 reqs) → {keep, matched[], reason, …}
        │      • keeper = belowMarket OR ai.keep ; patch row (status:"analyzed" | "failed", lastError)
        └─ finalize monitorRuns row (counts); schedule sendDigest(runId) → email keepers (Resend, key-gated)
        ▼
[/monitor page] keepers first → Promote to Potential / Open in Flip Analyzer
```

**Why the webhook is just a trigger:** the exact `monitor.page` payload schema is a build-time unknown,
and our own tested scrape+parse is the authority. `runMonitorScan` accepts optional pre-fetched content
(passed from the webhook payload when present) and otherwise scrapes itself. The cron path always scrapes.
One brain, three robustness layers (Monitor, cron, in-handler Redfin fallback).

## 4. The funnel (credit discipline)

1. **Search index scrape** — 1 (rarely a few) page(s)/day, `proxy:enhanced` (~5 cr each). Days-on-Zillow ≤ 7 + Newest sort.
2. **ZPID dedupe** — only listings whose ZPID we've never analyzed proceed. (Bulk of the daily set is already-seen → free.)
3. **Rule pre-filter** — drop > $500k or missing essential fields. (No type/bed cut per the buy box.)
4. **Per-new-listing enrich** (the only meaningful spend): one detail scrape + comps (cached per-ZIP/run). ~20–40 new/day.
5. **DeepSeek judge** — ~$0.0004/listing; negligible.

Estimated ≈ **150–250 credits/day** (~5–7k/month) — comfortably within the 100k/month key.

## 5. Keeper logic (deterministic + AI)

Pure, in `src/scraper/monitorListings.ts`, unit-tested:

- `compsValue` = `suggestArv(selectComps(comps, subject), subjectSqft).arv` (reuse `comps.ts`); fallback to the
  parsed **Zestimate** when comps are too thin (`< 3`). Record `valueSource: "comps" | "zestimate" | "none"`.
- `spread = compsValue − listPrice`; `spreadPct = spread / compsValue`.
- `belowMarket = compsValue != null && spreadPct >= MONITOR_SPREAD_THRESHOLD` (default **0.15**, config constant).
- **Final keeper = `belowMarket || ai.keep`** — the deterministic spread gate can never be dropped by an AI miss
  (honors "below-market is the primary, quantified requirement"); the AI adds the fixer/distressed OR-conditions.
- `matchedRequirements` stored = union of `["below_market"]` (if belowMarket) and the AI's matched subset.

`MONITOR_SPREAD_THRESHOLD`, `MONITOR_PRICE_CEILING` (500000), and `NEEDS_WORK_KEYWORDS` live in one config
block so they're tunable without touching logic.

## 6. AI layer (DeepSeek)

- **Input** (built server-side, deterministic): address, listPrice, beds/baths/sqft, yearBuilt, propertyType,
  `compsValue`, `spread`, `spreadPct`, `$/sqft` (subject vs comps median), priceHistory summary (last sold price
  + % change), and the **description text**. Plus the 4 requirements + the spread threshold, stated explicitly.
- **Task:** "Judge whether this NCC house is a deal worth surfacing. Keep if it meets ANY: (1) below-market
  (spread already computed — treat ≥ threshold as below-market), (2) needs renovation / fixer, (3) distressed or
  motivated seller, (4) flip with margin + work. Do NOT recompute numbers; use the ones given. Return json …"
- **Output (json, validated + tolerant-parsed):**
  `{ keep: boolean, matchedRequirements: string[] (⊂ below_market|fixer|distressed|flip),
     conditionNotes: string, reason: string (≤ 200 chars), confidence: "low"|"medium"|"high" }`.
- **Parser** mirrors `legalNotices.ts`/`conditionScore.ts`: strip code fences, `JSON.parse`, clamp/validate fields
  to the closed sets, drop unknown values; on unparseable output store a visible `lastError` and `keep=false`
  (the deterministic belowMarket gate still applies) — **never fabricate a verdict**.
- **Transport:** OpenRouter chat completions (the path already used for Legal Notices), `OPENROUTER_API_KEY`,
  model from `MONITOR_LLM_MODEL` (default `deepseek/deepseek-v3.2`), `AbortSignal.timeout(30_000)`, no reasoning model.

## 6b. Investor-grade multi-exit analysis (v2 — validated on real NCC data 2026-06-30; SUPERSEDES the raw-spread keeper in §4–6)

The test run proved a raw "% below comps" spread is misleading — it ignores rehab and the rental exit. On the 10 real candidates it reranked everything: the raw #1/#2 ("74%/69% below") were a **manufactured home** and a **fire-damaged flip-mirage** (2% margin after a $185K gut); the real flip winner (918 Kirkwood: MAO $150K, offer $25K *below* list at 26% margin) was buried at #5; and two "rejects" (801 9th, 412 Ranee) were strong **rentals** the flip-only lens discarded. So the monitor underwrites **every exit** per new listing and keeps if ANY makes money.

**Valuation (conservative):**
- `conservativeARV` = comps median $/sqft × sqft, **capped at 1.15 × Zestimate** when a Zestimate exists (kills inflated comps — e.g. 5 Smallwood comps $739K vs Zestimate $311K). **Manufactured → Zestimate only** (site-built comps invalid). Persist the comp set (addresses/prices/dates) so a human can sanity-check.
- `rehab`: infer tier from condition text — **gut** (fire/flood/gut/full-reno/structural), **moderate** (needs-work/as-is/investor/TLC/dated), **cosmetic** (updated/renovated/turnkey), unknown→moderate — × `REHAB_TIERS` $/sqft × 1.1 contingency (reuse `flip.ts`). Photos-vision upgrade later.

**Flip lens** (reuse `computeFlip`): `MAO` (70%), `profit@list`, `margin`, `ROI`, and **`roomVsList` = MAO − list** (how far below list we can offer and still profit).

**Rental / BRRRR lens** (uses `rentZestimate` — previously ignored): `onePctRule` (rent/list), `capRate` (NOI/all-in; ~25% opex + taxes + insurance), monthly `cashFlow` (NOI − P&I @75% LTV), `cashOnCash`. Flag manufactured/land-lease (lot rent not in `rentZestimate`).

**Wholesale lens:** `wholesaleSpread` = MAO − list − assignment fee.

**Deal score + best exit:** score each exit (flip by margin, rental by cap rate), take the best; label **FLIP / RENTAL / WHOLESALE / PASS**; **rank keepers by score** (best on top).

**Keep-rule (v2, OR across exits — replaces §4):** keep if ANY clears its bar — flip margin ≥ ~10–15% at list **OR** rental cap ≥ ~6% / positive cash flow **OR** below-market equity ≥ 15% (conservativeARV) **OR** a genuine distress signal (status/description/off-market match). Any exit that makes money = a keeper.

**Risk flags (all from the scraped JSON):** `MANUFACTURED` (comps/lot-rent suspect), `HIGH-HOA` (>$250/mo), `non-financeable` (cash-only / "may not qualify FHA/VA" → smaller buyer pool), `heavy-rehab` (gut), `comps>>Zestimate` (ARV suspect → VERIFY), `detail-missing` (VERIFY).

**Competitive-edge workflows:**
- **Price-drop / back-on-market tracking** — re-scan already-seen ZPIDs; a meaningful price cut or relist re-surfaces the listing (motivated-seller trigger), not just brand-new listings. (`priceHistory` + prev list price.)
- **Off-market cross-reference (the moat)** — join each listing to the CRM's existing **parcel spine + `signalEvents` + `parcelEquity`** by address→prclid. A listed house whose owner is in pre-foreclosure / has code violations / delinquent NCC balances = a super-motivated seller competitors can't see. Reuse **Street-View condition** (`condition-batch`) too.
- **Act-first surface** — rank by deal score; show the **MAO/offer #, listing agent contact, and photos** so the team calls the morning after the 8 PM run, ahead of the market.

**Data-model additions** (`monitorListings`): `rehabTier`, `rehabEstimate`, `conservativeARV`, `arvSource`, `comps[]`(addr/price/date), `flipMao`, `flipProfit`, `flipMargin`, `flipRoi`, `roomVsList`, `rentZestimate`, `capRate`, `cashFlow`, `onePctRule`, `cashOnCash`, `wholesaleSpread`, `dealScore`, `bestExit`, `riskFlags[]`, `lastSoldPrice`, `lastSoldDate`, `priceHistory[]`, `prevListPrice`/`priceDrop`, `agentName`, `agentPhone`, `brokerName`, `photoUrls[]`, `offMarketMatch{prclid, signals[], balances, conditionScore}`. **Scrape via embedded JSON** (search `listResults` + detail `gdpClientCache`) — NOT markdown cards.

**Honest limits (label "verify before offer"):** rehab $ is a tier heuristic (needs photos/walkthrough); ARV uses median $/sqft; title/liens beyond NCC balances aren't on Zillow; manufactured rent excludes lot rent.

## 7. Data model (additive — 2 new tables)

```ts
// convex/schema.ts (additive)
monitorListings: defineTable({
  zpid: v.string(),                 // Zillow listing id (Redfin: "rf:<id>"|normalized addr) — dedupe key
  source: v.union(v.literal("zillow"), v.literal("redfin")),
  url: v.string(),                  // detail page URL
  address: v.string(), propCity: v.optional(v.string()), propZip: v.optional(v.string()),
  lat: v.optional(v.number()), lng: v.optional(v.number()),
  listPrice: v.optional(v.number()),
  beds: v.optional(v.string()), baths: v.optional(v.string()), sqft: v.optional(v.number()),
  propertyType: v.optional(v.string()),     // "House"|"Townhome"|... as scraped
  listDate: v.optional(v.string()),         // "On Market" badge / price-history list date
  daysOnZillow: v.optional(v.number()),
  description: v.optional(v.string()),       // capped
  pricePerSqft: v.optional(v.number()),
  lastSoldPrice: v.optional(v.number()), lastSoldDate: v.optional(v.string()),
  // valuation + keeper math
  compsValue: v.optional(v.number()), compsCount: v.optional(v.number()),
  compsPpsf: v.optional(v.number()), zestimate: v.optional(v.number()),
  valueSource: v.optional(v.union(v.literal("comps"), v.literal("zestimate"), v.literal("none"))),
  spread: v.optional(v.number()), spreadPct: v.optional(v.number()),
  belowMarket: v.optional(v.boolean()),
  // AI verdict
  aiKeep: v.optional(v.boolean()),
  matchedRequirements: v.optional(v.array(v.string())),
  aiReason: v.optional(v.string()), aiConditionNotes: v.optional(v.string()),
  aiConfidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  aiModel: v.optional(v.string()),
  // outcome
  keeper: v.optional(v.boolean()),          // belowMarket || aiKeep
  status: v.union(v.literal("pending"), v.literal("analyzed"), v.literal("failed"), v.literal("skipped")),
  lastError: v.optional(v.string()),
  promotedDealId: v.optional(v.id("potentialDeals")),
  emailedAt: v.optional(v.number()),
  firstSeen: v.number(), lastSeen: v.number(), updatedAt: v.number(),
})
  .index("by_zpid", ["zpid"])
  .index("by_keeper", ["keeper"])
  .index("by_status", ["status"])
  .index("by_firstSeen", ["firstSeen"]),

// observability counter row per run (mirrors parcelSync)
monitorRuns: defineTable({
  trigger: v.union(v.literal("webhook"), v.literal("cron"), v.literal("manual")),
  source: v.union(v.literal("zillow"), v.literal("redfin")),
  status: v.union(v.literal("running"), v.literal("complete"), v.literal("failed")),
  scanned: v.number(), newCount: v.number(), analyzedCount: v.number(),
  keeperCount: v.number(), emailedCount: v.number(),
  startedAt: v.number(), finishedAt: v.optional(v.number()), error: v.optional(v.string()),
}).index("by_started", ["startedAt"]),
```

## 8. Pure module — `src/scraper/monitorListings.ts` (TDD against captured fixtures)

- `buildZillowSearchUrl({ regionId:2986, regionType:4, maxPrice, dozDays:7, sort:"days", page })` → search-URL with the
  `searchQueryState` JSON (encodings in the research doc).
- `parseZillowSearchCards(markdown) → Card[]` (`{ zpid, url, address, city, zip, listPrice, beds, baths, sqft, listDate, brokerage }`).
- `zpidFromUrl(url)`.
- `buildRedfinNewListingsUrl()` / `parseRedfinSearchCards(markdown)` (fallback; reuses `comps.ts` parsing idioms).
- `parseDetail(markdown) → { description, daysOnZillow, zestimate, lastSoldPrice, lastSoldDate, priceHistory[] , facts }`.
- `NEEDS_WORK_KEYWORDS`, `detectNeedsWork(description, ppsf, areaPpsf)` (a cheap signal; the AI is authoritative).
- `computeSpread({ compsValue, listPrice })`, `isBelowMarket(spreadPct, threshold)`, `decideKeeper({belowMarket, aiKeep})`.
- Config: `MONITOR_PRICE_CEILING`, `MONITOR_SPREAD_THRESHOLD`, `MONITOR_DOZ_DAYS`.

Reuses `comps.ts` (`buildRedfinSoldUrl`, `parseRedfinComps`, `selectComps`, `suggestArv`) and `flip.ts` where a full
flip P&L is wanted on promote.

## 9. Convex pieces

- **`convex/http.ts`** (NEW) — `httpRouter` with `POST /firecrawl-monitor`: read raw body, verify
  `X-Firecrawl-Signature` HMAC-SHA256 vs `FIRECRAWL_WEBHOOK_SECRET` (reject on mismatch/missing), schedule
  `internal.monitorActions.runMonitorScan({ trigger:"webhook", content? })`, return 200 quickly.
- **`convex/monitorData.ts`** (V8 query/mutation, `requireUser` for UI reads) — `upsertListingByZpid`,
  `getSeenZpids(range)`, `listKeepers`/`listRecent`, `getListing`, `patchAnalysis`, `markEmailed`, `setPromotedDeal`,
  run-row CRUD (`createRun`/`finishRun`/`latestRun`), internal variants for the actions.
- **`convex/monitorActions.ts`** (`"use node"`) — `runMonitorScan` (scan + diff + fan-out), `analyzeOne`
  (detail + comps + spread + DeepSeek → patch), `sendDigest` (Resend, key-gated), `createFirecrawlMonitor`
  (one-time Monitor setup via Firecrawl API — used by the op skill), `devMonitorScan` (IRES_DEV manual trigger).
  Explicit `Promise<…>` return annotations on every action that calls siblings (TS7023 rule).
- **`src/scraper/firecrawl.ts`** — add `proxy?: "basic"|"enhanced"|"auto"` to `FirecrawlScrapeOptions` →
  body `proxy`; `AbortSignal.timeout` already implied via timeout. Additive, default unchanged.
- **`convex/crons.ts`** — add `"monitor daily safety net"` at `0 1 * * *` (≈ 8 PM ET EST; accepts ±1h DST drift,
  documented) calling `internal.monitorActions.runMonitorScan({trigger:"cron"})` which **no-ops if a successful
  run exists in the last 20h**.

## 10. Firecrawl Monitor config (one-time, via the op skill / `createFirecrawlMonitor`)

```jsonc
POST https://api.firecrawl.dev/v2/monitor
{
  "name": "IRES NCC new listings",
  "schedule": { "text": "daily at 8:00 PM", "timezone": "America/New_York" },
  "targets": [ { "type": "scrape", "urls": ["<NCC newest, doz<=7, <=500k search URL>"],
                 "scrapeOptions": { "formats": ["markdown"], "proxy": "enhanced" } } ],
  "webhook": { "url": "https://<deployment>.convex.site/firecrawl-monitor",
               "events": ["monitor.page","monitor.check.completed"],
               "headers": {} },
  "retentionDays": 30
}
```
(The Convex HTTP actions domain is `*.convex.site`. `judgeEnabled`/`goal` are NOT used — our DeepSeek layer is the judge.)

## 11. UI — `/monitor` page (`src/web/MonitorPage.tsx`)

- Run-summary header from `latestRun` ("Last run 8:02 PM: 187 scanned · 24 new · 3 keepers").
- **Keepers first** (toggle to show all new). Each card: Street-View/listing photo, address, **list price**,
  **comps-value + spread % chip** (color by size), beds/baths/sqft, `$/sqft vs area`, **matched-requirement chips**
  (`below market` / `fixer` / `distressed` / `flip`), the **DeepSeek reason** + condition notes, price-history
  mini-line (last sold + %), Zillow link.
- Per-card actions: **Promote to Potential** (calls `promoteToPotential` with the snapshot; shows "In pipeline"
  once `promotedDealId` set), **Open in Flip Analyzer** (`/flip?address=`).
- Dark "Industrial Precision" theme, **lucide icons only — never emojis**. New sidebar nav item ("Monitor").

## 12. Email digest (Resend, key-gated)

`sendDigest(runId)` builds a text+HTML list of that run's keepers (address, list price, comps-value, spread %,
matched requirements, reason, link to `/monitor` + the Zillow URL) and sends via Resend to `RESEND_TO`/`RESEND_FROM`.
**No-op + `logServerError` when `RESEND_API_KEY` is unset** (mirrors `convex/contractActions.ts`); the page works
without the key. Sets `emailedAt` per listing so a keeper is never emailed twice.

## 13. Skills (the user's explicit ask)

- **Refresh `firecrawl` skill** (`~/.agents/skills/firecrawl*`): bump versions (1.8.0 → 1.19.22), add **Monitor /
  Webmonitor** (`firecrawl monitor create`, `/v2/monitor`, scheduling, goal/judge, email+webhook, pricing),
  **changeTracking** format (changeStatus/visibility/git-diff/json), **webhooks + `X-Firecrawl-Signature` HMAC**,
  **proxy basic/enhanced/auto**, batch-scrape, and corrected scrape/crawl/map/search option tables. (Gaps catalogued
  in the Firecrawl research, chat.)
- **New `monitor-web` op skill** (mirrors `condition-batch`'s shape): create/update/list the Firecrawl Monitor for a
  target (NCC config baked in, parameterizable), trigger a manual scan (`devMonitorScan`), and inspect
  recent `monitorRuns` + keepers. Documents the env vars + the one-time setup.

## 14. Security & compliance

- **Webhook**: HMAC-SHA256 verification (`FIRECRAWL_WEBHOOK_SECRET`); reject missing/invalid signatures; the endpoint
  only *schedules a scan* (no data is trusted from the payload beyond optional content that is itself re-parsed).
- **Auth**: all `/monitor` reads + promote go through `requireUser`; scan/analyze/digest are internal actions/cron.
- **No fabrication**: the DeepSeek verdict is sanitized server-side through the tolerant parser; unparseable → visible
  `lastError`, `keep=false`, deterministic spread gate still applies.
- **ToS**: Zillow prohibits scraping → modest volume (1 search pull/day + new-only detail scrapes), internal use,
  Redfin fallback. Documented; flag to the client (not legal advice).

## 15. Footprint

**New:** `monitorListings` + `monitorRuns` tables · `src/scraper/monitorListings.ts` ·
`convex/{http,monitorData,monitorActions}.ts` · `src/web/MonitorPage.tsx` · the `monitor-web` skill ·
the `firecrawl` skill refresh. **Touched (minimal, additive):** `src/scraper/firecrawl.ts` (+`proxy`) ·
`convex/crons.ts` (+1 cron) · `convex/schema.ts` (+2 tables) · `src/web/app.tsx` + sidebar (+route/nav).
**Zero change** to sheriff/legal/leads/flip/properties/potential logic. Promote reuses `potentialData.promoteToPotential`.

## 16. Testing

- TDD the pure module against **captured fixtures** (a real NCC search-results markdown + a real detail markdown —
  obtained via the user's Firecrawl key during build): `parseZillowSearchCards`, `parseRedfinSearchCards`,
  `parseDetail`/price-history, `computeSpread`/`isBelowMarket`/`decideKeeper`, `detectNeedsWork`, URL builders,
  and the DeepSeek-response tolerant parser (good/garbage/fenced inputs).
- Backend write paths verified live via `npx convex run` internal fns + `npx convex data monitorListings`.

## 17. Build-time unknowns — RESOLVED in the 2026-06-30 live test run

**Validated end-to-end against real NCC data (Firecrawl `proxy:enhanced`, ~60 credits):**
- ✅ **Scrape via embedded `__NEXT_DATA__` JSON, not markdown.** Search `props.pageProps.searchPageState.cat1.searchResults.listResults` = 41 full listings/page (paginate `pagination.currentPage` → all 134). Detail `props.pageProps.componentProps.gdpClientCache` → the property object (97 fields incl. full untruncated `description`, `resoFacts`, `priceHistory`, `taxHistory`, `zestimate`/`rentZestimate`, `lastSoldPrice`, `monthlyHoaFee`, `foreclosureTypes`, `attributionInfo`). This fixed lazy-load (24→41/page), truncation, and empty-markdown at once.
- ✅ **Detail 403 lesson is superseded** — homedetails scrape works with `proxy:enhanced`.
- ✅ **Retry hardening** — spaced increasing gaps **12s → 28s → 50s** (+jitter) recover transient blocks; request `rawHtml`+`markdown`; a rare persistent hydration-shell (16 E 24th) falls back to **search-JSON card data + VERIFY** (never lost — search JSON alone carries price/beds/baths/sqft/Zestimate/status).
- ✅ **Region encoding** confirmed: NCC `regionId 2986, regionType 4`; `filterState.sort="days"`, `doz="7"`, `price.max`.

**Still to confirm at build:**
1. `monitor.page` **webhook payload shape** (capture one real delivery; until then the scan re-scrapes — robust default).
2. Exact `filterState` keys for keyword/price-reduced (minor — toggle in UI, read URL).
3. Detail-scrape success rate at scale (16 E 24th's persistent shell may be an outlier; consider a markdown-only final fallback pass).

### (original) Build-time unknowns list

1. **Real Firecrawl markdown of the filtered NCC search URL** — confirm cards (ZPID/price/beds/baths/sqft/address/
   list-date) parse cleanly with `proxy:enhanced`. If too JS-obfuscated → use Firecrawl `json`-format extraction or
   lean on Redfin. (Test with the user's 100k key.)
- 2. **Detail enrichment** — confirm the `zillow.ts` search-URL technique yields the **description** + price-history;
   if not, test a homedetails scrape with `proxy:enhanced` (the old "homedetails 403" lesson predates enhanced proxy).
- 3. **`monitor.page` webhook payload shape** — capture one real delivery; confirm signature header + whether content
   is included (drives the "trigger vs content" path). Until confirmed, the scan re-scrapes (robust default).
- 4. Confirm the exact `filterState` keys for price/home-type/listing-type by toggling each in the Zillow UI + reading the URL.

## 18. Env vars

`FIRECRAWL_API_KEY` (new 100k key) · `FIRECRAWL_WEBHOOK_SECRET` (new) · `OPENROUTER_API_KEY` (exists) ·
`MONITOR_LLM_MODEL` (optional, default `deepseek/deepseek-v3.2`) · `GOOGLE_GEOCODING_API_KEY` (exists, Street View
thumb) · `RESEND_API_KEY`/`RESEND_FROM`/`RESEND_TO` (optional, for the digest).

## 19. Out of scope (v1) / future

- Photo/Street-View **vision** on listings (DeepSeek has no vision; would be a Claude/Gemini add-on later).
- Multi-county / multi-source (Kent, Sussex; realtor.com).
- **Rental/BRRRR** scoring (cash-flow lens) — a later requirement set.
- Using the Monitor's native `goal`/AI-judge or `changeTracking` json-diff (we judge ourselves in v1).
- Auto-promote (v1 is human-in-the-loop promote from the page).
```
