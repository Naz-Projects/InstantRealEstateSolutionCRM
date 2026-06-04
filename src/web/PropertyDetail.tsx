import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Home, RefreshCw, Trash2, Plus, ExternalLink } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GRADE_COLOR } from "./Properties";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "./ConfirmDialog";

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
function toDateInput(ms: number | null | undefined): string {
  if (ms == null) return "";
  return new Date(ms).toISOString().slice(0, 10);
}
function fromDateInput(s: string): number | null {
  if (!s) return null;
  const t = new Date(s + "T00:00:00").getTime();
  return Number.isFinite(t) ? t : null;
}

const inputCls =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none";

const STATUS_OPTIONS: Record<"flip" | "rental", { value: string; label: string }[]> = {
  flip: [
    { value: "in_progress", label: "In progress" },
    { value: "sold", label: "Sold" },
  ],
  rental: [
    { value: "active", label: "Active" },
    { value: "vacant", label: "Vacant" },
  ],
};
const EXPENSE_CATS = [
  "Purchase", "Rehab/Materials", "Labor", "Permits", "Taxes", "Insurance", "Utilities", "Financing", "Closing", "Other",
];
const INCOME_CATS = ["Rent", "Deposit", "Late fee", "Other"];

export function PropertyDetail() {
  const params = useParams({ strict: false }) as { id: string };
  const pid = params.id as Id<"properties">;
  const data = useQuery(api.propertyData.getProperty, { id: pid });

  if (data === undefined) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (data === null) {
    return (
      <div className="p-6">
        <Link
          to="/properties"
          className="inline-flex items-center gap-1 text-sm text-teal-glow hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to properties
        </Link>
        <p className="mt-4 text-muted-foreground">Property not found.</p>
      </div>
    );
  }

  // Keyed by _id so all the useState fields reset when navigating between properties.
  return <PropertyDetailInner key={data._id} data={data} pid={pid} />;
}

type DetailData = NonNullable<FunctionReturnType<typeof api.propertyData.getProperty>>;

