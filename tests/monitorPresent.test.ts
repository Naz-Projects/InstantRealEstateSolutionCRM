import { describe, it, expect } from "vitest";
import {
  MINUS, money, signedMoney, pct1, toneOf, normalizeExit, exitLabel, spreadBasisLabel,
  verdictFor, humanizeFlag, displayFlags, safeHref, oneLineReason, analystNote, ownerSignal, numberGroups,
} from "../src/scraper/monitorPresent";

describe("money / signedMoney / pct1 / toneOf", () => {
  it("formats whole dollars and a dash for missing", () => {
    expect(money(99900)).toBe("$99,900");
    expect(money(99900.6)).toBe("$99,901");
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(NaN)).toBe("—");
  });
  it("renders negatives with the same true minus as signedMoney", () => {
    expect(money(-5000)).toBe(`${MINUS}$5,000`);
    expect(money(-0.4)).toBe("$0");
  });
  it("signs with + and a true minus sign", () => {
    expect(signedMoney(5371)).toBe("+$5,371");
    expect(signedMoney(-14543)).toBe(`${MINUS}$14,543`);
    expect(signedMoney(0.4)).toBe("$0");
  });
  it("pct1 renders a fraction as a one-decimal percent", () => {
    expect(pct1(0.1234)).toBe("12.3%");
    expect(pct1(null)).toBe("—");
  });
  it("toneOf maps sign", () => {
    expect(toneOf(5)).toBe("pos");
    expect(toneOf(-5)).toBe("neg");
    expect(toneOf(0)).toBe("neutral");
    expect(toneOf(null)).toBe("neutral");
  });
});

describe("exits", () => {
  it("normalizeExit uppercases known exits and rejects others", () => {
    expect(normalizeExit("flip")).toBe("FLIP");
    expect(normalizeExit("RENTAL")).toBe("RENTAL");
    expect(normalizeExit("WHOLETAIL")).toBeNull();
    expect(normalizeExit(undefined)).toBeNull();
  });
  it("exitLabel title-cases any exit word", () => {
    expect(exitLabel("WHOLETAIL")).toBe("Wholetail");
    expect(exitLabel("FLIP")).toBe("Flip");
  });
  it("spread basis is the Zestimate only when one is present and positive", () => {
    expect(spreadBasisLabel({ zestimate: 250000 })).toBe("Zestimate");
    expect(spreadBasisLabel({ zestimate: 0 })).toBe("as-is value");
    expect(spreadBasisLabel({})).toBe("as-is value");
  });
});

describe("verdictFor", () => {
  it("FLIP: offer gap = max offer minus list, colored by sign", () => {
    expect(verdictFor({ bestExit: "FLIP", roomVsList: 5371, flipMao: 105271 })).toEqual({
      value: "+$5,371", caption: "max offer $105,271", tone: "pos", sortKey: 5371,
    });
    expect(verdictFor({ bestExit: "FLIP", roomVsList: -14543, flipMao: 422957 }).tone).toBe("neg");
  });
  it("RENTAL: monthly cash flow + DSCR", () => {
    expect(verdictFor({ bestExit: "RENTAL", cashFlow: 477, dscr: 1.314 })).toEqual({
      value: "+$477/mo", caption: "DSCR 1.31", tone: "pos", sortKey: 477,
    });
    expect(verdictFor({ bestExit: "RENTAL", cashFlow: 120 }).caption).toBe("DSCR —");
  });
  it("WHOLESALE: spread labeled by its real basis, never ARV", () => {
    expect(verdictFor({ bestExit: "WHOLESALE", spread: 40000, zestimate: 240000 })).toEqual({
      value: "+$40,000", caption: "vs Zestimate", tone: "pos", sortKey: 40000,
    });
    expect(verdictFor({ bestExit: "WHOLESALE", spread: 30000 }).caption).toBe("vs as-is value");
  });
  it("verdict falls back to — for PASS or missing numbers (old rows)", () => {
    const empty = { value: "—", caption: "", tone: "neutral", sortKey: null };
    expect(verdictFor({ bestExit: "PASS" })).toEqual(empty);
    expect(verdictFor({ bestExit: "FLIP" })).toEqual(empty);
    expect(verdictFor({})).toEqual(empty);
  });
});

describe("humanizeFlag / displayFlags", () => {
  it("maps bare slugs to plain labels", () => {
    expect(humanizeFlag("sparse_photos")).toBe("Few listing photos");
    expect(humanizeFlag("lead_paint_pre1978")).toBe("Lead paint era (pre-1978)");
    expect(humanizeFlag("heavy-rehab")).toBe("Heavy rehab");
  });
  it("humanizes key: value slugs (zipTier / photoSignal)", () => {
    expect(humanizeFlag("zipTier: city-high-risk")).toBe("Wilmington city ZIP (higher risk)");
    expect(humanizeFlag("photoSignal: sparse_photos")).toBe("Few listing photos");
  });
  it("cleans pipeline flags", () => {
    expect(humanizeFlag("detail-missing (VERIFY)")).toBe("Listing details missing");
    expect(humanizeFlag("tax rate estimated 1.6% (VERIFY)")).toBe("Tax rate estimated 1.6%");
    expect(humanizeFlag("LEASED at $1,450/mo")).toBe("Leased at $1,450/mo");
    expect(humanizeFlag("HIGH-HOA $300/mo")).toBe("High HOA $300/mo");
  });
  it("turns unknown slugs into words and leaves free text alone (first letter capped)", () => {
    expect(humanizeFlag("foundation_crack_risk")).toBe("Foundation crack risk");
    expect(humanizeFlag("stop-work order on file")).toBe("Stop-work order on file");
  });
  it("displayFlags: judge flags first, then pipeline flags, humanized and de-duplicated", () => {
    expect(displayFlags({ redFlags: ["sparse_photos", "Stop-work order"], riskFlags: ["heavy-rehab", "photoSignal: sparse_photos"] }))
      .toEqual(["Few listing photos", "Stop-work order", "Heavy rehab"]);
    expect(displayFlags({})).toEqual([]);
  });
});

