import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock,
  Map as MapIcon,
  MapPin,
  RefreshCcw,
  RefreshCw,
  Star,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "./dealStages";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropertyMap, type MapPoint } from "./PropertyMap";
import { ScrapeProgress } from "./ScrapeProgress";
const ERROR_VALUES = new Set([
  "PENDING", "NOT FOUND", "SCRAPE FAILED", "NO ADDRESS", "WRONG STATE", "NO PARCEL", "NO STATE", "BAD ADDRESS",
]);

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Loading() {
  return <div className="py-16 text-center text-muted-foreground">Loading…</div>;
}

// Split scrape button: main "Scrape this period" action + a caret dropdown with
// the secondary actions (retry blocked rows, force re-scrape). Shared by Sheriff
// (monthly) and Legal (weekly) via the `label` prop.
function ScrapeMenu({
  label,
  onScrape,
  onForce,
  onRetry,
  busy,
  failedCount,
}: {
  label: string;
  onScrape: () => void;
  onForce: () => void;
  onRetry: () => void;
  busy: boolean;
  failedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={onScrape}
        disabled={busy}
        className="rounded-l-lg btn-metal-yellow px-4 py-2 text-sm font-semibold shadow-sm transition disabled:opacity-60"
      >
        {busy ? "Working…" : label}
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-label="More scrape options"
        className="rounded-r-lg border-l border-white/25 btn-metal-yellow px-2 shadow-sm transition disabled:opacity-60"
      >
        <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-card py-1 text-sm shadow-lg">
          <button
            onClick={() => run(onRetry)}
            disabled={failedCount === 0}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            Retry failed / blocked{failedCount > 0 ? ` (${failedCount})` : ""}
          </button>
          <button
            onClick={() => run(onForce)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-foreground hover:bg-accent"
          >
            <RefreshCcw className="h-4 w-4 text-muted-foreground" />
            Force re-scrape (replace all)
          </button>
        </div>
      )}
    </div>
  );
}

function Val({ value }: { value: string }) {
  const muted = ERROR_VALUES.has(value);
  return <span className={muted ? "text-muted-foreground" : "text-foreground"}>{value}</span>;
}

function ZillowCell({ url }: { url: string }) {
  if (url.startsWith("http")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-teal-glow hover:underline">
        View
      </a>
    );
  }
  return <Val value={url} />;
}

