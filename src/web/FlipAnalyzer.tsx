import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Calculator, Plus, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "./dealStages";
import {
  estimateRehab,
  computeFlip,
  REHAB_TIERS,
  type RehabTier,
  type FlipAssumptions,
} from "../scraper/flip";

function fmtMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("en-US");
}
function fmtPct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : (n * 100).toFixed(1) + "%";
}
function num(s: string): number | null {
  if (s.trim() === "") return null;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const GRADE_COLOR: Record<string, string> = {
  good: "text-emerald-400",
  ok: "text-teal-glow",
  thin: "text-amber-400",
  bad: "text-red-400",
  unknown: "text-muted-foreground",
};
const GRADE_LABEL: Record<string, string> = {
  good: "Good", ok: "OK", thin: "Thin", bad: "Bad", unknown: "—",
};

const inputCls =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none";

const ASSUMPTION_FIELDS: { key: keyof FlipAssumptions; label: string; kind: "pct" | "int" | "money" }[] = [
  { key: "closingPct", label: "Purchase closing %", kind: "pct" },
  { key: "downPct", label: "Down payment %", kind: "pct" },
  { key: "loanPoints", label: "Loan points %", kind: "pct" },
  { key: "annualRate", label: "Hard-money rate %", kind: "pct" },
  { key: "holdingMonths", label: "Holding months", kind: "int" },
  { key: "monthlyHolding", label: "Monthly holding $", kind: "money" },
  { key: "sellAgentPct", label: "Agent commission %", kind: "pct" },
  { key: "sellTransferPct", label: "Transfer tax %", kind: "pct" },
  { key: "sellClosingPct", label: "Sale closing %", kind: "pct" },
];

type Analysis = NonNullable<ReturnType<typeof useFlipList>>[number];
function useFlipList() {
  return useQuery(api.flipData.listAnalyses);
}

export function FlipAnalyzer() {
  const analyses = useFlipList();
  const candidates = useQuery(api.flipData.candidates);
  const createFromSheriff = useMutation(api.flipData.createFromSheriff);
  const createFromLegal = useMutation(api.flipData.createFromLegal);
  const createManual = useMutation(api.flipData.createManual);
  const setStatus = useMutation(api.flipData.setFlipDealStatus);
  const del = useMutation(api.flipData.deleteAnalysis);

  const [selectedId, setSelectedId] = useState<Id<"flipAnalyses"> | null>(null);
  const [pick, setPick] = useState("");        // "sheriff:<id>" | "legal:<id>"
  const [manualAddr, setManualAddr] = useState("");

  const selected = analyses?.find((a) => a._id === selectedId) ?? null;

  const addFromListing = async () => {
    if (!pick) return;
    const [kind, id] = pick.split(":");
    const newId =
      kind === "sheriff"
        ? await createFromSheriff({ listingId: id as Id<"sheriffListings"> })
        : await createFromLegal({ listingId: id as Id<"legalNotices"> });
    setPick("");
    setSelectedId(newId as Id<"flipAnalyses">);
  };
  const addManual = async () => {
    if (!manualAddr.trim()) return;
    const newId = await createManual({ address: manualAddr.trim() });
    setManualAddr("");
    setSelectedId(newId as Id<"flipAnalyses">);
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Calculator className="h-5 w-5 text-teal-glow" /> Flip Analyzer
          </h1>
          <p className="text-sm text-muted-foreground">
            ARV − rehab − costs → max offer, profit, ROI. Pulls from Sheriff/Legal or a manual address.
          </p>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {/* New analysis */}
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From a scraped listing</label>
            <div className="flex gap-2">
              <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Select a property…</option>
                {candidates && (
                  <>
                    <optgroup label="Sheriff Sales">
                      {candidates.sheriff.map((c) => (
                        <option key={c.id} value={`sheriff:${c.id}`}>{c.address}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Legal Notices">
                      {candidates.legal.map((c) => (
                        <option key={c.id} value={`legal:${c.id}`}>{c.address}</option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>
              <button
                onClick={addFromListing}
                className="btn-metal-yellow flex items-center gap-1 rounded-md px-3 py-1 text-sm font-semibold"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Or a manual address</label>
            <div className="flex gap-2">
              <input
                className={inputCls}
                placeholder="123 Main St, Wilmington, DE"
                value={manualAddr}
                onChange={(e) => setManualAddr(e.target.value)}
              />
              <button
                onClick={addManual}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:border-teal"
              >
                <Plus className="h-4 w-4" /> Add manual
              </button>
            </div>
          </div>
        </div>

        {/* Saved analyses */}
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">ARV</th>
                <th className="px-3 py-2 text-right">Rehab</th>
                <th className="px-3 py-2 text-right">MAO</th>
                <th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2 text-right">ROI</th>
                <th className="px-3 py-2">Grade</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {analyses?.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                    No analyses yet. Add one above.
                  </td>
                </tr>
              )}
              {analyses?.map((a) => (
                <tr
                  key={a._id}
                  onClick={() => setSelectedId(a._id)}
                  className={
                    "cursor-pointer border-b border-border/50 hover:bg-muted " +
                    (a._id === selectedId ? "bg-muted" : "")
                  }
                >
                  <td className="px-3 py-2">{a.address}</td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{a.source.kind}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(a.arv)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(a.rehab.total)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(a.metrics.mao)}</td>
                  <td className={"px-3 py-2 text-right font-semibold " + GRADE_COLOR[a.metrics.grade]}>
                    {fmtMoney(a.metrics.profit)}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtPct(a.metrics.roi)}</td>
                  <td className={"px-3 py-2 font-semibold " + GRADE_COLOR[a.metrics.grade]}>
                    {GRADE_LABEL[a.metrics.grade]}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={a.dealStatus}
                      onChange={(e) => setStatus({ id: a._id, dealStatus: e.target.value as DealStage })}
                      className="rounded-md border border-border bg-card px-2 py-1 text-xs focus:border-primary focus:outline-none"
                    >
                      {DEAL_STAGES.map((s) => (
                        <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        if (a._id === selectedId) setSelectedId(null);
                        void del({ id: a._id });
                      }}
                      className="text-muted-foreground hover:text-red-400"
                      aria-label="Delete analysis"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Editor */}
        {selected && <AnalysisEditor key={selected._id} analysis={selected} />}
      </div>
    </div>
  );
}

function AnalysisEditor({ analysis }: { analysis: Analysis }) {
  const update = useMutation(api.flipData.updateAnalysis);
  const [sqft, setSqft] = useState(analysis.sqft?.toString() ?? "");
  const [arv, setArv] = useState(analysis.arv?.toString() ?? "");
  const [purchase, setPurchase] = useState(analysis.purchasePrice?.toString() ?? "");
  const [tier, setTier] = useState<RehabTier>(analysis.rehabTier);
  const [perSqft, setPerSqft] = useState(analysis.rehabPerSqft.toString());
  const [override, setOverride] = useState(analysis.rehabOverride?.toString() ?? "");
  const [cont, setCont] = useState((analysis.contingencyPct * 100).toString());
  const [assumptions, setAssumptions] = useState<FlipAssumptions>(analysis.assumptions);
  const [notes, setNotes] = useState(analysis.notes ?? "");
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [saved, setSaved] = useState(false);

  const onTier = (t: RehabTier) => {
    setTier(t);
    if (t !== "custom") setPerSqft(REHAB_TIERS[t].perSqft.toString());
  };
  const setAssumption = (key: keyof FlipAssumptions, kind: string, raw: string) => {
    const parsed = num(raw) ?? 0;
    setAssumptions((a) => ({ ...a, [key]: kind === "pct" ? parsed / 100 : parsed }));
  };

  const contFrac = (num(cont) ?? 0) / 100;
  const rehab = estimateRehab(num(perSqft) ?? 0, num(sqft), contFrac, num(override));
  const metrics = computeFlip({
    arv: num(arv),
    purchasePrice: num(purchase),
    rehabTotal: rehab.total,
    assumptions,
  });

  const save = async () => {
    await update({
      id: analysis._id,
      patch: {
        sqft: num(sqft),
        arv: num(arv),
        purchasePrice: num(purchase),
        rehabTier: tier,
        rehabPerSqft: num(perSqft) ?? 0,
        rehabOverride: num(override),
        contingencyPct: contFrac,
        assumptions,
        notes,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const Result = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={"text-lg font-semibold " + (cls ?? "text-foreground")}>{value}</span>
    </div>
  );

  return (
    <div className="grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-2">
      {/* Inputs */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">{analysis.address}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-muted-foreground">
            ARV ($)
            <input className={inputCls} value={arv} onChange={(e) => setArv(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Purchase price ($)
            <input className={inputCls} value={purchase} onChange={(e) => setPurchase(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Sqft
            <input className={inputCls} placeholder="for tiered rehab" value={sqft} onChange={(e) => setSqft(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Rehab tier
            <select className={inputCls} value={tier} onChange={(e) => onTier(e.target.value as RehabTier)}>
              {(["cosmetic", "moderate", "gut"] as const).map((t) => (
                <option key={t} value={t}>{REHAB_TIERS[t].label} ({REHAB_TIERS[t].range})</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            $/sqft
            <input className={inputCls} value={perSqft} onChange={(e) => { setPerSqft(e.target.value); setTier("custom"); }} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Rehab override ($)
            <input className={inputCls} placeholder="optional" value={override} onChange={(e) => setOverride(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Contingency %
            <input className={inputCls} value={cont} onChange={(e) => setCont(e.target.value)} />
          </label>
        </div>

        <button
          onClick={() => setShowAssumptions((s) => !s)}
          className="text-xs text-teal-glow hover:underline"
        >
          {showAssumptions ? "Hide" : "Show"} cost assumptions
        </button>
        {showAssumptions && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 p-3">
            {ASSUMPTION_FIELDS.map((f) => (
              <label key={f.key} className="block text-xs text-muted-foreground">
                {f.label}
                <input
                  className={inputCls}
                  defaultValue={f.kind === "pct" ? (assumptions[f.key] * 100).toString() : assumptions[f.key].toString()}
                  onChange={(e) => setAssumption(f.key, f.kind, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}

        <label className="block text-xs text-muted-foreground">
          Notes
          <textarea className={inputCls + " h-16"} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <button onClick={save} className="btn-metal-yellow rounded-md px-4 py-1.5 text-sm font-semibold">
          {saved ? "Saved" : "Save analysis"}
        </button>
      </div>

      {/* Live results */}
      <div className="space-y-4 rounded-lg border border-teal/40 bg-background p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase text-muted-foreground">Live results</span>
          <span className={"rounded-md px-2 py-0.5 text-xs font-semibold " + GRADE_COLOR[metrics.grade]}>
            {GRADE_LABEL[metrics.grade]}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Result label="Max offer (70% rule)" value={fmtMoney(metrics.mao)} />
          <Result label="Rehab (incl. contingency)" value={fmtMoney(rehab.total)} />
          <Result label="Net profit" value={fmtMoney(metrics.profit)} cls={GRADE_COLOR[metrics.grade]} />
          <Result label="Profit margin" value={fmtPct(metrics.margin)} />
          <Result label="ROI (cash invested)" value={fmtPct(metrics.roi)} />
          <Result label="Annualized ROI" value={fmtPct(metrics.annualizedRoi)} />
          <Result label="Holding + financing" value={fmtMoney((metrics.holdingCost ?? 0) + (metrics.financingCost ?? 0))} />
          <Result label="Selling costs" value={fmtMoney(metrics.sellingCost)} />
        </div>
        {metrics.flags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {metrics.flags.map((f) => (
              <span key={f} className="rounded-md border border-amber-400/40 px-2 py-0.5 text-xs text-amber-400">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
