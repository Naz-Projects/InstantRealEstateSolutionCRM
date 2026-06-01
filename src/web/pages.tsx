import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock,
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
import { ScrapeProgress } from "./ScrapeProgress";
const ERROR_VALUES = new Set([
  "PENDING", "NOT FOUND", "SCRAPE FAILED", "NO ADDRESS", "WRONG STATE", "NO PARCEL", "NO STATE", "BAD ADDRESS",
]);

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Loading() {
  return <div className="py-16 text-center text-slate-400">Loading…</div>;
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
        className="rounded-l-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-60"
      >
        {busy ? "Working…" : label}
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-label="More scrape options"
        className="rounded-r-lg border-l border-white/25 bg-accent px-2 text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-60"
      >
        <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <button
            onClick={() => run(onRetry)}
            disabled={failedCount === 0}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="h-4 w-4 text-slate-500" />
            Retry failed / blocked{failedCount > 0 ? ` (${failedCount})` : ""}
          </button>
          <button
            onClick={() => run(onForce)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw className="h-4 w-4 text-slate-500" />
            Force re-scrape (replace all)
          </button>
        </div>
      )}
    </div>
  );
}

function Val({ value }: { value: string }) {
  const muted = ERROR_VALUES.has(value);
  return <span className={muted ? "text-slate-400" : "text-slate-800"}>{value}</span>;
}

function ZillowCell({ url }: { url: string }) {
  if (url.startsWith("http")) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
        View
      </a>
    );
  }
  return <Val value={url} />;
}