describe("safeHref", () => {
  it("accepts only http(s)", () => {
    expect(safeHref("https://www.zillow.com/x")).toBe("https://www.zillow.com/x");
    expect(safeHref("  http://a.b/c ")).toBe("http://a.b/c");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
    expect(safeHref("//evil.com")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});

describe("oneLineReason / analystNote / ownerSignal", () => {
  it("keeps the first sentence and caps the length with an ellipsis", () => {
    expect(oneLineReason("Deep below-market fixer. Second sentence.")).toBe("Deep below-market fixer.");
    const long = "A".repeat(120);
    expect(oneLineReason(long)).toBe("A".repeat(54) + "…");
    expect(oneLineReason(long, 90)).toBe("A".repeat(89) + "…");
    expect(oneLineReason(null)).toBe("");
  });
  it("does not split after common abbreviations", () => {
    expect(oneLineReason("Est. ARV $240k, deep rehab")).toBe("Est. ARV $240k, deep rehab");
    expect(oneLineReason("Priced well below comps vs. Zestimate. More here.")).toBe("Priced well below comps vs. Zestimate.");
    expect(oneLineReason("Needs everything, e.g. roof and HVAC. More.")).toBe("Needs everything, e.g. roof and HVAC.");
    expect(oneLineReason("Corner lot on Market St. near the park. More.")).toBe("Corner lot on Market St. near the park.");
    expect(oneLineReason("APPROX. 1,200 sqft fixer. More.")).toBe("APPROX. 1,200 sqft fixer.");
  });
  it("falls back to the truncated full text when the first sentence is under 12 chars", () => {
    expect(oneLineReason("Fixer. Halted renovation, cash only.")).toBe("Fixer. Halted renovation, cash only.");
    const long = "Fixer. " + "B".repeat(80);
    expect(oneLineReason(long)).toBe(long.slice(0, 54) + "…");
  });
  it("analyst note only when it disagrees with bestExit and score >= 50", () => {
    expect(analystNote({ bestExit: "FLIP", exitTriage: "WHOLETAIL", dealScore: 72 })).toBe("Analyst leans Wholetail");
    expect(analystNote({ bestExit: "FLIP", exitTriage: "WHOLETAIL", dealScore: 40 })).toBeNull();
    expect(analystNote({ bestExit: "FLIP", exitTriage: "FLIP", dealScore: 90 })).toBeNull();
    expect(analystNote({ bestExit: "FLIP", dealScore: 90 })).toBeNull();
  });
  it("owner signal only from real distress data", () => {
    expect(ownerSignal({ offMarketSignals: ["tax_lien", "code_case"] })).toBe("Tax lien, Code case");
    expect(ownerSignal({ offMarketBalances: 4120 })).toBe("Delinquent balances $4,120");
    expect(ownerSignal({ offMarketConditionScore: 38 })).toBe("Condition score 38");
    expect(ownerSignal({})).toBeNull();
  });
});

describe("numberGroups", () => {
  it("builds Value / Flip / Rental groups with tones", () => {
    const g = numberGroups({
      listPrice: 99900, asIsValue: 180000, conservativeArv: 215657, rehabEstimate: 42000,
      flipMao: 105271, roomVsList: 5371, flipMargin: 0.2,
      rentZestimate: 1500, capRate: 0.107, cashFlow: 477, dscr: 1.31, brrrrCashLeftIn: -12000,
    });
    expect(g.map((x) => x.title)).toEqual(["Value", "Flip", "Rental"]);
    expect(g[0].cells.map((c) => c.label)).toEqual(["List", "As-is value", "ARV", "Rehab"]);
    expect(g[1].cells).toEqual([
      { label: "Max offer", value: "$105,271", tone: "neutral" },
      { label: "Offer gap", value: "+$5,371", tone: "pos" },
      { label: "Margin", value: "20.0%", tone: "neutral" },
    ]);
    expect(g[2].cells.map((c) => c.value)).toEqual(["$1,500/mo", "10.7%", "+$477/mo", "1.31", "$12,000 out"]);
  });
  it("rent shows the binding lease when it is lower than the Zestimate rent", () => {
    const g = numberGroups({ listPrice: 100000, capRate: 0.07, rentZestimate: 1600, leaseRent: 1250, cashFlow: 10, dscr: 1.2 });
    expect(g.find((x) => x.title === "Rental")!.cells[0]).toEqual({ label: "Rent (lease)", value: "$1,250/mo", tone: "neutral" });
  });
  it("omits empty groups (old rows)", () => {
    expect(numberGroups({ listPrice: 100000 }).map((x) => x.title)).toEqual(["Value"]);
    expect(numberGroups({})).toEqual([]);
  });
});
