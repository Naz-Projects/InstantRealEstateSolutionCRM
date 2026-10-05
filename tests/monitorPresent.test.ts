import { describe, it, expect } from "vitest";
import {
  MINUS, money, signedMoney, pct1, toneOf, normalizeExit, exitLabel, spreadBasisLabel,
  verdictFor, humanizeFlag, displayFlags, safeHref, oneLineReason, analystNote, ownerSignal, numberGroups,
  priceHistoryRows, sellerMotivation,
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
    expect(humanizeFlag("LAND (not underwritten)")).toBe("LAND (not underwritten)");
    expect(humanizeFlag("MANUFACTURED (not underwritten)")).toBe("Manufactured home (not underwritten)");
    expect(humanizeFlag("MANUFACTURED (comps/lot-rent suspect)")).toBe("Manufactured home (comps suspect)");
  });
  it("turns unknown slugs into words and leaves free text alone (first letter capped)", () => {
    expect(humanizeFlag("foundation_crack_risk")).toBe("Foundation crack risk");
    expect(humanizeFlag("stop-work order on file")).toBe("Stop-work order on file");
  });
  it("never leaks camelCase keys or slug lists from prod judge output", () => {
    expect(humanizeFlag("ownerTenureYears: 1 (recent purchase flag)")).toBe("Owner tenure years: 1 (recent purchase flag)");
    expect(humanizeFlag("flipMargin%: -28.9")).toBe("Flip margin%: -28.9");
    expect(humanizeFlag("flipMargin% negative")).toBe("Flip margin% negative");
    expect(humanizeFlag("rentalCapRate n/a")).toBe("Rental cap rate n/a");
    expect(humanizeFlag("eraHazards present")).toBe("Era hazards present");
    expect(humanizeFlag("Verify rehabTier 'gut' vs description")).toBe("Verify rehab tier 'gut' vs description");
    expect(humanizeFlag("eraHazards: lead_paint_pre1978, asbestos_era_pre1980"))
      .toBe("Lead paint era (pre-1978), asbestos era (pre-1980)");
    expect(humanizeFlag("tenant_occupied: access/transition risk")).toBe("Tenant occupied: access/transition risk");
    expect(humanizeFlag("ownerTenureYears: 0 (recent_purchase_flag)")).toBe("Owner tenure years: 0 (recent purchase flag)");
  });
  it("maps every city-high-risk spelling to one label (so displayFlags dedupes them)", () => {
    for (const f of ["zip_city_high_risk", "city-high-risk zip", "city-high-risk_zip"]) {
      expect(humanizeFlag(f)).toBe("Wilmington city ZIP (higher risk)");
    }
    expect(displayFlags({ redFlags: ["zip_city_high_risk", "zipTier: city-high-risk"] })).toEqual(["Wilmington city ZIP (higher risk)"]);
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

describe("priceHistoryRows (deal sheet seller motivation)", () => {
  const hist = [
    // Zillow order: newest first
    { date: "2025-03-01", event: "Price change", price: 189900 },
    { date: "2025-02-01", event: "Price change", price: 199900 },
    { date: "2025-01-02", event: "Listed for sale", price: 210000 },
    { date: "2019-06-15", event: "Sold", price: 150000 },
  ];
  it("lists most recent first with cut amounts on price changes only", () => {
    expect(priceHistoryRows(hist)).toEqual([
      // A cut is good news for a buyer: "cut" tone (amber), never the red negative tone.
      { date: "Mar 1, 2025", event: "Price cut", price: "$189,900", change: `${MINUS}$10,000`, tone: "cut" },
      { date: "Feb 1, 2025", event: "Price cut", price: "$199,900", change: `${MINUS}$10,100`, tone: "cut" },
      { date: "Jan 2, 2025", event: "Listed for sale", price: "$210,000", change: null, tone: "neutral" },
      { date: "Jun 15, 2019", event: "Sold", price: "$150,000", change: null, tone: "neutral" },
    ]);
  });
  it("formats YYYY-MM-DD in UTC (no off-by-one day)", () => {
    expect(priceHistoryRows([{ date: "2025-03-01", event: "Sold", price: 1 }])[0].date).toBe("Mar 1, 2025");
  });
  it("labels a price increase", () => {
    const r = priceHistoryRows([
      { date: "2025-02-01", event: "Price change", price: 205000 },
      { date: "2025-01-01", event: "Listed for sale", price: 200000 },
    ]);
    expect(r[0]).toMatchObject({ event: "Price increase", change: "+$5,000", tone: "neutral" });
  });
  it("computes changes before capping rows (the comparison base survives the cut)", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      date: `2025-0${i + 1}-01`, event: i === 0 ? "Listed for sale" : "Price change", price: 300000 - i * 1000,
    }));
    const r = priceHistoryRows(many);
    expect(r).toHaveLength(6);
    expect(r[0].date).toBe("Aug 1, 2025");
    expect(r[5]).toMatchObject({ date: "Mar 1, 2025", change: `${MINUS}$1,000` });
  });
  it("tolerates junk entries: never NaN, undefined or a crash", () => {
    const r = priceHistoryRows([null, 7, "x", {}, { date: "soon", event: "Price change", price: "12" }, { event: "Listing removed" }]);
    expect(r).toEqual([
      { date: "—", event: "Listing removed", price: "—", change: null, tone: "neutral" },
      { date: "soon", event: "Price change", price: "—", change: null, tone: "neutral" },
    ]);
    expect(priceHistoryRows(undefined)).toEqual([]);
    expect(priceHistoryRows("nope")).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/NaN|undefined/);
  });
});

describe("sellerMotivation", () => {
  it("returns null when the row has nothing to say", () => {
    expect(sellerMotivation({})).toBeNull();
    expect(sellerMotivation({ priceHistory: [], motivationSignals: [] })).toBeNull();
  });
  it("plain facts, capitalized signals with a true minus, tenure signal not repeated", () => {
    const m = sellerMotivation({
      motivationPoints: 7, daysOnZillow: 94, tenureYears: 22.4, lastSoldPrice: 150000, lastSoldDate: "2003-06-15",
      motivationSignals: ["2 price cuts (-8%)", "stale on market", "22-yr owner", "back on market"],
    })!;
    expect(m.facts).toEqual([
      { label: "Score", value: "7/10" },
      { label: "On market", value: "94 days" },
      { label: "Owner tenure", value: "22 yrs" },
      { label: "Last sold", value: "$150,000 · Jun 15, 2003" },
    ]);
    expect(m.signals).toEqual([`2 price cuts (${MINUS}8%)`, "Stale on market", "Back on market"]);
    expect(m.history).toEqual([]);
  });
  it("singular units and a tenure signal kept when there is no tenure fact", () => {
    const m = sellerMotivation({ daysOnZillow: 1, tenureYears: 1, motivationSignals: ["1 price cut (-3%)"] })!;
    expect(m.facts).toEqual([{ label: "On market", value: "1 day" }, { label: "Owner tenure", value: "1 yr" }]);
    expect(sellerMotivation({ motivationSignals: ["18-yr owner"] })!.signals).toEqual(["18-yr owner"]);
  });
});
