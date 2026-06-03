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