function PropertyDetailInner({ data, pid }: { data: DetailData; pid: Id<"properties"> }) {
  // useMutation hooks are called unconditionally at the top of the component (rules of
  // hooks satisfied — same order every render); grouped into `m` for readability.
  const m = {
    update: useMutation(api.propertyData.updateProperty),
    markSold: useMutation(api.propertyData.markSold),
    setPhotoUrl: useMutation(api.propertyData.setPhotoUrl),
    refreshImage: useMutation(api.propertyData.refreshPropertyImage),
    addEntry: useMutation(api.propertyData.addLedgerEntry),
    delEntry: useMutation(api.propertyData.deleteLedgerEntry),
    delProperty: useMutation(api.propertyData.deleteProperty),
  };
  const navigate = useNavigate();
  const p = data;
  const s = data.summary;

  const [confirmDelete, setConfirmDelete] = useState(false);

  // facts form
  const [status, setStatus] = useState(p.status);
  const [beds, setBeds] = useState(p.beds ?? "");
  const [baths, setBaths] = useState(p.baths ?? "");
  const [sqft, setSqft] = useState(p.sqft?.toString() ?? "");
  const [zestimate, setZestimate] = useState(p.zestimate ?? "");
  const [purchase, setPurchase] = useState(p.purchasePrice?.toString() ?? "");
  const [acquired, setAcquired] = useState(toDateInput(p.acquiredDate));
  const [zillow, setZillow] = useState(p.zillowUrl ?? "");
  const [notes, setNotes] = useState(p.notes ?? "");
  const [savedFacts, setSavedFacts] = useState(false);

  // The Zillow scrape fills beds/baths/sqft/zestimate ~seconds after a property is added
  // (or after "Refresh photo"). These inputs are seeded from useState, which won't pick up
  // that async DB update on its own (the component is keyed on _id, not the facts) — so
  // mirror each server value into its box once it arrives, but only when the box is still
  // empty (functional updater preserves anything you've typed and avoids wiping it on Save).
  useEffect(() => {
    const { beds: sBeds, baths: sBaths, sqft: sSqft, zestimate: sZest } = p;
    if (sBeds) setBeds((cur) => cur || sBeds);
    if (sBaths) setBaths((cur) => cur || sBaths);
    if (sSqft != null) setSqft((cur) => cur || String(sSqft));
    if (sZest) setZestimate((cur) => cur || sZest);
  }, [p.beds, p.baths, p.sqft, p.zestimate]);

  // sale form
  const [salePrice, setSalePrice] = useState(p.salePrice?.toString() ?? "");
  const [soldDate, setSoldDate] = useState(toDateInput(p.soldDate) || toDateInput(Date.now()));

  // photo paste
  const [photoUrl, setPhotoUrl] = useState("");

  // ledger add form
  const [dir, setDir] = useState<"expense" | "income">("expense");
  const cats = dir === "expense" ? EXPENSE_CATS : INCOME_CATS;
  const [cat, setCat] = useState(EXPENSE_CATS[0]);
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(toDateInput(Date.now()));
  const [desc, setDesc] = useState("");

  const saveFacts = async () => {
    await m.update({
      id: pid,
      patch: {
        status,
        beds: beds.trim() || null,
        baths: baths.trim() || null,
        sqft: num(sqft),
        zestimate: zestimate.trim() || null,
        purchasePrice: num(purchase),
        acquiredDate: fromDateInput(acquired),
        zillowUrl: zillow.trim() || null,
        notes,
      },
    });
    setSavedFacts(true);
    setTimeout(() => setSavedFacts(false), 1500);
  };

  const doMarkSold = async () => {
    const sp = num(salePrice);
    const sd = fromDateInput(soldDate);
    if (sp == null || sd == null) return;
    await m.markSold({ id: pid, salePrice: sp, soldDate: sd });
    setStatus("sold");
  };

  const onChangeDir = (d: "expense" | "income") => {
    setDir(d);
    setCat((d === "expense" ? EXPENSE_CATS : INCOME_CATS)[0]);
  };
  const addLedger = async () => {
    const amt = num(amount);
    const dt = fromDateInput(entryDate);
    if (amt == null || dt == null) return;
    await m.addEntry({ propertyId: pid, direction: dir, category: cat, amount: amt, date: dt, description: desc.trim() || undefined });
    setAmount("");
    setDesc("");
  };

  const SummaryCard = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"text-lg font-semibold " + (cls ?? "text-foreground")}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <Link to="/properties" className="inline-flex items-center gap-1 text-sm text-teal-glow hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to properties
      </Link>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Photo + facts */}
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.address} className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <Home className="h-10 w-10" />
                  <span className="text-xs">
                    {p.imageStatus === "pending" ? "Fetching photo…" : "No photo"}
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-2 p-3">
              <button
                onClick={() => void m.refreshImage({ id: pid })}
                className="flex items-center gap-1 text-xs text-teal-glow hover:underline"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh photo from Zillow
              </button>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="Paste a photo URL"
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                />
                <button
                  onClick={async () => {
                    if (!photoUrl.trim()) return;
                    await m.setPhotoUrl({ id: pid, imageUrl: photoUrl.trim() });
                    setPhotoUrl("");
                  }}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:border-teal"
                >
                  Set
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">{p.address}</h2>
            <span className="rounded-md border border-teal/40 px-2 py-0.5 text-xs capitalize text-teal-glow">
              {p.dealType}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS[p.dealType].map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="block text-xs text-muted-foreground">
                Purchase price ($)
                <input className={inputCls} value={purchase} onChange={(e) => setPurchase(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Beds
                <input className={inputCls} value={beds} onChange={(e) => setBeds(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Baths
                <input className={inputCls} value={baths} onChange={(e) => setBaths(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Sqft
                <input className={inputCls} value={sqft} onChange={(e) => setSqft(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Zestimate
                <input className={inputCls} value={zestimate} onChange={(e) => setZestimate(e.target.value)} placeholder="$0" />
              </label>
              <label className="block text-xs text-muted-foreground">
                Acquired
                <input type="date" className={inputCls} value={acquired} onChange={(e) => setAcquired(e.target.value)} />
              </label>
            </div>
            <label className="block text-xs text-muted-foreground">
              Zillow URL (reference)
              <input className={inputCls} value={zillow} onChange={(e) => setZillow(e.target.value)} />
            </label>
            {p.zillowUrl && (
              <a
                href={p.zillowUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-teal-glow hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open on Zillow
              </a>
            )}
            <label className="block text-xs text-muted-foreground">
              Notes
              <textarea className={inputCls + " h-16"} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="flex items-center justify-between">
              <button onClick={saveFacts} className="btn-metal-yellow rounded-md px-4 py-1.5 text-sm font-semibold">
                {savedFacts ? "Saved" : "Save"}
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </div>
        </div>

        {/* Summary + sale + ledger */}
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {p.dealType === "flip" ? (
              <>
                <SummaryCard label="Invested" value={fmtMoney(s.invested)} />
                <SummaryCard label="Expenses" value={fmtMoney(s.totalExpenses)} />
                <SummaryCard label="Sale price" value={fmtMoney(p.salePrice)} />
                <SummaryCard label="Realized profit" value={fmtMoney(s.realizedProfit)} cls={GRADE_COLOR[s.grade]} />
                <SummaryCard label="ROI" value={fmtPct(s.roi)} cls={GRADE_COLOR[s.grade]} />
              </>
            ) : (
              <>
                <SummaryCard label="Total income" value={fmtMoney(s.totalIncome)} />
                <SummaryCard label="Total expenses" value={fmtMoney(s.totalExpenses)} />
                <SummaryCard label="Net cash flow" value={fmtMoney(s.netCashFlow)} cls={GRADE_COLOR[s.grade]} />
              </>
            )}
          </div>

          {p.dealType === "flip" && status !== "sold" && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
              <span className="text-sm text-muted-foreground">Mark sold:</span>
              <label className="block text-xs text-muted-foreground">
                Sale price ($)
                <input className={inputCls} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Sold date
                <input type="date" className={inputCls} value={soldDate} onChange={(e) => setSoldDate(e.target.value)} />
              </label>
              <button onClick={doMarkSold} className="btn-metal-yellow rounded-md px-4 py-1.5 text-sm font-semibold">
                Mark sold
              </button>
            </div>
          )}

          {/* Ledger */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
              <div className="flex overflow-hidden rounded-md border border-border">
                {(["expense", "income"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => onChangeDir(d)}
                    className={
                      "px-3 py-1 text-sm capitalize " +
                      (dir === d ? "bg-muted text-foreground" : "text-muted-foreground")
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Category</label>
                <Select value={cat} onValueChange={setCat}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cats.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="block text-xs text-muted-foreground">
                Amount ($)
                <input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Date
                <input type="date" className={inputCls} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </label>
              <label className="block flex-1 text-xs text-muted-foreground">
                Description
                <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} />
              </label>
              <button onClick={addLedger} className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:border-teal">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {p.ledger.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No entries yet. Add an expense or income above.
                    </td>
                  </tr>
                )}
                {p.ledger.map((e) => (
                  <tr key={e._id} className="border-b border-border/50">
                    <td className="px-3 py-2 text-muted-foreground">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 capitalize">{e.direction}</td>
                    <td className="px-3 py-2">{e.category}</td>
                    <td className={"px-3 py-2 text-right font-medium " + (e.direction === "income" ? "text-emerald-400" : "text-red-400")}>
                      {e.direction === "income" ? "+" : "−"}
                      {fmtMoney(e.amount)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{e.description ?? ""}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => void m.delEntry({ id: e._id })}
                        className="text-muted-foreground hover:text-red-400"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this property?"
        description="This permanently removes the property and all its ledger entries. This cannot be undone."
        confirmLabel="Delete property"
        destructive
        onConfirm={async () => {
          await m.delProperty({ id: pid });
          await navigate({ to: "/properties" });
        }}
      />
    </div>
  );
}
