import { describe, it, expect } from "vitest";
import { summarizeProperty, type LedgerLike } from "../src/scraper/portfolio";

const exp = (amount: number): LedgerLike => ({ direction: "expense", amount });
const inc = (amount: number): LedgerLike => ({ direction: "income", amount });

describe("summarizeProperty — flip", () => {
  it("in-progress: invested = purchase + expenses; profit/roi null; grade pending", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "in_progress", purchasePrice: 200000 },
      [exp(50000), exp(20000)],
    );
    expect(s.totalExpenses).toBe(70000);
    expect(s.invested).toBe(270000);
    expect(s.realizedProfit).toBeNull();
    expect(s.roi).toBeNull();
    expect(s.netCashFlow).toBeNull();
    expect(s.grade).toBe("pending");
  });
  it("sold: realized profit, roi, and grade ok at ~18.5% return", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "sold", purchasePrice: 200000, salePrice: 320000 },
      [exp(70000)],
    );
    expect(s.invested).toBe(270000);
    expect(s.realizedProfit).toBe(50000);
    expect(s.roi).toBeCloseTo(0.1852, 3);
    expect(s.grade).toBe("ok");
  });
  it("sold at a loss: grade bad", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "sold", purchasePrice: 300000, salePrice: 350000 },
      [exp(80000)],
    );
    expect(s.realizedProfit).toBe(-30000);
    expect(s.grade).toBe("bad");
  });
  it("no purchase price + no expenses but a sale: roi null (no divide-by-zero), profit positive, grade good", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "sold", salePrice: 50000 },
      [],
    );
    expect(s.invested).toBe(0);
    expect(s.realizedProfit).toBe(50000);
    expect(s.roi).toBeNull();
    expect(s.grade).toBe("good");
  });
});

describe("summarizeProperty — rental", () => {
  it("computes net cash flow; grade good when positive", () => {
    const s = summarizeProperty(
      { dealType: "rental", status: "active" },
      [inc(1500), inc(1500), inc(1500), exp(400), exp(600)],
    );
    expect(s.totalIncome).toBe(4500);
    expect(s.totalExpenses).toBe(1000);
    expect(s.netCashFlow).toBe(3500);
    expect(s.realizedProfit).toBeNull();
    expect(s.grade).toBe("good");
  });
  it("no income yet: grade pending", () => {
    const s = summarizeProperty({ dealType: "rental", status: "vacant" }, [exp(500)]);
    expect(s.totalIncome).toBe(0);
    expect(s.netCashFlow).toBe(-500);
    expect(s.grade).toBe("pending");
  });
  it("negative cash flow with income: grade bad", () => {
    const s = summarizeProperty({ dealType: "rental", status: "active" }, [inc(800), exp(1000)]);
    expect(s.netCashFlow).toBe(-200);
    expect(s.grade).toBe("bad");
  });
});
