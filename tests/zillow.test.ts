import { describe, it, expect } from "vitest";
import {
  buildZillowSearchUrl,
  extractFields,
  extractHomedetailsUrl,
  isDelawareUrl,
} from "../src/scraper/zillow.js";

describe("buildZillowSearchUrl", () => {
  it("slugifies an address", () => {
    expect(buildZillowSearchUrl("100 Main St, Wilmington, DE 19801")).toBe(
      "https://www.zillow.com/homes/100-Main-St-Wilmington-DE-19801_rb/",
    );
  });
});

describe("extractFields", () => {
  const md =
    "4 beds 2.5 baths 1,800 sqft. Zestimate®: $298,700. Lot: 7,500 sqft lot.";
  const f = extractFields(md);

  it("extracts beds/baths/sqft/zestimate", () => {
    expect(f.beds).toBe("4");
    expect(f.baths).toBe("2.5");
    expect(f.sqft).toBe("1,800 sqft");
    expect(f.zestimate).toBe("$298,700");
  });

  it("extracts lot size separately from house sqft", () => {
    expect(f.lotSize).toContain("lot");
  });
});

describe("extractHomedetailsUrl", () => {
  it("pulls an absolute homedetails URL", () => {
    const text =
      "blah [link](https://www.zillow.com/homedetails/100-Main-St-Wilmington-DE-19801/12345_zpid/) blah";
    expect(extractHomedetailsUrl(text)).toBe(
      "https://www.zillow.com/homedetails/100-Main-St-Wilmington-DE-19801/12345_zpid/",
    );
  });

  it("returns null when no homedetails link is present", () => {
    expect(extractHomedetailsUrl("no links here")).toBeNull();
  });
});

describe("isDelawareUrl", () => {
  it("accepts DE, rejects others", () => {
    expect(
      isDelawareUrl("https://www.zillow.com/homedetails/100-Main-St-Wilmington-DE-19801/1_zpid/"),
    ).toBe(true);
    expect(
      isDelawareUrl("https://www.zillow.com/homedetails/100-Main-St-Philadelphia-PA-19103/1_zpid/"),
    ).toBe(false);
  });
});
