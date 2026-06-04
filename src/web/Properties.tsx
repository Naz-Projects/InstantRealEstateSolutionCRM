import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Home, Plus } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { PropertyPicker, type PropertySelection } from "./PropertyPicker";
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
  const [dealType, setDealType] = useState<DealType>("flip");
  const [selection, setSelection] = useState<PropertySelection>(null);

  const all = properties ?? [];
  const counts = {
    all: all.length,
    flip: all.filter((p) => p.dealType === "flip").length,
    rental: all.filter((p) => p.dealType === "rental").length,
  };
  const shown = all.filter((p) => filter === "all" || p.dealType === filter);

  const goTo = (id: Id<"properties">) => navigate({ to: "/properties/$id", params: { id } });

  const addProperty = async () => {
    if (!selection) return;
    let id: unknown;
    if (selection.kind === "manual") {
      id = await createManual({ dealType, address: selection.address });
    } else if (selection.kind === "sheriff") {
      id = await createFromSheriff({ listingId: selection.refId as Id<"sheriffListings">, dealType });
    } else if (selection.kind === "legal") {
      id = await createFromLegal({ listingId: selection.refId as Id<"legalNotices">, dealType });
    } else {
      id = await createFromFlip({ analysisId: selection.refId as Id<"flipAnalyses">, dealType });
    }
    setSelection(null);
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
      </div>

      <div className="space-y-6 p-6">
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
          <div className="flex min-w-72 flex-1 flex-col gap-1">
            <label className="text-xs text-muted-foreground">Property</label>
            <PropertyPicker
              candidates={candidates}
              value={selection}
              onChange={setSelection}
              className="w-full"
            />
          </div>
          <button
            onClick={addProperty}
            disabled={!selection}
            className="btn-metal-yellow flex items-center gap-1 rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add Property
          </button>
        </div>

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
