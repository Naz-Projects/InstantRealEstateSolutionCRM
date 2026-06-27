import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { HandCoins, Plus, Pencil, Trash2, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Buyer = FunctionReturnType<typeof api.pipelineData.listBuyers>[number];

const TYPE_LABEL: Record<Buyer["buyerType"], string> = {
  cash: "Cash buyer",
  landlord: "Landlord",
  flipper: "Flipper",
};

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  buyerType: "cash" as Buyer["buyerType"],
  targetAreas: "",
  maxPrice: "",
  notes: "",
};

function BuyerForm({
  initial,
  onDone,
}: {
  initial?: Buyer;
  onDone: () => void;
}) {
  const upsert = useMutation(api.pipelineData.upsertBuyer);
  const [f, setF] = useState(
    initial
      ? {
          name: initial.name,
          phone: initial.phone ?? "",
          email: initial.email ?? "",
          buyerType: initial.buyerType,
          targetAreas: initial.targetAreas ?? "",
          maxPrice: initial.maxPrice?.toString() ?? "",
          notes: initial.notes ?? "",
        }
      : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      await upsert({
        id: initial?._id,
        name: f.name.trim(),
        phone: f.phone.trim() || undefined,
        email: f.email.trim() || undefined,
        buyerType: f.buyerType,
        targetAreas: f.targetAreas.trim() || undefined,
        maxPrice: f.maxPrice.trim() ? Number(f.maxPrice.replace(/[^0-9.]/g, "")) : undefined,
        notes: f.notes.trim() || undefined,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-teal/30 bg-card p-4 md:grid-cols-4">
      <Input placeholder="Name *" value={f.name} onChange={(e) => set("name")(e.target.value)} />
      <Select value={f.buyerType} onValueChange={(v) => set("buyerType")(v)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cash">Cash buyer</SelectItem>
          <SelectItem value="landlord">Landlord</SelectItem>
          <SelectItem value="flipper">Flipper</SelectItem>
        </SelectContent>
      </Select>
      <Input placeholder="Phone" value={f.phone} onChange={(e) => set("phone")(e.target.value)} />
      <Input placeholder="Email" value={f.email} onChange={(e) => set("email")(e.target.value)} />
      <Input
        placeholder="Target areas (zips/cities)"
        value={f.targetAreas}
        onChange={(e) => set("targetAreas")(e.target.value)}
        className="col-span-2"
      />
      <Input
        placeholder="Max price $"
        value={f.maxPrice}
        onChange={(e) => set("maxPrice")(e.target.value)}
      />
      <Input placeholder="Notes" value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
      <div className="col-span-2 flex gap-2 md:col-span-4">
        <button
          onClick={save}
          disabled={busy || !f.name.trim()}
          className="btn-metal-yellow rounded-md px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
        >
          {initial ? "Save buyer" : "Add buyer"}
        </button>
        <button
          onClick={onDone}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

export function BuyersPage() {
  const buyers = useQuery(api.pipelineData.listBuyers, { includeInactive: true });
  const del = useMutation(api.pipelineData.deleteBuyer);
  const upsert = useMutation(api.pipelineData.upsertBuyer);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [deleting, setDeleting] = useState<Buyer | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <HandCoins className="h-5 w-5 text-teal-glow" /> Buyers
          </h1>
          <p className="text-sm text-muted-foreground">
            Cash-buyer list for disposition — assign a buyer to a lead from the Leads page.
          </p>
        </div>
        {!adding && !editing && (
          <button
            onClick={() => setAdding(true)}
            className="btn-metal-yellow inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" /> Add buyer
          </button>
        )}
      </div>

      <div className="space-y-5 p-6">
        {adding && <BuyerForm onDone={() => setAdding(false)} />}
        {editing && <BuyerForm key={editing._id} initial={editing} onDone={() => setEditing(null)} />}

        {buyers === undefined ? (
          <div className="px-3 py-10 text-center text-muted-foreground">Loading buyers…</div>
        ) : buyers.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            <HandCoins className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No buyers yet — add the cash buyers you wholesale to.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Target areas</th>
                  <th className="px-4 py-2.5 font-medium">Max price</th>
                  <th className="px-4 py-2.5 font-medium">Active</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {buyers.map((b) => (
                  <tr key={b._id} className={cn("border-b border-border/50", !b.active && "opacity-50")}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{b.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{TYPE_LABEL[b.buyerType]}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {[b.phone, b.email].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{b.targetAreas || "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {b.maxPrice ? `$${b.maxPrice.toLocaleString("en-US")}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => upsert({ id: b._id, name: b.name, buyerType: b.buyerType, active: !b.active })}
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-xs",
                          b.active
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {b.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => {
                            setAdding(false);
                            setEditing(b);
                          }}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          aria-label="Edit buyer"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleting(b)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                          aria-label="Delete buyer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete buyer"
        description={
          <>
            Remove <span className="font-semibold text-foreground">{deleting?.name}</span> from the
            buyers list? Any lead assignments to this buyer are cleared.
          </>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleting) await del({ id: deleting._id as Id<"buyers"> });
          setDeleting(null);
        }}
      />
    </div>
  );
}
