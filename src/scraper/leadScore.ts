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
};

export interface ScorableSignal {
  type: string;
  observedDate: number; // ms epoch
}

export function computeLeadScore(
  signals: ScorableSignal[],
  parcel: { absentee: boolean },
  now: number,
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
  return Math.round(total);
}
