// 2026-10-20 deal-flow fix (forensic: 3 emails in 15 nights): below-market 10%, DSCR 1.0,
// ARV cap 1.25x Zestimate, ARV-unverified VERIFY gate, rule-based DISTRESS lane, and the
// digest lanes (WHOLESALE + DISTRESS emailed, ranked below FLIP/RENTAL).
import { describe, it, expect } from "vitest";
import {
  MONITOR, evaluateDeal, detectDistress, conservativeArv, dealInputFromStored, meetsRentalFloor,
  isDigestWorthy, digestLaneRank, partitionDigestRows, shouldReopenForDigest, riskFlags, byDigestPriority,
} from "../src/scraper/monitorListings";
import { matchesBuyBox } from "../src/scraper/monitorBuyBox";
import type { DealInput, RentalMetrics } from "../src/scraper/monitorListings";
import type { Comp } from "../src/scraper/comps";

const DEAL: DealInput = { listPrice: null, zestimate: null, valueBasis: null, arv: null, rehabTotal: 0, rent: null, renovated: false };

describe("thresholds live in MONITOR", () => {
  it("below-market 10%, DSCR 1.0, ARV cap 1.25x Zestimate, unverified 1.6x list, distress 0.95x value", () => {
    expect(MONITOR.spreadThreshold).toBe(0.1);
    expect(MONITOR.dscrBar).toBe(1.0);
    expect(MONITOR.arvZestimateCap).toBe(1.25);
    expect(MONITOR.arvUnverifiedListMult).toBe(1.6);
    expect(MONITOR.distressMaxListToValue).toBe(0.95);
  });
});

describe("below market at 10%", () => {
  it("list <= 0.90 x Zestimate keeps as WHOLESALE; 1 dollar over does not", () => {
    expect(evaluateDeal({ ...DEAL, listPrice: 180000, zestimate: 200000 })).toMatchObject({ belowMarket: true, spreadPct: 10, bestExit: "WHOLESALE", keeper: true });
    expect(evaluateDeal({ ...DEAL, listPrice: 180001, zestimate: 200000 })).toMatchObject({ belowMarket: false, bestExit: "PASS", keeper: false });
  });
  it("no Zestimate: the as-is comps basis runs the same 10% test", () => {
    expect(evaluateDeal({ ...DEAL, listPrice: 180000, valueBasis: 200000 })).toMatchObject({ belowMarket: true, bestExit: "WHOLESALE" });
    expect(evaluateDeal({ ...DEAL, listPrice: 181000, valueBasis: 200000 })).toMatchObject({ belowMarket: false, bestExit: "PASS" });
  });
});

describe("rental floor DSCR 1.0", () => {
  const rentalOf = (capRate: number, cashFlow: number, dscr: number): RentalMetrics => ({ rent: 0, onePct: 0, capRate, cashFlow, cashOnCash: 0, allIn: 0, dscr, taxEstimated: false });
  it("DSCR 1.0 passes, 0.99 fails; cap >= 6% and cash flow >= 0 still required", () => {
    expect(meetsRentalFloor(rentalOf(0.06, 0, 1.0))).toBe(true);
    expect(meetsRentalFloor(rentalOf(0.09, 10, 0.99))).toBe(false);
    expect(meetsRentalFloor(rentalOf(0.0599, 100, 1.3))).toBe(false);
    expect(meetsRentalFloor(rentalOf(0.08, -1, 1.3))).toBe(false);
  });
  it("cap 7.1%, +$114/mo, DSCR 1.13 is now a RENTAL (was PASS under 1.2)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, rehabTotal: 20000, rent: 2000 });
    expect(d.rental!.dscr).toBeCloseTo(1.127, 3);
    expect(d).toMatchObject({ bestExit: "RENTAL", keeper: true });
  });
});

describe("ARV cap 1.25 x Zestimate", () => {
  const mk = (soldPrice: number, sqft: number): Comp => ({ address: "x", soldDate: "MAY 1, 2026", soldPrice, beds: 3, baths: 2, sqft, pricePerSqft: soldPrice / sqft });
  it("inflated comps are capped at 1.25 x Zestimate", () => {
    const comps = [mk(700000, 3101), mk(720000, 3101), mk(740000, 3101)];
    const r = conservativeArv({ comps, sqft: 3101, beds: 3, zestimate: 311400, homeType: "SINGLE_FAMILY", now: Date.parse("2026-10-01") });
    expect(r.arv).toBe(Math.round(311400 * 1.25));
  });
});

