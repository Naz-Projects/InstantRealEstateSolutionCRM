import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { SlidersHorizontal, Loader2, RotateCcw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { describeError } from "./lib/errorReporting";
import { buyBoxFormArgs, buyBoxToForm, type BuyBoxExit, type BuyBoxForm } from "../scraper/monitorBuyBox";

// Per-user buy box (Phase 4): filters ONLY this user's nightly digest. Server-side
// normalizeBuyBox is authoritative; the form only parses text into numbers/ZIPs.
export function MonitorBuyBoxButton() {
  const box = useQuery(api.monitorData.myBuyBox);
  const save = useMutation(api.monitorData.saveMyBuyBox);
  const clear = useMutation(api.monitorData.clearMyBuyBox);
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [form, setForm] = useState<BuyBoxForm>(() => buyBoxToForm(null));
  const [exits, setExits] = useState<BuyBoxExit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load the saved box into the form once per open (never on a live re-render,
  // so a reactive update can't wipe what the user is typing).
  const openDialog = () => {
    setErr(null);
    setForm(buyBoxToForm(box ?? null));
    setExits(box ? box.exits : []);
    setOpen(true);
  };

  const set = (k: keyof BuyBoxForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleExit = (x: BuyBoxExit) => setExits((xs) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]));

  const onSave = async (e: FormEvent) => {
    e.preventDefault(); // a <form> so Enter in any field saves
    if (busy) return;
    const r = buyBoxFormArgs(form, exits);
    if (!r.ok) return setErr(r.error);
    setBusy(true);
    setErr(null);
    try {
      await save(r.args);
      setOpen(false);
    } catch (e) {
      setErr(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const active = box != null;
  return (
    <>
      <Button variant="outline" size="sm" disabled={box === undefined} onClick={openDialog}>
        <SlidersHorizontal data-icon="inline-start" />
        {active ? "Buy box (on)" : "Buy box"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>My buy box</DialogTitle>
            <DialogDescription>
              Filters only your nightly digest email. Leave a field blank for "any". The board still shows every deal.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSave} className="grid gap-4">
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                ZIP codes
                <Input value={form.zips} onChange={set("zips")} placeholder="19805, 19806, 19711" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">Min price<Input inputMode="numeric" value={form.priceMin} onChange={set("priceMin")} placeholder="any" /></label>
                <label className="grid gap-1 text-sm">Max price<Input inputMode="numeric" value={form.priceMax} onChange={set("priceMax")} placeholder="any" /></label>
                <label className="grid gap-1 text-sm">Min beds<Input inputMode="numeric" value={form.minBeds} onChange={set("minBeds")} placeholder="any" /></label>
                <div className="grid gap-1 text-sm">
                  <span id="buybox-exits">Exits</span>
                  <div role="group" aria-labelledby="buybox-exits" className="flex gap-2">
                    {(["FLIP", "RENTAL"] as const).map((x) => (
                      <button
                        key={x}
                        type="button"
                        onClick={() => toggleExit(x)}
                        aria-pressed={exits.includes(x)}
                        className={cn(
                          "h-9 rounded-md border border-border px-3 text-xs transition-colors md:h-8",
                          exits.includes(x) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        {x === "FLIP" ? "Flip" : "Rental"}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="grid gap-1 text-sm">Min flip profit<Input inputMode="numeric" value={form.minFlipProfit} onChange={set("minFlipProfit")} placeholder="any" /></label>
                <label className="grid gap-1 text-sm">Min cash flow /mo<Input inputMode="text" /* may be negative; iOS numeric/decimal pads have no minus */ value={form.minCashFlow} onChange={set("minCashFlow")} placeholder="any" /></label>
              </div>
              {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {/* Close this dialog first: a Radix modal blocks pointer events outside itself,
                  so a ConfirmDialog stacked on top of it would be unclickable. */}
              <Button type="button" variant="ghost" size="sm" disabled={!active || busy} onClick={() => { setOpen(false); setConfirmReset(true); }}>
                <RotateCcw data-icon="inline-start" /> Reset to everything
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy && <Loader2 className="animate-spin" data-icon="inline-start" />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset your buy box?"
        description="Your digest will include every flip and rental deal again."
        confirmLabel="Reset"
        onConfirm={() => clear({})}
      />
    </>
  );
}
