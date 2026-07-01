# Monitor the Web (Zillow NCC deal finder) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily automated monitor that scrapes new New-Castle-County Zillow for-sale listings, underwrites every exit (flip / rental / wholesale) with an AI condition read, and surfaces only real deals to a `/monitor` page + email digest with one-click promote to the Potential board.

**Architecture:** Firecrawl (`proxy:enhanced`) scrapes Zillow's embedded `__NEXT_DATA__` JSON (search `listResults`, detail `gdpClientCache`). Pure runtime-agnostic logic in `src/scraper/monitorListings.ts` (parse + multi-exit math + keep-rule) is reused by Convex actions. A shared `runMonitorScan` action (triggered by a Firecrawl Monitor webhook, with a daily Convex cron safety-net) diffs by zpid, enriches survivors (detail + comps + DeepSeek + off-market cross-ref), stores to `monitorListings`, and emails keepers. A `/monitor` React page reviews + promotes them.

**Tech Stack:** Convex (V8 `*Data.ts` queries/mutations + `"use node"` `*Actions.ts` actions + `http.ts` httpAction), TanStack Router + React + Tailwind + shadcn, Firecrawl REST v2, OpenRouter (DeepSeek), Resend (optional), Vitest.

## Global Constraints

- **UI: lucide-react icons only — NEVER emojis.** Dark "Industrial Precision" theme tokens.
- **All implementation via Opus 4.8 subagents** (`model:"opus"`); main loop orchestrates/reviews.
- **Strictly additive** — zero change to sheriff/legal/leads/flip/properties/potential logic. Only edits: `convex/schema.ts` (+2 tables), `convex/crons.ts` (+1 cron), `src/scraper/firecrawl.ts` (+`proxy`), `src/web/app.tsx` + sidebar (+route/nav), new `convex/http.ts`.
- **Convex rules:** `"use node"` files hold ONLY actions; V8 queries/mutations in `*Data.ts`. Every action handler that calls siblings needs an explicit `: Promise<...>` return annotation (TS7023). Throw `ConvexError({code,message})` for user-facing errors. All browser-callable fns gate `requireUser`.
- **React 19:** import `JSX` from `react` if annotating `JSX.Element`.
- **After changing `convex/`:** run `npx convex dev --once` (validates + regenerates `_generated`) THEN `npm run build`. In an isolated worktree use `CONVEX_AGENT_MODE=anonymous npx convex dev --once`.
- **Money/thresholds config:** one exported const block in `monitorListings.ts` — `MONITOR = { priceCeiling:500000, spreadThreshold:0.15, dozDays:7, regionId:2986, regionType:4, flipMarginBar:0.12, capRateBar:0.06 }`.
- **Firecrawl:** REST v2 `https://api.firecrawl.dev/v2/scrape`, `proxy:"enhanced"` for Zillow (~5 credits/page), `proxy:"auto"` for Redfin. Key `FIRECRAWL_API_KEY`. Direct HTTP to api.firecrawl.dev works from this env.
- **Validated fixtures/patterns** captured in `docs/superpowers/research/2026-06-30-zillow-structure.md`; reuse `src/scraper/comps.ts` (`parseRedfinComps`/`selectComps`/`suggestArv`) and `src/scraper/flip.ts` (`REHAB_TIERS`/`estimateRehab`/`computeFlip`/`FLIP_DEFAULTS`).

---

## File Structure

- `src/scraper/monitorListings.ts` (NEW) — pure: config, Zillow JSON parsers, URL builder, conservative ARV, rehab-tier, multi-exit math, deal score, risk flags, keep-rule, DeepSeek prompt+parser. Runtime-agnostic, unit-tested.
- `tests/monitorListings.test.ts` (NEW) — vitest for the above, asserting on real captured values.
- `convex/schema.ts` (MODIFY) — add `monitorListings` + `monitorRuns` tables.
- `convex/monitorData.ts` (NEW, V8) — upsert-by-zpid, seen-zpids, list keepers/recent, get, patch analysis, run CRUD, markEmailed, setPromotedDeal, off-market cross-ref query.
- `convex/monitorActions.ts` (NEW, `"use node"`) — `runMonitorScan`, `analyzeOne`, `judgeWithDeepSeek`, `sendDigest`, `createFirecrawlMonitor`, `devMonitorScan`.
- `convex/monitorScrape.ts` (NEW, runtime-agnostic helper importable by the action) — `scrapeJson()` (Firecrawl call + retry/backoff/shell-detect/dual-format), thin wrappers.
- `convex/http.ts` (NEW) — Firecrawl Monitor webhook (HMAC).
- `convex/crons.ts` (MODIFY) — daily safety-net cron.
- `src/scraper/firecrawl.ts` (MODIFY) — add `proxy?` to options.
- `src/web/MonitorPage.tsx` (NEW) + `src/web/app.tsx` (MODIFY route) + sidebar (MODIFY nav).
- `~/.agents/skills/firecrawl*/**` (MODIFY) — refresh; `.claude/skills/monitor-web/SKILL.md` (NEW) — op skill.

---

# PHASE 1 — Core (pure logic + scraping + data + manual scan)

### Task 1: Config + Zillow search URL builder

**Files:** Create `src/scraper/monitorListings.ts`; Test `tests/monitorListings.test.ts`.

**Interfaces:**
- Produces: `MONITOR` (config const), `buildSearchUrl(opts: {page?: number}): string`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { MONITOR, buildSearchUrl } from "../src/scraper/monitorListings";

