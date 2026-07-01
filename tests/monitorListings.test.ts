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
