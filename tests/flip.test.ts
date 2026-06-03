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
