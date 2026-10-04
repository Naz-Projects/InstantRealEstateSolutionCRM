/**
 * Backtest the CURRENT monitor keeper rules against a prod export of monitorListings
 * (stored fields only, the same path as monitorData:regateKeepers). Reports the
 * old-vs-new keep rate and exit mix.
 *
 * Get the data (prod deploy key, see lessons 2026-10-03):
 *   npx convex export --path monitor-export.zip   ->  unzip  ->  monitorListings/documents.jsonl
 * Run:
 *   npx tsx scripts/monitor-backtest.ts monitorListings/documents.jsonl
 */
import { readFileSync } from "node:fs";
import {
  evaluateDeal,
  dealInputFromStored,
  isDigestWorthy,
  isLandType,
  isMultiUnitType,
  isCondoType,
  MONITOR,
  type StoredListing,
} from "../src/scraper/monitorListings";

export interface BacktestRow extends StoredListing {
  status?: string;
  keeper?: boolean;
  bestExit?: string;
  homeType?: string;
}
export interface BacktestSummary {
  analyzed: number;
  oldKeepers: number;
  newKeepers: number;
  regateKept: number;   // old keepers that survive (what regateKeepers would keep)
  dekept: number;       // old keepers the new rules drop
  newlyKept: number;    // old non-keepers the new rules would keep (re-gate never promotes)
  newDigest: number;    // new keepers that reach the email (FLIP/RENTAL)
  oldExitMix: Record<string, number>;
  newExitMix: Record<string, number>;
  taxEstimated: number; // rows underwritten on the 1.6% fallback (no stored tax rate)
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export function summarizeBacktest(rows: BacktestRow[]): BacktestSummary {
  const s: BacktestSummary = {
    analyzed: 0, oldKeepers: 0, newKeepers: 0, regateKept: 0, dekept: 0, newlyKept: 0, newDigest: 0,
    oldExitMix: {}, newExitMix: {}, taxEstimated: 0,
  };
  for (const r of rows) {
    if (r.status !== "analyzed") continue;
    // analyzeOne vetoes these before any underwriting; they are never keepers.
    if (isLandType(r.homeType) || isMultiUnitType(r.homeType) || isCondoType(r.homeType)) continue;
    s.analyzed++;
    const d = evaluateDeal(dealInputFromStored(r));
    const wasKeeper = r.keeper === true;
    if (wasKeeper) {
      s.oldKeepers++;
      bump(s.oldExitMix, r.bestExit ?? "UNSET");
      if (d.keeper) s.regateKept++;
      else s.dekept++;
    }
    if (d.keeper) {
      s.newKeepers++;
      bump(s.newExitMix, d.bestExit);
      if (!wasKeeper) s.newlyKept++;
      if (isDigestWorthy(d.bestExit)) s.newDigest++;
    }
    if (d.rental?.taxEstimated) s.taxEstimated++;
  }
  return s;
}

function main(path: string): void {
  const rows = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as BacktestRow);
  const s = summarizeBacktest(rows);
  const rate = (n: number) => (s.analyzed ? `${((n / s.analyzed) * 100).toFixed(1)}%` : "n/a");
  console.log(`analyzed rows:   ${s.analyzed}`);
  console.log(`old keepers:     ${s.oldKeepers} (${rate(s.oldKeepers)})  exits ${JSON.stringify(s.oldExitMix)}`);
  console.log(`new keepers:     ${s.newKeepers} (${rate(s.newKeepers)})  exits ${JSON.stringify(s.newExitMix)}`);
  console.log(`  digest-worthy: ${s.newDigest}`);
  console.log(`re-gate:         ${s.regateKept} kept / ${s.dekept} de-kept (of ${s.oldKeepers})`);
  console.log(`newly kept:      ${s.newlyKept} (fresh analysis only; re-gate never promotes)`);
  console.log(`tax estimated:   ${s.taxEstimated} rows on the ${MONITOR.rentalTaxFallbackPct}% fallback (old rows store no tax rate)`);
}

if (process.argv[1] && /monitor-backtest\.ts$/.test(process.argv[1])) {
  if (!process.argv[2]) {
    console.error("usage: npx tsx scripts/monitor-backtest.ts <monitorListings/documents.jsonl>");
    process.exit(1);
  }
  main(process.argv[2]);
}
