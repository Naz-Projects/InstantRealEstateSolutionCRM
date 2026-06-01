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
