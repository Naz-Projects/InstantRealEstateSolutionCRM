// Portfolio actuals math for owned properties. Pure + testable (like deal.ts/flip.ts);
// safe to run inside a Convex V8 query. Computes money-in / money-out summaries from a
// unified ledger and turns a sold flip into realized profit + ROI.

export type Direction = "expense" | "income";
export type Grade = "good" | "ok" | "thin" | "bad" | "pending";

export interface LedgerLike {
  direction: Direction;
  amount: number;
}

export interface PropertyFinancials {
  dealType: "flip" | "rental";
  status: "in_progress" | "sold" | "active" | "vacant";
  purchasePrice?: number | null;
  salePrice?: number | null;
}

export interface PortfolioSummary {
  totalExpenses: number;
  totalIncome: number;
  invested: number; // (purchasePrice ?? 0) + totalExpenses — running money-in
  realizedProfit: number | null; // sold flips only
  roi: number | null; // realizedProfit / invested, when invested > 0
  netCashFlow: number | null; // rentals only
  grade: Grade;
}

export function summarizeProperty(
  p: PropertyFinancials,
  ledger: LedgerLike[],
): PortfolioSummary {
  let totalExpenses = 0;
  let totalIncome = 0;
  for (const e of ledger) {
    if (e.direction === "expense") totalExpenses += e.amount;
    else totalIncome += e.amount;
  }
  const purchase = p.purchasePrice ?? 0;
  const invested = purchase + totalExpenses;

  if (p.dealType === "flip") {
    if (p.status === "sold" && p.salePrice != null) {
      const realizedProfit = p.salePrice + totalIncome - purchase - totalExpenses;
      const roi = invested > 0 ? realizedProfit / invested : null;
      let grade: Grade;
      if (realizedProfit <= 0) grade = "bad";
      else if (roi != null && roi < 0.1) grade = "thin";
      else if (roi != null && roi < 0.2) grade = "ok";
      else grade = "good";
      return { totalExpenses, totalIncome, invested, realizedProfit, roi, netCashFlow: null, grade };
    }
    return {
      totalExpenses, totalIncome, invested,
      realizedProfit: null, roi: null, netCashFlow: null, grade: "pending",
    };
  }

  // rental
  const netCashFlow = totalIncome - totalExpenses;
  let grade: Grade;
  if (totalIncome === 0) grade = "pending";
  else if (netCashFlow < 0) grade = "bad";
  else grade = "good";
  return { totalExpenses, totalIncome, invested, realizedProfit: null, roi: null, netCashFlow, grade };
}
