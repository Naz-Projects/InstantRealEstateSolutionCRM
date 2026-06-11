import { useState } from "react";
import { BadgeInfo, ChevronDown, ChevronUp } from "lucide-react";
import { SCORE_CONFIG } from "../scraper/leadScore";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ires-score-legend-collapsed";

// Lead-score legend, docked in the sidebar footer (fixed — never shifts page layout).
// Values come from SCORE_CONFIG so the legend can't drift from the real scoring.
export function ScoreLegend() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "1",
  );
  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  const w = SCORE_CONFIG.typeWeights;

  return (
    <div className="mx-2 mb-1 rounded-lg border border-sidebar-border bg-sidebar-accent/30 group-data-[collapsible=icon]:hidden">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-sidebar-foreground/80"
        aria-expanded={!collapsed}
      >
        <BadgeInfo className="h-3.5 w-3.5 text-teal-glow" />
        Lead score guide
        {collapsed ? (
          <ChevronUp className="ml-auto h-3.5 w-3.5 opacity-60" />
        ) : (
          <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-60" />
        )}
      </button>
      {!collapsed && (
        <div className="space-y-1.5 px-2.5 pb-2.5 text-[11px] leading-snug text-sidebar-foreground/70">
          <div>
            Not out of 100 — an open-ended <span className="text-sidebar-foreground">priority rank</span>:
            higher = fresher, more stacked distress.
          </div>
          <div className="space-y-0.5">
            <Row label="Pre-foreclosure filing" value={`+${w["pre-foreclosure"]}`} />
            <Row label="Code violation" value={`+${w["code-violation"]}`} />
            <Row label="Each extra signal" value={`+${SCORE_CONFIG.stackBonus}`} />
            <Row label="Absentee owner" value={`×${SCORE_CONFIG.absenteeMultiplier}`} />
            <Row label={`Halves every ${SCORE_CONFIG.recencyHalfLifeDays} days`} value="decay" />
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Tier dot="bg-red-400" label="70+ hot" />
            <Tier dot="bg-amber-400" label="40+ warm" />
            <Tier dot="bg-sidebar-foreground/40" label="<40 cool" />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span>{label}</span>
      <span className="font-mono text-sidebar-foreground/90">{value}</span>
    </div>
  );
}

function Tier({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}
