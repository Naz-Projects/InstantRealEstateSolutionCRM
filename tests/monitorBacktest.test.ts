import { describe, it, expect } from "vitest";
import { summarizeBacktest, type BacktestRow } from "../scripts/monitor-backtest";

const ROWS: BacktestRow[] = [
  // old distress keeper, above Zestimate -> de-kept
  { status: "analyzed", keeper: true, bestExit: "PASS", homeType: "SINGLE_FAMILY", listPrice: 240000, zestimate: 230000, conservativeArv: 260000, sqft: 1400, yearBuilt: 1990, description: "Estate sale, sold as-is" },
  // old keeper, 20% under Zestimate -> stays (WHOLESALE, board-only)
  { status: "analyzed", keeper: true, bestExit: "FLIP", homeType: "SINGLE_FAMILY", listPrice: 160000, zestimate: 200000, sqft: 1200, yearBuilt: 1990, description: "needs TLC" },
  // old non-keeper that now clears the RENTAL floor -> newly kept (fresh analysis only)
  { status: "analyzed", keeper: false, bestExit: "PASS", homeType: "TOWNHOUSE", listPrice: 150000, sqft: 1000, yearBuilt: 1990, rentZestimate: 2600, description: "Updated kitchen, move-in ready", riskFlags: [] },
  // condo / pending rows are ignored
  { status: "analyzed", keeper: false, homeType: "CONDO", listPrice: 100000, zestimate: 200000 },
  { status: "pending", keeper: false, listPrice: 100000, zestimate: 200000 },
];

describe("summarizeBacktest", () => {
  it("counts old vs new keepers, re-gate survivors, newly kept and exit mixes", () => {
    const s = summarizeBacktest(ROWS);
    expect(s).toMatchObject({ analyzed: 3, oldKeepers: 2, regateKept: 1, dekept: 1, newlyKept: 1, newKeepers: 2, newDigest: 1 });
    expect(s.oldExitMix).toEqual({ PASS: 1, FLIP: 1 });
    expect(s.newExitMix).toEqual({ WHOLESALE: 1, RENTAL: 1 });
    expect(s.taxEstimated).toBeGreaterThanOrEqual(1);
  });
});
