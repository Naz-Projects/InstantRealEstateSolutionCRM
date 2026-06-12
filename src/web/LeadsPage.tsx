import { Fragment, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
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
  LayoutList,
  Columns3,
  CalendarClock,
  Check,
  Plus,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { buildMailCsv } from "./lib/mailCsv";
import { LEAD_STAGES, STAGE_LABELS, isLeadStage, followUpState } from "../scraper/wholesalePipeline";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "./ConfirmDialog";
import { describeError } from "./lib/errorReporting";

type Lead = FunctionReturnType<typeof api.signalData.leads>[number];
type Buyer = FunctionReturnType<typeof api.pipelineData.listBuyers>[number];
type FollowUp = FunctionReturnType<typeof api.pipelineData.openFollowUps>[number];

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

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const EQUITY_CHIP: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  medium: "border-teal/40 bg-teal/10 text-teal-glow",
  low: "border-red-500/40 bg-red-500/10 text-red-400",
  unknown: "border-border text-muted-foreground",
};

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

/** Due-date urgency badge for a lead's next open follow-up. */
function FollowUpBadge({ next }: { next: FollowUp | undefined }) {
  if (!next) return null;
  const state = followUpState(next.dueAt, Date.now());
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        state === "overdue" && "border-red-500/40 bg-red-500/10 text-red-400",
        state === "today" && "border-amber-500/40 bg-amber-500/10 text-amber-400",
        state === "upcoming" && "border-border text-muted-foreground",
      )}
    >
      <CalendarClock className="h-3 w-3" />
      {state === "overdue" ? "Overdue" : state === "today" ? "Due today" : fmtDate(next.dueAt)}
    </span>
  );
}

