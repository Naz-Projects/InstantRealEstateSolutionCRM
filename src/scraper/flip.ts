// Flip economics — the "should I flip this, and at what max offer?" screen.
// Pure + deterministic so it's unit-tested and safe to run in a Convex query
// AND imported by the React page for a live preview. Does NOT touch deal.ts.

export type RehabTier = "cosmetic" | "moderate" | "gut" | "custom";

export interface RehabTierInfo {
  perSqft: number;
  label: string;
  range: string;
}

// Per-sqft midpoints from the research (ranges shown for the UI); all editable.
export const REHAB_TIERS: Record<Exclude<RehabTier, "custom">, RehabTierInfo> = {
  cosmetic: { perSqft: 18, label: "Cosmetic", range: "$10-25/sqft" },
  moderate: { perSqft: 42, label: "Moderate", range: "$25-60/sqft" },
  gut: { perSqft: 95, label: "Full Gut", range: "$60-150+/sqft" },
};

export interface FlipAssumptions {
  closingPct: number;     // purchase-side closing, fraction of purchase
  downPct: number;        // down payment, fraction of purchase
  loanPoints: number;     // fraction of loan amount
  annualRate: number;     // hard-money annual interest, fraction
  holdingMonths: number;
  monthlyHolding: number; // taxes+insurance+utilities+misc, $/month
  sellAgentPct: number;   // fraction of ARV
  sellTransferPct: number;// fraction of ARV (DE seller transfer-tax portion)
  sellClosingPct: number; // fraction of ARV
}

export const FLIP_DEFAULTS: { contingencyPct: number; assumptions: FlipAssumptions } = {
  contingencyPct: 0.10,
  assumptions: {
    closingPct: 0.02,
    downPct: 0.10,
    loanPoints: 0.02,
    annualRate: 0.11,
    holdingMonths: 6,
    monthlyHolding: 400,
    sellAgentPct: 0.05,
    sellTransferPct: 0.02,
    sellClosingPct: 0.01,
  },
};

export interface RehabEstimate {
  base: number | null;
  contingency: number | null;
  total: number | null;
}

/** Tiered rehab estimate: override wins; else perSqft * sqft; + contingency. */
export function estimateRehab(
  perSqft: number,
  sqft: number | null,
  contingencyPct: number,
  override?: number | null,
): RehabEstimate {
  const base = override != null ? override : sqft != null ? perSqft * sqft : null;
  if (base === null) return { base: null, contingency: null, total: null };
  const contingency = base * contingencyPct;
  return { base, contingency, total: base + contingency };
}

export type FlipGrade = "good" | "ok" | "thin" | "bad" | "unknown";

export interface FlipInput {
  arv: number | null;
  purchasePrice: number | null;
  rehabTotal: number | null;
  assumptions: FlipAssumptions;
}

export interface FlipMetrics {
  mao: number | null;
  closingCost: number | null;
  financingCost: number | null;
  holdingCost: number | null;
  sellingCost: number | null;
  totalCost: number | null;
  profit: number | null;
  cashInvested: number | null;
  roi: number | null;
  annualizedRoi: number | null;
  margin: number | null;
  grade: FlipGrade;
  dataComplete: boolean;
  flags: string[];
}

export function computeFlip(input: FlipInput): FlipMetrics {
  const { arv, purchasePrice, rehabTotal, assumptions: a } = input;
  const flags: string[] = [];
  if (arv === null) flags.push("missing-arv");
  if (purchasePrice === null) flags.push("missing-purchase");
  if (rehabTotal === null) flags.push("missing-rehab");

  // MAO needs ARV + rehab only (the quick offer ceiling).
  const mao = arv !== null && rehabTotal !== null ? arv * 0.7 - rehabTotal : null;

  const dataComplete = arv !== null && purchasePrice !== null && rehabTotal !== null;
  if (!dataComplete) {
    return {
      mao, closingCost: null, financingCost: null, holdingCost: null, sellingCost: null,
      totalCost: null, profit: null, cashInvested: null, roi: null, annualizedRoi: null,
      margin: null, grade: "unknown", dataComplete: false, flags,
    };
  }

  const closingCost = purchasePrice * a.closingPct;
  const downPayment = purchasePrice * a.downPct;
  const loanAmount = purchasePrice - downPayment + rehabTotal; // hard money funds rest of purchase + 100% rehab
  const points = loanAmount * a.loanPoints;
  const interest = loanAmount * a.annualRate * (a.holdingMonths / 12);
  const financingCost = points + interest;
  const holdingCost = a.monthlyHolding * a.holdingMonths;
  const sellingCost = arv * (a.sellAgentPct + a.sellTransferPct + a.sellClosingPct);

  const totalCost = purchasePrice + closingCost + rehabTotal + financingCost + holdingCost + sellingCost;
  const profit = arv - totalCost;
  const cashInvested = downPayment + closingCost + points + interest + holdingCost;
  const roi = cashInvested > 0 ? profit / cashInvested : null;
  const annualizedRoi = roi !== null && a.holdingMonths > 0 ? roi * (12 / a.holdingMonths) : null;
  const margin = arv > 0 ? profit / arv : null;

  if (mao !== null && purchasePrice > mao) flags.push("over-70%-rule");
  if (profit <= 0) flags.push("negative-profit");
  if (margin !== null && margin > 0 && margin < 0.1) flags.push("thin-margin");

  let grade: FlipGrade = "unknown";
  if (margin !== null) {
    if (margin <= 0) grade = "bad";
    else if (margin < 0.1) grade = "thin";
    else if (margin < 0.2) grade = "ok";
    else grade = "good";
  }

  return {
    mao, closingCost, financingCost, holdingCost, sellingCost, totalCost,
    profit, cashInvested, roi, annualizedRoi, margin, grade, dataComplete, flags,
  };
}
