import { describe, it, expect } from "vitest";
import { parseRedfinGisComps, isLegacyCompsCache, type Comp } from "../src/scraper/comps";

// Mirrors the real Redfin sold-search rawHtml (captured 2026-10-04, ZIP 19805):
// InitialContext is a JSON object literal; the gis response body is a JSON STRING
// ("{}&&{...}") nested inside it, so the homes are double-encoded. Field shapes copied
// from real homes (propertyType 6 = single-family, 13 = townhouse, 4 = multi, 8 = land).
const home = (o: Record<string, unknown>) => ({
  mlsStatus: "Closed",
  price: { value: 255000, level: 1 },
  sqFt: { value: 1300, level: 1 },
  beds: 3,
  baths: 2,
  latLong: { value: { latitude: 39.7318939, longitude: -75.5720145 }, level: 1 },
  streetLine: { value: "1604 Coleman St", level: 1 },
  city: "Wilmington",
  state: "DE",
  zip: "19805",
  soldDate: 1778137200000,
  propertyType: 13,
  sashes: [{ sashTypeName: "Sold", lastSaleDate: "MAY 7, 2026", lastSalePrice: "" }],
  ...o,
});
function redfinHtml(homes: unknown[]): string {
  const gisText = "{}&&" + JSON.stringify({ version: 661, errorMessage: "Success", resultCode: 0, payload: { homes } });
  const ctx = {
    "ReactServerAgent.cache": {
      dataCache: {
        "/stingray/api/gis-aggregates?al=1&region_id=7680": { res: { text: "{}&&{}" } },
        "/stingray/api/gis?al=1&include_nearby_homes=true&region_id=7680&sold_within_days=180": { res: { text: gisText } },
      },
    },
  };
  return [
    "<html><body><script>_tLAB.wait(function(){",
    "(function (root) {",
    "/* -- Data -- */",
    "root.__reactServerState || (root.__reactServerState = {});",
    `root.__reactServerState.InitialContext = ${JSON.stringify(ctx)};`,
    'root.__reactServerState.Config = {"environmentName":"prod"};',
    "})(window);",
    "});</script></body></html>",
  ].join("\n");
}

describe("parseRedfinGisComps", () => {
  it("parses a townhouse home with coords, type and sold epoch", () => {
    const [c] = parseRedfinGisComps(redfinHtml([home({})]));
    expect(c).toEqual({
      address: "1604 Coleman St, Wilmington, DE 19805",
      soldDate: "MAY 7, 2026",
      soldPrice: 255000,
      beds: 3,
      baths: 2,
      sqft: 1300,
      pricePerSqft: 255000 / 1300,
      lat: 39.7318939,
      lng: -75.5720145,
      propertyType: "townhouse",
      soldAt: 1778137200000,
    });
  });
  it("keeps single-family (6) and townhouse (13); drops multi-family (4), land (8), non-DE", () => {
    const out = parseRedfinGisComps(redfinHtml([
      home({ propertyType: 6 }),
      home({ propertyType: 13 }),
      home({ propertyType: 4 }),
      home({ propertyType: 8 }),
      home({ propertyType: 6, state: "PA" }),
    ]));
    expect(out.map((c) => c.propertyType)).toEqual(["sfr", "townhouse"]);
  });
  it("nearby homes without soldDate fall back to the sash lastSaleDate", () => {
    const [c] = parseRedfinGisComps(redfinHtml([home({ soldDate: undefined, sashes: [{ lastSaleDate: "SEP 9, 2026" }] })]));
    expect(c.soldAt).toBe(Date.parse("SEP 9, 2026"));
    expect(c.soldDate).toBe("SEP 9, 2026");
  });
  it("missing sqft -> sqft and $/sqft null (never priced by size)", () => {
    const [c] = parseRedfinGisComps(redfinHtml([home({ sqFt: { level: 1 } })]));
    expect(c.sqft).toBeNull();
    expect(c.pricePerSqft).toBeNull();
  });
  it("[] when the embed is missing or malformed (caller falls back to markdown)", () => {
    expect(parseRedfinGisComps("<html>no data</html>")).toEqual([]);
    expect(parseRedfinGisComps("root.__reactServerState.InitialContext = {not json};\n")).toEqual([]);
    expect(parseRedfinGisComps("")).toEqual([]);
  });
  it("skips non-sold homes (nearby active relist with a past lastSaleDate sash); Closed/Sold kept", () => {
    const out = parseRedfinGisComps(redfinHtml([
      home({ mlsStatus: "Active", soldDate: undefined, price: { value: 399000 }, sashes: [{ lastSaleDate: "AUG 1, 2026" }] }),
      home({ mlsStatus: "Pending" }),
      home({ mlsStatus: "Sold", price: { value: 200000 } }),
      home({ mlsStatus: undefined, price: { value: 210000 } }),
      home({}),
    ]));
    expect(out.map((c) => c.soldPrice)).toEqual([200000, 210000, 255000]);
  });
  it("malformed sashes (non-array) does not throw", () => {
    const out = parseRedfinGisComps(redfinHtml([home({ soldDate: undefined, sashes: { lastSaleDate: "x" } as unknown })]));
    expect(out).toHaveLength(1);
    expect(out[0].soldDate).toBe("");
  });
  it("[] when the gis key is missing or its nested text is malformed", () => {
    const wrap = (dataCache: unknown) =>
      `root.__reactServerState.InitialContext = ${JSON.stringify({ "ReactServerAgent.cache": { dataCache } })};
`;
    expect(parseRedfinGisComps(wrap({ "/stingray/api/other": { res: { text: "{}&&{}" } } }))).toEqual([]);
    expect(parseRedfinGisComps(wrap({ "/stingray/api/gis?x=1": { res: { text: "{}&&{not json" } } }))).toEqual([]);
    expect(parseRedfinGisComps(wrap({ "/stingray/api/gis?x=1": { res: { text: "{}&&{\"payload\":{\"homes\":7}}" } } }))).toEqual([]);
  });
});

describe("isLegacyCompsCache", () => {
  const c = (o: Partial<Comp> = {}): Comp => ({ address: "a", soldDate: "", soldPrice: 1, beds: null, baths: null, sqft: null, pricePerSqft: null, ...o });
  it("true only for a non-empty cache with no typed comp (pre-gis markdown rows)", () => {
    expect(isLegacyCompsCache([c(), c()])).toBe(true);
    expect(isLegacyCompsCache([c(), c({ propertyType: "sfr" })])).toBe(false);
    expect(isLegacyCompsCache([])).toBe(false);
  });
});