/** Open follow-ups for one lead + the add form (pipeline P2). */
function LeadFollowUps({ lead, followUps }: { lead: Lead; followUps: FollowUp[] }) {
  const add = useMutation(api.pipelineData.addFollowUp);
  const setDone = useMutation(api.pipelineData.setFollowUpDone);
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");

  const submit = async () => {
    if (!note.trim() || !due) return;
    await add({ prclid: lead.prclid, note: note.trim(), dueAt: Date.parse(`${due}T12:00:00`) });
    setNote("");
    setDue("");
  };

  return (
    <div className="space-y-2 border-t border-border/50 px-4 py-3">
      {followUps.map((f) => (
        <div key={f._id} className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setDone({ id: f._id, done: true })}
            className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:border-teal/40 hover:text-teal-glow"
            aria-label="Mark follow-up done"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <FollowUpBadge next={f} />
          <span className="text-foreground">{f.note}</span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Follow-up — e.g. call owner, second mail piece…"
          className="h-8 w-full max-w-sm rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <button
          onClick={submit}
          disabled={!note.trim() || !due}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Follow-up
        </button>
      </div>
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

/** Equity panel in the expanded row: enrich button, balances detail, manual liens (P4). */
function LeadEquity({ lead }: { lead: Lead }) {
  const enrich = useAction(api.equityActions.enrichEquity);
  const setLiens = useMutation(api.equityData.setManualLiens);
  const [pulling, setPulling] = useState(false);
  const [pullErr, setPullErr] = useState<string | null>(null);
  const [liens, setLiens_] = useState(lead.manualLiens?.toString() ?? "");
  const [liensNote, setLiensNote] = useState(lead.manualLiensNote ?? "");

  const pull = async () => {
    setPulling(true);
    setPullErr(null);
    try {
      await enrich({ prclid: lead.prclid });
    } catch (e) {
      setPullErr(describeError(e).message);
    } finally {
      setPulling(false);
    }
  };

  const saveLiens = async () => {
    const n = Number(liens.replace(/[^0-9.]/g, ""));
    await setLiens({
      prclid: lead.prclid,
      amount: liens.trim() === "" ? null : n,
      note: liensNote.trim() === "" ? null : liensNote.trim(),
    });
  };

  return (
    <div className="space-y-2 border-t border-border/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          Value: <span className="text-foreground">{fmtMoney(lead.value)}</span>
          {lead.valueSource && (
            <span className="ml-1 text-xs">({lead.valueSource}, {fmtDate(lead.valueAt ?? 0)})</span>
          )}
        </span>
        <span className="text-muted-foreground">
          Balances:{" "}
          <span className="text-foreground">
            {lead.balancesAt
              ? `county ${fmtMoney(lead.countyBalance)} · school ${fmtMoney(lead.schoolBalance)} · sewer ${fmtMoney(lead.sewerBalance)}`
              : "—"}
          </span>
          {lead.balancesAt ? <span className="ml-1 text-xs">({fmtDate(lead.balancesAt)})</span> : null}
        </span>
        {lead.assessedValue != null && (
          <span className="text-muted-foreground">
            Assessed: <span className="text-foreground">{fmtMoney(lead.assessedValue)}</span>
          </span>
        )}
        <button
          onClick={pull}
          disabled={pulling}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-teal/40 px-2.5 text-sm text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", pulling && "animate-spin")} />
          {pulling ? "Pulling…" : "Pull value & balances"}
        </button>
      </div>
      {(pullErr ?? lead.equityError) && (
        <div className="text-xs text-amber-400">{pullErr ?? lead.equityError}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Known liens $</span>
        <input
          value={liens}
          onChange={(e) => setLiens_(e.target.value)}
          placeholder="e.g. 150000"
          className="h-8 w-28 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <input
          value={liensNote}
          onChange={(e) => setLiensNote(e.target.value)}
          placeholder="Note — e.g. mortgage per docket"
          className="h-8 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <button
          onClick={saveLiens}
          disabled={liens === (lead.manualLiens?.toString() ?? "") && liensNote === (lead.manualLiensNote ?? "")}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
      </div>
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

/** Kanban board: one column per stage, stage moves via the card's select (P1). */
function LeadBoard({
  leads,
  followUpsByParcel,
  onMove,
}: {
  leads: Lead[];
  followUpsByParcel: Map<string, FollowUp[]>;
  onMove: (prclid: string, stage: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {LEAD_STAGES.map((s) => {
        const col = leads.filter((l) => l.stage === s);
        return (
          <div key={s} className="w-64 shrink-0 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", STAGE_CHIP[s])}>
                {STAGE_LABELS[s]}
              </span>
              <span className="text-xs text-muted-foreground">{col.length}</span>
            </div>
            <div className="min-h-24 space-y-2 p-2">
              {col.map((l) => (
                <div key={l.prclid} className="rounded-lg border border-border/70 bg-background p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("text-base font-bold", scoreColor(l.score))}>{l.score}</span>
                    <FollowUpBadge next={followUpsByParcel.get(l.prclid)?.[0]} />
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium text-foreground" title={l.situsStreet}>
                    {l.situsStreet || "—"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {l.ownerName}
                    {l.absentee ? " · absentee" : ""}
                  </div>
                  <div className="mt-1.5">
                    <SignalChips lead={l} />
                  </div>
                  <div className="mt-2">
                    <Select value={l.stage} onValueChange={(v) => onMove(l.prclid, v)}>
                      <SelectTrigger className="h-7 w-full border-border text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_STAGES.map((st) => (
                          <SelectItem key={st} value={st}>
                            {STAGE_LABELS[st]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LeadsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [absenteeOnly, setAbsenteeOnly] = useState(false);
  const [minStack, setMinStack] = useState("1");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "board">("table");
  const [minEquity, setMinEquity] = useState("any");
  const [enrichOpen, setEnrichOpen] = useState(false);
  const enrichBatch = useAction(api.equityActions.enrichBatch);

  const setStatus = useMutation(api.pipelineData.setLeadStatus);
  const buyers = useQuery(api.pipelineData.listBuyers, {}) ?? [];
  const openFollowUps = useQuery(api.pipelineData.openFollowUps) ?? [];
  const followUpsByParcel = useMemo(() => {
    const m = new Map<string, FollowUp[]>();
    for (const f of openFollowUps) {
      const list = m.get(f.prclid);
      if (list) list.push(f);
      else m.set(f.prclid, [f]);
    }
    return m;
  }, [openFollowUps]);
  const leads = useQuery(api.signalData.leads, {
    type: typeFilter === "all" ? undefined : typeFilter,
    stage: stageFilter === "all" ? undefined : stageFilter,
    absenteeOnly: absenteeOnly || undefined,
    minStack: minStack === "1" ? undefined : Number(minStack),
    minEquityRatio: minEquity === "any" ? undefined : Number(minEquity),
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
          value: l.value ?? null,
          equity: l.equity,
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
          <Select value={minEquity} onValueChange={setMinEquity}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any equity</SelectItem>
              <SelectItem value="0">Has equity</SelectItem>
              <SelectItem value="0.2">≥20% equity</SelectItem>
              <SelectItem value="0.5">≥50% equity</SelectItem>
            </SelectContent>
          </Select>
          <div className="grow" />
          <div className="flex rounded-md border border-border">
            <button
              onClick={() => setView("table")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-l-md px-3 py-1.5 text-sm",
                view === "table" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              <LayoutList className="h-4 w-4" /> Table
            </button>
            <button
              onClick={() => setView("board")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-r-md px-3 py-1.5 text-sm",
                view === "board" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              <Columns3 className="h-4 w-4" /> Board
            </button>
          </div>
          <button
            onClick={() => setEnrichOpen(true)}
            disabled={!leads || leads.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
          >
            <Zap className="h-4 w-4" /> Enrich top {Math.min(leads?.length ?? 0, 50)}
          </button>
          <ConfirmDialog
            open={enrichOpen}
            onOpenChange={setEnrichOpen}
            title="Enrich top leads?"
            description={`Pull value + county balances for the top ${Math.min(leads?.length ?? 0, 50)} filtered leads. Uses ~2 Firecrawl credits per lead and runs staggered in the background (~${Math.ceil((Math.min(leads?.length ?? 0, 50) * 2.5) / 60)} min).`}
            confirmLabel="Enrich"
            onConfirm={() => enrichBatch({ prclids: (leads ?? []).slice(0, 50).map((l) => l.prclid) })}
          />
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
        ) : view === "board" ? (
          <LeadBoard
            leads={leads}
            followUpsByParcel={followUpsByParcel}
            onMove={(prclid, s) => {
              if (isLeadStage(s)) setStatus({ prclid, stage: s });
            }}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Equity</th>
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
                      <td className="px-4 py-2.5">
                        {l.equity != null ? (
                          <div>
                            <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-medium", EQUITY_CHIP[l.equityBucket])}>
                              {fmtMoney(l.equity)} · {Math.round((l.equityRatio ?? 0) * 100)}%
                            </span>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {l.equityBasis === "incl-manual-liens" ? "incl. liens" : "taxes-only"} · worth {fmtMoney(l.value)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {l.situsStreet || "—"}
                        <div className="mt-0.5">
                          <FollowUpBadge next={followUpsByParcel.get(l.prclid)?.[0]} />
                        </div>
                      </td>
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
                        <td colSpan={8}>
                          <SignalTimeline lead={l} />
                          <LeadEquity key={`eq-${l.prclid}`} lead={l} />
                          <LeadWorkflow key={l.prclid} lead={l} buyers={buyers} />
                          <LeadFollowUps lead={l} followUps={followUpsByParcel.get(l.prclid) ?? []} />
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