function DealSelect({ value, onChange }: { value: DealStage; onChange: (s: DealStage) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DealStage)}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none"
    >
      {DEAL_STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function Funnel({ title, data }: { title: string; data: Record<string, number> }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-ink">{title}</div>
      <div className="flex flex-wrap gap-2">
        {DEAL_STAGES.map((s) => (
          <div key={s} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
            <div className="text-lg font-bold text-ink">{data[s] ?? 0}</div>
            <div className="text-[11px] text-slate-500">{STAGE_LABEL[s]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const stats = useQuery(api.runs.dashboardStats);
  const runs = useQuery(api.runs.listRuns);
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your wholesaling pipeline at a glance" />
      <div className="space-y-6 p-6">
        {!stats ? (
          <Loading />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="Sheriff Listings" value={stats.sheriffTotal} />
              <StatCard label="Legal Notices" value={stats.legalTotal} />
              <StatCard label="Contacted" value={stats.sheriffByStage.contacted + stats.legalByStage.contacted} accent />
              <StatCard label="Offers Made" value={stats.sheriffByStage.offer + stats.legalByStage.offer} accent />
            </div>
            <Funnel title="Sheriff Sales pipeline" data={stats.sheriffByStage} />
            <Funnel title="Legal Notices pipeline" data={stats.legalByStage} />
          </>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-ink">Recent scrape runs</div>
          {!runs ? (
            <Loading />
          ) : runs.length === 0 ? (
            <div className="text-sm text-slate-400">No runs yet — trigger one from Sheriff Sales or Legal Notices.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1">Type</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Listings</th>
                  <th>Enriched</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r._id} className="border-t border-slate-100">
                    <td className="py-1.5 capitalize">{r.type}</td>
                    <td>{r.label}</td>
                    <td className="capitalize">{r.status}</td>
                    <td>{r.listingCount}</td>
                    <td>{r.enrichedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
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
  good: "bg-green-100 text-green-800",
  ok: "bg-emerald-50 text-emerald-700",
  thin: "bg-amber-100 text-amber-800",
  verify: "bg-amber-50 text-amber-800 ring-1 ring-amber-400",
  bad: "bg-red-100 text-red-700",
  unknown: "bg-slate-100 text-slate-400",
};

const TYPE_STYLE: Record<string, string> = {
  TAX: "bg-amber-100 text-amber-800",
  MTG: "bg-blue-100 text-blue-800",
  JUDG: "bg-purple-100 text-purple-800",
};

function TypeBadge({ type }: { type: string }) {
  const t = (type || "").toUpperCase();
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", TYPE_STYLE[t] ?? "bg-slate-100 text-slate-600")}>
      {t || "—"}
    </span>
  );
}

const FLAG_INFO: Record<string, { Icon: LucideIcon; className: string; title: string }> = {
  "tax-redemption": { Icon: Clock, className: "text-amber-600", title: "Tax sale — owner has 60 days to redeem (buy back at +15%)" },
  "senior-lien-risk": { Icon: TriangleAlert, className: "text-amber-600", title: "Principal looks small for a mortgage — a larger senior loan may survive (not shown on the county page)" },
  "judg-risk": { Icon: TriangleAlert, className: "text-amber-600", title: "Judgment sale — senior mortgages/liens may survive; research title" },
  "needs-rescrape": { Icon: RefreshCw, className: "text-slate-500", title: "Incomplete data (a lookup was blocked) — re-scrape to complete" },
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
  if (notes.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        {notes.map((n, i) => (
          <n.Icon key={i} className={cn("h-3.5 w-3.5", n.className)} />
        ))}
        <ChevronDown className="h-3 w-3 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 text-left text-[11px] leading-snug text-slate-600 shadow-lg">
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
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {periods.map((p) => (
        <button
          key={p.value}
          onClick={() => onSelect(p.value)}
          className={cn(
            "-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition",
            selected === p.value
              ? "border-accent text-accent"
              : "border-transparent text-slate-500 hover:text-slate-700",
          )}
        >
          {p.label} <span className="text-xs text-slate-400">({p.count})</span>
        </button>
      ))}
    </div>
  );
}

type SortKey = "cushion" | "zestimate" | "principal" | "liens";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

function SortHeader({ label, k, sort, onSort }: { label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void }) {
  const active = sort?.key === k;
  return (
    <th className="px-3 py-2 text-right font-medium">
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-slate-700", active && "text-accent")}>
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
        {msg && <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">{msg}</div>}
        <ScrapeProgress type="sheriff" />
        {months === undefined ? (
          <Loading />
        ) : months.length === 0 ? (
          <div className="py-16 text-center text-slate-400">No listings yet. Click “Scrape This Month's Sheriff Sales”.</div>
        ) : (
          <>
            <PeriodTabs
              periods={months.map((m) => ({ value: m.month, label: m.month, count: m.count }))}
              selected={selectedMonth}
              onSelect={setSelectedMonth}
            />
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">Best deals first (cushion = est. resale − cost to clear).</span>
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">Strong</span>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Thin</span>
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-400">Verify (hidden senior loan?)</span>
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">Weak</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-400">Needs re-scrape</span>
              {sort && (
                <button
                  onClick={() => setSort(null)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  <Star className="h-3 w-3" /> Best-deal order
                </button>
              )}
              <div className="w-full text-slate-400">
                Click a column header to sort. Cushion assumes you win near the <strong>Principal</strong>; competitive bids and surviving senior loans reduce it. Open the Notes column for per-row caveats. Not legal advice — verify title per property.
              </div>
            </div>
            {!listings ? (
              <Loading />
            ) : listings.length === 0 ? (
              <div className="py-16 text-center text-slate-400">No listings for {selectedMonth}.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
                      <th className="px-3 py-2 font-medium">Deal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sorted ?? listings).map((l, i) => (
                      <tr key={l._id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2">
                          <CushionCell cushion={l.deal.cushion} cushionPct={l.deal.cushionPct} tier={l.deal.tier} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-ink">{l.address}</div>
                          {!ERROR_VALUES.has(l.ownerName) && (
                            <div className="text-[11px] text-slate-400">{l.ownerName}</div>
                          )}
                        </td>
                        <td className="px-3 py-2"><TypeBadge type={l.saleType} /></td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">{fmtSize(l.beds, l.baths, l.sqft)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-800">{fmtMoney(l.deal.zestimate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-800">{fmtMoney(l.deal.principal)}</td>
                        <td
                          className="px-3 py-2 text-right tabular-nums text-slate-600"
                          title={`County ${fmtMoney(l.deal.county)} · School ${fmtMoney(l.deal.school)} · Sewer ${fmtMoney(l.deal.sewer)}`}
                        >
                          {fmtMoney(l.deal.liensTotal)}
                        </td>
                        <td className="px-3 py-2"><DealNotes flags={l.deal.flags} /></td>
                        <td className="px-3 py-2"><ZillowCell url={l.zillowUrl} /></td>
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
        {msg && <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">{msg}</div>}
        <ScrapeProgress type="legal" />
        {weeks === undefined ? (
          <Loading />
        ) : weeks.length === 0 ? (
          <div className="py-16 text-center text-slate-400">No notices yet. Click “Scrape This Week's Legal Notices”.</div>
        ) : (
          <>
            <PeriodTabs
              periods={weeks.map((w) => ({ value: w.weekDate, label: fmtWeek(w.weekDate), count: w.count }))}
              selected={selectedWeek}
              onSelect={setSelectedWeek}
            />
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">Highest estimated value (Zestimate) first.</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-400">Needs re-scrape</span>
              {sort && (
                <button
                  onClick={() => setSort(null)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  <Star className="h-3 w-3" /> Highest value first
                </button>
              )}
              <div className="w-full text-slate-400">
                Estate / probate notices — the play is an off-market purchase from the estate. Contact the <strong>Personal Representative</strong>. Open the Notes column for per-row caveats.
              </div>
            </div>
            {!notices ? (
              <Loading />
            ) : notices.length === 0 ? (
              <div className="py-16 text-center text-slate-400">No notices for {selectedWeek}.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">#</th>
                      <SortHeader label="Worth (Zest.)" k="zestimate" sort={sort} onSort={toggleSort} />
                      <th className="px-3 py-2 font-medium">Deceased / Owner</th>
                      <th className="px-3 py-2 font-medium">Personal Rep</th>
                      <th className="px-3 py-2 font-medium">Address</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2 font-medium">Notes</th>
                      <th className="px-3 py-2 font-medium">Zillow</th>
                      <th className="px-3 py-2 font-medium">Deal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sorted ?? notices).map((n, i) => (
                      <tr key={n._id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 text-right">
                          {n.value !== null ? (
                            <span className="font-semibold tabular-nums text-ink">{fmtMoney(n.value)}</span>
                          ) : (
                            <span className="text-xs text-slate-400">{n.zestimate === "SCRAPE FAILED" ? "re-scrape" : "—"}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-ink">{n.ownerName}</td>
                        <td className="px-3 py-2 text-slate-600">{n.personalRepresentative}</td>
                        <td className="px-3 py-2 text-slate-600">{n.address}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">{fmtSize(n.beds, n.baths, n.sqft)}</td>
                        <td className="px-3 py-2"><DealNotes flags={n.flags} /></td>
                        <td className="px-3 py-2"><ZillowCell url={n.zillowUrl} /></td>
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
