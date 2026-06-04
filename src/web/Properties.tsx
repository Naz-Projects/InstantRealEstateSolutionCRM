import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Home, Plus, ChevronsUpDown } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
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
import { AddressAutocomplete } from "./AddressAutocomplete";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function fmtMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("en-US");
}

export const GRADE_COLOR: Record<string, string> = {
  good: "text-emerald-400",
  ok: "text-teal-glow",
  thin: "text-amber-400",
  bad: "text-red-400",
  pending: "text-muted-foreground",
};
export const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  sold: "Sold",
  active: "Active",
  vacant: "Vacant",
};

type DealType = "flip" | "rental";
type Candidate = { id: string; address: string };

function CandidateCombobox({
  candidates,
  value,
  onChange,
}: {
  candidates: { sheriff: Candidate[]; legal: Candidate[]; flip: Candidate[] } | undefined;
  value: string; // "sheriff:<id>" | "legal:<id>" | "flip:<id>"
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = (() => {
    if (!value || !candidates) return "";
    const [kind, id] = value.split(":");
    const list =
      kind === "sheriff" ? candidates.sheriff : kind === "legal" ? candidates.legal : candidates.flip;
    return list.find((c) => c.id === id)?.address ?? "";
  })();

  const group = (heading: string, kind: string, list: Candidate[] | undefined) =>
    list && list.length > 0 ? (
      <CommandGroup heading={heading}>
        {list.map((c) => (
          <CommandItem
            key={c.id}
            value={`${kind} ${c.address}`}
            onSelect={() => {
              onChange(`${kind}:${c.id}`);
              setOpen(false);
            }}
          >
            {c.address}
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null;

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
          <span className="truncate">{label || "Select a record…"}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search address…" />
          <CommandList>
            <CommandEmpty>No record found.</CommandEmpty>
            {group("Sheriff Sales", "sheriff", candidates?.sheriff)}
            {group("Legal Notices", "legal", candidates?.legal)}
            {group("Flip Analyses", "flip", candidates?.flip)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type PropertyRow = FunctionReturnType<typeof api.propertyData.listProperties>[number];

function PropertyCard({ p, onClick }: { p: PropertyRow; onClick: () => void }) {
  const headline =
    p.dealType === "flip"
      ? p.status === "sold"
        ? { label: "Profit", value: fmtMoney(p.summary.realizedProfit), cls: GRADE_COLOR[p.summary.grade] }
        : { label: "Invested", value: fmtMoney(p.summary.invested), cls: "" }
      : { label: "Net cash flow", value: fmtMoney(p.summary.netCashFlow), cls: GRADE_COLOR[p.summary.grade] };

  return (
    <button
      onClick={onClick}
      className="overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-teal"
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt={p.address} className="h-full w-full object-cover" />
        ) : (
          <Home className="h-10 w-10 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-teal/40 px-2 py-0.5 text-xs capitalize text-teal-glow">
            {p.dealType}
          </span>
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {STATUS_LABEL[p.status]}
          </span>
        </div>
        <div className="font-semibold text-foreground">{p.address}</div>
        <div className="text-sm text-muted-foreground">
          {p.beds || "?"} bd · {p.baths || "?"} ba · {p.sqft ? p.sqft.toLocaleString() + " sqft" : "— sqft"}
        </div>
        <div className="flex justify-between border-t border-border/50 pt-2 text-sm">
          <span className="text-muted-foreground">{headline.label}</span>
          <span className={"font-semibold " + headline.cls}>{headline.value}</span>
        </div>
      </div>
    </button>
  );
}

export function Properties() {
  const properties = useQuery(api.propertyData.listProperties);
  const candidates = useQuery(api.propertyData.candidates);
  const createManual = useMutation(api.propertyData.createManual);
  const createFromSheriff = useMutation(api.propertyData.createFromSheriff);
  const createFromLegal = useMutation(api.propertyData.createFromLegal);
  const createFromFlip = useMutation(api.propertyData.createFromFlip);
  const navigate = useNavigate();

  const [filter, setFilter] = useState<"all" | "flip" | "rental">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [dealType, setDealType] = useState<DealType>("flip");
  const [manualAddr, setManualAddr] = useState("");
  const [pick, setPick] = useState("");

  const all = properties ?? [];
  const counts = {
    all: all.length,
    flip: all.filter((p) => p.dealType === "flip").length,
    rental: all.filter((p) => p.dealType === "rental").length,
  };
  const shown = all.filter((p) => filter === "all" || p.dealType === filter);

  const goTo = (id: Id<"properties">) => navigate({ to: "/properties/$id", params: { id } });

  const addManual = async () => {
    if (!manualAddr.trim()) return;
    const id = await createManual({ dealType, address: manualAddr.trim() });
    setManualAddr("");
    setShowAdd(false);
    goTo(id as Id<"properties">);
  };
  const addFromExisting = async () => {
    if (!pick) return;
    const [kind, rid] = pick.split(":");
    let id: unknown;
    if (kind === "sheriff") id = await createFromSheriff({ listingId: rid as Id<"sheriffListings">, dealType });
    else if (kind === "legal") id = await createFromLegal({ listingId: rid as Id<"legalNotices">, dealType });
    else id = await createFromFlip({ analysisId: rid as Id<"flipAnalyses">, dealType });
    setPick("");
    setShowAdd(false);
    goTo(id as Id<"properties">);
  };

  const TABS: { key: "all" | "flip" | "rental"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "flip", label: "Flips" },
    { key: "rental", label: "Rentals" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Building2 className="h-5 w-5 text-teal-glow" /> Properties
          </h1>
          <p className="text-sm text-muted-foreground">
            Houses we own — flips and rentals. Track expenses, income, and sale outcomes.
          </p>
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="btn-metal-yellow flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" /> Add property
        </button>
      </div>

      <div className="space-y-6 p-6">
        {showAdd && (
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Type</label>
              <Select value={dealType} onValueChange={(v) => setDealType(v as DealType)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flip">Flip</SelectItem>
                  <SelectItem value="rental">Rental</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">From an existing record</label>
              <div className="flex gap-2">
                <CandidateCombobox candidates={candidates} value={pick} onChange={setPick} />
                <button
                  onClick={addFromExisting}
                  className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:border-teal"
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
        )}

        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "rounded-md border px-3 py-1 text-sm",
                filter === t.key
                  ? "border-teal text-teal-glow"
                  : "border-border text-muted-foreground hover:border-teal/50",
              )}
            >
              {t.label} <span className="opacity-60">{counts[t.key]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            No properties yet. Click "Add property" to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <PropertyCard key={p._id} p={p} onClick={() => goTo(p._id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
