import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Calculator, ChevronsUpDown, Home, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "./dealStages";
import { AddressAutocomplete } from "./AddressAutocomplete";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type Candidate = { id: string; address: string };

// Searchable "select a property" combobox (shadcn Popover + Command), grouped by
// source, type-to-filter autocomplete. Controlled: value = "sheriff:<id>" | "legal:<id>".
function PropertyCombobox({
  candidates,
  value,
  onChange,
}: {
  candidates: { sheriff: Candidate[]; legal: Candidate[] } | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => {
    if (!value || !candidates) return "";
    const [kind, id] = value.split(":");
    const list = kind === "sheriff" ? candidates.sheriff : candidates.legal;
    return list.find((c) => c.id === id)?.address ?? "";
  }, [value, candidates]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex w-80 items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1 text-left text-sm focus:border-primary focus:outline-none",
            !label && "text-muted-foreground",
          )}
        >
          <span className="truncate">{label || "Select a property…"}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search address…" />
          <CommandList>
            <CommandEmpty>No property found.</CommandEmpty>
            {candidates && candidates.sheriff.length > 0 && (
              <CommandGroup heading="Sheriff Sales">
                {candidates.sheriff.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`sheriff ${c.address}`}
                    onSelect={() => {
                      onChange(`sheriff:${c.id}`);
                      setOpen(false);
                    }}
                  >
                    {c.address}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {candidates && candidates.legal.length > 0 && (
              <CommandGroup heading="Legal Notices">
                {candidates.legal.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`legal ${c.address}`}
                    onSelect={() => {
                      onChange(`legal:${c.id}`);
                      setOpen(false);
                    }}
                  >
                    {c.address}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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
  const [manualAddr, setManualAddr] = useState(
    // Seamless handoff from /leads ("Analyze flip"): pre-fill the manual address.
    () => new URLSearchParams(window.location.search).get("address") ?? "",
  );

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
      <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
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
              <PropertyCombobox candidates={candidates} value={pick} onChange={setPick} />
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
              <AddressAutocomplete
                value={manualAddr}
                onChange={setManualAddr}
                placeholder="123 Main St, Wilmington, DE"
                className="w-72"
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
                    <Select
                      value={a.dealStatus}
                      onValueChange={(v) => setStatus({ id: a._id, dealStatus: v as DealStage })}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DEAL_STAGES.map((s) => (
                          <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
  const pullComps = useAction(api.compsActions.pullComps);
  const [pulling, setPulling] = useState(false);
  const [showComps, setShowComps] = useState(false);
  const doPull = async () => {
    setPulling(true);
    try {
      await pullComps({ id: analysis._id });
    } finally {
      setPulling(false);
    }
  };
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Rehab tier</label>
            <Select value={tier} onValueChange={(v) => onTier(v as RehabTier)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["cosmetic", "moderate", "gut"] as const).map((t) => (
                  <SelectItem key={t} value={t}>{REHAB_TIERS[t].label} ({REHAB_TIERS[t].range})</SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
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

        {/* Comps → suggested ARV */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">ARV from sold comps</span>
            <button
              onClick={doPull}
              disabled={pulling}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-teal disabled:opacity-50"
            >
              {pulling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Home className="h-3.5 w-3.5" />}
              {analysis.compsPulledAt ? "Refresh comps" : "Pull comps"}
            </button>
          </div>

          {analysis.suggestedArv != null && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-teal-glow">
                Comp value ~{fmtMoney(analysis.suggestedArv)}
                {analysis.suggestedPricePerSqft != null &&
                  ` · median $${Math.round(analysis.suggestedPricePerSqft)}/sqft`}
                {" · "}
                {analysis.comps?.length ?? 0} comps · adjust up for reno
              </span>
              <button
                onClick={() => setArv(String(analysis.suggestedArv))}
                className="rounded-md border border-teal px-2 py-0.5 text-teal-glow hover:bg-muted"
              >
                Use as ARV
              </button>
            </div>
          )}
          {analysis.compsError && (
            <p className="mt-2 text-xs text-amber-400">{analysis.compsError}</p>
          )}
          {analysis.comps && analysis.comps.length > 0 && (
            <>
              <button
                onClick={() => setShowComps((s) => !s)}
                className="mt-2 text-xs text-teal-glow hover:underline"
              >
                {showComps ? "Hide" : "Show"} {analysis.comps.length} comps
              </button>
              {showComps && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-2">Address</th>
                        <th className="py-1 pr-2">Sold</th>
                        <th className="py-1 pr-2 text-right">Price</th>
                        <th className="py-1 pr-2 text-right">Bd/Ba</th>
                        <th className="py-1 pr-2 text-right">Sqft</th>
                        <th className="py-1 text-right">$/sqft</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.comps.map((c, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="py-1 pr-2">{c.address}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{c.soldDate}</td>
                          <td className="py-1 pr-2 text-right">{fmtMoney(c.soldPrice)}</td>
                          <td className="py-1 pr-2 text-right">{c.beds ?? "—"}/{c.baths ?? "—"}</td>
                          <td className="py-1 pr-2 text-right">{c.sqft ?? "—"}</td>
                          <td className="py-1 text-right">{c.pricePerSqft ? "$" + Math.round(c.pricePerSqft) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
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
