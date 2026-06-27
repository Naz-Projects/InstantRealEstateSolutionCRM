import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { ScanEye, Loader2, AlertTriangle, MapPinOff } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { describeError } from "./lib/errorReporting";

const FLAG_LABELS: Record<string, string> = {
  overgrown_vegetation: "Overgrown",
  junk_debris: "Junk / debris",
  boarded_or_broken_windows: "Boarded / broken windows",
  roof_damage_or_tarp: "Roof damage / tarp",
  distressed_exterior: "Distressed exterior",
  vacant_appearance: "Vacant-looking",
};

function conditionColor(score: number): string {
  if (score >= 76) return "text-red-400";
  if (score >= 51) return "text-amber-400";
  if (score <= 20) return "text-emerald-400";
  return "text-foreground";
}

function fmtTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

export function ConditionTest() {
  const leads = useQuery(api.signalData.leads, { limit: 100 });
  const prclids = (leads ?? []).map((l) => l.prclid);
  const conditions = useQuery(
    api.conditionData.conditionForPrclids,
    prclids.length ? { prclids } : "skip",
  );
  const scoreCondition = useAction(api.conditionActions.scoreCondition);

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const condByPrclid = new Map((conditions ?? []).map((c) => [c.prclid, c]));

  const rows = [...(leads ?? [])].sort((a, b) => {
    const ca = condByPrclid.get(a.prclid)?.score ?? null;
    const cb = condByPrclid.get(b.prclid)?.score ?? null;
    if (ca != null && cb != null) return cb - ca; // both scored: worst distress first
    if (ca != null) return -1; // scored before unscored
    if (cb != null) return 1;
    return b.score - a.score; // both unscored: by lead score
  });

  async function handleScore(prclid: string) {
    setBusy((b) => ({ ...b, [prclid]: true }));
    setErrors((e) => ({ ...e, [prclid]: "" }));
    try {
      const r = await scoreCondition({ prclid });
      if (r.status === "error") setErrors((e) => ({ ...e, [prclid]: r.error }));
    } catch (err) {
      setErrors((e) => ({ ...e, [prclid]: describeError(err).message }));
    } finally {
      setBusy((b) => ({ ...b, [prclid]: false }));
    }
  }

  return (
    <div className="space-y-6 p-1">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <ScanEye className="h-6 w-6 text-teal-glow" />
          Vision Condition (test)
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Top 100 leads, worst condition distress first. Scores may come from the monthly Chrome
          batch or the per-lead "Score condition" button, which pulls the Street View front-of-house
          photo and runs a vision model on it. Condition scores are an estimate from a single,
          possibly-stale photo — for triage only, not ground truth. (This page is isolated; scores do
          not yet affect lead ranking.)
        </p>
      </div>

      {leads === undefined && <p className="text-sm text-muted-foreground">Loading leads…</p>}
      {leads && leads.length === 0 && (
        <p className="text-sm text-muted-foreground">No leads yet.</p>
      )}

      <div className="space-y-4">
        {rows.map((lead) => {
          const c = condByPrclid.get(lead.prclid);
          const isBusy = busy[lead.prclid];
          const err = errors[lead.prclid] || c?.lastError;
          return (
            <div
              key={lead.prclid}
              className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row"
              data-slot="card"
            >
              {/* Image / placeholder */}
              <div className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40 sm:w-56">
                {c?.imageUrl ? (
                  <img src={c.imageUrl} alt="Street View" className="h-full w-full object-cover" />
                ) : c?.hasImagery === false ? (
                  <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                    <MapPinOff className="h-5 w-5" /> No Street View coverage
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Not scored yet</span>
                )}
              </div>

              {/* Details */}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {lead.situsStreet}, {lead.propCity} {lead.propZip}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {lead.ownerName} · lead score {lead.score}
                    </div>
                  </div>
                  {c && c.score != null && (
                    <div className="text-right">
                      <div className={cn("text-2xl font-semibold tabular-nums", conditionColor(c.score))}>
                        {c.score}
                        <span className="text-sm text-muted-foreground">/100</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">condition distress</div>
                    </div>
                  )}
                </div>

                {c?.flags && c.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.flags.map((f) => (
                      <span
                        key={f}
                        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400"
                      >
                        {FLAG_LABELS[f] ?? f}
                      </span>
                    ))}
                  </div>
                )}

                {c?.description ? (
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                ) : c?.reason ? (
                  <p className="text-sm text-muted-foreground">{c.reason}</p>
                ) : null}

                {c?.confidence && (
                  <span
                    className={cn(
                      "inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium",
                      c.confidence === "low"
                        ? "border-red-500/40 bg-red-500/10 text-red-400"
                        : c.confidence === "high"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                          : "border-border bg-muted/40 text-muted-foreground",
                    )}
                  >
                    confidence: {c.confidence}
                  </span>
                )}

                {err && (
                  <p className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> {err}
                  </p>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleScore(lead.prclid)}
                    className="inline-flex items-center gap-2 rounded-md border border-teal/40 bg-teal/10 px-3 py-1.5 text-sm font-medium text-teal-glow hover:bg-teal/20 disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanEye className="h-4 w-4" />}
                    {c?.scoredAt ? "Re-score condition" : "Score condition"}
                  </button>
                  {c?.model && (
                    <span className="text-[11px] text-muted-foreground">
                      {c.model}
                      {c.scoredAt ? ` · ${fmtTime(c.scoredAt)}` : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
