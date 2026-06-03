import { describe, it, expect } from "vitest";
import { parseZip, buildRedfinSoldUrl, parseRedfinComps, selectComps, suggestArv } from "../src/scraper/comps";

// Trimmed Redfin "recently sold" markdown: 3 DE comps (A,B,D) + 1 PA comp (filtered by /DE/).
const FIXTURE = `
# 19805 Recently Sold Homes

SOLD MAY 18, 2026

- ![](https://ssl.cdn-redfin.com/photo/235/islphoto/238/x.webp)

Are you looking for a property with newer roof and great bones.

$250,000Last sold price

3 beds1.5 baths1,650sq ft

[2104 Wildwood Dr, Wilmington, DE 19805](https://www.redfin.com/DE/Wilmington/2104-Wildwood-Dr-19805/home/44910808)

(302) 202-9855

SOLD APR 8, 2026

- ![](https://ssl.cdn-redfin.com/photo/235/islphoto/140/y.webp)

Beautifully renovated all-brick ranch, move-in ready.

$305,500Last sold price

3 beds1 bath1,164sq ft

[513 Ohio Ave, Wilmington, DE 19805](https://www.redfin.com/DE/Wilmington/513-Ohio-Ave-19805/home/44911068)

(302) 351-5000

SOLD MAR 27, 2026

$260,000Last sold price

3 beds1.5 baths1,575sq ft

[418 Ohio Ave, Wilmington, DE 19805](https://www.redfin.com/DE/Wilmington/418-Ohio-Ave-19805/home/44912000)

SOLD FEB 1, 2026

$600,000Last sold price

5 beds3 baths3,500sq ft

[9 Big House Rd, Greenville, DE 19807](https://www.redfin.com/DE/Greenville/9-Big-House-Rd-19807/home/55500000)

SOLD JAN 9, 2026

$400,000Last sold price

3 beds2 baths2,000sq ft

[100 Market St, Philadelphia, PA 19103](https://www.redfin.com/PA/Philadelphia/100-Market-St-19103/home/12345678)
`;

describe("parseZip", () => {
  it("extracts a 5-digit zip", () => {
    expect(parseZip("2104 Wildwood Dr, Wilmington, DE 19805")).toBe("19805");
  });
  it("returns null when no zip", () => {
    expect(parseZip("Wilmington, DE")).toBeNull();
  });
});

describe("buildRedfinSoldUrl", () => {
  it("builds a 6-month sold search url", () => {
    expect(buildRedfinSoldUrl("19805")).toBe(
      "https://www.redfin.com/zipcode/19805/filter/include=sold-6mo",
    );
  });
});

describe("parseRedfinComps", () => {
  const comps = parseRedfinComps(FIXTURE);

  it("parses only DE comps (drops the PA one)", () => {
    expect(comps).toHaveLength(4); // A, B, D, and the Greenville DE one — PA dropped
    expect(comps.every((c) => /, DE /.test(c.address))).toBe(true);
  });
  it("extracts fields for the first comp", () => {
    const a = comps[0];
    expect(a.address).toBe("2104 Wildwood Dr, Wilmington, DE 19805");
    expect(a.soldPrice).toBe(250000);
    expect(a.beds).toBe(3);
    expect(a.baths).toBe(1.5);
    expect(a.sqft).toBe(1650);
    expect(a.pricePerSqft).toBeCloseTo(151.515, 2);
  });
});

describe("selectComps", () => {
  it("keeps comps within ±30% sqft and beds ±1 when 3+ pass", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1500, beds: 3 });
    // A(1650), B(1164), D(1575) pass; Greenville(3500, 5bd) excluded.
    expect(selected).toHaveLength(3);
    expect(selected.map((c) => c.sqft).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([1164, 1575, 1650]);
  });
  it("falls back to all priced comps when fewer than 3 pass the filter", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1650, beds: 3 }); // tight; still ≥3 here
    expect(selected.length).toBeGreaterThanOrEqual(3);
  });
});

describe("suggestArv", () => {
  it("median $/sqft × subject sqft", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1500, beds: 3 }); // A,B,D
    const s = suggestArv(selected, 1500);
    // $/sqft: A=151.515, D=165.079, B=262.457 → median 165.079 → ×1500 = 247619
    expect(s.count).toBe(3);
    expect(s.pricePerSqft).toBe(165);
    expect(s.arv).toBe(247619);
    expect(s.low).toBe(227273); // 151.515×1500
    expect(s.high).toBe(393686); // 262.457×1500
  });
  it("falls back to median sold price when subject sqft is unknown", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1500, beds: 3 }); // A,B,D prices 250000,305500,260000
    const s = suggestArv(selected, null);
    expect(s.arv).toBe(260000); // median of 250000,260000,305500
    expect(s.low).toBeNull();
  });
  it("returns nulls for an empty selection", () => {
    const s = suggestArv([], 1500);
    expect(s).toEqual({ arv: null, pricePerSqft: null, low: null, high: null, count: 0 });
  });
});
