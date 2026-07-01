# Zillow structure reference — for the "Monitor the Web" feature

_Captured live 2026-06-30 by driving the user's logged-in Chrome (claude-in-chrome) against
New Castle County, DE. This is the empirical ground truth the monitor's scraper + parser +
DeepSeek layer are built on — not assumptions. Re-verify any field marked "confirm at build"._

Related: feature brainstorm in chat; Firecrawl capability research (chat); the existing
per-address Zillow scraper `src/scraper/zillow.ts`; Redfin comps `src/scraper/comps.ts`.

---

## 1. Search-results page (the daily scrape target)

**URL shape:** `https://www.zillow.com/new-castle-county-de/` redirects to a stateful URL carrying a
single `searchQueryState` JSON param. Captured live:

```jsonc
// https://www.zillow.com/new-castle-county-de/?searchQueryState=<urlencoded JSON>
{
  "pagination": {},                      // {"currentPage": N} for pages 2+
  "isMapVisible": true,
  "mapBounds": { "west": -75.97218944, "east": -75.22237255,
                 "south": 39.36230086, "north": 39.76777058 },  // NCC bbox
  "regionSelection": [ { "regionId": 2986, "regionType": 4 } ], // ★ NCC = regionId 2986, type 4 (county)
  "filterState": { "sort": { "value": "globalrelevanceex" } },  // default sort = "Homes for You"
  "isListVisible": true,
  "mapZoom": 11
}
```

- **★ New Castle County region = `regionId 2986`, `regionType 4`.** This is the anchor for every
  monitor query. (`regionType 4` = county; 6 = city, 7 = neighborhood, 8 = zip — confirm if we
  ever scope tighter.)
- Result header showed **"1,192 results"** for the unfiltered NCC for-sale set, "Sorted by Homes for You".
- **Pagination:** ~40 cards/page; page 2+ via `pagination.currentPage`. Newest-sorted, last-7-days
  filtered, the NCC new-listing set is small (a few pages at most), so we rarely page deep.

### Listing-card anatomy (what one card on the results page shows)
From the live NCC results, each card carries:
- **Status / marketing badge** (top-left): `On Market Jul 01` (the **list date** — our freshness cue),
  or `Showcase`, `Featured`, `New Construction`, or a marketing blurb (`Abundant natural light`, `Fresh paint`).
- Photo carousel (+ MLS source watermark, e.g. `bright MLS`), a Save (heart), and a `…` menu.
- **Price** (e.g. `$319,900`; `$649,990+` for new-construction communities).
- **`4 bds | 3 ba | 2,495 sqft | House for sale`** — beds, baths, sqft, and the **listing-type label**.
- **Address** (`511 Brentwood Dr, Wilmington, DE 19803`).
- **Brokerage** (`PATTERSON-SCHWARTZ-HOCKESSIN`).
- Card link → the detail page: `…/homedetails/<address-slug>/<ZPID>_zpid/` (★ **ZPID = our dedupe key**).

> Cards are the cheap layer: price, beds/baths/sqft, address, list-date badge, ZPID, brokerage —
> enough for the **free rule pre-filter** (price ceiling, rough $/sqft, type) before we ever scrape a detail page.

---

## 2. Filter catalog — UI filter → `searchQueryState.filterState` key → use for us

The omnibus **Filters** panel would not open in the embedded browser (small viewport / portal quirk —
not worth fighting; the URL encoding is what the scraper needs). `sort` + region were confirmed live;
the `filterState` keys below are the documented Zillow schema — **confirm each exact key at build by
toggling it in the UI and reading the resulting URL.**

