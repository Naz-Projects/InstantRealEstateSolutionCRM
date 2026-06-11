import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Target,
  Download,
  ChevronDown,
  ChevronRight,
  Gavel,
  TriangleAlert,
  CircleHelp,
  Calculator,
  Save,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { buildMailCsv } from "./lib/mailCsv";
import { LEAD_STAGES, STAGE_LABELS, isLeadStage } from "../scraper/wholesalePipeline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Lead = FunctionReturnType<typeof api.signalData.leads>[number];
type Buyer = FunctionReturnType<typeof api.pipelineData.listBuyers>[number];

const STAGE_CHIP: Record<string, string> = {
  new: "border-border text-muted-foreground",
  contacted: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  negotiating: "border-teal/40 bg-teal/10 text-teal-glow",
  under_contract: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  marketing: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  assigned: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  closed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  dead: "border-border bg-muted/40 text-muted-foreground line-through",
};

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

/** Workflow strip in the expanded row: stage, notes, buyer assignment, flip handoff. */
function LeadWorkflow({ lead, buyers }: { lead: Lead; buyers: Buyer[] }) {
  const setStatus = useMutation(api.pipelineData.setLeadStatus);
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [fee, setFee] = useState(lead.assignmentFee?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const fullAddress = `${lead.situsStreet}, ${lead.propCity} DE ${lead.propZip}`;
  const showDisposition = ["marketing", "assigned", "closed"].includes(lead.stage);

  const saveNotes = async () => {
    setSaving(true);
    try {
      await setStatus({ prclid: lead.prclid, notes });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border/50 px-4 py-3">
      <div className="flex grow items-center gap-2">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes — calls, mail sent, owner situation…"
          className="h-9 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <button
          onClick={saveNotes}
          disabled={saving || notes === (lead.notes ?? "")}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
      </div>
      {showDisposition && (
        <div className="flex items-center gap-2">
          <Select
            value={lead.buyerId ?? "none"}
            onValueChange={(val) =>
              setStatus({
                prclid: lead.prclid,
                buyerId: val === "none" ? null : (val as Id<"buyers">),
              })
            }
          >
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Assign buyer…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No buyer</SelectItem>
              {buyers.map((b) => (
                <SelectItem key={b._id} value={b._id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            onBlur={() => {
              const n = Number(fee.replace(/[^0-9.]/g, ""));
              setStatus({ prclid: lead.prclid, assignmentFee: fee.trim() === "" ? null : n });
            }}
            placeholder="Fee $"
            className="h-9 w-24 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
          />
        </div>
      )}
      <a
        href={`/flip?address=${encodeURIComponent(fullAddress)}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-teal/40 px-3 text-sm text-teal-glow transition-colors hover:bg-teal/10"
      >
        <Calculator className="h-3.5 w-3.5" /> Analyze flip
      </a>
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
  const [stageFilter, setStageFilter] = useState("all");
  const [absenteeOnly, setAbsenteeOnly] = useState(false);
  const [minStack, setMinStack] = useState("1");
  const [expanded, setExpanded] = useState<string | null>(null);

  const setStatus = useMutation(api.pipelineData.setLeadStatus);
  const buyers = useQuery(api.pipelineData.listBuyers, {}) ?? [];
  const leads = useQuery(api.signalData.leads, {
    type: typeFilter === "all" ? undefined : typeFilter,
    stage: stageFilter === "all" ? undefined : stageFilter,
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
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {LEAD_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
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
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 font-medium">Latest</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <Fragment key={l.prclid}>
                    <tr
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
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={l.stage}
                          onValueChange={(s) => {
                            if (isLeadStage(s)) setStatus({ prclid: l.prclid, stage: s });
                          }}
                        >
                          <SelectTrigger
                            className={cn("h-7 w-40 border text-xs", STAGE_CHIP[l.stage])}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEAD_STAGES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {STAGE_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {fmtDate(l.signals[0]?.observedDate ?? 0)}
                      </td>
                    </tr>
                    {expanded === l.prclid && (
                      <tr className="border-b border-border/50 bg-muted/30">
                        <td colSpan={7}>
                          <SignalTimeline lead={l} />
                          <LeadWorkflow key={l.prclid} lead={l} buyers={buyers} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
