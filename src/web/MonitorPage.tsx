import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import {
  Radar,
  ClipboardPlus,
  ClipboardCheck,
  Calculator,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ImageOff,
  Phone,
  TrendingUp,
  TrendingDown,
  Eye,
  TriangleAlert,
  Microscope,
  Flame,
  Wrench,
  History,
  OctagonAlert,
  ShieldAlert,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { describeError } from "./lib/errorReporting";

// "Monitor the Web" (Zillow NCC deal-finder) — the /monitor review surface. Ranks
// keeper deals (best dealScore first), underwrites every exit (flip + rental), and
// promotes a listing into the existing Potential pipeline in one click. Mirrors the
// dark "Industrial Precision" chip/card idioms from LeadsPage / PotentialPage.
// Strictly additive. Spec: docs/superpowers/specs/2026-06-30-monitor-web-zillow-design.md §11.

type MonitorRow = FunctionReturnType<typeof api.monitorData.listKeepers>[number];

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// ---- chips ----

// bestExit is stored uppercase ("FLIP" | "RENTAL" | "WHOLESALE" | "PASS").
const EXIT_CHIP: Record<string, string> = {
  FLIP: "border-teal/40 bg-teal/10 text-teal-glow",
  WHOLETAIL: "border-sky-500/40 bg-sky-500/10 text-sky-400", // analyst-only exit (never a deterministic bestExit)
  RENTAL: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  WHOLESALE: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  PASS: "border-border bg-muted/40 text-muted-foreground",
};

function ExitChip({ exit }: { exit: string }) {
  const chip = EXIT_CHIP[exit.toUpperCase()] ?? "border-border text-muted-foreground";
  return (
    <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-medium uppercase", chip)}>{exit}</span>
  );
}

// spreadPct is stored as a PERCENT number (e.g. 15.0), not a fraction.
function SpreadChip({ pct }: { pct: number }) {
  const p = Math.round(pct);
  const tone =
    p >= 20
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : p >= 10
        ? "border-teal/40 bg-teal/10 text-teal-glow"
        : p > 0
          ? "border-border text-muted-foreground"
          : "border-red-500/40 bg-red-500/10 text-red-400";
  return (
    <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-medium", tone)}>
      {p >= 0 ? `${p}% below` : `${-p}% over`}
    </span>
  );
}

const REQ_META: Record<string, { label: string; chip: string }> = {
  below_market: { label: "Below market", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  fixer: { label: "Fixer", chip: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  distressed: { label: "Distressed", chip: "border-red-500/40 bg-red-500/10 text-red-400" },
  flip: { label: "Flip", chip: "border-teal/40 bg-teal/10 text-teal-glow" },
};

function MatchedChips({ reqs }: { reqs: string[] }) {
  if (reqs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reqs.map((r) => {
        const meta = REQ_META[r] ?? { label: r, chip: "border-border text-muted-foreground" };
        return (
          <span key={r} className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", meta.chip)}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function RiskChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <span
          key={f}
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-400"
        >
          <TriangleAlert className="h-3 w-3" />
          {f}
        </span>
      ))}
    </div>
  );
}

/**
 * The off-market "moat" badge — shown ONLY when a real distress signal attached
 * (signals / delinquent NCC balances / condition score). A bare offMarketPrclid
 * means merely "an NCC parcel matched this address" (almost always true) and is
 * NOT a signal, so it never triggers the badge on its own.
 */
function offMarketLabel(row: MonitorRow): string | null {
  const signals = row.offMarketSignals ?? [];
  if (signals.length > 0) return signals.join(", ");
  if (row.offMarketBalances != null) return `delinquent balances ${fmtMoney(row.offMarketBalances)}`;
  if (row.offMarketConditionScore != null) return `condition ${row.offMarketConditionScore}`;
  return null;
}

function OffMarketBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
      <Eye className="h-3.5 w-3.5" /> OWNER: {label}
    </span>
  );
}

// ---- photo ----

function CardPhoto({ row }: { row: MonitorRow }) {
  const [err, setErr] = useState(false);
  const url = row.photoUrls?.[0];
  if (!url || err) {
    return (
      <div className="grid h-40 w-full place-items-center border-b border-border/50 bg-muted/40">
        <ImageOff className="h-8 w-8 text-muted-foreground opacity-40" />
      </div>
    );
  }
  return (
    <img
      loading="lazy"
      src={url}
      onError={() => setErr(true)}
      alt={row.address}
      className="h-40 w-full border-b border-border/50 object-cover"
    />
  );
}

// ---- price history ----

function PriceHistoryLine({ row }: { row: MonitorRow }) {
  const sold = row.lastSoldPrice;
  if (sold == null) return null;
  const pct = row.listPrice != null && sold ? Math.round(((row.listPrice - sold) / sold) * 100) : null;
  const up = pct != null && pct >= 0;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      Last sold {fmtMoney(sold)}
      {row.lastSoldDate ? ` (${row.lastSoldDate})` : ""}
      {pct != null && (
        <span className={up ? "text-emerald-400" : "text-red-400"}>
          {" · "}
          {up ? "+" : ""}
          {pct}%
        </span>
      )}
    </div>
  );
}

