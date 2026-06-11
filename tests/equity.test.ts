import { describe, it, expect } from "vitest";
import { computeEquity, parseZestimate } from "../src/scraper/equity";

describe("parseZestimate", () => {
  it("parses a plain dollar figure", () => {
    expect(parseZestimate("$123,456")).toBe(123456);
  });
  it("parses K-suffixed figures", () => {
    expect(parseZestimate("$350K")).toBe(350000);
    expect(parseZestimate("$350.5k")).toBe(350500);
  });
  it("parses M-suffixed figures", () => {
    expect(parseZestimate("$1.2M")).toBe(1200000);
  });
  it("returns null for missing/garbage input", () => {
    expect(parseZestimate(undefined)).toBeNull();
    expect(parseZestimate(null)).toBeNull();
    expect(parseZestimate("")).toBeNull();
    expect(parseZestimate("SCRAPE FAILED")).toBeNull();
  });
});

describe("computeEquity", () => {
  it("computes equity and ratio from value minus tax balances", () => {
    const r = computeEquity({ value: 200000, countyBalance: 3000, schoolBalance: 1500, sewerBalance: 500 });
    expect(r.equity).toBe(195000);
    expect(r.equityRatio).toBeCloseTo(0.975);
    expect(r.basis).toBe("taxes-only");
  });
  it("includes manual liens and switches basis", () => {
    const r = computeEquity({ value: 200000, countyBalance: 5000, manualLiens: 150000 });
    expect(r.equity).toBe(45000);
    expect(r.equityRatio).toBeCloseTo(0.225);
    expect(r.basis).toBe("incl-manual-liens");
  });
  it("treats missing balances as 0 (taxes-only proxy)", () => {
    const r = computeEquity({ value: 100000 });
    expect(r.equity).toBe(100000);
    expect(r.equityRatio).toBe(1);
    expect(r.basis).toBe("taxes-only");
  });
  it("allows negative equity", () => {
    const r = computeEquity({ value: 100000, manualLiens: 150000 });
    expect(r.equity).toBe(-50000);
    expect(r.equityRatio).toBeCloseTo(-0.5);
  });
  it("returns all-null when value is unknown", () => {
    const r = computeEquity({ value: null, countyBalance: 5000, manualLiens: 100000 });
    expect(r.equity).toBeNull();
    expect(r.equityRatio).toBeNull();
    expect(r.basis).toBeNull();
  });
  it("manualLiens of 0 still counts as taxes-only basis", () => {
    expect(computeEquity({ value: 100000, manualLiens: 0 }).basis).toBe("taxes-only");
  });
});
