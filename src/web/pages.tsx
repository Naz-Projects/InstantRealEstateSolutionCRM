import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const DEAL_STAGES = ["new", "reviewing", "contacted", "offer", "dead"] as const;
type DealStage = (typeof DEAL_STAGES)[number];
const STAGE_LABEL: Record<DealStage, string> = {
  new: "New",
  reviewing: "Reviewing",
  contacted: "Contacted",
  offer: "Offer",
  dead: "Dead",
};
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

function ScrapeButton({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-60"
    >
      {busy ? "Working…" : label}
    </button>
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

function EnrichPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    enriched: "bg-green-100 text-green-700",
    pending: "bg-amber-100 text-amber-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
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

export function SheriffSales() {
  const listings = useQuery(api.sheriffData.listListings, {});
  const startScrape = useMutation(api.sheriffData.startScrape);
  const setDeal = useMutation(api.sheriffData.setDealStatus);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onScrape = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await startScrape({});
      setMsg(
        r.status === "already_running"
          ? "A scrape is already running — listings will keep filling in."
          : "Scrape started. Listings appear immediately and enrich live (parcel + Zillow).",
      );
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
        action={<ScrapeButton onClick={onScrape} busy={busy} label="Scrape Sheriff Sales This Week" />}
      />
      <div className="p-6">
        {msg && <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">{msg}</div>}
        {!listings ? (
          <Loading />
        ) : listings.length === 0 ? (
          <div className="py-16 text-center text-slate-400">No listings yet. Click “Scrape Sheriff Sales This Week”.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {["Address", "Type", "Owner", "Assessment", "Principal", "Zestimate", "Beds", "Zillow", "Enrichment", "Deal"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l._id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-ink">{l.address}</td>
                    <td className="px-3 py-2">{l.saleType}</td>
                    <td className="px-3 py-2"><Val value={l.ownerName} /></td>
                    <td className="px-3 py-2"><Val value={l.assessmentTotal} /></td>
                    <td className="px-3 py-2">{l.principal}</td>
                    <td className="px-3 py-2"><Val value={l.zestimate} /></td>
                    <td className="px-3 py-2"><Val value={l.beds} /></td>
                    <td className="px-3 py-2"><ZillowCell url={l.zillowUrl} /></td>
                    <td className="px-3 py-2"><EnrichPill status={l.enrichmentStatus} /></td>
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
      </div>
    </div>
  );
}

export function LegalNotices() {
  const notices = useQuery(api.legalData.listNotices, {});
  const startScrape = useMutation(api.legalData.startScrape);
  const setDeal = useMutation(api.legalData.setDealStatus);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onScrape = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await startScrape({});
      setMsg(
        r.status === "already_running"
          ? "A scrape is already running — notices will keep filling in."
          : "Scrape started. Estate listings are extracted by AI and enriched with Zillow.",
      );
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
        action={<ScrapeButton onClick={onScrape} busy={busy} label="Scrape Legal Notices This Week" />}
      />
      <div className="p-6">
        {msg && <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">{msg}</div>}
        {!notices ? (
          <Loading />
        ) : notices.length === 0 ? (
          <div className="py-16 text-center text-slate-400">No notices yet. Click “Scrape Legal Notices This Week”.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {["Deceased / Owner", "Address", "Personal Rep", "Zestimate", "Beds", "Zillow", "Week", "Enrichment", "Deal"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {notices.map((n) => (
                  <tr key={n._id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-ink">{n.ownerName}</td>
                    <td className="px-3 py-2">{n.address}</td>
                    <td className="px-3 py-2">{n.personalRepresentative}</td>
                    <td className="px-3 py-2"><Val value={n.zestimate} /></td>
                    <td className="px-3 py-2"><Val value={n.beds} /></td>
                    <td className="px-3 py-2"><ZillowCell url={n.zillowUrl} /></td>
                    <td className="px-3 py-2">{n.weekDate}</td>
                    <td className="px-3 py-2"><EnrichPill status={n.enrichmentStatus} /></td>
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
      </div>
    </div>
  );
}