describe("ARV unverified (no Zestimate, ARV > 1.6 x list) -> VERIFY, board-only", () => {
  const big = { ...DEAL, listPrice: 180000, arv: 338743, valueBasis: 307200, rehabTotal: 40000 };
  it("a would-be FLIP is a VERIFY keeper, never emailed", () => {
    const d = evaluateDeal(big);
    expect(d.arvUnverified).toBe(true);
    expect(d.flip).not.toBeNull(); // numbers still shown on the board
    expect(d).toMatchObject({ bestExit: "VERIFY", keeper: true });
    expect(isDigestWorthy(d.bestExit)).toBe(false);
  });
  it("the comps-based below-market spread is equally unverified -> VERIFY, not WHOLESALE", () => {
    const d = evaluateDeal({ ...big, rehabTotal: null });
    expect(d.belowMarket).toBe(true);
    expect(d).toMatchObject({ bestExit: "VERIFY", keeper: true });
  });
  it("a rent-driven RENTAL does not depend on ARV and still wins", () => {
    const d = evaluateDeal({ ...big, listPrice: 150000, arv: 300000, rehabTotal: 20000, rent: 2400 });
    expect(d).toMatchObject({ arvUnverified: true, bestExit: "RENTAL" });
  });
  it("exactly 1.6 x list is verified; a Zestimate always verifies", () => {
    expect(evaluateDeal({ ...DEAL, listPrice: 100000, arv: 160000, rehabTotal: 10000 }).arvUnverified).toBe(false);
    expect(evaluateDeal({ ...big, zestimate: 250000 }).arvUnverified).toBe(false);
  });
  it("an unverified ARV with nothing else clearing stays PASS (not kept)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 180000, arv: 300000, rehabTotal: 150000 });
    expect(d).toMatchObject({ arvUnverified: true, bestExit: "PASS", keeper: false });
  });
  it("riskFlags carries the VERIFY flag", () => {
    expect(riskFlags({ arvUnverified: true })).toContain("ARV unverified - no Zestimate, ARV > 1.6x list (VERIFY)");
    expect(riskFlags({})).not.toContain("ARV unverified - no Zestimate, ARV > 1.6x list (VERIFY)");
  });
});

describe("detectDistress (word-bounded, negation-aware)", () => {
  it.each([
    ["Sold as-is, cash only", "as-is"],
    ["Property being sold as is.", "as-is"],
    ["INVESTOR SPECIAL in Elsmere", "investor special"],
    ["Approved short sale", "short sale"],
    ["Online auction ends Friday", "auction"],
    ["Estate sale - bring offers", "estate"],
    ["Being sold by the estate of the late owner", "estate"],
    ["Court-ordered probate sale", "probate"],
    ["House is a shell", "shell"],
    ["Power is off, bring a flashlight", "power off"],
    ["Fixer-upper with potential", "fixer"],
    ["Needs work throughout", "needs work"],
    ["Needs some TLC", "TLC"],
    ["Major rehab required", "major rehab"],
    ["Handyman special!", "handyman special"],
  ])("%s -> %s", (desc, sig) => {
    expect(detectDistress(desc)).toBe(sig);
  });
  it.each([
    "Licensed real estate agent owner",
    "Real-estate taxes are low",
    "Located in Brandywine Estates",
    "This 4-bedroom estate has been thoughtfully cared for",
    "Real estate sale terms apply",
    "Cozy fireplace and firepit",
    "The yard is huge, as is the basement",
    "This is not a short sale",
    "No auction, traditional sale",
    "Seashell accents and a nutshell summary",
    "Fully renovated colonial",
    "",
  ])("no signal: %s", (desc) => {
    expect(detectDistress(desc)).toBeNull();
  });
  it("null / undefined -> null", () => {
    expect(detectDistress(null)).toBeNull();
    expect(detectDistress(undefined)).toBeNull();
  });
});

describe("DISTRESS lane (deterministic, never the LLM)", () => {
  const d0 = { ...DEAL, rehabTotal: null, description: "Estate sale, sold as-is", homeType: "SINGLE_FAMILY" };
  it("distress words + list <= 0.95 x Zestimate -> DISTRESS keeper", () => {
    const d = evaluateDeal({ ...d0, listPrice: 190000, zestimate: 200000 });
    expect(d).toMatchObject({ belowMarket: false, bestExit: "DISTRESS", keeper: true, distressSignal: "as-is" });
    expect(isDigestWorthy(d.bestExit)).toBe(true);
  });
  it("no Zestimate -> the as-is comps value is the basis", () => {
    expect(evaluateDeal({ ...d0, listPrice: 190000, valueBasis: 200000 }).bestExit).toBe("DISTRESS");
  });
  it("list above 0.95 x value -> PASS", () => {
    expect(evaluateDeal({ ...d0, listPrice: 190001, zestimate: 200000 })).toMatchObject({ bestExit: "PASS", keeper: false });
  });
  it("no basis at all -> PASS", () => {
    expect(evaluateDeal({ ...d0, listPrice: 100000 }).bestExit).toBe("PASS");
  });
  it("renovated (detector or judge veto) -> no distress lane", () => {
    expect(evaluateDeal({ ...d0, listPrice: 190000, zestimate: 200000, renovated: true })).toMatchObject({ bestExit: "PASS", keeper: false });
  });
  it("never for land / manufactured / condo / multi-family", () => {
    for (const homeType of ["LOT", "LAND", "MANUFACTURED", "CONDO", "MULTI_FAMILY"]) {
      expect(evaluateDeal({ ...d0, homeType, listPrice: 188000, zestimate: 200000 })).toMatchObject({ bestExit: "PASS", keeper: false });
    }
  });
  it("no distress words -> PASS", () => {
    expect(evaluateDeal({ ...d0, description: "Lovely colonial", listPrice: 190000, zestimate: 200000 }).bestExit).toBe("PASS");
  });
  it("below market outranks distress (WHOLESALE), FLIP outranks both", () => {
    expect(evaluateDeal({ ...d0, listPrice: 170000, zestimate: 200000 }).bestExit).toBe("WHOLESALE");
    expect(evaluateDeal({ ...d0, listPrice: 180000, zestimate: 260000, arv: 300000, rehabTotal: 30000 }).bestExit).toBe("FLIP");
  });
  it("re-gate carries description + homeType from the stored row", () => {
    const i = dealInputFromStored({ listPrice: 190000, zestimate: 200000, description: "Estate sale, sold as-is", homeType: "SINGLE_FAMILY" });
    expect(i).toMatchObject({ description: "Estate sale, sold as-is", homeType: "SINGLE_FAMILY" });
    expect(evaluateDeal(i).bestExit).toBe("DISTRESS");
  });
});

