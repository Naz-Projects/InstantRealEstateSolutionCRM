import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { MapPin, Search, Home, Layers } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type SearchRow = FunctionReturnType<typeof api.parcelData.searchParcels>[number];

function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

function AbsenteeBadge({ absentee, reason }: { absentee: boolean; reason: string }) {
  if (absentee) {
    const outOfState = reason === "out-of-state";
    return (
      <span
        className={cn(
          "rounded-md border px-2 py-0.5 text-xs font-medium",
          outOfState
            ? "border-red-500/40 bg-red-500/10 text-red-400"
            : "border-amber-500/40 bg-amber-500/10 text-amber-400",
        )}
      >
        Absentee · {outOfState ? "out of state" : "in state"}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
      {reason === "owner-occupant" ? "Owner-occupant" : "Unknown"}
    </span>
  );
}

function ResultRow({
  r,
  selected,
  onSelect,
}: {
  r: SearchRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      onClick={onSelect}
      className={cn(
        "cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/50",
        selected && "bg-muted/60",
      )}
    >
      <td className="px-4 py-2.5 font-medium text-foreground">{r.situsStreet || "—"}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{r.propCity}</td>
      <td className="px-4 py-2.5 text-foreground">{r.ownerName || "—"}</td>
      <td className="px-4 py-2.5">
        <AbsenteeBadge absentee={r.absentee} reason={r.absenteeReason} />
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.propClass}</td>
      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.prclid}</td>
    </tr>
  );
}

/** Absentee-portfolio panel: the selected owner's OTHER parcels (a multi-property owner = a strong lead). */
function OwnerPortfolio({ ownerName }: { ownerName: string }) {
  const rows = useQuery(api.parcelData.ownerParcels, { ownerName });
  if (rows === undefined) {
    return <div className="px-4 py-6 text-sm text-muted-foreground">Loading owner's parcels…</div>;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <Layers className="h-4 w-4 text-teal-glow" />
        <span className="font-semibold text-foreground">{ownerName}</span>
        <span className="text-muted-foreground">
          owns {rows.length} parcel{rows.length === 1 ? "" : "s"} in New Castle County
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((p) => (
              <tr key={p._id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2 text-foreground">{p.situsStreet}</td>
                <td className="px-4 py-2 text-muted-foreground">{p.propCity}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{p.propClass}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.prclid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ParcelSearch() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<SearchRow | null>(null);

  // Debounce the search term so we don't query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const stats = useQuery(api.parcelData.parcelStats);
  const results = useQuery(api.parcelData.searchParcels, q ? { q } : "skip");

  const absenteePct =
    stats && stats.total ? Math.round((stats.absentee / stats.total) * 100) : null;

  return (
    <div>
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <MapPin className="h-5 w-5 text-teal-glow" /> Parcel Search
        </h1>
        <p className="text-sm text-muted-foreground">
          Every New Castle County parcel — search by owner, address, or parcel number. Absentee owners are flagged.
        </p>
      </div>

      <div className="space-y-5 p-6">
        {/* Spine summary */}
        <div className="flex flex-wrap gap-4">
          <div className="rounded-xl border border-border bg-card px-5 py-3">
            <div className="text-xs text-muted-foreground">Parcels</div>
            <div className="text-2xl font-bold text-foreground">{fmtInt(stats?.total)}</div>
          </div>
          <div className="rounded-xl border border-border bg-card px-5 py-3">
            <div className="text-xs text-muted-foreground">Absentee owners</div>
            <div className="text-2xl font-bold text-amber-400">
              {fmtInt(stats?.absentee)}
              {absenteePct !== null && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">{absenteePct}%</span>
              )}
            </div>
          </div>
        </div>

        {/* Search box */}
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search by owner name, address, or parcel #…"
            className="pl-9"
          />
        </div>

        {/* Results */}
        {!q ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            <Home className="mx-auto mb-2 h-8 w-8 opacity-40" />
            Start typing to search {fmtInt(stats?.total)} parcels.
          </div>
        ) : results === undefined ? (
          <div className="px-3 py-10 text-center text-muted-foreground">Searching…</div>
        ) : results.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            No parcels match "{q}".
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Address</th>
                  <th className="px-4 py-2.5 font-medium">City</th>
                  <th className="px-4 py-2.5 font-medium">Owner</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Class</th>
                  <th className="px-4 py-2.5 font-medium">Parcel #</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <ResultRow
                    key={r._id}
                    r={r}
                    selected={selected?._id === r._id}
                    onSelect={() => setSelected(r)}
                  />
                ))}
              </tbody>
            </table>
            {results.length === 25 && (
              <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                Showing the top 25 matches — refine your search to narrow.
              </div>
            )}
          </div>
        )}

        {/* Owner portfolio (absentee-portfolio view) */}
        {selected && (
          <div className="rounded-xl border border-teal/30 bg-card p-4">
            <OwnerPortfolio ownerName={selected.ownerName} />
          </div>
        )}
      </div>
    </div>
  );
}
