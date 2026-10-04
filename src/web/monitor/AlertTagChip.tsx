import { RotateCcw, TrendingDown } from "lucide-react";
import { digestAlertTag } from "../../scraper/monitorRecheck";
import { alertChipLabel } from "../lib/monitorBoard";

// Phase 4: a fresh PRICE CUT / BACK ON MARKET event on this listing (same freshness
// rule as the digest, src/scraper/monitorRecheck.ts digestAlertTag).
export function AlertTagChip({ alertTag, alertedEventAt }: { alertTag?: string; alertedEventAt?: number }) {
  const tag = digestAlertTag({ alertTag, alertedEventAt }, Date.now());
  if (!tag) return null;
  const Icon = tag === "BACK ON MARKET" ? RotateCcw : TrendingDown;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
      <Icon className="h-3 w-3" aria-hidden />
      {alertChipLabel(tag)}
    </span>
  );
}
