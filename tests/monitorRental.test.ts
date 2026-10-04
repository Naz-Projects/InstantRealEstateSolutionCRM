import { describe, it, expect } from "vitest";
import { analyzeRental, parseLeaseRent, rentForListing, detailFromCache, evaluateDeal, dealInputFromStored, MONITOR } from "../src/scraper/monitorListings";

describe("analyzeRental v2 (35% opex, real tax rate, DSCR)", () => {
  it("constants", () => {
    expect(MONITOR.rentalOpexPct).toBe(0.35);
    expect(MONITOR.rentalTaxFallbackPct).toBe(1.6);
    expect(MONITOR.dscrBar).toBe(1.2);
  });
  it("no rate -> 1.6% fallback, flagged estimated", () => {
    const r = analyzeRental({ rent: 2000, list: 150000, rehab: 20000 })!;
    expect(r.taxEstimated).toBe(true);
    expect(r.cashFlow).toBe(114);
    expect(r.capRate).toBeCloseTo(0.07094, 5);
  });
  it("listing rate 0.68% -> lower tax, not estimated", () => {
    const r = analyzeRental({ rent: 2000, list: 150000, rehab: 20000, taxRatePct: 0.68 })!;
    expect(r.taxEstimated).toBe(false);
    expect(r.cashFlow).toBe(229);
    expect(r.dscr).toBeCloseTo(1.256, 3);
  });
  it("a 0 / negative rate is treated as missing", () => {
    expect(analyzeRental({ rent: 2000, list: 150000, rehab: 20000, taxRatePct: 0 })!.taxEstimated).toBe(true);
  });
});

describe("parseLeaseRent", () => {
  it("reads stated leases", () => {
    expect(parseLeaseRent("Tenant occupied, rents for $1,450/mo through June")).toBe(1450);
    expect(parseLeaseRent("Current rent is $1,250. Great investment")).toBe(1250);
    expect(parseLeaseRent("Currently rented at $1,300 per month")).toBe(1300);
    expect(parseLeaseRent("Leased at $1500 until 2027")).toBe(1500);
    expect(parseLeaseRent("Tenant pays $1,200 monthly")).toBe(1200);
    expect(parseLeaseRent("Rented for 1100/mo, tenant wants to stay")).toBe(1100);
    expect(parseLeaseRent("Rent: $950")).toBe(950);
  });
  it("ignores years, hypothetical rent, annual totals and no-$ amounts", () => {
    expect(parseLeaseRent("Rented 2024, tenant in place")).toBeNull();
    expect(parseLeaseRent("Market rent $2,100 per Zillow")).toBeNull();
    expect(parseLeaseRent("Could rent for $1,800 after rehab")).toBeNull();
    expect(parseLeaseRent("Potential rent of $2,000")).toBeNull();
    expect(parseLeaseRent("Gross rents $24,000 annually")).toBeNull();
    expect(parseLeaseRent("Annual rent $6,000")).toBeNull();
    expect(parseLeaseRent("Rents for $4,800/yr")).toBeNull();
    expect(parseLeaseRent("Rent $5,400 annually")).toBeNull();
    expect(parseLeaseRent("Rental property near the park")).toBeNull();
    expect(parseLeaseRent("")).toBeNull();
    expect(parseLeaseRent(undefined)).toBeNull();
  });
});

describe("rentForListing", () => {
  it("a stated lease caps the rentZestimate (min of both)", () => {
    expect(rentForListing("rents for $1,450/mo", 1900)).toEqual({ rent: 1450, leaseRent: 1450 });
    expect(rentForListing("rents for $2,450/mo", 1900)).toEqual({ rent: 1900, leaseRent: 2450 });
  });
  it("lease only / Zestimate only / neither", () => {
    expect(rentForListing("rents for $1,450/mo", null)).toEqual({ rent: 1450, leaseRent: 1450 });
    expect(rentForListing("no lease info", 1900)).toEqual({ rent: 1900, leaseRent: null });
    expect(rentForListing(null, undefined)).toEqual({ rent: null, leaseRent: null });
  });
});

describe("detailFromCache propertyTaxRate", () => {
  const nd = (property: Record<string, unknown>) => ({
    props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify({ 'ForSaleFullRenderQuery{"zpid":1}': { property } }) } } },
  });
  it("reads Zillow's per-property rate (percent)", () => {
    expect(detailFromCache(nd({ propertyTaxRate: 0.68 }))!.propertyTaxRate).toBe(0.68);
  });
  it("null when absent or non-positive", () => {
    expect(detailFromCache(nd({}))!.propertyTaxRate).toBeNull();
    expect(detailFromCache(nd({ propertyTaxRate: 0 }))!.propertyTaxRate).toBeNull();
  });
});

describe("BRRRR + re-gate rental inputs", () => {
  it("brrrrCashLeftIn = all-in - 75% of ARV (null without ARV or rental)", () => {
    const base = { zestimate: null, valueBasis: null, renovated: false, listPrice: 120000, rehabTotal: 20000, rent: 1900 };
    expect(evaluateDeal({ ...base, arv: 250000 }).brrrrCashLeftIn).toBe(-47500);
    expect(evaluateDeal({ ...base, arv: null }).brrrrCashLeftIn).toBeNull();
    expect(evaluateDeal({ ...base, arv: 250000, rent: null }).brrrrCashLeftIn).toBeNull();
  });
  it("re-gate reads the stored lease + tax rate", () => {
    const i = dealInputFromStored({ rentZestimate: 1900, description: "rents for $1,450/mo", propertyTaxRatePct: 0.68 });
    expect(i.rent).toBe(1450);
    expect(i.taxRatePct).toBe(0.68);
  });
});