| Filter (UI) | `filterState` key | Notes / values | Use for monitor |
|---|---|---|---|
| Sort | `sort.value` | `globalrelevanceex` (Homes for You) · **`days` (Newest)** · `priceddesc`/`pricea` · `beds` · `lot` · `sqft` | ★ `days` (newest first) |
| **Days on Zillow** | `doz.value` | `"1"` · **`"7"`** · `"14"` · `"30"` · `"90"` · `"6m"` · `"12m"`… | ★ newness lever — use `"7"` + ZPID dedupe (portal syndication lags up to 24h, so 1-day misses stragglers) |
| Price | `price.min` / `price.max` | dollars | ★ buy-box ceiling (user-set) |
| Monthly payment | `mp.min`/`mp.max` | — | no |
| Beds | `beds.min`/`beds.max` | 0–5+ | optional min |
| Baths | `baths.min`/`baths.max` | — | optional |
| Home type — Houses | `isSingleFamily` | bool | ★ usually true |
| Home type — Townhome | `isTownhouse` | bool | ★ usually true |
| Home type — Multi-family | `isMultiFamily` | bool | ★ optional (small MF flips) |
| Home type — Condo/Co-op | `isCondo` / `isApartmentOrCondo` | bool | usually false (HOA) |
| Home type — Lot/Land | `isLotLand` | bool | false |
| Home type — Manufactured | `isManufactured` | bool | false |
| Listing — By agent | `isForSaleByAgent` | bool | ★ true |
| Listing — By owner (FSBO) | `isForSaleByOwner` | bool | ★ true (deals hide here) |
| Listing — New construction | `isNewConstruction` | bool | false (not a flip) |
| Listing — Coming soon | `isComingSoon` | bool | ★ optional (note: not yet syndicated until Active) |
| Listing — Auction | `isAuction` | bool | ★ optional |
| Listing — Foreclosure | `isForSaleForeclosure` | bool | ★ true |
| Pre-foreclosure / Foreclosed (off-market) | `isPreMarketForeclosure` / `isPreMarketPreForeclosure` | bool | NO — already covered by the off-market `/leads` engine |
| Square feet | `sqft.min`/`sqft.max` | — | optional |
| Lot size | `lotSize.min`/`lotSize.max` | — | optional |
| Year built | `built.min`/`built.max` | year | optional (cap ~1990 skews to dated stock) |
| Max HOA | `hoa.max` | — | optional |
| Price reduced | `pricr...` (confirm) | bool/days | ★ motivated-seller signal |
| **Keywords** | `att.value` | free text matched against the description (e.g. `"fixer"`) | ★★ strong free distress lever — but use as a SIGNAL, not a hard gate (would miss clean-worded below-market houses; keep-rule is OR across 4 reqs) |
| Has basement / garage / A-C / pool / waterfront / view / 55+ | various bools | — | mostly irrelevant for sourcing |

**What Zillow CANNOT filter (so the funnel + DeepSeek does it):** price-per-sqft vs comps,
ARV / 70%-rule MAO / flip margin / equity, true condition beyond a literal keyword match,
and nuanced "motivated/distressed" intent.

---

## 3. Listing detail page (`/homedetails/<slug>/<ZPID>_zpid/`)

