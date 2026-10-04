import { describe, it, expect } from "vitest";
import { buildSearchUrl, listingsFromSearch, detailFromCache, passesScanGate, MONITOR } from "../src/scraper/monitorListings";
import type { SearchListing } from "../src/scraper/monitorListings";

const sqsOf = (url: string) => JSON.parse(decodeURIComponent(url.split("searchQueryState=")[1]));

describe("buildSearchUrl price-cut mode", () => {
  it("nightly URL is byte-identical with or without priceCutOnly:false", () => {
    expect(buildSearchUrl({ priceCutOnly: false })).toBe(buildSearchUrl({}));
    expect(buildSearchUrl({ page: 2, priceCutOnly: false })).toBe(buildSearchUrl({ page: 2 }));
  });
  it("price-cut sweep: onlyPriceReduction, any days on Zillow, newest sort, ceiling", () => {
    const sqs = sqsOf(buildSearchUrl({ priceCutOnly: true, page: 3 }));
    expect(sqs.filterState.onlyPriceReduction).toEqual({ value: true });
    expect(sqs.filterState.doz).toBeUndefined();
    expect(sqs.filterState.sort).toEqual({ value: "days" });
    expect(sqs.filterState.price).toEqual({ max: 500000 });
    expect(sqs.pagination).toEqual({ currentPage: 3 });
    expect(sqs.regionSelection[0]).toEqual({ regionId: 2986, regionType: 4 });
  });
  it("page cap covers the verified 6-page sweep with headroom", () => {
    expect(MONITOR.cutSearchMaxPages).toBeGreaterThanOrEqual(6);
  });
});

// Shapes copied from the live 2026-10-04 price-cut sweep (zpids real, other fields trimmed).
const CUT_NEXT = { props: { pageProps: { searchPageState: { cat1: {
  searchList: { totalResultCount: 208 },
  searchResults: { listResults: [
    { zpid: "72940572", unformattedPrice: 330000, area: 1400, address: "1 A St, Wilmington, DE 19805", addressZipcode: "19805",
      detailUrl: "https://www.zillow.com/homedetails/1-A-St/72940572_zpid/",
      hdpData: { homeInfo: { homeType: "SINGLE_FAMILY", homeStatus: "FOR_SALE", daysOnZillow: 72, priceChange: -40000, datePriceChanged: 1790838000000 } } },
    { zpid: "73015515", unformattedPrice: 359900, address: "2 B St, Newark, DE 19711",
      detailUrl: "https://www.zillow.com/homedetails/2-B-St/73015515_zpid/",
      hdpData: { homeInfo: { homeType: "TOWNHOUSE", homeStatus: "FOR_SALE" } } },
  ] },
} } } } };

describe("listingsFromSearch tracking fields", () => {
  it("carries homeStatus, priceChange and datePriceChanged from homeInfo", () => {
    const [a, b] = listingsFromSearch(CUT_NEXT);
    expect(a.homeStatus).toBe("FOR_SALE");
    expect(a.priceChange).toBe(-40000);
    expect(a.datePriceChanged).toBe(1790838000000);
    expect(b.homeStatus).toBe("FOR_SALE");
    expect(b.priceChange).toBeUndefined();
    expect(b.datePriceChanged).toBeUndefined();
  });
});

const detailWith = (property: object) => ({ props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify({
  'ForSaleFullRenderQuery{"zpid":72975668}': { property },
}) } } } });

describe("detailFromCache tracking fields", () => {
  it("reads the current price and the isPending sub-type flag", () => {
    const d = detailFromCache(detailWith({ price: 435000, homeStatus: "FOR_SALE", listingSubType: { isPending: false } }))!;
    expect(d.price).toBe(435000);
    expect(d.homeStatus).toBe("FOR_SALE");
    expect(d.isPending).toBe(false);
    const p = detailFromCache(detailWith({ price: 435000, homeStatus: "FOR_SALE", listingSubType: { isPending: true } }))!;
    expect(p.isPending).toBe(true);
  });
  it("missing price -> null, missing sub-type -> not pending", () => {
    const d = detailFromCache(detailWith({ homeStatus: "OTHER" }))!;
    expect(d.price).toBeNull();
    expect(d.isPending).toBe(false);
  });
});

const card = (o: Partial<SearchListing> = {}): SearchListing => ({
  zpid: "1", price: 250000, beds: 3, baths: 1, sqft: 1200, ppsf: 208, status: "", homeType: "SINGLE_FAMILY",
  zestimate: null, zestSpreadPct: null, address: "x", isNewConstruction: false, isZillowOwned: false, url: "u", ...o,
});

describe("passesScanGate (shared by the nightly scan and the price-cut sweep)", () => {
  it("keeps an ordinary priced house", () => {
    expect(passesScanGate(card())).toBe(true);
  });
  it("drops new construction, Zillow-owned, multi-family, condo, unpriced and out-of-band prices", () => {
    expect(passesScanGate(card({ isNewConstruction: true }))).toBe(false);
    expect(passesScanGate(card({ isZillowOwned: true }))).toBe(false);
    expect(passesScanGate(card({ homeType: "MULTI_FAMILY" }))).toBe(false);
    expect(passesScanGate(card({ homeType: "CONDO" }))).toBe(false);
    expect(passesScanGate(card({ price: null }))).toBe(false);
    expect(passesScanGate(card({ price: 500 }))).toBe(false);
    expect(passesScanGate(card({ price: 500001 }))).toBe(false);
  });
});
