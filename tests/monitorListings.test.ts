import { describe, it, expect } from "vitest";
import { buildSearchUrl } from "../src/scraper/monitorListings";
import { extractNextData, listingsFromSearch, totalResultCount } from "../src/scraper/monitorListings";
import { detailFromCache } from "../src/scraper/monitorListings";
import { conservativeArv, inferRehabTier } from "../src/scraper/monitorListings";
import { analyzeFlip, analyzeRental, scoreDeal, decideKeeper, riskFlags } from "../src/scraper/monitorListings";
import { parseJudgeResponse, buildJudgePrompt } from "../src/scraper/monitorListings";
import type { Comp } from "../src/scraper/comps";

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

describe("analyzeFlip", () => {
  it("computes MAO/profit/margin/roomVsList (918 Kirkwood: ARV 247200, list 125000, cosmetic rehab ~23265)", () => {
    const f = analyzeFlip(247200, 125000, 23265)!;
    expect(f.mao).toBe(Math.round(247200 * 0.7 - 23265)); // 149775
    expect(f.roomVsList).toBe(f.mao! - 125000); // ~+24775 (can offer below list)
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
