import { describe, it, expect } from "vitest";
import { buildSearchUrl } from "../src/scraper/monitorListings";
import { extractNextData, listingsFromSearch, totalResultCount } from "../src/scraper/monitorListings";
import { detailFromCache } from "../src/scraper/monitorListings";
import { conservativeArv, inferRehabTier, detectRenovated } from "../src/scraper/monitorListings";
import { analyzeFlip, analyzeRental, scoreDeal, decideKeeper, riskFlags } from "../src/scraper/monitorListings";
import { isLandType, isMultiUnitType, isCondoType, digestRecipients } from "../src/scraper/monitorListings";
import { parseJudgeResponse, buildJudgePrompt } from "../src/scraper/monitorListings";
import { computeFlip, FLIP_DEFAULTS } from "../src/scraper/flip";
import { deriveDealSignals } from "../src/scraper/dealSignals";
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
  it("word 'dated' still reads moderate (word-boundary regression pin)", () => { expect(inferRehabTier("dated kitchen, needs updating")).toBe("moderate"); });
  it("'updated' no longer substring-matches MODERATE's 'dated' -> cosmetic", () => { expect(inferRehabTier("Updated kitchen and baths, move-in ready")).toBe("cosmetic"); });
});

describe("detectRenovated", () => {
  it("true on explicit done-renovation language", () => {
    expect(detectRenovated("Beautifully renovated 3BR with new kitchen")).toBe(true);
    expect(detectRenovated("Fully remodeled from top to bottom")).toBe(true);
    expect(detectRenovated("Recently rehabbed, turnkey rental")).toBe(true);
    expect(detectRenovated("Updated kitchen and baths, move-in ready")).toBe(true);
    expect(detectRenovated("Completely updated throughout")).toBe(true);
    expect(detectRenovated("Shows like new")).toBe(true);
  });
  it("false when needs-work language wins or it's a renovation opportunity", () => {
    expect(detectRenovated("Needs renovation — bring your vision")).toBe(false);
    expect(detectRenovated("Great renovation opportunity for investors")).toBe(false);
    expect(detectRenovated("Partially renovated, unfinished basement project")).toBe(false);
    expect(detectRenovated("Move-in ready charmer")).toBe(false); // bare move-in
    expect(detectRenovated("Renovated kitchen but the rest needs TLC")).toBe(false); // MODERATE wins
    expect(detectRenovated("Sold strictly as-is, full rehab needed")).toBe(false); // GUT wins
  });
  it("false on empty / undefined / null", () => {
    expect(detectRenovated("")).toBe(false);
    expect(detectRenovated(undefined)).toBe(false);
    expect(detectRenovated(null)).toBe(false);
  });
});

