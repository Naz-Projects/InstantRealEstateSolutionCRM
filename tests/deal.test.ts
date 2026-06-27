import { describe, it, expect } from "vitest";
import { computeDeal, parseMoney } from "../src/scraper/deal.js";

describe("parseMoney", () => {
  it("parses currency and plain numbers", () => {
    expect(parseMoney("$45,527.14")).toBeCloseTo(45527.14);
    expect(parseMoney("47600")).toBe(47600);
    expect(parseMoney("$0.00")).toBe(0);
  });
  it("returns null for error codes and blanks", () => {
    expect(parseMoney("SCRAPE FAILED")).toBeNull();
    expect(parseMoney("NOT FOUND")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
  it("expands K/M suffixes Zillow uses on search cards", () => {
    expect(parseMoney("$1.2M")).toBe(1_200_000);
    expect(parseMoney("$350K")).toBe(350_000);
    expect(parseMoney("$1,234.56")).toBeCloseTo(1234.56);
    expect(parseMoney("47600")).toBe(47600);
  });
  it("returns null for a range / malformed string instead of a wrong number", () => {
    expect(parseMoney("$100,000-$120,000")).toBeNull();
    expect(parseMoney("100000-120000")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("$1.2.3")).toBeNull();
  });
  it("still parses a number followed by a unit word (e.g. sqft)", () => {
    // deal.ts parseMoney is reused to parse "1,234 sqft" → 1234; a unit suffix is fine,
    // a second NUMBER (a range) is not.
    expect(parseMoney("1,234 sqft")).toBe(1234);
  });
});

describe("computeDeal", () => {
  it("TAX sale: cost = principal (taxes already inside it), not principal + balances", () => {
    // 31 Phoenix Ave, Newark — real June data
    const d = computeDeal({
      saleType: "TAX",
      zestimate: "$399,000",
      principal: "$45,527.14",
      countyBalanceDue: "$20,722.91",
      schoolBalanceDue: "$9,767.66",
      sewerBalanceDue: "$1,907.25",
    });
    expect(d.costToClear).toBeCloseTo(45527.14); // NOT 45527 + 32397
    expect(d.cushion).toBeCloseTo(353472.86);
    expect(d.tier).toBe("good");
    expect(d.flags).toContain("tax-redemption");
  });

  it("MTG sale: cost = principal + senior tax balances", () => {
    // 545 E Hanna Dr, Newark — real June data
    const d = computeDeal({
      saleType: "MTG",
      zestimate: "$390,700",
      principal: "$325,816.10",
      countyBalanceDue: "$0.00",
      schoolBalanceDue: "$0.00",
      sewerBalanceDue: "$204.83",
    });
    expect(d.costToClear).toBeCloseTo(326020.93);
    expect(d.cushion).toBeCloseTo(64679.07);
    expect(d.tier).toBe("thin");
    expect(d.flags).not.toContain("tax-redemption");
  });

  it("treats sewer NOT FOUND as $0 (no NCC sewer account)", () => {
    const d = computeDeal({
      saleType: "MTG",
      zestimate: "$250,000",
      principal: "$100,000",
      countyBalanceDue: "$0.00",
      schoolBalanceDue: "$0.00",
      sewerBalanceDue: "NOT FOUND",
    });
    expect(d.liensTotal).toBe(0);
    expect(d.costToClear).toBe(100000);
    expect(d.cushion).toBe(150000);
  });

  it("marks incomplete data as unknown + needs-rescrape", () => {
    const d = computeDeal({
      saleType: "MTG",
      zestimate: "SCRAPE FAILED",
      principal: "$100,000",
      countyBalanceDue: "SCRAPE FAILED",
      schoolBalanceDue: "SCRAPE FAILED",
      sewerBalanceDue: "SCRAPE FAILED",
    });
    expect(d.cushion).toBeNull();
    expect(d.tier).toBe("unknown");
    expect(d.dataComplete).toBe(false);
    expect(d.flags).toContain("needs-rescrape");
  });

  it("flags a suspiciously small mortgage principal and downgrades it to 'verify'", () => {
    // The 413-Georgiana trap: tiny principal mechanically inflates the cushion.
    const d = computeDeal({
      saleType: "MTG",
      zestimate: "$400,000",
      principal: "$20,000",
      countyBalanceDue: "$0.00",
      schoolBalanceDue: "$0.00",
      sewerBalanceDue: "$0.00",
    });
    expect(d.flags).toContain("senior-lien-risk");
    expect(d.cushion).toBe(380000); // raw cushion is huge...
    expect(d.tier).toBe("verify"); // ...but it must NOT rank as a confident "good" deal
  });

  it("values a $1.2M zestimate stored with a trailing M correctly (not $1.20 → tier 'bad')", () => {
    // Zillow search cards store "$1.2M"; parseMoney must expand it to 1,200,000.
    const d = computeDeal({
      saleType: "MTG",
      zestimate: "$1.2M",
      principal: "$300,000",
      countyBalanceDue: "$0.00",
      schoolBalanceDue: "$0.00",
      sewerBalanceDue: "$0.00",
    });
    expect(d.zestimate).toBe(1_200_000);
    expect(d.costToClear).toBe(300_000);
    expect(d.cushion).toBe(900_000);
    expect(d.tier).toBe("good"); // NOT "bad" (which a 1.2 zestimate would have produced)
  });

  it("downgrades a JUDG sale to 'verify' even with a large cushion", () => {
    // 413 Georgiana — real June data
    const d = computeDeal({
      saleType: "JUDG",
      zestimate: "$814,800",
      principal: "$4,956.54",
      countyBalanceDue: "$0.00",
      schoolBalanceDue: "$0.00",
      sewerBalanceDue: "$0.00",
    });
    expect(d.tier).toBe("verify");
    expect(d.flags).toContain("judg-risk");
  });
});
