import { describe, it, expect } from "vitest";
import { MONITOR, buildSearchUrl } from "../src/scraper/monitorListings";
import { extractNextData, listingsFromSearch, totalResultCount } from "../src/scraper/monitorListings";
import { detailFromCache } from "../src/scraper/monitorListings";

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
