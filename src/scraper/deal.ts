// Deal economics for a sheriff-sale listing — the "cushion" screen.
//
// The math is sale-type-aware (see the user research):
//  - TAX (Vend Exp Monition): the foreclosing "principal" IS essentially the
//    delinquent county/school/sewer taxes, so cost ≈ principal. Adding the
//    balances again would double-count. Other liens (mortgages) are typically
//    wiped. Caveat: 60-day owner redemption.
//  - MTG (Lev Fac) / JUDG (Vend Exp Judge): principal is the foreclosed loan;
//    the county/school/sewer taxes are SEPARATE senior liens, so cost ≈
//    principal + those balances. Risk: a surviving senior mortgage (not on the
//    parcel page) if a junior lien is foreclosing — flagged when principal is
//    suspiciously small vs. value.
//
// Pure + deterministic so it's unit-tested and safe to run in a Convex query.

// 2-word error codes the scrapers write into fields when data is unavailable.
export const ERROR_CODES = new Set([
  "PENDING", "NOT FOUND", "SCRAPE FAILED", "NO ADDRESS", "WRONG STATE",
  "NO PARCEL", "NO STATE", "BAD ADDRESS",
]);

/** Parse a money/number string ("$45,527.14", "47600") to a number, or null if missing/error. */
export function parseMoney(s: string | undefined | null): number | null {
  if (s === undefined || s === null) return null;
  const trimmed = s.trim();
  if (!trimmed || ERROR_CODES.has(trimmed)) return null;
  const n = parseFloat(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export type CushionTier = "good" | "ok" | "thin" | "verify" | "bad" | "unknown";

export interface DealMetrics {
  zestimate: number | null;
  principal: number | null;
  county: number | null;
  school: number | null;
  sewer: number | null;
  liensTotal: number | null;
  costToClear: number | null;
  cushion: number | null;
  cushionPct: number | null; // cushion / zestimate
  tier: CushionTier;
  dataComplete: boolean;
  flags: string[]; // e.g. "tax-redemption", "senior-lien-risk", "needs-rescrape", "judg-risk"
}

export interface DealInput {
  saleType: string;
  zestimate: string;
  principal: string;
  countyBalanceDue: string;
  schoolBalanceDue: string;
  sewerBalanceDue: string;
}

export function computeDeal(row: DealInput): DealMetrics {
  const zestimate = parseMoney(row.zestimate);
  const principal = parseMoney(row.principal);
  const county = parseMoney(row.countyBalanceDue);
  const school = parseMoney(row.schoolBalanceDue);
  // "NOT FOUND" sewer = parcel has no NCC sewer account = $0 owed to the county.
  const sewer = row.sewerBalanceDue === "NOT FOUND" ? 0 : parseMoney(row.sewerBalanceDue);
  const type = (row.saleType || "").toUpperCase();
  const flags: string[] = [];

  const taxesKnown = county !== null && school !== null;
  const liensTotal = taxesKnown ? county! + school! + (sewer ?? 0) : null;

  let costToClear: number | null = null;
  if (principal !== null) {
    if (type === "TAX") {
      costToClear = principal; // taxes already inside the principal
      flags.push("tax-redemption");
    } else if (taxesKnown) {
      costToClear = principal + liensTotal!; // loan + separate senior taxes
      if (type === "JUDG") flags.push("judg-risk");
      if (zestimate !== null && zestimate > 0 && principal < zestimate * 0.25) {
        flags.push("senior-lien-risk"); // tiny principal → possible hidden senior mortgage
      }
    }
  }

  const cushion = zestimate !== null && costToClear !== null ? zestimate - costToClear : null;
  const cushionPct = cushion !== null && zestimate !== null && zestimate > 0 ? cushion / zestimate : null;
  const dataComplete = cushion !== null;
  if (!dataComplete) flags.push("needs-rescrape");

  let tier: CushionTier = "unknown";
  if (cushionPct !== null) {
    if (cushionPct >= 0.4) tier = "good";
    else if (cushionPct >= 0.2) tier = "ok";
    else if (cushionPct > 0.05) tier = "thin";
    else tier = "bad";
  }
  // A surviving-senior-lien / judgment risk makes the cushion unreliable (a tiny
  // foreclosing principal mechanically inflates it). Never let such a row show as
  // a confident "good" deal — downgrade to "verify" so it's flagged, not ranked #1.
  if (tier !== "unknown" && (flags.includes("senior-lien-risk") || flags.includes("judg-risk"))) {
    tier = "verify";
  }

  return {
    zestimate, principal, county, school, sewer,
    liensTotal, costToClear, cushion, cushionPct, tier, dataComplete, flags,
  };
}