function DealSelect({ value, onChange }: { value: DealStage; onChange: (s: DealStage) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DealStage)}>
      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {DEAL_STAGES.map((s) => (
          <SelectItem key={s} value={s}>
            {STAGE_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function fmtMoney(n: number | null): string {
  return n === null ? "—" : "$" + Math.round(n).toLocaleString("en-US");
}

// ISO week date ("2026-05-26") -> "May 26, 2026" for the week tabs. Built from
// explicit Y/M/D parts so there's no UTC-vs-local off-by-one-day shift.
function fmtWeek(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TIER_STYLE: Record<string, string> = {
  good: "bg-green-500/15 text-green-400",
  ok: "bg-emerald-500/15 text-emerald-300",
  thin: "bg-amber-500/15 text-amber-300",
  verify: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40",
  bad: "bg-red-500/15 text-red-400",
  unknown: "bg-muted text-muted-foreground",
};

const TYPE_STYLE: Record<string, string> = {
  TAX: "bg-amber-500/15 text-amber-300",
  MTG: "bg-blue-500/15 text-blue-300",
  JUDG: "bg-purple-500/15 text-purple-300",
};

function TypeBadge({ type }: { type: string }) {
  const t = (type || "").toUpperCase();
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", TYPE_STYLE[t] ?? "bg-muted text-muted-foreground")}>
      {t || "—"}
    </span>
  );
}

const FLAG_INFO: Record<string, { Icon: LucideIcon; className: string; title: string }> = {
  "tax-redemption": { Icon: Clock, className: "text-amber-400", title: "Tax sale — owner has 60 days to redeem (buy back at +15%)" },
  "senior-lien-risk": { Icon: TriangleAlert, className: "text-amber-400", title: "Principal looks small for a mortgage — a larger senior loan may survive (not shown on the county page)" },
  "judg-risk": { Icon: TriangleAlert, className: "text-amber-400", title: "Judgment sale — senior mortgages/liens may survive; research title" },
  "needs-rescrape": { Icon: RefreshCw, className: "text-muted-foreground", title: "Incomplete data (a lookup was blocked) — re-scrape to complete" },
};

function fmtSize(beds: string, baths: string, sqft: string): string {
  const parts: string[] = [];
  if (beds && !ERROR_VALUES.has(beds)) parts.push(`${beds} bd`);
  if (baths && baths !== "0" && !ERROR_VALUES.has(baths)) parts.push(`${baths} ba`);
  if (sqft && !ERROR_VALUES.has(sqft)) parts.push(sqft.replace(/\s*sqft$/i, "") + " sf");
  return parts.length ? parts.join(" · ") : "—";
}

// Notes as a click-to-open dropdown showing the full caveat text (replaces the
// icon+tooltip). Uses native <details> so there's no open/close state to manage.
function DealNotes({ flags }: { flags: string[] }) {
  const notes = flags.map((f) => FLAG_INFO[f]).filter(Boolean) as { Icon: LucideIcon; className: string; title: string }[];
  if (notes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent [&::-webkit-details-marker]:hidden">
        {notes.map((n, i) => (
          <n.Icon key={i} className={cn("h-3.5 w-3.5", n.className)} />
        ))}
        <ChevronDown className="h-3 w-3 text-muted-foreground transition group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-border bg-card p-2 text-left text-[11px] leading-snug text-muted-foreground shadow-lg">
        <ul className="space-y-1.5">
          {notes.map((n, i) => (
            <li key={i} className="flex gap-1.5">
              <n.Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", n.className)} />
              <span>{n.title}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function CushionCell({ cushion, cushionPct, tier }: { cushion: number | null; cushionPct: number | null; tier: string }) {
  return (
    <div className={cn("rounded-md px-2 py-1 text-right text-sm font-bold tabular-nums", TIER_STYLE[tier] ?? TIER_STYLE.unknown)}>
      {cushion === null ? (
        <span className="text-xs font-medium">re-scrape</span>
      ) : (
        <>
          {fmtMoney(cushion)}
          {cushionPct !== null && <span className="ml-1 text-[10px] font-normal opacity-70">{Math.round(cushionPct * 100)}%</span>}
        </>
      )}
    </div>
  );
}

function PeriodTabs({
  periods,
  selected,
  onSelect,
}: {
  periods: { value: string; label: string; count: number }[];
  selected: string | null;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {periods.map((p) => (
        <button
          key={p.value}
          onClick={() => onSelect(p.value)}
          className={cn(
            "-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition",
            selected === p.value
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label} <span className="text-xs text-muted-foreground">({p.count})</span>
        </button>
      ))}
    </div>
  );
}

// Collapsible map panel button — shows the map above the table on click (hidden
// by default), instead of a separate tab.
function MapToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent"
    >
      <MapIcon className="h-4 w-4 text-primary" />
      {open ? "Hide map" : "Open map"}
      <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
    </button>
  );
}

// Table "Map" column: jump to the map focused on this row + auto-open Street View.
function MapLinkCell({ hasCoords, onClick }: { hasCoords: boolean; onClick: () => void }) {
  if (!hasCoords) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      onClick={onClick}
      title="Show on the map and open Street View"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      <MapPin className="h-3.5 w-3.5" /> Map
    </button>
  );
}

const SHERIFF_PIN: Record<string, string> = {
  good: "#16a34a", ok: "#10b981", thin: "#f59e0b", verify: "#f59e0b", bad: "#ef4444", unknown: "#94a3b8",
};
function legalPinColor(value: number | null): string {
  if (value === null) return "#94a3b8";
  if (value >= 500000) return "#16a34a";
  if (value >= 250000) return "#f59e0b";
  return "#64748b";
}

type SortKey = "cushion" | "zestimate" | "principal" | "liens";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

function SortHeader({ label, k, sort, onSort }: { label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void }) {
  const active = sort?.key === k;
  return (
    <th className="px-3 py-2 text-right font-medium">
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-primary")}>
        {label}
        {active ? (
          sort!.dir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

export function SheriffSales() {
  const months = useQuery(api.sheriffData.sheriffMonths);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const startScrape = useMutation(api.sheriffData.startScrape);
  const retryFailed = useMutation(api.sheriffData.retryFailed);
  const setDeal = useMutation(api.sheriffData.setDealStatus);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const startGeocode = useMutation(api.geocodeData.startGeocode);
  const onShowOnMap = (id: string) => {
    setFocusId(id);
    setMapOpen(true);
  };

  // Default to the newest month; re-point if the selection disappears.
  useEffect(() => {
    if (months && months.length > 0 && (!selectedMonth || !months.some((m) => m.month === selectedMonth))) {
      setSelectedMonth(months[0].month);
    }
  }, [months, selectedMonth]);

  const listings = useQuery(
    api.sheriffData.monthListings,
    selectedMonth ? { saleMonth: selectedMonth } : "skip",
  );

  const mapPoints: MapPoint[] = (listings ?? [])
    .filter((l) => typeof l.lat === "number" && typeof l.lng === "number")
    .map((l) => ({
      id: l._id,
      lat: l.lat as number,
      lng: l.lng as number,
      address: l.address,
      subtitle: ERROR_VALUES.has(l.ownerName) ? undefined : l.ownerName,
      metricValue: fmtMoney(l.deal.cushion),
      popupMetric: { label: "Zestimate", value: fmtMoney(l.deal.zestimate) },
      color: SHERIFF_PIN[l.deal.tier] ?? SHERIFF_PIN.unknown,
      size: fmtSize(l.beds, l.baths, l.sqft),
      zillowUrl: l.zillowUrl,
      dealStatus: l.dealStatus as DealStage,
    }));
  const missingGeocode = (listings ?? []).filter(
    (l) => l.lat === undefined && l.geocodeStatus !== "failed",
  ).length;

  const onGeocode = async () => {
    setGeocoding(true);
    try {
      await startGeocode({ type: "sheriff" });
      setMsg("Geocoding started — pins will appear as addresses resolve.");
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setGeocoding(false);
    }
  };

  // Blocked rows the "Retry failed" button can re-enrich.
  const failedCount = listings?.filter((l) => l.ownerName === "SCRAPE FAILED" || l.zestimate === "SCRAPE FAILED").length ?? 0;

  // Default = the backend's smart (tier-aware) order; clicking a header sorts by that column.
  const sorted = useMemo(() => {
    if (!listings || !sort) return listings;
    const { key, dir } = sort;
    const arr = [...listings];
    arr.sort((a, b) => {
      const pick = (l: (typeof arr)[number]) =>
        key === "cushion" ? l.deal.cushion : key === "zestimate" ? l.deal.zestimate : key === "principal" ? l.deal.principal : l.deal.liensTotal;
      const av = pick(a);
      const bv = pick(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls always last
      if (bv === null) return -1;
      return dir === "desc" ? bv - av : av - bv;
    });
    return arr;
  }, [listings, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const onRetry = async () => {
    if (!selectedMonth) return;
    setMsg(null);
    try {
      const r = await retryFailed({ saleMonth: selectedMonth });
      setMsg(
        r.status === "already_running"
          ? "A scrape is already running — let it finish, then retry."
          : r.retried > 0
            ? `Retrying ${r.retried} blocked lookup(s) — watch the progress above.`
            : "Nothing to retry.",
      );
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    }
  };

  const onScrape = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await startScrape({ force: false });
      setMsg(
        r.status === "already_running"
          ? "A scrape is already running — watch its progress below."
          : "Scrape started — follow the live progress below.",
      );
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onForce = async () => {
    if (
      !window.confirm(
        "Force re-scrape will DELETE this month's existing rows — including their deal status and notes — and pull a fresh set. Continue?",
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await startScrape({ force: true });
      setMsg("Force re-scrape started — replacing this month. Follow the live progress below.");
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Sheriff Sales"
        subtitle="New Castle County monthly tax & mortgage foreclosure auctions"
        action={
          <ScrapeMenu
            label="Scrape This Month's Sheriff Sales"
            onScrape={onScrape}
            onForce={onForce}
            onRetry={onRetry}
            busy={busy}
            failedCount={failedCount}
          />
        }
      />
      <div className="p-6">
        {msg && <div className="mb-4 rounded-lg bg-blue-500/10 px-4 py-2 text-sm text-blue-300">{msg}</div>}
        <ScrapeProgress type="sheriff" />
        {months === undefined ? (
          <Loading />
        ) : months.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">No listings yet. Click “Scrape This Month's Sheriff Sales”.</div>
        ) : (
          <>
            <PeriodTabs
              periods={months.map((m) => ({ value: m.month, label: m.month, count: m.count }))}
              selected={selectedMonth}
              onSelect={setSelectedMonth}
            />
            <div className="mb-3">
              <MapToggle open={mapOpen} onToggle={() => setMapOpen((o) => !o)} />
            </div>
            {mapOpen && (
              <div className="mb-4">
                <PropertyMap
                  points={mapPoints}
                  missingCount={missingGeocode}
                  onGeocode={onGeocode}
                  geocoding={geocoding}
                  focusId={focusId}
                  onFocusConsumed={() => setFocusId(null)}
                  onDealChange={(id, s) =>
                    setDeal({ listingId: id as Id<"sheriffListings">, dealStatus: s })
                  }
                />
              </div>
            )}
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-muted-foreground">Best deals first (cushion = est. resale − cost to clear).</span>
                  <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-green-400">Strong</span>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">Thin</span>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/40">Verify (hidden senior loan?)</span>
                  <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-400">Weak</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">Needs re-scrape</span>
                  {sort && (
                    <button
                      onClick={() => setSort(null)}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      <Star className="h-3 w-3" /> Best-deal order
                    </button>
                  )}
                  <div className="w-full text-muted-foreground">
                    Click a column header to sort. Cushion assumes you win near the <strong>Principal</strong>; competitive bids and surviving senior loans reduce it. Open the Notes column for per-row caveats. Not legal advice — verify title per property.
                  </div>
                </div>
                {!listings ? (
                  <Loading />
                ) : listings.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground">No listings for {selectedMonth}.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-right font-medium">#</th>
                          <SortHeader label="Cushion" k="cushion" sort={sort} onSort={toggleSort} />
                          <th className="px-3 py-2 font-medium">Property</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Size</th>
                          <SortHeader label="Worth (Zest.)" k="zestimate" sort={sort} onSort={toggleSort} />
                          <SortHeader label="Debt (Principal)" k="principal" sort={sort} onSort={toggleSort} />
                          <SortHeader label="Liens (tax+sewer)" k="liens" sort={sort} onSort={toggleSort} />
                          <th className="px-3 py-2 font-medium">Notes</th>
                          <th className="px-3 py-2 font-medium">Zillow</th>
                          <th className="px-3 py-2 font-medium">Map</th>
                          <th className="px-3 py-2 font-medium">Deal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(sorted ?? listings).map((l, i) => (
                          <tr key={l._id} className="border-t border-border hover:bg-accent">
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-2">
                              <CushionCell cushion={l.deal.cushion} cushionPct={l.deal.cushionPct} tier={l.deal.tier} />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-foreground">{l.address}</div>
                              {!ERROR_VALUES.has(l.ownerName) && (
                                <div className="text-[11px] text-muted-foreground">{l.ownerName}</div>
                              )}
                            </td>
                            <td className="px-3 py-2"><TypeBadge type={l.saleType} /></td>
                            <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{fmtSize(l.beds, l.baths, l.sqft)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtMoney(l.deal.zestimate)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground">{fmtMoney(l.deal.principal)}</td>
                            <td
                              className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                              title={`County ${fmtMoney(l.deal.county)} · School ${fmtMoney(l.deal.school)} · Sewer ${fmtMoney(l.deal.sewer)}`}
                            >
                              {fmtMoney(l.deal.liensTotal)}
                            </td>
                            <td className="px-3 py-2"><DealNotes flags={l.deal.flags} /></td>
                            <td className="px-3 py-2"><ZillowCell url={l.zillowUrl} /></td>
                            <td className="px-3 py-2">
                              <MapLinkCell
                                hasCoords={typeof l.lat === "number" && typeof l.lng === "number"}
                                onClick={() => onShowOnMap(l._id)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <DealSelect
                                value={l.dealStatus as DealStage}
                                onChange={(s) => setDeal({ listingId: l._id as Id<"sheriffListings">, dealStatus: s })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </>
        )}
      </div>
    </div>
  );
}

export function LegalNotices() {
  const weeks = useQuery(api.legalData.legalWeeks);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const startScrape = useMutation(api.legalData.startScrape);
  const retryFailed = useMutation(api.legalData.retryFailed);
  const setDeal = useMutation(api.legalData.setDealStatus);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const startGeocode = useMutation(api.geocodeData.startGeocode);
  const onShowOnMap = (id: string) => {
    setFocusId(id);
    setMapOpen(true);
  };

  // Default to the newest week; re-point if the selection disappears.
  useEffect(() => {
    if (weeks && weeks.length > 0 && (!selectedWeek || !weeks.some((w) => w.weekDate === selectedWeek))) {
      setSelectedWeek(weeks[0].weekDate);
    }
  }, [weeks, selectedWeek]);

  const notices = useQuery(
    api.legalData.weekNotices,
    selectedWeek ? { weekDate: selectedWeek } : "skip",
  );

  const mapPoints: MapPoint[] = (notices ?? [])
    .filter((n) => typeof n.lat === "number" && typeof n.lng === "number")
    .map((n) => ({
      id: n._id,
      lat: n.lat as number,
      lng: n.lng as number,
      address: n.address,
      subtitle: ERROR_VALUES.has(n.ownerName) ? undefined : n.ownerName,
      metricValue: fmtMoney(n.value),
      color: legalPinColor(n.value),
      size: fmtSize(n.beds, n.baths, n.sqft),
      zillowUrl: n.zillowUrl,
      dealStatus: n.dealStatus as DealStage,
    }));
  const missingGeocode = (notices ?? []).filter(
    (n) => n.lat === undefined && n.geocodeStatus !== "failed",
  ).length;

  const onGeocode = async () => {
    setGeocoding(true);
    try {
      await startGeocode({ type: "legal" });
      setMsg("Geocoding started — pins will appear as addresses resolve.");
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setGeocoding(false);
    }
  };

  // Blocked rows the "Retry failed" button can re-enrich.
  const failedCount = notices?.filter((n) => n.zestimate === "SCRAPE FAILED").length ?? 0;

  // Default = the backend's value-desc order; clicking the Worth header sorts by it.
  const sorted = useMemo(() => {
    if (!notices || !sort) return notices;
    const arr = [...notices];
    arr.sort((a, b) => {
      const av = a.value;
      const bv = b.value;
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls always last
      if (bv === null) return -1;
      return sort.dir === "desc" ? bv - av : av - bv;
    });
    return arr;
  }, [notices, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const onRetry = async () => {
    if (!selectedWeek) return;
    setMsg(null);
    try {
      const r = await retryFailed({ weekDate: selectedWeek });
      setMsg(
        r.status === "already_running"
          ? "A scrape is already running — let it finish, then retry."
          : r.retried > 0
            ? `Retrying ${r.retried} blocked lookup(s) — watch the progress above.`
            : "Nothing to retry.",
      );
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    }
  };

  const onScrape = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await startScrape({ force: false });
      setMsg(
        r.status === "already_running"
          ? "A scrape is already running — watch its progress below."
          : "Scrape started — follow the live progress below.",
      );
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onForce = async () => {
    if (
      !window.confirm(
        "Force re-scrape will DELETE this week's existing rows — including their deal status and notes — and pull a fresh set. Continue?",
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await startScrape({ force: true });
      setMsg("Force re-scrape started — replacing this week. Follow the live progress below.");
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Legal Notices"
        subtitle="New Castle County weekly estate / probate notices"
        action={
          <ScrapeMenu
            label="Scrape This Week's Legal Notices"
            onScrape={onScrape}
            onForce={onForce}
            onRetry={onRetry}
            busy={busy}
            failedCount={failedCount}
          />
        }
      />
      <div className="p-6">
        {msg && <div className="mb-4 rounded-lg bg-blue-500/10 px-4 py-2 text-sm text-blue-300">{msg}</div>}
        <ScrapeProgress type="legal" />
        {weeks === undefined ? (
          <Loading />
        ) : weeks.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">No notices yet. Click “Scrape This Week's Legal Notices”.</div>
        ) : (
          <>
            <PeriodTabs
              periods={weeks.map((w) => ({ value: w.weekDate, label: fmtWeek(w.weekDate), count: w.count }))}
              selected={selectedWeek}
              onSelect={setSelectedWeek}
            />
            <div className="mb-3">
              <MapToggle open={mapOpen} onToggle={() => setMapOpen((o) => !o)} />
            </div>
            {mapOpen && (
              <div className="mb-4">
                <PropertyMap
                  points={mapPoints}
                  missingCount={missingGeocode}
                  onGeocode={onGeocode}
                  geocoding={geocoding}
                  focusId={focusId}
                  onFocusConsumed={() => setFocusId(null)}
                  onDealChange={(id, s) =>
                    setDeal({ noticeId: id as Id<"legalNotices">, dealStatus: s })
                  }
                />
              </div>
            )}
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-muted-foreground">Highest estimated value (Zestimate) first.</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">Needs re-scrape</span>
                  {sort && (
                    <button
                      onClick={() => setSort(null)}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      <Star className="h-3 w-3" /> Highest value first
                    </button>
                  )}
                  <div className="w-full text-muted-foreground">
                    Estate / probate notices — the play is an off-market purchase from the estate. Contact the <strong>Personal Representative</strong>. Open the Notes column for per-row caveats.
                  </div>
                </div>
                {!notices ? (
                  <Loading />
                ) : notices.length === 0 ? (
                  <div className="py-16 text-center text-muted-foreground">No notices for {selectedWeek}.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-right font-medium">#</th>
                          <SortHeader label="Worth (Zest.)" k="zestimate" sort={sort} onSort={toggleSort} />
                          <th className="px-3 py-2 font-medium">Deceased / Owner</th>
                          <th className="px-3 py-2 font-medium">Personal Rep</th>
                          <th className="px-3 py-2 font-medium">Address</th>
                          <th className="px-3 py-2 font-medium">Size</th>
                          <th className="px-3 py-2 font-medium">Notes</th>
                          <th className="px-3 py-2 font-medium">Zillow</th>
                          <th className="px-3 py-2 font-medium">Map</th>
                          <th className="px-3 py-2 font-medium">Deal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(sorted ?? notices).map((n, i) => (
                          <tr key={n._id} className="border-t border-border hover:bg-accent">
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-2 text-right">
                              {n.value !== null ? (
                                <span className="font-semibold tabular-nums text-foreground">{fmtMoney(n.value)}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">{n.zestimate === "SCRAPE FAILED" ? "re-scrape" : "—"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-medium text-foreground">{n.ownerName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{n.personalRepresentative}</td>
                            <td className="px-3 py-2 text-muted-foreground">{n.address}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{fmtSize(n.beds, n.baths, n.sqft)}</td>
                            <td className="px-3 py-2"><DealNotes flags={n.flags} /></td>
                            <td className="px-3 py-2"><ZillowCell url={n.zillowUrl} /></td>
                            <td className="px-3 py-2">
                              <MapLinkCell
                                hasCoords={typeof n.lat === "number" && typeof n.lng === "number"}
                                onClick={() => onShowOnMap(n._id)}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <DealSelect
                                value={n.dealStatus as DealStage}
                                onChange={(s) => setDeal({ noticeId: n._id as Id<"legalNotices">, dealStatus: s })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </>
        )}
      </div>
    </div>
  );
}