Live example: **314 W 28th St, Wilmington, DE 19802** (ZPID `72950210`, MLS# `DENC2105646`),
a "Showcase" listing. Sections top→bottom:

1. **Media gallery** — tabs: `3D Home`, `Floor plan`, `Virtual staging`, `Photos`, `Map`; `Showcase` badge; Save / Share / More.
2. **Listing agent block** — agent name + brokerage + MLS logo (`United Real Estate Philadelphia`); a "Listed by" card with photo + Contact + "Request a tour".
3. **Status + headline facts** — `For sale` pill · **price `$319,900`** · **`3 beds · 3 baths · 1,980 sqft`** · address.
4. **Description** — prose with a `Show more` expander (★ the primary needs-work / motivation text for DeepSeek; e.g. "beautifully maintained corner-unit home… approximately 1,950 square feet…").
5. **Engagement + provenance** — **`3 days on Zillow | 1,366 views | 63 saves`** · **`Source: Bright MLS, MLS#: DENC2105646`**.
6. **Map + Street View** thumbnail.
7. **Room-by-room media** (Showcase only) — Family Room / Kitchen / … each with a 3D tour.
8. **Facts & features** (`Show more`) — e.g. **Heating: Forced Air, Natural Gas · Cooling: Central Air, Electric · Interior area: total 1,980 / livable 1,980 sqft**; (also year built, lot, parking, appliances, construction, HOA — under the expander).
9. **★ Price history** — table of `Date · Event · Price · $/sqft · Source(MLS#)`. Captured:
   - `6/27/2026 — Listed for sale — $319,900 (+73.9%) — $162/sqft`
   - `6/26/2023 — Listing removed — —`
   - `6/30/2021 — Sold — $184,000 (-16%) — $93/sqft`
   - `5/23/2021 — Pending sale — $219,000 — $111/sqft`
   → **last-sale price + appreciation since + on/off-market churn** = strong flip/motivation signals.
10. **Below** (standard, not all captured): **Zestimate** + Rent Zestimate, **Tax history**, monthly-cost estimator, **Public records** (beds/baths/sqft/lot/year), nearby schools, similar homes.

---

## 4. Listing categories / "types of sales" seen

- **For sale (by agent)** — the norm; `For sale` pill + Bright MLS source.
- **For sale by owner (FSBO)** — no listing brokerage.
- **New construction** — builder communities, `$xxx,xxx+`, bed/bath/sqft ranges, "N plans / N available homes" (skip — not flips).
- **Showcase / Featured** — premium paid presentation (3D, virtual staging); orthogonal to sale type.
- **Coming soon** — pre-Active; does NOT syndicate to portals until it flips to Active.
- **Foreclosure / Auction** — on-market distressed (include).
- **Pre-foreclosure / Foreclosed (off-market "Potential listings")** — Zillow shows these but they are off-market → out of scope here (the `/leads` engine already covers NCC pre-foreclosure via CourtConnect).

---

## 5. Bot protection + scraping implications

- **PerimeterX confirmed** — the page fires `collector-*.px-cloud.net` (PerimeterX) on load (plus Cloudflare per external research). → Firecrawl needs **`proxy: enhanced`/`auto`** (~5 credits/page) for Zillow.
- **Detail pages resist clean extraction** — `get_page_text` on the SPA detail page returned a *sidebar* card, not the body; and the project's own lesson is that **homedetails URLs 403 via Firecrawl** when hit directly. → Strategy:
  - **Scrape the SEARCH-results URL** (renders cards reliably as markdown) as the authoritative daily pull + ZPID diff. This is cheap (a few pages).
  - For survivors needing the description/price-history, scrape the detail via the **search-URL trick** already used in `zillow.ts` (search slug, not the raw homedetails URL), or fall back to Redfin.
- **Real browser (user's residential IP) loads Zillow fine** — useful for manual spot-checks, NOT for the automated pull (that's Firecrawl's job, on Firecrawl's cloud IPs).
- **Redfin fallback** stays the resilience path (already proven in `comps.ts`; friendlier ToS + anti-bot).
- **ToS:** Zillow prohibits scraping → keep volume modest (1 search pull/day + new-only detail scrapes), internal use only. (Heads-up to the client; not legal advice.)

---

## 6. Recommended monitor search config (NCC new flips)

Build a `searchQueryState` with:
`regionSelection:[{regionId:2986,regionType:4}]` · `filterState.sort.value:"days"` ·
`filterState.doz.value:"7"` · `isSingleFamily/isTownhouse(/isMultiFamily):true` ·
`isForSaleByAgent/isForSaleByOwner/isForSaleForeclosure:true` · `isNewConstruction:false` ·
`price.max:<user buy-box>` · (keywords `att` left OFF as a hard gate — applied as a DeepSeek signal instead).
Then: scrape index → ZPID diff vs `monitorListings` → free rule pre-filter (price/$-sqft/type) →
detail-scrape survivors → DeepSeek keep/discard vs the 4 requirements (OR) → store keepers → email digest.

## 7. Confirm at build (open items)
- Exact `filterState` keys for **keywords (`att`)**, **price-reduced**, and the **home-type/listing-type** bools (toggle each in the UI, read the URL).
- The real **Firecrawl markdown** of a filtered NCC search URL (proves parseability) — test with the user's new 100k-credit key.
- Whether the search-card markdown includes the **list-date badge** + ZPID reliably (it should, from the DOM).

---

## Test run 2026-06-30 — VALIDATED: scrape embedded JSON, not markdown

Live-tested against real NCC data (Firecrawl `proxy:enhanced`). **Supersedes the markdown-card approach above** — parse Zillow's embedded `__NEXT_DATA__` JSON instead (complete, structured, no lazy-load/truncation):

- **Search:** `props.pageProps.searchPageState.cat1.searchResults.listResults` = **41 full listings/page** (markdown only rendered ~24). Each: `zpid, unformattedPrice, beds, baths, area, marketingStatusSimplifiedCd/statusType, hdpData.homeInfo.{homeType,daysOnZillow,zestimate}, latLong, addressZipcode, detailUrl, builderName/isPaidBuilderNewConstruction`. `cat1.searchList.totalResultCount` = grand total; paginate `pagination.currentPage` (got **134/134** over 4 pages).
- **Detail:** `props.pageProps.componentProps.gdpClientCache` → JSON.parse → find the key whose value has `.property` → **97 fields**: full untruncated `description`, `resoFacts` (yearBuilt, parking, bath breakdown…), `priceHistory`, `taxHistory`, `zestimate`, `rentZestimate`, `lastSoldPrice`/`dateSoldString`, `lotSize`, `monthlyHoaFee`, `foreclosureTypes`/`isPreforeclosureAuction`, `attributionInfo` (agentName, brokerName, mlsId), `pageViewCount`/`favoriteCount`, `datePosted`.
- **Bot handling:** `proxy:enhanced` clears PerimeterX; **homedetails no longer 403** (supersedes the old lesson). Some detail scrapes intermittently return a **hydration shell** (~5.9 KB rawHtml, no property JSON) → **spaced retries 12/28/50s + jitter + dual-format (rawHtml+markdown)**; persistent shell → fall back to the **search-JSON card data + VERIFY** (search JSON alone carries price/beds/baths/sqft/Zestimate/status, so nothing is lost).
- **Comps:** Redfin `sold-6mo` per ZIP (`proxy:auto`) parsed fine (38–41/ZIP); cache per-ZIP per run.
- **Investor findings** (why raw spread ≠ deal; multi-exit math; manufactured-home + inflated-comps traps): see the design spec §6b.
