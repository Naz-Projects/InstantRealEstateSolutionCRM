import { describe, it, expect } from "vitest";
import { parseGeocodeResponse } from "../src/scraper/geocode";

const okDE = {
  status: "OK",
  results: [
    {
      geometry: { location: { lat: 39.7391, lng: -75.5398 } },
      address_components: [
        { short_name: "DE", long_name: "Delaware", types: ["administrative_area_level_1", "political"] },
      ],
    },
  ],
};

describe("parseGeocodeResponse", () => {
  it("returns the point for an OK Delaware result", () => {
    expect(parseGeocodeResponse(okDE)).toEqual({ lat: 39.7391, lng: -75.5398 });
  });

  it("returns null when the top result is out of state", () => {
    const pa = JSON.parse(JSON.stringify(okDE));
    pa.results[0].address_components[0].short_name = "PA";
    expect(parseGeocodeResponse(pa)).toBeNull();
  });

  it("returns null for ZERO_RESULTS", () => {
    expect(parseGeocodeResponse({ status: "ZERO_RESULTS", results: [] })).toBeNull();
  });

  it("returns null when geometry is missing", () => {
    const noGeo = {
      status: "OK",
      results: [{ address_components: [{ short_name: "DE", types: ["administrative_area_level_1"] }] }],
    };
    expect(parseGeocodeResponse(noGeo)).toBeNull();
  });

  it("returns null for an empty/garbage response", () => {
    expect(parseGeocodeResponse({})).toBeNull();
  });
});