describe("analyzeFlip", () => {
  it("computes MAO/profit/margin/roomVsList (918 Kirkwood: ARV 247200, list 125000, cosmetic rehab ~23265)", () => {
    const f = analyzeFlip(247200, 125000, 23265)!;
    expect(f.mao).toBe(Math.round((0.68 * 247200 - 23265) / 1.02)); // 141991 — NCC-corrected MAO
    expect(f.roomVsList).toBe(f.mao! - 125000); // ~+16991 (can offer below list)
    expect(f.margin).toBeGreaterThan(0.2); // ~25% under NCC-corrected assumptions
  });
  it("NCC transfer-tax correction lowers flip profit vs FLIP_DEFAULTS (relationship + exact)", () => {
    // Corrected monitor underwriting (MONITOR_FLIP_ASSUMPTIONS: +2% buy closing, +2% ARV transfer)
    const corrected = analyzeFlip(300000, 200000, 40000)!;
    // Generic /flip math for the same deal (unchanged FLIP_DEFAULTS)
    const generic = computeFlip({ arv: 300000, purchasePrice: 200000, rehabTotal: 40000, assumptions: FLIP_DEFAULTS.assumptions });
    // Relationship: transfer tax makes the monitor's economics strictly worse.
    expect(corrected.profit!).toBeLessThan(generic.profit!);
    // NCC-corrected MAO is LOWER than the generic 70%-rule ceiling.
    expect(corrected.mao!).toBeLessThan(generic.mao!);
    // Exact corrected values.
    expect(corrected.mao).toBe(160784); // (0.68·300000 − 40000)/1.02
    expect(corrected.profit).toBe(9100);
    expect(corrected.margin).toBeCloseTo(91 / 3000, 10);
    expect(corrected.roomVsList).toBe(160784 - 200000); // -39216
    // The gap is exactly the missing BUY-leg transfer tax: 2% of purchase.
    expect(generic.profit! - corrected.profit!).toBe(200000 * 0.02);
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
  it("keeps when a deterministic exit clears (below-market OR flip OR rental)", () => {
    expect(decideKeeper({ belowMarket: true, distress: false, spread: null, dealScore: 0 })).toBe(true);
    expect(decideKeeper({ belowMarket: false, flip: { margin: 0.2 }, distress: false, spread: null, dealScore: 0 })).toBe(true);
    expect(decideKeeper({ belowMarket: false, rental: { capRate: 0.09 }, distress: false, spread: null, dealScore: 0 })).toBe(true);
    expect(decideKeeper({ belowMarket: false, flip: { margin: 0.02 }, rental: { capRate: 0.03 }, distress: false, spread: null, dealScore: 0 })).toBe(false);
  });
  it("distress keeps ONLY when not above market (spread>=0) OR dealScore>=floor", () => {
    // above-market AS-IS boilerplate (508 Lake Dr / 513 W 37th noise) — dropped
    expect(decideKeeper({ belowMarket: false, distress: true, spread: -20000, dealScore: 0 })).toBe(false);
    // distressed and not above market — kept
    expect(decideKeeper({ belowMarket: false, distress: true, spread: 0, dealScore: 0 })).toBe(true);
    expect(decideKeeper({ belowMarket: false, distress: true, spread: 25000, dealScore: 0 })).toBe(true);
    // unknown spread is not a free pass
    expect(decideKeeper({ belowMarket: false, distress: true, spread: null, dealScore: 0 })).toBe(false);
    // score floor keeps it
    expect(decideKeeper({ belowMarket: false, distress: true, spread: null, dealScore: 40 })).toBe(true);
    // below the 30 floor
    expect(decideKeeper({ belowMarket: false, distress: true, spread: -20000, dealScore: 20 })).toBe(false);
    // deterministic rental keep unchanged (218 W 23rd)
    expect(decideKeeper({ belowMarket: false, distress: false, rental: { capRate: 0.065 }, spread: null, dealScore: 0 })).toBe(true);
  });
});
describe("riskFlags", () => {
  it("flags manufactured, high HOA, non-financeable, ARV-suspect, detail-missing", () => {
    const f = riskFlags({ homeType: "MANUFACTURED", monthlyHoaFee: 400, description: "cash only, may not qualify FHA/VA", rehabTier: "gut", zestimate: 100000, compsArv: 300000, detailOk: false });
    expect(f).toEqual(expect.arrayContaining([expect.stringContaining("MANUFACTURED"), expect.stringContaining("HOA"), expect.stringContaining("financeable"), expect.stringContaining("heavy-rehab"), expect.stringContaining("ARV"), expect.stringContaining("VERIFY")]));
  });
});

describe("isLandType", () => {
  it("true for LOT / LAND (case-insensitive, trimmed)", () => {
    expect(isLandType("LOT")).toBe(true);
    expect(isLandType("LAND")).toBe(true);
    expect(isLandType("lot")).toBe(true);
    expect(isLandType(" LOT ")).toBe(true);
  });
  it("false for house types and empty/undefined/null", () => {
    expect(isLandType("SINGLE_FAMILY")).toBe(false);
    expect(isLandType("MANUFACTURED")).toBe(false);
    expect(isLandType(undefined)).toBe(false);
    expect(isLandType(null)).toBe(false);
    expect(isLandType("")).toBe(false);
  });
});

describe("isMultiUnitType", () => {
  it("true for apartment / multi-family types (case-insensitive, trimmed, underscore-optional)", () => {
    expect(isMultiUnitType("MULTI_FAMILY")).toBe(true);
    expect(isMultiUnitType("APARTMENT")).toBe(true);
    expect(isMultiUnitType("multi_family")).toBe(true);
    expect(isMultiUnitType(" MULTIFAMILY ")).toBe(true);
    expect(isMultiUnitType("APARTMENT_TYPE")).toBe(true);
  });
  it("false for wholesale-relevant types and empty/undefined/null", () => {
    expect(isMultiUnitType("SINGLE_FAMILY")).toBe(false);
    expect(isMultiUnitType("TOWNHOUSE")).toBe(false);
    expect(isMultiUnitType("CONDO")).toBe(false);
    expect(isMultiUnitType("MANUFACTURED")).toBe(false);
    expect(isMultiUnitType(undefined)).toBe(false);
    expect(isMultiUnitType(null)).toBe(false);
    expect(isMultiUnitType("")).toBe(false);
  });
});

describe("isCondoType", () => {
  it("true for condo / co-op units (case-insensitive, trimmed)", () => {
    expect(isCondoType("CONDO")).toBe(true);
    expect(isCondoType("condo")).toBe(true);
    expect(isCondoType(" CONDO ")).toBe(true);
    expect(isCondoType("COOP")).toBe(true);
    expect(isCondoType("CO_OP")).toBe(true);
  });
  it("false for wholesale-relevant types and empty/undefined/null", () => {
    expect(isCondoType("SINGLE_FAMILY")).toBe(false);
    expect(isCondoType("TOWNHOUSE")).toBe(false);
    expect(isCondoType("MANUFACTURED")).toBe(false);
    expect(isCondoType(undefined)).toBe(false);
    expect(isCondoType(null)).toBe(false);
    expect(isCondoType("")).toBe(false);
  });
});

describe("digestRecipients", () => {
  it("merges user emails with the fallback address, deduping case-insensitively", () => {
    expect(digestRecipients(["a@x.com", "B@Y.com"], "b@y.com")).toEqual(["a@x.com", "B@Y.com"]);
  });
  it("trims entries and drops blanks/non-emails", () => {
    expect(digestRecipients([" a@x.com ", "", "   ", "not-an-email"], undefined)).toEqual(["a@x.com"]);
  });
  it("falls back to the single address when there are no user emails", () => {
    expect(digestRecipients([], "admin@x.com")).toEqual(["admin@x.com"]);
  });
  it("returns [] when nothing is valid", () => {
    expect(digestRecipients([], "")).toEqual([]);
    expect(digestRecipients(["nope"], undefined)).toEqual([]);
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
  it("parses renovated:true, defaults missing renovated to false", () => {
    const yes = parseJudgeResponse('{"keep":false,"matchedRequirements":[],"conditionNotes":"","reason":"already flipped","confidence":"high","renovated":true}')!;
    expect(yes.renovated).toBe(true);
    const missing = parseJudgeResponse('{"keep":true,"matchedRequirements":["fixer"],"conditionNotes":"","reason":"fixer","confidence":"low"}')!;
    expect(missing.renovated).toBe(false); // missing field -> false
    const truthy = parseJudgeResponse('{"keep":false,"matchedRequirements":[],"conditionNotes":"","reason":"x","confidence":"low","renovated":"yes"}')!;
    expect(truthy.renovated).toBe(false); // tolerant: anything not === true is false
  });
  it("prompt contains the 4 requirements + says return json + forbids recomputing + asks for renovated", () => {
    const p = buildJudgePrompt({ address: "1 X St", listPrice: 100000, conservativeArv: 200000, spreadPct: 50, description: "as-is" });
    expect(p.toLowerCase()).toContain("json");
    expect(p).toMatch(/below.market/i); expect(p).toMatch(/fixer|renovat/i); expect(p).toMatch(/distress/i);
    expect(p.toLowerCase()).toContain("do not recompute");
    expect(p).toContain('"renovated":false');
    expect(p.toLowerCase()).toContain("already renovated");
  });
});

// ── v2 prompt + parser (deep-analysis breakdown) ──────────────────────────────
describe("buildJudgePrompt v2 (rubric + dealSignals block)", () => {
  const dealSignals = deriveDealSignals({
    listPrice: 180000,
    sqft: 1500,
    priceHistory: [
      { date: "2026-01-10", event: "Listed for sale", price: 210000, ppsf: 140 },
      { date: "2026-03-01", event: "Price change", price: 180000, ppsf: 120 },
    ],
    lastSoldPrice: 90000,
    dateSold: "2004-05-01",
    daysOnZillow: 120,
    yearBuilt: 1968,
    photoCount: 4,
    compsPpsf: 160,
    zip: "19702",
    now: Date.parse("2026-07-04"),
  });
  const p = buildJudgePrompt({
    address: "12 Motivated Ln, Newark, DE 19702",
    listPrice: 180000,
    conservativeArv: 260000,
    spreadPct: 30,
    rehabTier: "moderate",
    flipMarginPct: 18,
    capRatePct: 7,
    homeType: "SINGLE_FAMILY",
    yearBuilt: 1968,
    photoCount: 4,
    lastSoldPrice: 90000,
    lastSoldDate: "2004-05-01",
    daysOnMarket: 120,
    priceHistoryCompact: "2026-01-10 Listed for sale $210000 | 2026-03-01 Price change $180000",
    dealSignals,
    description: "Investor special — needs TLC, sold as-is, motivated seller",
  });

  it("keeps ALL legacy markers (backward compatible)", () => {
    expect(p.toLowerCase()).toContain("json");
    expect(p).toMatch(/below.market/i);
    expect(p).toMatch(/fixer|renovat/i);
    expect(p).toMatch(/distress/i);
    expect(p.toLowerCase()).toContain("do not recompute");
    expect(p).toContain('"renovated":false');
    expect(p.toLowerCase()).toContain("already renovated");
  });

  it("embeds the condition-tier rubric vocabulary", () => {
    expect(p).toContain("cosmetic");
    expect(p).toContain("moderate");
    expect(p).toContain("systems");
    expect(p).toContain("structural");
  });

  it("embeds the exit-triage routing words", () => {
    expect(p).toContain("WHOLETAIL");
    expect(p).toContain("FLIP");
    expect(p).toContain("RENTAL");
    expect(p).toContain("WHOLESALE");
  });

  it("names the v2 output fields", () => {
    expect(p).toContain("conditionTier");
    expect(p).toContain("exitTriage");
    expect(p).toContain("valueAddScope");
    expect(p).toContain("breakdown");
  });

  it("prints the GIVEN dealSignals block + the extra facts", () => {
    expect(p).toContain("motivationPoints");
    expect(p).toContain("motivationSignals");
    expect(p).toContain("ppsfDiscount"); // ppsfDiscountVsComps label
    expect(p).toContain("yearBuilt");
    expect(p).toContain("photoCount");
    expect(p).toContain("priceHistory");
    // the dealSignals block actually computed a motivation signal from the cut
    expect(dealSignals.motivationPoints).toBeGreaterThan(0);
  });

  it("omits the dealSignals block when rec.dealSignals is absent", () => {
    const bare = buildJudgePrompt({ address: "1 X St", listPrice: 100000, conservativeArv: 200000, spreadPct: 50, description: "as-is" });
    expect(bare).toContain("dealSignals: n/a");
  });
});

describe("parseJudgeResponse v2 (condition/exit breakdown)", () => {
  it("parses a full valid v2 verdict + respects closed vocab", () => {
    const raw = JSON.stringify({
      keep: true,
      matchedRequirements: ["fixer", "distressed"],
      renovated: false,
      conditionTier: "moderate",
      valueAddScope: "kitchen + baths + paint",
      redFlags: ["oil tank risk"],
      verifyGates: ["confirm no leak"],
      exitTriage: "FLIP",
      exitFallbacks: ["WHOLETAIL", "RENTAL"],
      breakdown: "moderate fixer, big spread, both floors clear -> flip",
      confidence: "high",
      conditionNotes: "needs TLC",
      reason: "as-is fixer with spread",
    });
    const v = parseJudgeResponse(raw)!;
    expect(v.keep).toBe(true);
    expect(v.matchedRequirements).toEqual(["fixer", "distressed"]);
    expect(v.conditionTier).toBe("moderate");
    expect(v.valueAddScope).toBe("kitchen + baths + paint");
    expect(v.redFlags).toEqual(["oil tank risk"]);
    expect(v.verifyGates).toEqual(["confirm no leak"]);
    expect(v.exitTriage).toBe("FLIP");
    expect(v.exitFallbacks).toEqual(["WHOLETAIL", "RENTAL"]);
    expect(v.breakdown).toContain("moderate fixer");
    expect(v.confidence).toBe("high");
  });

  it("defaults missing v2 fields (null scalars, empty arrays), legacy still works", () => {
    const v = parseJudgeResponse('{"keep":true,"matchedRequirements":["fixer"],"conditionNotes":"","reason":"fixer","confidence":"low","renovated":true}')!;
    expect(v.keep).toBe(true);
    expect(v.renovated).toBe(true);
    expect(v.conditionTier).toBeNull();
    expect(v.exitTriage).toBeNull();
    expect(v.valueAddScope).toBeNull();
    expect(v.breakdown).toBeNull();
    expect(v.redFlags).toEqual([]);
    expect(v.verifyGates).toEqual([]);
    expect(v.exitFallbacks).toEqual([]);
  });

  it("rejects junk vocab + non-array flags", () => {
    const v = parseJudgeResponse('{"keep":true,"matchedRequirements":[],"conditionTier":"banana","exitTriage":"FLOP","redFlags":"nope","confidence":"low"}')!;
    expect(v.conditionTier).toBeNull();
    expect(v.exitTriage).toBeNull();
    expect(v.redFlags).toEqual([]);
  });

  it("clamps oversized strings (valueAddScope 300, breakdown 900, redFlags entry 120)", () => {
    const raw = JSON.stringify({
      keep: true,
      matchedRequirements: [],
      conditionTier: "systems",
      valueAddScope: "a".repeat(500),
      breakdown: "b".repeat(2000),
      redFlags: ["c".repeat(400)],
      exitTriage: "RENTAL",
      confidence: "medium",
    });
    const v = parseJudgeResponse(raw)!;
    expect(v.valueAddScope!.length).toBe(300);
    expect(v.breakdown!.length).toBe(900);
    expect(v.redFlags[0].length).toBe(120);
  });

  it("parses a fenced ```json block with v2 fields", () => {
    const raw = '```json\n{"keep":true,"matchedRequirements":["flip"],"conditionTier":"cosmetic","exitTriage":"WHOLETAIL","valueAddScope":"paint + carpet","confidence":"high"}\n```';
    const v = parseJudgeResponse(raw)!;
    expect(v.keep).toBe(true);
    expect(v.matchedRequirements).toEqual(["flip"]);
    expect(v.conditionTier).toBe("cosmetic");
    expect(v.exitTriage).toBe("WHOLETAIL");
    expect(v.valueAddScope).toBe("paint + carpet");
  });
});