describe("digest lanes", () => {
  it("rank: FLIP/RENTAL 3 > WHOLESALE 2 > DISTRESS 1 > VERIFY/PASS/unset 0", () => {
    expect(["FLIP", "RENTAL", "WHOLESALE", "DISTRESS", "VERIFY", "PASS", undefined, null].map(digestLaneRank)).toEqual([3, 3, 2, 1, 0, 0, 0, 0]);
  });
  it("WHOLESALE and DISTRESS are emailed; VERIFY/PASS stay board-only", () => {
    expect(isDigestWorthy("WHOLESALE")).toBe(true);
    expect(isDigestWorthy("DISTRESS")).toBe(true);
    expect(isDigestWorthy("VERIFY")).toBe(false);
    expect(isDigestWorthy("PASS")).toBe(false);
  });
  it("partition emails active rows of every emailed lane", () => {
    const rows = [{ id: "w", bestExit: "WHOLESALE" }, { id: "d", bestExit: "DISTRESS" }, { id: "v", bestExit: "VERIFY" }, { id: "aw", bestExit: "WHOLESALE", archivedAt: 1 }];
    const p = partitionDigestRows(rows);
    expect(p.toEmail.map((r) => r.id)).toEqual(["w", "d"]);
    expect(p.toSkip.map((r) => r.id)).toEqual(["v", "aw"]);
  });
  it("digest order: lane first, then score (the 50-row cap can never drop a FLIP for a Below market row)", () => {
    const rows = [
      { id: "w90", bestExit: "WHOLESALE", dealScore: 90 }, { id: "d", bestExit: "DISTRESS", dealScore: 99 },
      { id: "f40", bestExit: "FLIP", dealScore: 40 }, { id: "w20", bestExit: "WHOLESALE", dealScore: 20 }, { id: "r75", bestExit: "RENTAL", dealScore: 75 },
    ];
    expect([...rows].sort(byDigestPriority).map((r) => r.id)).toEqual(["r75", "f40", "w90", "w20", "d"]);
  });
  it("buy box: zips/price/beds filter every lane; an explicit exits list (FLIP/RENTAL only) excludes the new lanes", () => {
    const w = { address: "1 A St, Newark, DE 19702", propZip: "19702", listPrice: 170000, bestExit: "WHOLESALE" };
    const d = { ...w, bestExit: "DISTRESS" };
    const box = { zips: ["19702"], exits: [] as ("FLIP" | "RENTAL")[] };
    expect(matchesBuyBox(w, box)).toBe(true);
    expect(matchesBuyBox(d, box)).toBe(true);
    expect(matchesBuyBox(w, { ...box, zips: ["19805"] })).toBe(false);
    expect(matchesBuyBox(d, { ...box, priceMax: 150000 })).toBe(false);
    expect(matchesBuyBox(w, { ...box, exits: ["FLIP"] })).toBe(false);
    expect(matchesBuyBox(w, null)).toBe(true);
  });
  it("reopen on a lane upgrade only (a skipped-stamped WHOLESALE upgraded to FLIP is emailed again)", () => {
    expect(shouldReopenForDigest("WHOLESALE", "FLIP")).toBe(true);
    expect(shouldReopenForDigest("DISTRESS", "WHOLESALE")).toBe(true);
    expect(shouldReopenForDigest("PASS", "DISTRESS")).toBe(true);
    expect(shouldReopenForDigest("VERIFY", "WHOLESALE")).toBe(true);
    expect(shouldReopenForDigest("WHOLESALE", "WHOLESALE")).toBe(false);
    expect(shouldReopenForDigest("FLIP", "RENTAL")).toBe(false);
    expect(shouldReopenForDigest("FLIP", "DISTRESS")).toBe(false);
  });
});
