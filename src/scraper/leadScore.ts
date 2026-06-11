// Rules-based lead scoring (lead engine Phase 2, spec layer 3). Score =
// Σ per-signal (type weight × recency decay) + stack bonus, × absentee multiplier.
// Config-driven so weights tune without logic changes; imported by BOTH the Convex
// leads query and any UI preview so displayed == computed. ML propensity comes later
// (needs closed-deal outcomes to train on — distress-signals.md).

export const SCORE_CONFIG = {
  typeWeights: {
    "pre-foreclosure": 50, // months of runway before the auction — highest intent
    "code-violation": 20,
  } as Record<string, number>,
  defaultWeight: 10, // unknown/future signal types still count
  recencyHalfLifeDays: 90, // a signal loses half its weight every 90 days
  stackBonus: 10, // per signal beyond the first (list stacking)
  absenteeMultiplier: 1.5,
  // P4 equity gate: equityRatio (equity/value) → bucket → score multiplier.
  // "unknown" (not yet enriched) = 1.0 so un-enriched leads score as before.
  equityBuckets: { highMin: 0.5, mediumMin: 0.2 },
  equityMultipliers: { high: 1.5, medium: 1.2, low: 0.5, unknown: 1.0 },
};

export type EquityBucketName = "high" | "medium" | "low" | "unknown";

export function equityBucket(ratio: number | null): EquityBucketName {
  if (ratio == null) return "unknown";
  if (ratio >= SCORE_CONFIG.equityBuckets.highMin) return "high";
  if (ratio >= SCORE_CONFIG.equityBuckets.mediumMin) return "medium";
  return "low";
}

export interface ScorableSignal {
  type: string;
  observedDate: number; // ms epoch
}

export function computeLeadScore(
  signals: ScorableSignal[],
  parcel: { absentee: boolean },
  now: number,
  equity?: EquityBucketName,
): number {
  if (signals.length === 0) return 0;
  const halfLifeMs = SCORE_CONFIG.recencyHalfLifeDays * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const s of signals) {
    const weight = SCORE_CONFIG.typeWeights[s.type] ?? SCORE_CONFIG.defaultWeight;
    const ageMs = Math.max(0, now - s.observedDate);
    total += weight * Math.pow(0.5, ageMs / halfLifeMs);
  }
  total += SCORE_CONFIG.stackBonus * (signals.length - 1);
  if (parcel.absentee) total *= SCORE_CONFIG.absenteeMultiplier;
  total *= SCORE_CONFIG.equityMultipliers[equity ?? "unknown"];
  return Math.round(total);
}