// ---- analyst breakdown (deep-analysis: deterministic dealSignals + LLM condition/exit) ----

// LLM condition tiers → chip tone (cosmetic → structural = green → red).
const CONDITION_CHIP: Record<string, { label: string; chip: string }> = {
  cosmetic: { label: "Cosmetic", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  moderate: { label: "Moderate", chip: "border-teal/40 bg-teal/10 text-teal-glow" },
  systems: { label: "Systems", chip: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  structural: { label: "Structural", chip: "border-red-500/40 bg-red-500/10 text-red-400" },
};

// year-built era-hazard slugs → readable label.
const ERA_HAZARD_LABEL: Record<string, string> = {
  lead_paint_pre1978: "Lead paint era",
  asbestos_era_pre1980: "Asbestos era",
  knob_tube_era_pre1940: "Knob & tube era",
  aluminum_wiring_era_1965_75: "Aluminum wiring era",
  polybutylene_era_1978_95: "Polybutylene era",
  oil_tank_risk_pre1975: "Oil tank risk",
};

// NCC ZIP tier → label + tone (premium=green, standard=neutral, city=risk-red).
const ZIP_TIER_CHIP: Record<string, { label: string; chip: string }> = {
  "city-high-risk": { label: "City · high-risk ZIP", chip: "border-red-500/40 bg-red-500/10 text-red-400" },
  "suburb-standard": { label: "Suburb · standard ZIP", chip: "border-border bg-muted/40 text-muted-foreground" },
  "suburb-premium": { label: "Suburb · premium ZIP", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
};

// Humanize the compact history facts: ppsfDiscountPct 0.28 → "28% under comps $/sqft";
// tenureYears 22.3 → "22-yr owner".
function analystHistoryLine(row: MonitorRow): string | null {
  const parts: string[] = [];
  if (row.ppsfDiscountPct != null) {
    const pct = Math.round(row.ppsfDiscountPct * 100);
    parts.push(pct >= 0 ? `${pct}% under comps $/sqft` : `${-pct}% over comps $/sqft`);
  }
  if (row.tenureYears != null) parts.push(`${Math.round(row.tenureYears)}-yr owner`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The per-listing analyst read (Task 4): motivation, condition/value-add, a compact
 * price history, era-hazard + ZIP-tier context, red flags vs VERIFY checklist, and
 * the analyst's exit call (distinct from the deterministic score badge up top).
 * Every field is optional — a pre-upgrade row renders nothing (block is gated).
 */
function AnalystBreakdown({ row }: { row: MonitorRow }) {
  const motivationSignals = row.motivationSignals ?? [];
  const eraHazards = row.eraHazards ?? [];
  const redFlags = row.redFlags ?? [];
  const verifyGates = row.verifyGates ?? [];
  const exitFallbacks = row.exitFallbacks ?? [];
  const history = analystHistoryLine(row);

  const hasAny =
    row.motivationPoints != null ||
    motivationSignals.length > 0 ||
    row.conditionTier != null ||
    row.valueAddScope != null ||
    history != null ||
    eraHazards.length > 0 ||
    row.zipTier != null ||
    redFlags.length > 0 ||
    verifyGates.length > 0 ||
    row.exitTriage != null ||
    row.breakdown != null;
  if (!hasAny) return null;

  const cond = row.conditionTier ? CONDITION_CHIP[row.conditionTier] : null;
  const zip = row.zipTier ? ZIP_TIER_CHIP[row.zipTier] : null;
  const exitTone = row.exitTriage
    ? EXIT_CHIP[row.exitTriage.toUpperCase()] ?? "border-border text-muted-foreground"
    : "";

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Microscope className="h-3.5 w-3.5 text-teal-glow" /> Analyst breakdown
      </div>

      {/* motivation points + signal chips */}
      {(row.motivationPoints != null || motivationSignals.length > 0) && (
        <div className="space-y-1">
          {row.motivationPoints != null && (
            <div className="flex items-center gap-1.5 text-xs">
              <Flame className="h-3 w-3 text-amber-400" />
              <span className="text-muted-foreground">Seller motivation</span>
              <span className="font-semibold text-foreground">{row.motivationPoints}/10</span>
            </div>
          )}
          {motivationSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {motivationSignals.map((s) => (
                <span
                  key={s}
                  className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* condition tier + value-add scope */}
      {(cond || row.valueAddScope) && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Wrench className="h-3 w-3" /> Condition
          </span>
          {cond && (
            <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-medium", cond.chip)}>
              {cond.label}
            </span>
          )}
          {row.valueAddScope && <span className="text-muted-foreground">{row.valueAddScope}</span>}
        </div>
      )}

      {/* compact history: ppsf discount + tenure */}
      {history && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="h-3 w-3" /> {history}
        </div>
      )}

      {/* era-hazard chips + zip-tier chip */}
      {(eraHazards.length > 0 || zip) && (
        <div className="flex flex-wrap gap-1.5">
          {eraHazards.map((h) => (
            <span
              key={h}
              className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {ERA_HAZARD_LABEL[h] ?? h.replace(/_/g, " ")}
            </span>
          ))}
          {zip && (
            <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-medium", zip.chip)}>
              {zip.label}
            </span>
          )}
        </div>
      )}

      {/* red flags — red */}
      {redFlags.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-400">
            <OctagonAlert className="h-3.5 w-3.5" /> Red flags
          </div>
          <div className="flex flex-wrap gap-1.5">
            {redFlags.map((f) => (
              <span
                key={f}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-400"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* verify gates — amber, distinct "Verify before bid" checklist */}
      {verifyGates.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-400">
            <ShieldAlert className="h-3.5 w-3.5" /> Verify before bid
          </div>
          <div className="flex flex-wrap gap-1.5">
            {verifyGates.map((g) => (
              <span
                key={g}
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-400"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* analyst exit read — labeled distinct from the deterministic score badge up top */}
      {row.exitTriage && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Analyst exit</span>
          <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase", exitTone)}>
            {row.exitTriage}
          </span>
          {exitFallbacks.length > 0 && (
            <span className="text-muted-foreground">· fallback {exitFallbacks.join(", ")}</span>
          )}
        </div>
      )}

      {/* the analyst narrative */}
      {row.breakdown && <p className="text-xs leading-relaxed text-foreground">{row.breakdown}</p>}
    </div>
  );
}

// ---- promote ----

/**
 * Promote to Potential: call the existing shared-team `promoteToPotential`, then
 * stamp the returned deal id back on this listing row via `markPromoted` so the
 * card flips to "In pipeline". Value snapshot = conservative ARV; source = manual
 * (refId = zpid). Idempotent: a re-promote of an already-promoted address returns
 * the existing deal id, which we stamp all the same.
 */
function MonitorPromote({ row, fullAddress }: { row: MonitorRow; fullAddress: string }) {
  const promote = useMutation(api.potentialData.promoteToPotential);
  const markPromoted = useMutation(api.monitorData.markPromoted);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (row.promotedDealId) {
    return (
      <Link
        to="/potential"
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400"
      >
        <ClipboardCheck className="h-3.5 w-3.5" /> In pipeline
      </Link>
    );
  }

  const onClick = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await promote({
        source: { kind: "manual", refId: row.zpid },
        address: fullAddress,
        propCity: row.propCity ?? undefined,
        propZip: row.propZip ?? undefined,
        beds: row.beds != null ? String(row.beds) : undefined,
        baths: row.baths != null ? String(row.baths) : undefined,
        sqft: row.sqft ?? undefined,
        value: row.conservativeArv ?? undefined,
        score: row.dealScore ?? undefined,
        topSignals: row.matchedRequirements ?? undefined,
        contactName: row.agentName ?? undefined,
        contactPhone: row.agentPhone ?? undefined,
        lat: row.lat ?? undefined,
        lng: row.lng ?? undefined,
      });
      await markPromoted({ id: row._id, promotedDealId: res.id });
    } catch (e) {
      setErr(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-teal/40 px-2.5 py-1 text-xs font-medium text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40"
      >
        <ClipboardPlus className="h-3.5 w-3.5" /> {busy ? "Adding…" : "Promote"}
      </button>
      {err && <span className="text-[10px] text-amber-400">{err}</span>}
    </div>
  );
}

// ---- card ----

function MonitorCard({ row }: { row: MonitorRow }) {
  const [open, setOpen] = useState(false);
  const cityZip = [row.propCity, row.propZip].filter(Boolean).join(" ");
  const fullAddress = [row.address, cityZip].filter(Boolean).join(", ");
  const sizeLine = [
    row.beds != null ? `${row.beds} bd` : null,
    row.baths != null ? `${row.baths} ba` : null,
    row.sqft != null ? `${row.sqft.toLocaleString()} sqft` : null,
    row.ppsf != null ? `$${Math.round(row.ppsf)}/sqft` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const matched = row.matchedRequirements ?? [];
  const flags = row.riskFlags ?? [];
  const off = offMarketLabel(row);
  const room = row.roomVsList;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <CardPhoto row={row} />
      <div className="flex grow flex-col gap-2 p-3">
        {/* score + best exit + spread */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {row.dealScore != null && (
              <span className="text-lg font-bold leading-none text-teal-glow">{row.dealScore}</span>
            )}
            {row.bestExit && <ExitChip exit={row.bestExit} />}
          </div>
          {row.spreadPct != null && <SpreadChip pct={row.spreadPct} />}
        </div>

        {/* address */}
        <div>
          <div className="truncate font-medium text-foreground" title={row.address}>
            {row.address || "—"}
          </div>
          {cityZip && <div className="truncate text-xs text-muted-foreground">{cityZip}</div>}
        </div>

        {/* price + ARV */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
          <span>
            <span className="text-base font-bold text-foreground">{fmtMoney(row.listPrice)}</span>
            <span className="ml-1 text-xs text-muted-foreground">list</span>
          </span>
          {row.conservativeArv != null && (
            <span className="text-muted-foreground">
              ARV <span className="text-foreground">{fmtMoney(row.conservativeArv)}</span>
            </span>
          )}
        </div>
        {sizeLine && <div className="text-xs text-muted-foreground">{sizeLine}</div>}

        {/* matched requirements */}
        <MatchedChips reqs={matched} />

        {/* flip line */}
        {row.flipMao != null && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Flip:</span> MAO {fmtMoney(row.flipMao)}
            {room != null && (
              <> · {fmtMoney(Math.abs(room))} {room >= 0 ? "above" : "below"} list</>
            )}
            {row.flipMargin != null && <> · {Math.round(row.flipMargin * 100)}% margin</>}
          </div>
        )}

        {/* rental line (only when a cap rate was underwritten) */}
        {row.capRate != null && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Rental:</span> {(row.capRate * 100).toFixed(1)}% cap
            {row.cashFlow != null && <> · {fmtMoney(row.cashFlow)}/mo cash flow</>}
          </div>
        )}

        {/* off-market moat + risk flags */}
        {off && <OffMarketBadge label={off} />}
        <RiskChips flags={flags} />

        {/* agent contact */}
        {(row.agentName || row.agentPhone) && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3 w-3" />
            {[row.agentName, row.agentPhone].filter(Boolean).join(" · ")}
          </div>
        )}

        {/* expandable underwriting detail */}
        {open && (
          <div className="space-y-2 border-t border-border/50 pt-2">
            {row.aiReason && <p className="text-sm text-foreground">{row.aiReason}</p>}
            {row.aiConditionNotes && <p className="text-xs text-muted-foreground">{row.aiConditionNotes}</p>}
            <PriceHistoryLine row={row} />
            <AnalystBreakdown row={row} />
          </div>
        )}

        <div className="grow" />

        {/* footer: expand + actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? "Less" : "Details"}
          </button>
          <div className="grow" />
          <MonitorPromote row={row} fullAddress={fullAddress} />
          <Link
            to="/flip"
            search={{ address: fullAddress, value: row.conservativeArv ?? undefined, sqft: row.sqft ?? undefined }}
            className="inline-flex items-center gap-1.5 rounded-md border border-teal/40 px-2.5 py-1 text-xs font-medium text-teal-glow transition-colors hover:bg-teal/10"
          >
            <Calculator className="h-3.5 w-3.5" /> Flip
          </Link>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Zillow
          </a>
        </div>
      </div>
    </div>
  );
}

// ---- page ----

type LatestRun = FunctionReturnType<typeof api.monitorData.latestRun>;

function summaryText(summary: LatestRun | undefined, keeperCount: number): string {
  if (summary === undefined) return "Loading latest run…";
  if (summary === null) return "No scans yet — the daily monitor runs at 8 PM ET.";
  const { run, newLast24h } = summary;
  const t = run.finishedAt ?? run.startedAt;
  const when = new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const failed = run.status === "failed" ? " · last scan failed" : "";
  return `Last scan ${when} · ${newLast24h} new in last 24h · ${keeperCount} ${keeperCount === 1 ? "keeper" : "keepers"}${failed}`;
}

export function MonitorPage() {
  const latestRun = useQuery(api.monitorData.latestRun);
  const keepers = useQuery(api.monitorData.listKeepers, {});
  const recent = useQuery(api.monitorData.listRecent, {});
  const [showAll, setShowAll] = useState(false);

  const keeperCount = keepers?.length ?? 0;
  const rows = showAll ? recent : keepers;

  return (
    <div>
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Radar className="h-5 w-5 text-teal-glow" /> Monitor
        </h1>
        <p className="text-sm text-muted-foreground">{summaryText(latestRun, keeperCount)}</p>
      </div>

      <div className="space-y-5 p-6">
        {/* Keepers ↔ all-new toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-md border border-border">
            <button
              onClick={() => setShowAll(false)}
              className={cn(
                "rounded-l-md px-3 py-1.5 text-sm transition-colors",
                !showAll ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              Keepers ({keeperCount})
            </button>
            <button
              onClick={() => setShowAll(true)}
              className={cn(
                "rounded-r-md px-3 py-1.5 text-sm transition-colors",
                showAll ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              All new ({recent?.length ?? 0})
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {showAll
              ? "All recently discovered listings (newest first), keepers and non-keepers."
              : "Below-market or investor-grade deals, best deal score first."}
          </p>
        </div>

        {/* Cards */}
        {rows === undefined ? (
          <div className="px-3 py-10 text-center text-muted-foreground">Loading listings…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            <Radar className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {showAll
              ? "No listings discovered yet. The monitor scans NCC new listings daily at 8 PM ET."
              : "No keeper deals yet. The monitor surfaces below-market and investor-grade listings after its daily 8 PM ET scan."}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <MonitorCard key={r._id} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
