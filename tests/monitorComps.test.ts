import { describe, it, expect } from "vitest";
import { selectMonitorComps, conservativeArv, subjectCompType, distanceMi, MONITOR } from "../src/scraper/monitorListings";
import type { Comp, CompType } from "../src/scraper/comps";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const S_LAT = 39.75, S_LNG = -75.55;
// ~0.0145 deg latitude per mile at this latitude.
const MI = 1 / 69.05;
let n = 0;
const comp = (o: { mi?: number; type?: CompType; ppsf?: number; sqft?: number; beds?: number; daysAgo?: number; legacy?: boolean }): Comp => {
  const sqft = o.sqft ?? 1200, ppsf = o.ppsf ?? 200;
  const base: Comp = { address: `${++n} Test St`, soldDate: "SEP 1, 2026", soldPrice: ppsf * sqft, beds: o.beds ?? 3, baths: 1.5, sqft, pricePerSqft: ppsf };
  if (o.legacy) return base;
  return { ...base, lat: S_LAT + (o.mi ?? 0.2) * MI, lng: S_LNG, propertyType: o.type ?? "townhouse", soldAt: NOW - (o.daysAgo ?? 30) * DAY };
};
const SUBJ = { lat: S_LAT, lng: S_LNG, sqft: 1200, beds: 3, compType: "townhouse" as CompType };

describe("subjectCompType / distanceMi", () => {
  it("maps Zillow homeType to the Redfin comp class", () => {
    expect(subjectCompType("TOWNHOUSE")).toBe("townhouse");
    expect(subjectCompType("SINGLE_FAMILY")).toBe("sfr");
    expect(subjectCompType("MANUFACTURED")).toBeNull();
    expect(subjectCompType(undefined)).toBeNull();
  });
  it("haversine miles", () => {
    expect(distanceMi(S_LAT, S_LNG, S_LAT + MI, S_LNG)).toBeCloseTo(1, 2);
  });
});

describe("selectMonitorComps", () => {
  it("same type only — a rowhome is never priced off detached sales", () => {
    const out = selectMonitorComps([comp({ type: "sfr" }), comp({ type: "sfr" }), comp({ type: "sfr" }), comp({}), comp({}), comp({})], SUBJ, NOW);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.propertyType === "townhouse")).toBe(true);
  });
  it("0.5 mi ring when it has >= 3", () => {
    const out = selectMonitorComps([comp({ mi: 0.1 }), comp({ mi: 0.3 }), comp({ mi: 0.45 }), comp({ mi: 0.9 }), comp({ mi: 3 })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("expands to 1 mi when 0.5 mi has < 3", () => {
    const out = selectMonitorComps([comp({ mi: 0.1 }), comp({ mi: 0.7 }), comp({ mi: 0.9 }), comp({ mi: 3 })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("falls back to the whole same-type ZIP pool, nearest first", () => {
    const far = comp({ mi: 3 }), farther = comp({ mi: 4 }), near = comp({ mi: 0.2 });
    const out = selectMonitorComps([farther, far, near], SUBJ, NOW);
    expect(out.map((c) => c.address)).toEqual([near.address, far.address, farther.address]);
  });
  it("drops sales older than compMaxAgeDays", () => {
    expect(MONITOR.compMaxAgeDays).toBe(183);
    const out = selectMonitorComps([comp({}), comp({}), comp({}), comp({ daysAgo: 200 })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("typed comps + unknown subject type -> none (no cross-type fallback)", () => {
    expect(selectMonitorComps([comp({}), comp({}), comp({})], { ...SUBJ, compType: null }, NOW)).toEqual([]);
  });
  it("subject without coordinates -> same-type ZIP pool", () => {
    const out = selectMonitorComps([comp({ mi: 0.1 }), comp({ mi: 5 }), comp({ mi: 9 })], { ...SUBJ, lat: null, lng: null }, NOW);
    expect(out).toHaveLength(3);
  });
  it("legacy untyped comps (markdown / old cache) pass type + distance unfiltered", () => {
    const out = selectMonitorComps([comp({ legacy: true }), comp({ legacy: true }), comp({ legacy: true })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("applies the sqft +-30% band when it leaves >= 3", () => {
    const out = selectMonitorComps([comp({}), comp({}), comp({}), comp({ sqft: 3000 })], SUBJ, NOW);
    expect(out.map((c) => c.sqft)).toEqual([1200, 1200, 1200]);
  });
  it("typed comp with no sold date (nearby active/pending listing) is excluded", () => {
    const undated: Comp = { ...comp({}), soldAt: undefined };
    const out = selectMonitorComps([comp({}), comp({}), comp({}), undated], SUBJ, NOW);
    expect(out).toHaveLength(3);
    expect(out).not.toContain(undated);
  });
  it("undated untyped legacy comp is still included", () => {
    const out = selectMonitorComps([comp({ legacy: true }), comp({ legacy: true }), comp({ legacy: true })], SUBJ, NOW);
    expect(out.every((c) => c.soldAt == null)).toBe(true);
    expect(out).toHaveLength(3);
  });
  it("caps at compMaxCount", () => {
    const many = Array.from({ length: 15 }, () => comp({}));
    expect(selectMonitorComps(many, SUBJ, NOW)).toHaveLength(MONITOR.compMaxCount);
  });
});

describe("conservativeArv v2 (as-is = median, ARV = 75th pct)", () => {
  const four = [comp({ ppsf: 100 }), comp({ ppsf: 150 }), comp({ ppsf: 200 }), comp({ ppsf: 250 })];
  const base = { comps: four, sqft: 1200, beds: 3, homeType: "TOWNHOUSE", lat: S_LAT, lng: S_LNG, now: NOW };
  it("median 175 -> as-is 210,000; p75 212.5 -> ARV 255,000", () => {
    expect(conservativeArv({ ...base, zestimate: null })).toEqual({ arv: 255000, asIsValue: 210000, source: "comps", compsPpsf: 175, compsCount: 4 });
  });
  it("ARV capped at 1.15 x Zestimate; as-is is not capped", () => {
    const r = conservativeArv({ ...base, zestimate: 200000 });
    expect(r.arv).toBe(230000);
    expect(r.asIsValue).toBe(210000);
  });
  it("as-is clamped to ARV when the Zestimate cap pushes ARV below the median", () => {
    const r = conservativeArv({ ...base, zestimate: 150000 });
    expect(r.arv).toBe(172500);
    expect(r.asIsValue).toBe(172500);
  });
  it("fewer than compMinCount comps -> Zestimate for both values", () => {
    expect(conservativeArv({ ...base, comps: four.slice(0, 2), zestimate: 190000 })).toEqual({ arv: 190000, asIsValue: 190000, source: "zestimate", compsPpsf: null, compsCount: 0 });
  });
});
