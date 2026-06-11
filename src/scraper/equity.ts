// Equity math for the P4 equity gate (lead engine). Pure, zero-dependency:
// imported by BOTH the Convex leads query and the UI so displayed == computed.
// Spec: docs/superpowers/specs/2026-06-11-equity-gate-design.md.

export interface EquityInput {
  value: number | null; // best-known as-is value (zestimate or comps-derived)
  countyBalance?: number | null;
  schoolBalance?: number | null;
  sewerBalance?: number | null;
  manualLiens?: number | null; // team-entered known liens/payoff (e.g. mortgage)
}

export interface EquityResult {
  equity: number | null;
  equityRatio: number | null; // equity / value
  basis: "taxes-only" | "incl-manual-liens" | null;
}

/**
 * Equity = value − known liens. Missing balances count as 0 — this is a
 * taxes-only PROXY until a mortgage payoff is entered (mortgages aren't in any
 * free feed); basis labels which case the number represents.
 */
export function computeEquity(input: EquityInput): EquityResult {
  if (input.value == null || input.value <= 0) {
    return { equity: null, equityRatio: null, basis: null };
  }
  const taxes =
    (input.countyBalance ?? 0) + (input.schoolBalance ?? 0) + (input.sewerBalance ?? 0);
  const manual = input.manualLiens ?? 0;
  const equity = input.value - taxes - manual;
  return {
    equity,
    equityRatio: equity / input.value,
    basis: manual > 0 ? "incl-manual-liens" : "taxes-only",
  };
}

/**
 * Parse a Zillow zestimate string to dollars. Unlike deal.ts parseMoney, this
 * handles the K/M suffixes Zillow uses on search cards ("$350K", "$1.2M").
 */
export function parseZestimate(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.trim().match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*([MKmk])?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toUpperCase();
  return Math.round(suffix === "M" ? n * 1_000_000 : suffix === "K" ? n * 1_000 : n);
}