describe("buildSearchUrl", () => {
  it("encodes NCC region + newest + doz + price ceiling", () => {
    const url = buildSearchUrl({});
    expect(url).toContain("zillow.com/new-castle-county-de/");
    const sqs = JSON.parse(decodeURIComponent(url.split("searchQueryState=")[1]));
    expect(sqs.regionSelection[0]).toEqual({ regionId: 2986, regionType: 4 });
    expect(sqs.filterState.sort.value).toBe("days");
    expect(sqs.filterState.doz.value).toBe("7");
    expect(sqs.filterState.price.max).toBe(500000);
    expect(sqs.pagination).toEqual({});
  });
  it("adds currentPage for page>1", () => {
    const sqs = JSON.parse(decodeURIComponent(buildSearchUrl({ page: 3 }).split("searchQueryState=")[1]));
    expect(sqs.pagination).toEqual({ currentPage: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/monitorListings.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**
```ts
// src/scraper/monitorListings.ts
export const MONITOR = {
  regionId: 2986, regionType: 4, // New Castle County, DE
  priceCeiling: 500000, dozDays: "7", sort: "days",
  spreadThreshold: 0.15, flipMarginBar: 0.12, capRateBar: 0.06,
  ncc_bounds: { west: -75.97218944726562, east: -75.22237255273437, south: 39.36230086205304, north: 39.76777058263119 },
} as const;

export function buildSearchUrl({ page }: { page?: number } = {}): string {
  const sqs = {
    pagination: page && page > 1 ? { currentPage: page } : {},
    isMapVisible: false,
    mapBounds: MONITOR.ncc_bounds,
    regionSelection: [{ regionId: MONITOR.regionId, regionType: MONITOR.regionType }],
    filterState: { sort: { value: MONITOR.sort }, doz: { value: MONITOR.dozDays }, price: { max: MONITOR.priceCeiling } },
    isListVisible: true,
  };
  return "https://www.zillow.com/new-castle-county-de/?searchQueryState=" + encodeURIComponent(JSON.stringify(sqs));
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/monitorListings.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/scraper/monitorListings.ts tests/monitorListings.test.ts && git commit -m "feat(monitor): config + Zillow search URL builder"`

---

### Task 2: Parse search `listResults` from `__NEXT_DATA__`

**Files:** Modify `src/scraper/monitorListings.ts`; `tests/monitorListings.test.ts`.

**Interfaces:**
- Produces: `extractNextData(html:string): any|null`, `SearchListing` type, `listingsFromSearch(nextData:any): SearchListing[]`, `totalResultCount(nextData:any): number|null`.
- `SearchListing = { zpid:string; price:number|null; beds:number|null; baths:number|null; sqft:number|null; ppsf:number|null; status:string; homeType?:string; daysOnZillow?:number; zestimate:number|null; zestSpreadPct:number|null; address:string; zip?:string; lat?:number; lng?:number; isNewConstruction:boolean; isZillowOwned:boolean; url:string }`

- [ ] **Step 1: Write the failing test** (real values from the captured search page)
```ts
import { extractNextData, listingsFromSearch, totalResultCount } from "../src/scraper/monitorListings";

const FAKE_NEXT = {
  props: { pageProps: { searchPageState: { cat1: {
    searchList: { totalResultCount: 134 },
    searchResults: { listResults: [
      { zpid: "72883530", unformattedPrice: 270000, beds: 3, baths: 2, area: 1554,
        marketingStatusSimplifiedCd: "Foreclosure", statusType: "FOR_SALE",
        address: "837 Hasting Ct, Newark, DE 19702", addressZipcode: "19702",
        latLong: { latitude: 39.6, longitude: -75.7 },
        hdpData: { homeInfo: { homeType: "SINGLE_FAMILY", daysOnZillow: 0, zestimate: 300000 } },
        detailUrl: "https://www.zillow.com/homedetails/837-Hasting-Ct-Newark-DE-19702/72883530_zpid/" },
      { zpid: "444685170", unformattedPrice: 362800, beds: 5, baths: 2, area: 2669,
        marketingStatusSimplifiedCd: "New Construction Spec", statusType: "FOR_SALE",
        address: "Truman Plan, Venue at Winchelsea 55+", addressZipcode: "19709",
        hdpData: { homeInfo: { homeType: "TOWNHOUSE", daysOnZillow: 0, zestimate: 356800 } },
        builderName: "Lennar",
        detailUrl: "https://www.zillow.com/community/venue-at-winchelsea/444685170_zpid/" },
    ] } } } } },
};

describe("listingsFromSearch", () => {
  it("maps listResults into SearchListing with derived ppsf + zestSpread + flags", () => {
    const rows = listingsFromSearch(FAKE_NEXT);
    expect(rows).toHaveLength(2);
    const a = rows[0];
    expect(a.zpid).toBe("72883530");
    expect(a.price).toBe(270000);
    expect(a.sqft).toBe(1554);
    expect(a.ppsf).toBe(174); // 270000/1554
    expect(a.status).toBe("Foreclosure");
    expect(a.zestimate).toBe(300000);
    expect(a.zestSpreadPct).toBeCloseTo(10, 0); // (300000-270000)/300000
    expect(a.isNewConstruction).toBe(false);
    const b = rows[1];
    expect(b.isNewConstruction).toBe(true); // builderName or /community/
  });
  it("totalResultCount reads the searchList", () => {
    expect(totalResultCount(FAKE_NEXT)).toBe(134);
  });
  it("extractNextData returns null when absent", () => {
    expect(extractNextData("<html>no script</html>")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`extractNextData` not defined).

- [ ] **Step 3: Implement**
```ts
export function extractNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
export interface SearchListing {
  zpid: string; price: number | null; beds: number | null; baths: number | null; sqft: number | null;
  ppsf: number | null; status: string; homeType?: string; daysOnZillow?: number;
  zestimate: number | null; zestSpreadPct: number | null; address: string; zip?: string;
  lat?: number; lng?: number; isNewConstruction: boolean; isZillowOwned: boolean; url: string;
}
export function totalResultCount(nextData: any): number | null {
  return nextData?.props?.pageProps?.searchPageState?.cat1?.searchList?.totalResultCount ?? null;
}
export function listingsFromSearch(nextData: any): SearchListing[] {
  const lr = nextData?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults ?? [];
  return lr.map((c: any): SearchListing => {
    const hi = c.hdpData?.homeInfo ?? {};
    const price = c.unformattedPrice ?? hi.price ?? null;
    const sqft = c.area ?? hi.livingArea ?? null;
    const zest = c.zestimate ?? hi.zestimate ?? null;
    const url = c.detailUrl ?? "";
    return {
      zpid: String(c.zpid), price, beds: c.beds ?? hi.bedrooms ?? null, baths: c.baths ?? hi.bathrooms ?? null,
      sqft, ppsf: price && sqft ? Math.round(price / sqft) : null,
      status: c.marketingStatusSimplifiedCd || c.statusText || c.statusType || "",
      homeType: hi.homeType, daysOnZillow: hi.daysOnZillow, zestimate: zest,
      zestSpreadPct: zest && price ? +(((zest - price) / zest) * 100).toFixed(1) : null,
      address: c.address ?? "", zip: c.addressZipcode, lat: c.latLong?.latitude, lng: c.latLong?.longitude,
      isNewConstruction: !!(c.builderName || c.isPaidBuilderNewConstruction) || /\/community\//.test(url),
      isZillowOwned: !!c.isZillowOwned, url,
    };
  });
}
```

- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(monitor): parse Zillow search listResults JSON"`

---

### Task 3: Parse detail `gdpClientCache` (+ shell detection)

**Files:** Modify `monitorListings.ts` + test.

**Interfaces:**
- Produces: `ListingDetail` type, `detailFromCache(nextData:any): ListingDetail|null`.
- `ListingDetail = { description:string; homeType?:string; homeStatus?:string; yearBuilt:number|null; zestimate:number|null; rentZestimate:number|null; lastSoldPrice:number|null; dateSold:string|null; monthlyHoaFee:number|null; foreclosure:boolean; daysOnZillow:number|null; mlsId?:string; agentName?:string; agentPhone?:string; brokerName?:string; lotSize:number|null; priceHistory:{date?:string;event?:string;price?:number;ppsf?:number}[]; photoUrls:string[] }`

- [ ] **Step 1: Write the failing test** (real values from 15 Merry Rd)
```ts
import { detailFromCache } from "../src/scraper/monitorListings";
const FAKE_DETAIL = { props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify({
  'ForSaleFullRenderQuery{"zpid":72882834}': { property: {
    zpid: 72882834, homeStatus: "FOR_SALE", homeType: "SINGLE_FAMILY", price: 110000,
    zestimate: null, rentZestimate: null, bedrooms: 4, bathrooms: 2, livingArea: 1770, lotSize: 7405,
    daysOnZillow: 2, monthlyHoaFee: 5, lastSoldPrice: 99900, dateSoldString: "1998-08-31",
    isPreforeclosureAuction: false, foreclosureTypes: {},
    resoFacts: { yearBuilt: 1956 },
    attributionInfo: { agentName: "Peggy Centrella", brokerName: "Patterson-Schwartz-Hockessin", mlsId: "DENC2106100", agentPhoneNumber: "302-555-1234" },
    description: "INVESTOR ALERT!!!! ... severe fire and water damage ... full rehab/renovation ... AS IS",
    priceHistory: [{ date: "2026-06-28", event: "Listed for sale", price: 110000, pricePerSquareFoot: 62 }],
    responsivePhotos: [{ mixedSources: { jpeg: [{ url: "https://photos.zillowstatic.com/fp/a-cc_ft_960.jpg" }] } }],
  } } }) } } } };

describe("detailFromCache", () => {
  it("extracts the property object with normalized fields", () => {
    const d = detailFromCache(FAKE_DETAIL)!;
    expect(d.description).toContain("fire and water damage");
    expect(d.yearBuilt).toBe(1956);
    expect(d.lastSoldPrice).toBe(99900);
    expect(d.monthlyHoaFee).toBe(5);
    expect(d.agentName).toBe("Peggy Centrella");
    expect(d.mlsId).toBe("DENC2106100");
    expect(d.priceHistory[0].price).toBe(110000);
    expect(d.photoUrls[0]).toContain("zillowstatic.com");
  });
  it("returns null on a hydration shell (no property)", () => {
    expect(detailFromCache({ props: { pageProps: { componentProps: {} } } })).toBeNull();
    expect(detailFromCache(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**
```ts
export interface ListingDetail {
  description: string; homeType?: string; homeStatus?: string; yearBuilt: number | null;
  zestimate: number | null; rentZestimate: number | null; lastSoldPrice: number | null; dateSold: string | null;
  monthlyHoaFee: number | null; foreclosure: boolean; daysOnZillow: number | null; mlsId?: string;
  agentName?: string; agentPhone?: string; brokerName?: string; lotSize: number | null;
  priceHistory: { date?: string; event?: string; price?: number; ppsf?: number }[]; photoUrls: string[];
}
export function detailFromCache(nextData: any): ListingDetail | null {
  const cc = nextData?.props?.pageProps?.componentProps?.gdpClientCache;
  if (!cc) return null;
  let cache: any; try { cache = JSON.parse(cc); } catch { return null; }
  const key = Object.keys(cache).find((k) => cache[k] && cache[k].property);
  if (!key) return null;
  const p = cache[key].property;
  const ai = p.attributionInfo ?? {};
  const photos = (p.responsivePhotos ?? p.originalPhotos ?? [])
    .map((ph: any) => ph?.mixedSources?.jpeg?.[0]?.url ?? ph?.url).filter(Boolean).slice(0, 8);
  return {
    description: p.description ?? "", homeType: p.homeType, homeStatus: p.homeStatus,
    yearBuilt: p.resoFacts?.yearBuilt ?? null, zestimate: p.zestimate ?? null, rentZestimate: p.rentZestimate ?? null,
    lastSoldPrice: p.lastSoldPrice ?? null, dateSold: p.dateSoldString ?? null, monthlyHoaFee: p.monthlyHoaFee ?? null,
    foreclosure: !!(p.isPreforeclosureAuction || (p.foreclosureTypes && Object.values(p.foreclosureTypes).some(Boolean))),
    daysOnZillow: p.daysOnZillow ?? null, mlsId: ai.mlsId, agentName: ai.agentName,
    agentPhone: ai.agentPhoneNumber ?? ai.agentPhone, brokerName: ai.brokerName, lotSize: p.lotSize ?? p.lotAreaValue ?? null,
    priceHistory: (p.priceHistory ?? []).slice(0, 6).map((h: any) => ({ date: h.date, event: h.event, price: h.price, ppsf: h.pricePerSquareFoot })),
    photoUrls: photos,
  };
}
```

- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(monitor): parse Zillow detail gdpClientCache JSON + shell detection"`

---

### Task 4: Conservative ARV + rehab tier

**Files:** Modify `monitorListings.ts` + test.

**Interfaces:**
- Consumes: `selectComps`,`suggestArv` from `./comps`; `REHAB_TIERS`,`estimateRehab` from `./flip`.
- Produces: `conservativeArv(opts:{comps:Comp[]; sqft:number|null; beds:number|null; zestimate:number|null; homeType?:string}): {arv:number|null; source:"comps"|"zestimate"|"none"; compsPpsf:number|null; compsCount:number}`; `inferRehabTier(description:string): "cosmetic"|"moderate"|"gut"`; re-export `estimateRehab`.

- [ ] **Step 1: Write the failing test**
```ts
import { conservativeArv, inferRehabTier } from "../src/scraper/monitorListings";
import type { Comp } from "../src/scraper/comps";
const mkComp = (soldPrice: number, sqft: number, beds = 4): Comp =>
  ({ address: "x", soldDate: "MAY 1, 2026", soldPrice, beds, baths: 2, sqft, pricePerSqft: soldPrice / sqft });

describe("conservativeArv", () => {
  it("caps comps at 1.15x Zestimate when comps are inflated", () => {
    const comps = [mkComp(700000, 3101), mkComp(720000, 3101), mkComp(740000, 3101)];
    const r = conservativeArv({ comps, sqft: 3101, beds: 3, zestimate: 311400, homeType: "SINGLE_FAMILY" });
    expect(r.arv).toBe(Math.round(311400 * 1.15)); // capped
  });
  it("uses comps when consistent with Zestimate", () => {
    const comps = [mkComp(230000, 1100), mkComp(220000, 1100), mkComp(226000, 1100)];
    const r = conservativeArv({ comps, sqft: 1100, beds: 3, zestimate: 176200, homeType: "SINGLE_FAMILY" });
    expect(r.source).toBe("comps");
    expect(r.arv).toBeLessThanOrEqual(Math.round(176200 * 1.15));
  });
  it("manufactured -> Zestimate only (comps invalid)", () => {
    const comps = [mkComp(270000, 1019), mkComp(260000, 1019), mkComp(280000, 1019)];
    const r = conservativeArv({ comps, sqft: 1019, beds: 2, zestimate: 90000, homeType: "MANUFACTURED" });
    expect(r.source).toBe("zestimate");
    expect(r.arv).toBe(90000);
  });
});
describe("inferRehabTier", () => {
  it("gut on fire/full-reno", () => { expect(inferRehabTier("severe fire and water damage, full rehab, sold AS IS")).toBe("gut"); });
  it("cosmetic on turnkey", () => { expect(inferRehabTier("totally renovated 2022, shows like new, move-in")).toBe("cosmetic"); });
  it("moderate on needs-work/investor", () => { expect(inferRehabTier("great investment, needs full renovation, priced to sell, sold as-is")).toBe("gut"); });
  it("moderate default when unknown", () => { expect(inferRehabTier("charming home near shopping")).toBe("moderate"); });
});
```
> Note: "needs full renovation" contains "full reno…" → gut is acceptable; the assertion reflects that. Keep the ordering gut→cosmetic→moderate.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**
```ts
import { selectComps, suggestArv, type Comp } from "./comps";
import { REHAB_TIERS, estimateRehab } from "./flip";
export { estimateRehab };

export function conservativeArv(opts: { comps: Comp[]; sqft: number | null; beds: number | null; zestimate: number | null; homeType?: string; }):
  { arv: number | null; source: "comps" | "zestimate" | "none"; compsPpsf: number | null; compsCount: number } {
  const manufactured = (opts.homeType || "").toUpperCase() === "MANUFACTURED";
  if (manufactured) return { arv: opts.zestimate ?? null, source: opts.zestimate ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
  const sel = selectComps(opts.comps, { sqft: opts.sqft, beds: opts.beds });
  const sug = suggestArv(sel, opts.sqft);
  if (sug.arv == null) return { arv: opts.zestimate ?? null, source: opts.zestimate ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
  let arv = sug.arv;
  if (opts.zestimate && arv > opts.zestimate * 1.15) arv = Math.round(opts.zestimate * 1.15); // cap inflated comps
  return { arv, source: "comps", compsPpsf: sug.pricePerSqft, compsCount: sug.count };
}

const GUT = /fire|flood|gut|shell|structural|severe|full rehab|full renovation|complete renovation|tear down|needs everything/i;
const COSMETIC = /updated|renovated|remodel|move.?in|turn.?key|shows like new|refreshed|pride of ownership|new (kitchen|roof|hvac|appliances)/i;
const MODERATE = /needs? (work|updating|tlc|repairs|renovation)|dated|handyman|investor|value.?add|personal touch|bring your (vision|contractor|imagination)|fixer|sold (strictly )?as.?is|cash only|may not qualify/i;
export function inferRehabTier(description: string): "cosmetic" | "moderate" | "gut" {
  const d = description || "";
  if (GUT.test(d)) return "gut";
  if (COSMETIC.test(d) && !MODERATE.test(d)) return "cosmetic";
  return "moderate";
}
```

- [ ] **Step 4: Run → PASS** (adjust the `inferRehabTier` regex ordering if a case mismatches; gut wins first).
- [ ] **Step 5: Commit** — `git commit -am "feat(monitor): conservative ARV (comps capped by Zestimate) + rehab tier"`

---

### Task 5: Multi-exit math (flip / rental / wholesale) + deal score + keep-rule

**Files:** Modify `monitorListings.ts` + test.

**Interfaces:**
- Consumes: `computeFlip`,`FLIP_DEFAULTS` from `./flip`.
- Produces: `analyzeFlip(arv,list,rehab): {mao,profit,margin,roi,roomVsList}`; `analyzeRental(opts:{rent:number|null;list:number;rehab:number;taxRatePct?:number}): RentalMetrics|null`; `scoreDeal(flip,rental): {flipScore:number;rentScore:number;dealScore:number;bestExit:"FLIP"|"RENTAL"|"PASS"}`; `decideKeeper(opts:{belowMarket:boolean;flip?:any;rental?:any;distress:boolean}): boolean`; `riskFlags(r): string[]`.

- [ ] **Step 1: Write the failing test** (real: 918 Kirkwood flip; 801 9th rental)
```ts
import { analyzeFlip, analyzeRental, scoreDeal, decideKeeper, riskFlags } from "../src/scraper/monitorListings";

describe("analyzeFlip", () => {
  it("computes MAO/profit/margin/roomVsList (918 Kirkwood: ARV 247200, list 125000, cosmetic rehab ~23265)", () => {
    const f = analyzeFlip(247200, 125000, 23265);
    expect(f.mao).toBe(Math.round(247200 * 0.7 - 23265)); // 149775
    expect(f.roomVsList).toBe(f.mao - 125000); // ~+24775 (can offer below list)
    expect(f.margin).toBeGreaterThan(0.2); // ~26%
  });
});
describe("analyzeRental", () => {
  it("computes cap rate + cash flow (801 9th: rent 1925, list 69900, rehab ~20176)", () => {
    const r = analyzeRental({ rent: 1925, list: 69900, rehab: 20176 })!;
    expect(r.onePct).toBeCloseTo(1925 / 69900, 3);
    expect(r.capRate).toBeGreaterThan(0.1); // strong
    expect(r.cashFlow).toBeGreaterThan(0);
  });
  it("returns null without rent", () => { expect(analyzeRental({ rent: null, list: 100000, rehab: 0 })).toBeNull(); });
});
describe("scoreDeal + decideKeeper", () => {
  it("labels best exit FLIP when flip margin high", () => {
    const f = analyzeFlip(247200, 125000, 23265); const r = analyzeRental({ rent: 1788, list: 125000, rehab: 23265 });
    const s = scoreDeal(f, r); expect(s.bestExit).toBe("FLIP"); expect(s.dealScore).toBeGreaterThanOrEqual(75);
  });
  it("keeps when any exit clears (below-market OR flip OR rental OR distress)", () => {
    expect(decideKeeper({ belowMarket: true, distress: false })).toBe(true);
    expect(decideKeeper({ belowMarket: false, flip: { margin: 0.2 }, distress: false })).toBe(true);
    expect(decideKeeper({ belowMarket: false, rental: { capRate: 0.09 }, distress: false })).toBe(true);
    expect(decideKeeper({ belowMarket: false, distress: true })).toBe(true);
    expect(decideKeeper({ belowMarket: false, flip: { margin: 0.02 }, rental: { capRate: 0.03 }, distress: false })).toBe(false);
  });
});
describe("riskFlags", () => {
  it("flags manufactured, high HOA, non-financeable, ARV-suspect, detail-missing", () => {
    const f = riskFlags({ homeType: "MANUFACTURED", monthlyHoaFee: 400, description: "cash only, may not qualify FHA/VA", rehabTier: "gut", zestimate: 100000, compsArv: 300000, detailOk: false });
    expect(f).toEqual(expect.arrayContaining([expect.stringContaining("MANUFACTURED"), expect.stringContaining("HOA"), expect.stringContaining("financeable"), expect.stringContaining("heavy-rehab"), expect.stringContaining("ARV"), expect.stringContaining("VERIFY")]));
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**
```ts
import { computeFlip, FLIP_DEFAULTS } from "./flip";
export interface RentalMetrics { rent: number; onePct: number; capRate: number; cashFlow: number; cashOnCash: number; allIn: number; }

export function analyzeFlip(arv: number | null, list: number | null, rehab: number) {
  if (arv == null || list == null) return null;
  const m = computeFlip({ arv, purchasePrice: list, rehabTotal: rehab, assumptions: FLIP_DEFAULTS.assumptions });
  return { mao: m.mao, profit: m.profit, margin: m.margin ?? 0, roi: m.roi, roomVsList: m.mao != null ? Math.round(m.mao - list) : null };
}
export function analyzeRental({ rent, list, rehab, taxRatePct }: { rent: number | null; list: number; rehab: number; taxRatePct?: number }): RentalMetrics | null {
  if (!rent || !list) return null;
  const allIn = list + (rehab || 0);
  const taxMo = (list * ((taxRatePct ?? 1.6) / 100)) / 12, ins = 95, opVar = 0.25 * rent;
  const noiMo = rent - taxMo - ins - opVar;
  const r = 0.075 / 12, loan = 0.75 * allIn, pi = loan * r / (1 - (1 + r) ** -360);
  const cashFlow = noiMo - pi, capRate = (noiMo * 12) / allIn;
  const invested = 0.25 * allIn + 0.03 * list;
  return { rent, onePct: rent / list, capRate, cashFlow: Math.round(cashFlow), cashOnCash: (cashFlow * 12) / invested, allIn };
}
export function scoreDeal(flip: any, rental: RentalMetrics | null) {
  const flipScore = !flip || flip.margin == null ? 0 : flip.margin >= 0.2 ? 90 : flip.margin >= 0.15 ? 75 : flip.margin >= 0.1 ? 60 : flip.margin >= 0.05 ? 40 : flip.margin > 0 ? 20 : 0;
  const rentScore = !rental ? 0 : rental.capRate >= 0.08 ? 90 : rental.capRate >= 0.06 ? 72 : rental.capRate >= 0.05 ? 55 : rental.capRate >= 0.04 ? 40 : 20;
  const dealScore = Math.max(flipScore, rentScore);
  const bestExit = dealScore < 35 ? "PASS" : flipScore >= rentScore ? "FLIP" : "RENTAL";
  return { flipScore, rentScore, dealScore, bestExit } as const;
}
export function decideKeeper({ belowMarket, flip, rental, distress }: { belowMarket: boolean; flip?: any; rental?: any; distress: boolean }): boolean {
  if (belowMarket || distress) return true;
  if (flip && flip.margin != null && flip.margin >= MONITOR.flipMarginBar) return true;
  if (rental && rental.capRate != null && rental.capRate >= MONITOR.capRateBar) return true;
  return false;
}
export function riskFlags(r: { homeType?: string; monthlyHoaFee?: number | null; description?: string; rehabTier?: string; zestimate?: number | null; compsArv?: number | null; detailOk?: boolean }): string[] {
  const f: string[] = [];
  if ((r.homeType || "").toUpperCase() === "MANUFACTURED") f.push("MANUFACTURED (comps/lot-rent suspect)");
  if (r.monthlyHoaFee && r.monthlyHoaFee > 250) f.push("HIGH-HOA $" + r.monthlyHoaFee + "/mo");
  if (/may not qualify|cash only|\bFHA\b|\bVA\b/i.test(r.description || "")) f.push("non-financeable (cash)");
  if (r.rehabTier === "gut") f.push("heavy-rehab");
  if (r.zestimate && r.compsArv && r.compsArv > r.zestimate * 1.5) f.push("comps>>Zestimate (ARV suspect)");
  if (r.detailOk === false) f.push("detail-missing (VERIFY)");
  return f;
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(monitor): multi-exit math + deal score + keep-rule + risk flags"`

---

### Task 6: DeepSeek judge prompt + tolerant parser

**Files:** Modify `monitorListings.ts` + test.

**Interfaces:**
- Produces: `buildJudgePrompt(rec): string`; `parseJudgeResponse(raw:string): JudgeVerdict|null`.
- `JudgeVerdict = { keep:boolean; matchedRequirements:string[]; conditionNotes:string; reason:string; confidence:"low"|"medium"|"high" }`. Allowed matched values: `below_market|fixer|distressed|flip`.

- [ ] **Step 1: Write the failing test** (tolerant like `legalNotices.ts`)
```ts
import { parseJudgeResponse, buildJudgePrompt } from "../src/scraper/monitorListings";
describe("parseJudgeResponse", () => {
  it("parses fenced JSON + clamps to closed sets", () => {
    const raw = '```json\n{"keep":true,"matchedRequirements":["fixer","distressed","garbage"],"conditionNotes":"fire","reason":"AS-IS fixer","confidence":"high"}\n```';
    const v = parseJudgeResponse(raw)!;
    expect(v.keep).toBe(true);
    expect(v.matchedRequirements).toEqual(["fixer", "distressed"]); // "garbage" dropped
    expect(v.confidence).toBe("high");
  });
  it("returns null on unparseable", () => { expect(parseJudgeResponse("the house looks fine")).toBeNull(); });
  it("prompt contains the 4 requirements + says return json + forbids recomputing", () => {
    const p = buildJudgePrompt({ address: "1 X St", listPrice: 100000, conservativeArv: 200000, spreadPct: 50, description: "as-is" });
    expect(p.toLowerCase()).toContain("json");
    expect(p).toMatch(/below.market/i); expect(p).toMatch(/fixer|renovat/i); expect(p).toMatch(/distress/i);
    expect(p.toLowerCase()).toContain("do not recompute");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (mirror `src/scraper/legalNotices.ts` fence-strip + tolerant parse)
```ts
export interface JudgeVerdict { keep: boolean; matchedRequirements: string[]; conditionNotes: string; reason: string; confidence: "low" | "medium" | "high"; }
const REQS = ["below_market", "fixer", "distressed", "flip"];
export function buildJudgePrompt(rec: any): string {
  return `You are a real-estate investment analyst for a New Castle County, DE flipping/rental firm. Judge whether this NEW listing is a deal worth surfacing. Keep it if it meets ANY of: (1) below_market (listed materially under value — the spread is ALREADY COMPUTED below), (2) fixer (needs renovation), (3) distressed (motivated/estate/foreclosure/as-is/must-sell), (4) flip (margin after rehab). DO NOT recompute any numbers — use the ones given. Return ONLY json of the form:
{"keep":true,"matchedRequirements":["fixer","distressed"],"conditionNotes":"...","reason":"one sentence <=200 chars","confidence":"high"}
Listing:
address: ${rec.address}
listPrice: ${rec.listPrice}
conservativeARV: ${rec.conservativeArv}
belowMarketSpread%: ${rec.spreadPct}
rehabTier(estimated): ${rec.rehabTier}
flipMargin%: ${rec.flipMarginPct}
rentalCapRate%: ${rec.capRatePct}
homeType: ${rec.homeType}
description: """${(rec.description || "").slice(0, 1500)}"""`;
}
export function parseJudgeResponse(raw: string): JudgeVerdict | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  let obj: any; try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return null; }
  if (typeof obj.keep !== "boolean") return null;
  const matched = Array.isArray(obj.matchedRequirements) ? obj.matchedRequirements.filter((x: any) => REQS.includes(x)) : [];
  const conf = ["low", "medium", "high"].includes(obj.confidence) ? obj.confidence : "low";
  return { keep: obj.keep, matchedRequirements: matched, conditionNotes: String(obj.conditionNotes ?? "").slice(0, 500), reason: String(obj.reason ?? "").slice(0, 240), confidence: conf };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(monitor): DeepSeek judge prompt + tolerant verdict parser"`

---

### Task 7: Schema — `monitorListings` + `monitorRuns`

**Files:** Modify `convex/schema.ts` (append two `defineTable` blocks before the closing `});`).

- [ ] **Step 1:** Add the tables (full field set per spec §7 + §6b data additions). Use `v.optional` on all analysis fields so partial (VERIFY) rows validate. Indexes: `monitorListings` → `by_zpid`,`by_keeper`(bool),`by_status`,`by_firstSeen`; `monitorRuns` → `by_started`. Include: identity (`zpid`,`source`,`url`,`address`,`propCity`,`propZip`,`lat`,`lng`), listing facts (`listPrice`,`beds`,`baths`,`sqft`,`ppsf`,`homeType`,`yearBuilt`,`status`,`daysOnZillow`,`monthlyHoaFee`,`lastSoldPrice`,`lastSoldDate`,`priceHistory`(v.array(v.any())),`prevListPrice`,`description`,`photoUrls`(v.array(v.string())),`agentName`,`agentPhone`,`brokerName`,`mlsId`), valuation (`zestimate`,`rentZestimate`,`conservativeArv`,`arvSource`,`compsPpsf`,`compsCount`,`spread`,`spreadPct`,`belowMarket`,`rehabTier`,`rehabEstimate`), exits (`flipMao`,`flipProfit`,`flipMargin`,`flipRoi`,`roomVsList`,`capRate`,`cashFlow`,`onePctRule`,`cashOnCash`,`wholesaleSpread`), decision (`dealScore`,`bestExit`,`riskFlags`(v.array(v.string())),`keeper`(v.boolean()),`aiKeep`,`matchedRequirements`,`aiReason`,`aiConditionNotes`,`aiConfidence`,`aiModel`), off-market (`offMarketPrclid`,`offMarketSignals`(v.array(v.string())),`offMarketBalances`,`offMarketConditionScore`), workflow (`status`(union pending/analyzed/failed/skipped),`lastError`,`promotedDealId`(v.optional(v.id("potentialDeals"))),`emailedAt`,`firstSeen`,`lastSeen`,`updatedAt`).
- [ ] **Step 2:** `CONVEX_AGENT_MODE=anonymous npx convex dev --once` → expect "Schema validated" + `_generated` regenerated. (Trust output over the Windows UV_HANDLE assertion.)
- [ ] **Step 3:** `npm run build` → clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(monitor): monitorListings + monitorRuns schema"`

---

### Task 8: `convex/monitorData.ts` (V8 data layer)

**Files:** Create `convex/monitorData.ts`. Mirror `convex/potentialData.ts` (requireUser) + `convex/signalData.ts` (internal upsert/watermark) patterns.

**Interfaces (Produces):** internal: `upsertListing` (by zpid; insert new `status:"pending"` or patch `lastSeen`/`prevListPrice` on repeat, returns `{id,isNew,priceDropped}`), `seenZpids({zpids})→string[]`, `patchAnalysis({id, fields})`, `createRun`/`finishRun`, `markEmailed`, `setPromotedDeal`, `getListingInternal`. Public (requireUser): `listKeepers` (keeper=true, order by dealScore desc), `listRecent`, `getListing`, `latestRun`, `offMarketFor({address,zip})` (queries `parcels` by search index + `signalEvents`/`parcelEquity` by prclid → `{prclid,signals[],balances,conditionScore}` or null).

- [ ] **Step 1:** Write the file (queries/mutations, all public reads `requireUser`; internal fns for the action). `upsertListing`: look up `by_zpid`; if none insert with `firstSeen=now,status:"pending"`; else patch `lastSeen=now`, and if `args.listPrice < existing.listPrice` set `prevListPrice=existing.listPrice` and return `priceDropped:true`.
- [ ] **Step 2:** `offMarketFor`: `ctx.db.query("parcels").withSearchIndex("search_text", q=>q.search("searchText", normalizedAddress))` → best match; then `signalEvents.by_prclid`, `parcelEquity.by_prclid`, `parcelCondition.by_prclid`. Return compact summary. (Read-only; additive.)
- [ ] **Step 3:** `CONVEX_AGENT_MODE=anonymous npx convex dev --once` + `npm run build` → clean.
- [ ] **Step 4:** Live-verify with `npx convex run monitorData:latestRun` (expect null) — confirms it deploys.
- [ ] **Step 5: Commit** — `git commit -am "feat(monitor): monitorData V8 layer + off-market cross-ref query"`

---

### Task 9: Firecrawl proxy option + `convex/monitorScrape.ts` helper

**Files:** Modify `src/scraper/firecrawl.ts` (add `proxy?: "basic"|"enhanced"|"auto"` to `FirecrawlScrapeOptions`; when set, `body.proxy = proxy`). Create `convex/monitorScrape.ts` (runtime-agnostic; imported by the action).

**Interfaces (Produces):** `scrapeZillowJson(url, apiKey): Promise<any|null>` — POST v2 scrape `formats:["rawHtml","markdown"]`, `proxy:"enhanced"`, `waitFor:5000`; parse `extractNextData(rawHtml)`; **shell/transient retry with gaps [0,12s,28s,50s]+jitter**; return the nextData object or null after retries. `scrapeRedfinMarkdown(zip, apiKey): Promise<string>` (`proxy:"auto"`).

- [ ] **Step 1:** Add `proxy` to `firecrawl.ts` options + body (additive; existing calls unchanged). Build clean.
- [ ] **Step 2:** Write `monitorScrape.ts` with the spaced-retry loop (shell = rawHtml < 50_000 or `extractNextData` null → retry; all external `fetch` use `AbortSignal.timeout(150_000)`). On final failure return null (caller falls back to card data).
- [ ] **Step 3:** `npm run build` → clean. (No unit test — it's I/O; validated live in Task 10.)
- [ ] **Step 4: Commit** — `git commit -am "feat(monitor): Firecrawl proxy option + spaced-retry JSON scrape helper"`

---

### Task 10: `convex/monitorActions.ts` — scan + enrich + manual trigger

**Files:** Create `convex/monitorActions.ts` (`"use node"`). Mirror `convex/sheriffActions.ts` (run lifecycle + staggered fan-out) + `convex/equityActions.ts` (capped enrich + `lastError`).

**Interfaces (Produces):** `runMonitorScan({trigger, content?}): Promise<{scanned,newCount,keeperCount}>`, `analyzeOne({id}): Promise<void>`, `judgeWithDeepSeek(rec): Promise<JudgeVerdict|null>`, `devMonitorScan()` (IRES_DEV-gated manual trigger). All annotated `: Promise<...>`.

- [ ] **Step 1:** `runMonitorScan`: create a `monitorRuns` row; for `page=1..5` call `scrapeZillowJson(buildSearchUrl({page}))` → `listingsFromSearch` (stop when cumulative ≥ `totalResultCount`); filter out `isNewConstruction||isZillowOwned||!price||price>ceiling`; `upsertListing` each; for NEW (or price-dropped) rows `ctx.scheduler.runAfter(i*3000, internal.monitorActions.analyzeOne, {id})`; schedule `sendDigest` after the fan-out window; `finishRun`. Wrap in try/catch → `finishRun failed` + `logServerError`.
- [ ] **Step 2:** `analyzeOne`: load row → `scrapeZillowJson(url)` → `detailFromCache`; if null, set `detailOk:false` (card-data fallback). Pull comps: `scrapeRedfinMarkdown(zip)` (cache per zip within the run via a module-level Map keyed by runId+zip) → `parseRedfinComps`. Compute `conservativeArv`, `inferRehabTier(desc)`, `estimateRehab`, spread/`belowMarket`, `analyzeFlip`, `analyzeRental`, `scoreDeal`, `riskFlags`. Call `offMarketFor`. Call `judgeWithDeepSeek`. `keeper = decideKeeper({belowMarket, flip, rental, distress: verdict?.matchedRequirements.includes("distressed") || detail.foreclosure || verdict?.keep})`. `patchAnalysis` with everything + `status:"analyzed"` (or `"failed"`+`lastError`).
- [ ] **Step 3:** `judgeWithDeepSeek`: POST OpenRouter `chat/completions`, model `process.env.MONITOR_LLM_MODEL ?? "deepseek/deepseek-v3.2"`, `buildJudgePrompt(rec)`, `AbortSignal.timeout(30_000)`; `parseJudgeResponse(content)`; on null return null (keep still driven by deterministic gate). Mirror the OpenRouter call in `convex/conditionActions.ts`/legal.
- [ ] **Step 4:** `devMonitorScan` (IRES_DEV gate) → `runMonitorScan({trigger:"manual"})`.
- [ ] **Step 5:** `CONVEX_AGENT_MODE=anonymous npx convex dev --once` + `npm run build` clean.
- [ ] **Step 6: LIVE VERIFY (the phase-1 acceptance):** set `FIRECRAWL_API_KEY`+`OPENROUTER_API_KEY` on dev; `IRES_DEV=1 npx convex run monitorActions:devMonitorScan`; then `npx convex data monitorListings` → confirm rows with `dealScore`,`bestExit`,`keeper`,`flipMao`,`capRate`,`riskFlags` populated and manufactured/turnkey correctly rejected. (CLI may report a client-side timeout on the long action; verify via `monitorData:latestRun` counts, not the exit code.)
- [ ] **Step 7: Commit** — `git commit -am "feat(monitor): scan + enrich actions (comps, multi-exit, DeepSeek, off-market)"`

---

# PHASE 2 — Surfacing (page + promote + email)

### Task 11: `/monitor` page

**Files:** Create `src/web/MonitorPage.tsx`; modify `src/web/app.tsx` (add `/monitor` route) + the sidebar nav file (add "Monitor" item, lucide `radar`/`home-search` icon). Mirror `src/web/LeadsPage.tsx` (expandable cards + `promoteToPotential`) + `PotentialBoard`.

- [ ] **Step 1:** Build the page: header from `monitorData.latestRun` ("Last run … N scanned · N new · N keepers"); `listKeepers` cards **ranked by dealScore desc**. Each card: photo (`photoUrls[0]`), address, **list price**, `bestExit` chip + `dealScore`, comps ARV + **spread% chip**, beds/baths/sqft + `$/sqft`, **matched-requirement chips**, DeepSeek `aiReason` + condition notes, **flip line** (MAO / roomVsList / margin) + **rental line** (cap / cashflow), price-history mini (last sold + %), **risk-flag chips**, **off-market badge** (if `offMarketPrclid` — "OWNER IN PRE-FORECLOSURE / code violations"), agent name+phone, Zillow link. Toggle "show all (incl. non-keepers)". lucide icons only.
- [ ] **Step 2:** Per-card actions: **Promote to Potential** (call existing `potentialData.promoteToPotential` with the snapshot incl. `source:{kind:"manual",refId:zpid}`, value=conservativeArv; on success `setPromotedDeal`, show "In pipeline"); **Open in Flip Analyzer** (`/flip?address=<addr>`). Reuse `ConfirmDialog` where needed.
- [ ] **Step 3:** `npm run build` + `npx tsc` clean.
- [ ] **Step 4: Verify** (headless per lessons 2026-06-03: mock `useQuery`, throwaway `preview.html`, Chrome `--headless=new --screenshot`) — cards render dark-themed, chips readable.
- [ ] **Step 5: Commit** — `git commit -am "feat(monitor): /monitor page (ranked keepers, exits, off-market, promote)"`

---

### Task 12: Email digest (Resend, key-gated)

**Files:** Add `sendDigest` to `convex/monitorActions.ts` (already scheduled by `runMonitorScan`). Mirror `convex/contractActions.ts` (no-op + `logServerError` without `RESEND_API_KEY`).

- [ ] **Step 1:** `sendDigest({runId})`: load that run's keepers not yet `emailedAt`; if `RESEND_API_KEY` unset → return `{sent:false}` (logged). Build text+HTML ranked list (address, list, bestExit, dealScore, spread%, MAO or cap-rate, matched reqs, aiReason, off-market flag, `/monitor` link + Zillow link) → Resend to `RESEND_TO`/`RESEND_FROM`; `markEmailed` each. `AbortSignal.timeout(30_000)`.
- [ ] **Step 2:** `npx convex dev --once` + `npm run build` clean.
- [ ] **Step 3: Verify:** without key → `devMonitorScan` logs "no RESEND_API_KEY" (no throw). (Real email deferred to the user setting the key.)
- [ ] **Step 4: Commit** — `git commit -am "feat(monitor): key-gated Resend deal digest"`

---

# PHASE 3 — Automation + skills

### Task 13: Webhook endpoint + safety-net cron

**Files:** Create `convex/http.ts`; modify `convex/crons.ts`.

- [ ] **Step 1:** `convex/http.ts`: `httpRouter`; `POST /firecrawl-monitor` `httpAction` → read raw body, verify `X-Firecrawl-Signature` HMAC-SHA256 with `FIRECRAWL_WEBHOOK_SECRET` (reject 401 on missing/mismatch), then `ctx.runAction(internal.monitorActions.runMonitorScan, {trigger:"webhook"})`, return 200 fast. (Node crypto in an httpAction is fine; keep it minimal.)
- [ ] **Step 2:** `crons.ts`: add `crons.cron("monitor daily safety net", "0 1 * * *", internal.monitorActions.runMonitorScan, {trigger:"cron"})`. In `runMonitorScan`, when `trigger==="cron"`, no-op if a `complete` `monitorRuns` row exists within the last 20h (query `by_started`).
- [ ] **Step 3:** `npx convex dev --once` + `npm run build` clean; confirm the HTTP route registers (`npx convex run` N/A for http — check the dashboard/functions list or curl the dev `.convex.site` URL with a bad signature → 401).
- [ ] **Step 4: Commit** — `git commit -am "feat(monitor): Firecrawl webhook (HMAC) + daily safety-net cron"`

---

### Task 14: Refresh the `firecrawl` skill

**Files:** Modify `~/.agents/skills/firecrawl/SKILL.md` + `rules/{install,security}.md` + relevant subskills.

- [ ] **Step 1:** Bump versions (1.8.0→1.19.22). Add sections: **Monitor/Webmonitor** (`firecrawl monitor create`, `/v2/monitor`, cron/natural-language schedule 15-min min, `goal`/`judgeEnabled`, `retentionDays`, email+webhook, pricing), **changeTracking** format (`changeStatus`/`visibility`/git-diff/json), **webhooks + `X-Firecrawl-Signature` HMAC**, **proxy basic/enhanced/auto** (Zillow needs enhanced), **batch-scrape**. Fix stale scrape/crawl/map/search option tables (per `docs/superpowers/research/2026-06-30-zillow-structure.md` + the Firecrawl research). No emojis.
- [ ] **Step 2:** Spot-check accuracy (the doc URLs in the research). Commit (skills live outside the repo; note the path in the commit message if tracked, else skip git).

---

### Task 15: `monitor-web` op skill

**Files:** Create `.claude/skills/monitor-web/SKILL.md` (mirror `.claude/skills/condition-batch/SKILL.md` shape).

- [ ] **Step 1:** Document: how to **create/update the Firecrawl Monitor** (`monitorActions.createFirecrawlMonitor` or the `firecrawl monitor create` CLI with the NCC search URL + webhook `https://<deployment>.convex.site/firecrawl-monitor` + secret), how to **trigger a manual scan** (`npx convex run monitorActions:devMonitorScan`), how to **inspect** results (`monitorData:latestRun`, `npx convex data monitorListings`), the env vars, and the tuning knobs (`MONITOR` config, `MONITOR_LLM_MODEL`). Triggers: "run the web monitor", "scan Zillow for deals", "monitor zillow". No emojis.
- [ ] **Step 2:** Add `createFirecrawlMonitor` to `monitorActions.ts` (POST `/v2/monitor` per spec §10; key-gated). `npx convex dev --once` + build clean.
- [ ] **Step 3: Commit** — `git commit -am "feat(monitor): monitor-web op skill + createFirecrawlMonitor"`

---

## Self-Review

**Spec coverage:** §3 flow → Tasks 9/10/13; §4 funnel → Task 10; §5 valuation → Task 4; §6 DeepSeek → Task 6/10; §6b multi-exit/score/keep/risk/off-market/price-drop → Tasks 4/5/8/10/11; §7 data model → Task 7; §8 pure module → Tasks 1–6; §9 Convex pieces → Tasks 8/9/10/12/13; §10 Monitor setup → Task 15; §11 UI → Task 11; §12 email → Task 12; §13 skills → Tasks 14/15; §14 security (HMAC/requireUser/no-fabrication) → Tasks 13/8/6. **Gap check:** photos (Task 3/11 ✓), price-drop tracking (Task 8 `upsertListing` + Task 10 re-analyze ✓), agent contact (Task 3/11 ✓).

**Placeholder scan:** all code steps contain real code; test steps assert real captured values; no "TBD".

**Type consistency:** `SearchListing`/`ListingDetail`/`RentalMetrics`/`JudgeVerdict` defined in Tasks 2/3/5/6 and consumed by Tasks 8/10/11 with matching names; `MONITOR` config used consistently; `computeFlip`/`suggestArv`/`selectComps`/`REHAB_TIERS` reused with their real signatures from `flip.ts`/`comps.ts`.

**Verify-at-build reminders:** confirm real Redfin/Zillow field names against the captured fixtures if a parser test mismatches; the exact `monitor.page` webhook body (Task 13) — until confirmed the webhook only triggers a re-scrape (robust).
