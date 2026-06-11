import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  Target,
  Download,
  ChevronDown,
  ChevronRight,
  Gavel,
  TriangleAlert,
  CircleHelp,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { buildMailCsv } from "./lib/mailCsv";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Lead = FunctionReturnType<typeof api.signalData.leads>[number];

const SIGNAL_META: Record<string, { label: string; chip: string; icon: typeof Gavel }> = {
  "pre-foreclosure": {
    label: "Pre-foreclosure",
    chip: "border-red-500/40 bg-red-500/10 text-red-400",
    icon: Gavel,
  },
  "code-violation": {
    label: "Code violation",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: TriangleAlert,
  },
};

const signalMeta = (type: string) =>
  SIGNAL_META[type] ?? { label: type, chip: "border-border bg-muted/40 text-muted-foreground", icon: CircleHelp };

function fmtDate(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-red-400";
  if (score >= 40) return "text-amber-400";
  return "text-foreground";
}

function SignalChips({ lead }: { lead: Lead }) {
  const types = [...new Set(lead.signals.map((s) => s.type))];
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((t) => {
        const meta = signalMeta(t);
        const Icon = meta.icon;
        return (
          <span
            key={t}
            className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", meta.chip)}
          >
            <Icon className="h-3 w-3" />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function SignalTimeline({ lead }: { lead: Lead }) {
  return (
    <div className="space-y-2 px-4 py-3">
      {lead.signals.map((s, i) => {
        const meta = signalMeta(s.type);
        const p = s.payload ?? {};
        return (
          <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{fmtDate(s.observedDate)}</span>
            <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-medium", meta.chip)}>{meta.label}</span>
            <span className="text-foreground">
              {s.type === "code-violation" && (p.apdesc || p.aptype)}
              {s.type === "pre-foreclosure" && (
                <>
                  <span className="font-mono text-xs">{p.caseId}</span>
                  <span className="ml-2 text-muted-foreground">{p.caption}</span>
                </>
              )}
            </span>
            {s.status && <span className="text-xs text-muted-foreground">status: {s.status}</span>}
            {s.matchConfidence && (
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[10px] uppercase",
                  s.matchConfidence === "exact"
                    ? "border-teal/40 text-teal-glow"
                    : s.matchConfidence === "strong"
                      ? "border-border text-muted-foreground"
                      : "border-amber-500/40 text-amber-400",
                )}
              >
                {s.matchConfidence} match
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function UnmatchedFilings() {
  const [open, setOpen] = useState(false);
  const rows = useQuery(api.signalData.unmatchedSignals);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Unmatched filings ({rows.length}) — defendant didn't match a parcel owner
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3 text-sm">
          {rows.map((r, i) => {
            const p = (r.payload ?? {}) as Record<string, any>;
            return (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 border-b border-border/50 py-2 last:border-0">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{fmtDate(r.observedDate)}</span>
                <span className="font-mono text-xs text-foreground">{p.caseId}</span>
                <span className="text-muted-foreground">{p.caption}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LeadsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [absenteeOnly, setAbsenteeOnly] = useState(false);
  const [minStack, setMinStack] = useState("1");
  const [expanded, setExpanded] = useState<string | null>(null);

  const leads = useQuery(api.signalData.leads, {
    type: typeFilter === "all" ? undefined : typeFilter,
    absenteeOnly: absenteeOnly || undefined,
    minStack: minStack === "1" ? undefined : Number(minStack),
  });

  const exportCsv = useMemo(
    () => () => {
      if (!leads || leads.length === 0) return;
      const csv = buildMailCsv(
        leads.map((l) => ({
          ownerName: l.ownerName,
          ownerAddr: l.ownerAddr,
          ownerAddr2: l.ownerAddr2,
          ownerCity: l.ownerCity,
          ownerState: l.ownerState,
          ownerZip: l.ownerZip,
          situsStreet: l.situsStreet,
          propCity: l.propCity,
          propZip: l.propZip,
          score: l.score,
          signalTypes: [...new Set(l.signals.map((s) => s.type))],
        })),
      );
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `ires-mail-list-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [leads],
  );

  return (
    <div>
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Target className="h-5 w-5 text-teal-glow" /> Leads
        </h1>
        <p className="text-sm text-muted-foreground">
          Parcels carrying distress signals, scored by stacked signals × recency × absentee. Pre-foreclosure
          filings land months before the sheriff sale.
        </p>
      </div>

      <div className="space-y-5 p-6">
        {/* Filters + export */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All signals</SelectItem>
              <SelectItem value="pre-foreclosure">Pre-foreclosure</SelectItem>
              <SelectItem value="code-violation">Code violation</SelectItem>
            </SelectContent>
          </Select>
          <Select value={minStack} onValueChange={setMinStack}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Any stack</SelectItem>
              <SelectItem value="2">2+ signal types</SelectItem>
              <SelectItem value="3">3+ signal types</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => setAbsenteeOnly((a) => !a)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              absenteeOnly
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            Absentee only
          </button>
          <div className="grow" />
          <button
            onClick={exportCsv}
            disabled={!leads || leads.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-teal/40 px-3 py-1.5 text-sm text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> Export mail list ({leads?.length ?? 0})
          </button>
        </div>

        {/* Lead table */}
        {leads === undefined ? (
          <div className="px-3 py-10 text-center text-muted-foreground">Loading leads…</div>
        ) : leads.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            <Target className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No leads match these filters yet. Signals sync weekly — or run a sync from the backend.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Address</th>
                  <th className="px-4 py-2.5 font-medium">City</th>
                  <th className="px-4 py-2.5 font-medium">Owner</th>
                  <th className="px-4 py-2.5 font-medium">Signals</th>
                  <th className="px-4 py-2.5 font-medium">Latest</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <>
                    <tr
                      key={l.prclid}
                      onClick={() => setExpanded(expanded === l.prclid ? null : l.prclid)}
                      className={cn(
                        "cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/50",
                        expanded === l.prclid && "bg-muted/60",
                      )}
                    >
                      <td className={cn("px-4 py-2.5 text-lg font-bold", scoreColor(l.score))}>{l.score}</td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{l.situsStreet || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{l.propCity}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-foreground">{l.ownerName || "—"}</div>
                        {l.absentee && (
                          <div className="text-xs text-amber-400">
                            Absentee · {l.absenteeReason === "out-of-state" ? "out of state" : "in state"}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <SignalChips lead={l} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {fmtDate(l.signals[0]?.observedDate ?? 0)}
                      </td>
                    </tr>
                    {expanded === l.prclid && (
                      <tr key={`${l.prclid}-detail`} className="border-b border-border/50 bg-muted/30">
                        <td colSpan={6}>
                          <SignalTimeline lead={l} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <UnmatchedFilings />
      </div>
    </div>
  );
}
