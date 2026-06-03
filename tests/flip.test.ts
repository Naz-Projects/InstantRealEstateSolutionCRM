import { describe, it, expect } from "vitest";
import { REHAB_TIERS, FLIP_DEFAULTS, estimateRehab } from "../src/scraper/flip";

describe("REHAB_TIERS / FLIP_DEFAULTS", () => {
  it("has the three tiers with per-sqft midpoints", () => {
    expect(REHAB_TIERS.cosmetic.perSqft).toBe(18);
    expect(REHAB_TIERS.moderate.perSqft).toBe(42);
    expect(REHAB_TIERS.gut.perSqft).toBe(95);
  });
  it("has sane defaults", () => {
    expect(FLIP_DEFAULTS.contingencyPct).toBe(0.10);
    expect(FLIP_DEFAULTS.assumptions.annualRate).toBe(0.11);
    expect(FLIP_DEFAULTS.assumptions.holdingMonths).toBe(6);
  });
});

describe("estimateRehab", () => {
  it("computes base = perSqft * sqft, plus contingency", () => {
    const r = estimateRehab(42, 1500, 0.10);
    expect(r.base).toBe(63000);
    expect(r.contingency).toBe(6300);
    expect(r.total).toBe(69300);
  });
  it("override wins over perSqft * sqft", () => {
    const r = estimateRehab(42, 1500, 0.10, 50000);
    expect(r.base).toBe(50000);
    expect(r.total).toBe(55000);
  });
  it("returns nulls when sqft is unknown and no override", () => {
    const r = estimateRehab(42, null, 0.10);
    expect(r.base).toBeNull();
    expect(r.total).toBeNull();
  });
});
import { computeFlip } from "../src/scraper/flip";

describe("computeFlip", () => {
  const A = FLIP_DEFAULTS.assumptions;

  it("golden case: profit, MAO, ROI, grade ok", () => {
    const m = computeFlip({ arv: 300000, purchasePrice: 150000, rehabTotal: 50000, assumptions: A });
    expect(m.mao).toBe(160000);            // 300000*0.7 - 50000
    expect(m.profit).toBe(56725);
    expect(m.cashInvested).toBe(34275);
    expect(m.roi).toBeCloseTo(1.65496, 4);
    expect(m.annualizedRoi).toBeCloseTo(3.30999, 4);
    expect(m.margin).toBeCloseTo(0.18908, 4);
    expect(m.grade).toBe("ok");
    expect(m.flags).toEqual([]);
    expect(m.dataComplete).toBe(true);
  });

  it("high-margin deal grades good", () => {
    const m = computeFlip({ arv: 400000, purchasePrice: 120000, rehabTotal: 40000, assumptions: A });
    expect(m.grade).toBe("good");
    expect(m.profit).toBe(192100);
  });

  it("overpaying past the 70% rule with a thin margin", () => {
    const m = computeFlip({ arv: 300000, purchasePrice: 200000, rehabTotal: 40000, assumptions: A });
    expect(m.mao).toBe(170000);
    expect(m.flags).toContain("over-70%-rule");
    expect(m.flags).toContain("thin-margin");
    expect(m.grade).toBe("thin");
  });

  it("negative profit grades bad", () => {
    const m = computeFlip({ arv: 200000, purchasePrice: 160000, rehabTotal: 20000, assumptions: A });
    expect(m.profit).toBeLessThan(0);
    expect(m.grade).toBe("bad");
    expect(m.flags).toContain("negative-profit");
  });

  it("missing ARV → unknown grade, MAO null, missing-arv flag", () => {
    const m = computeFlip({ arv: null, purchasePrice: 100000, rehabTotal: 50000, assumptions: A });
    expect(m.dataComplete).toBe(false);
    expect(m.grade).toBe("unknown");
    expect(m.mao).toBeNull();
    expect(m.profit).toBeNull();
    expect(m.flags).toContain("missing-arv");
  });
});
