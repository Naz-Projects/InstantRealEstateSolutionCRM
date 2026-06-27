import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import {
  ClipboardList,
  ClipboardPlus,
  ClipboardCheck,
  CalendarClock,
  Trash2,
  Mail,
  MapPin,
  ExternalLink,
  Plus,
  Save,
  PhoneCall,
  DoorOpen,
  MessageSquare,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  POTENTIAL_STAGES,
  STAGE_LABELS,
  STAGE_COLORS,
  isPotentialStage,
  ACTIVITY_TYPES,
  ACTIVITY_LABELS,
  OUTCOME_SUGGESTIONS,
  nextActionLabel,
  dealDedupeKey,
  type ActivityType,
} from "../scraper/potentialPipeline";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "./ConfirmDialog";
import { describeError } from "./lib/errorReporting";

type Deal = FunctionReturnType<typeof api.potentialData.listDeals>[number];
type Activity = FunctionReturnType<typeof api.potentialData.activitiesForDeal>[number];

const ACTIVITY_ICON: Record<ActivityType, LucideIcon> = {
  call: PhoneCall,
  door_knock: DoorOpen,
  text: MessageSquare,
  email: Mail,
  note: StickyNote,
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtDate(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-red-400";
  if (score >= 40) return "text-amber-400";
  return "text-foreground";
}

const zillowUrl = (address: string) => `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** Overdue/today/upcoming next-action badge — reuses the funnel-widget palette. */
function NextActionBadge({ at }: { at?: number }) {
  if (!at) return null;
  const label = nextActionLabel(at, Date.now());
  const tone =
    label === "Overdue"
      ? "border-red-500/40 bg-red-500/10 text-red-400"
      : label === "Today"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
        : "border-border text-muted-foreground";
  const text = label === "Overdue" || label === "Today" || label === "Tomorrow" ? label : `next ${label}`;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", tone)}>
      <CalendarClock className="h-3 w-3" />
      {text}
    </span>
  );
}

function DealCard({
  deal,
  onOpen,
  onMove,
}: {
  deal: Deal;
  onOpen: () => void;
  onMove: (id: Id<"potentialDeals">, stage: string) => void;
}) {
  const cityZip = [deal.propCity, deal.propZip].filter(Boolean).join(" ");
  return (
    <div
      onClick={onOpen}
      className="cursor-pointer rounded-lg border border-border/70 bg-background p-2.5 transition-colors hover:border-teal/40"
    >
      <div className="flex items-baseline justify-between gap-2">
        {deal.score != null ? (
          <span className={cn("text-base font-bold", scoreColor(deal.score))}>{deal.score}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{STAGE_LABELS[deal.stage]}</span>
        )}
        <NextActionBadge at={deal.nextFollowUpAt} />
      </div>
      <div className="mt-0.5 truncate text-sm font-medium text-foreground" title={deal.address}>
        {deal.address || "—"}
      </div>
      {cityZip && <div className="truncate text-xs text-muted-foreground">{cityZip}</div>}
      {deal.value != null && (
        <div className="text-xs text-muted-foreground">
          {fmtMoney(deal.value)}
          {deal.equity != null ? ` · ${fmtMoney(deal.equity)} eq` : ""}
        </div>
      )}
      {(deal.contactName || deal.contactPhone) && (
        <div className="mt-1 truncate text-xs text-foreground">
          {deal.contactName}
          {deal.contactName && deal.contactPhone ? " · " : ""}
          {deal.contactPhone}
        </div>
      )}
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Select value={deal.stage} onValueChange={(v) => onMove(deal._id, v)}>
          <SelectTrigger className="h-7 w-full border-border text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POTENTIAL_STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function Board({
  deals,
  onOpen,
  onMove,
}: {
  deals: Deal[];
  onOpen: (id: Id<"potentialDeals">) => void;
  onMove: (id: Id<"potentialDeals">, stage: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {POTENTIAL_STAGES.map((s) => {
        const col = deals.filter((d) => d.stage === s);
        return (
          <div key={s} className="w-64 shrink-0 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", STAGE_COLORS[s])}>
                {STAGE_LABELS[s]}
              </span>
              <span className="text-xs text-muted-foreground">{col.length}</span>
            </div>
            <div className="min-h-24 space-y-2 p-2">
              {col.length === 0 ? (
                <div className="px-1 py-6 text-center text-xs text-muted-foreground">No deals</div>
              ) : (
                col.map((d) => <DealCard key={d._id} deal={d} onOpen={() => onOpen(d._id)} onMove={onMove} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {POTENTIAL_STAGES.map((s) => (
        <div key={s} className="w-64 shrink-0 rounded-xl border border-border bg-card">
          <div className="border-b border-border px-3 py-2">
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="space-y-2 p-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One logged touch in the activity log. */
function ActivityRow({ activity, onDelete }: { activity: Activity; onDelete: () => void }) {
  const Icon = ACTIVITY_ICON[activity.type as ActivityType] ?? StickyNote;
  return (
    <div className="flex items-start gap-2 border-b border-border/50 py-2 last:border-0">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-muted/40 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="grow">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium text-foreground">{ACTIVITY_LABELS[activity.type as ActivityType] ?? activity.type}</span>
          {activity.outcome && <span className="text-teal-glow">{activity.outcome}</span>}
          <span className="text-xs text-muted-foreground">{fmtDate(activity.occurredAt)}</span>
        </div>
        {activity.note && <div className="text-sm text-muted-foreground">{activity.note}</div>}
        {activity.createdByEmail && <div className="text-[10px] text-muted-foreground">{activity.createdByEmail}</div>}
      </div>
      <button
        onClick={onDelete}
        aria-label="Delete activity"
        className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The "log a touch" form. */
function LogTouchForm({ dealId }: { dealId: Id<"potentialDeals"> }) {
  const add = useMutation(api.potentialData.addActivity);
  const [type, setType] = useState<ActivityType>("call");
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await add({
        dealId,
        type,
        ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(date ? { occurredAt: Date.parse(`${date}T12:00:00`) } : {}),
      });
      setOutcome("");
      setNote("");
    } catch (e) {
      setErr(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap gap-1.5">
        {ACTIVITY_TYPES.map((t) => {
          const Icon = ACTIVITY_ICON[t];
          return (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                type === t
                  ? "border-teal/40 bg-teal/10 text-teal-glow"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {ACTIVITY_LABELS[t]}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {OUTCOME_SUGGESTIONS.map((o) => (
          <button
            key={o}
            onClick={() => setOutcome(o)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs transition-colors",
              outcome === o
                ? "border-teal/40 bg-teal/10 text-teal-glow"
                : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            {o}
          </button>
        ))}
      </div>
      <input
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        placeholder="Outcome (free text)"
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note — what was said, next step…"
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
      />
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-teal/40 px-2.5 text-sm text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Log touch
        </button>
      </div>
      {err && <div className="text-xs text-amber-400">{err}</div>}
    </div>
  );
}

/** Deal detail drawer body: snapshot facts, editable contact/notes, next action, activity log, delete. */
function DealDetail({ dealId, onClose }: { dealId: Id<"potentialDeals">; onClose: () => void }) {
  const deal = useQuery(api.potentialData.getDeal, { id: dealId });
  const activities = useQuery(api.potentialData.activitiesForDeal, { dealId });
  const update = useMutation(api.potentialData.updateDeal);
  const setNext = useMutation(api.potentialData.setNextFollowUp);
  const setStage = useMutation(api.potentialData.setDealStage);
  const del = useMutation(api.potentialData.deleteDeal);
  const delActivity = useMutation(api.potentialData.deleteActivity);

  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [contactErr, setContactErr] = useState<string | null>(null);

  const [nextDate, setNextDate] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Seed editable inputs once when the deal first loads (keyed on id so reactive
  // updates don't clobber an in-progress edit; switching deals re-seeds).
  useEffect(() => {
    if (!deal) return;
    setContactName(deal.contactName ?? "");
    setContactPhone(deal.contactPhone ?? "");
    setContactEmail(deal.contactEmail ?? "");
    setNotes(deal.notes ?? "");
    setNextNote(deal.nextFollowUpNote ?? "");
    setNextDate(deal.nextFollowUpAt ? new Date(deal.nextFollowUpAt).toISOString().slice(0, 10) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?._id]);

  if (deal === undefined) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (deal === null) {
    return <div className="p-4 text-sm text-muted-foreground">This deal no longer exists.</div>;
  }

  const dirty =
    contactName !== (deal.contactName ?? "") ||
    contactPhone !== (deal.contactPhone ?? "") ||
    contactEmail !== (deal.contactEmail ?? "") ||
    notes !== (deal.notes ?? "");

  const saveContact = async () => {
    setSavingContact(true);
    setContactErr(null);
    try {
      await update({
        id: dealId,
        patch: { contactName, contactPhone, contactEmail, notes },
      });
    } catch (e) {
      setContactErr(describeError(e).message);
    } finally {
      setSavingContact(false);
    }
  };

  const saveNext = async () => {
    await setNext({
      id: dealId,
      ...(nextDate ? { at: Date.parse(`${nextDate}T12:00:00`) } : {}),
      ...(nextNote.trim() ? { note: nextNote.trim() } : {}),
    });
  };

  const clearNext = async () => {
    setNextDate("");
    setNextNote("");
    await setNext({ id: dealId });
  };

  const topSignals = deal.topSignals ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-4 pr-12">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-teal-glow" />
          <h2 className="text-base font-bold text-foreground">{deal.address}</h2>
        </div>
        {[deal.propCity, deal.propZip].filter(Boolean).length > 0 && (
          <p className="text-sm text-muted-foreground">{[deal.propCity, deal.propZip].filter(Boolean).join(" ")}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={deal.stage} onValueChange={(v) => { if (isPotentialStage(v)) void setStage({ id: dealId, stage: v }); }}>
            <SelectTrigger className={cn("h-7 w-40 border text-xs", STAGE_COLORS[deal.stage])}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POTENTIAL_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <a
            href={zillowUrl(deal.address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Zillow
          </a>
          <a
            href={mapsUrl(deal.address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <MapPin className="h-3.5 w-3.5" /> Map
          </a>
        </div>
      </div>

      <div className="grow space-y-5 overflow-y-auto p-4">
        {/* Snapshot facts (read-only) */}
        <div className="space-y-1 rounded-lg border border-border bg-background p-3 text-sm">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Snapshot</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {deal.ownerName && (
              <span className="text-muted-foreground">
                Owner: <span className="text-foreground">{deal.ownerName}</span>
              </span>
            )}
            {deal.score != null && (
              <span className="text-muted-foreground">
                Score: <span className={cn("font-bold", scoreColor(deal.score))}>{deal.score}</span>
              </span>
            )}
            {deal.value != null && (
              <span className="text-muted-foreground">
                Value: <span className="text-foreground">{fmtMoney(deal.value)}</span>
              </span>
            )}
            {deal.equity != null && (
              <span className="text-muted-foreground">
                Equity: <span className="text-foreground">{fmtMoney(deal.equity)}</span>
              </span>
            )}
            {(deal.beds || deal.baths || deal.sqft != null) && (
              <span className="text-muted-foreground">
                Size:{" "}
                <span className="text-foreground">
                  {[deal.beds ? `${deal.beds} bd` : null, deal.baths ? `${deal.baths} ba` : null, deal.sqft != null ? `${deal.sqft} sf` : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </span>
              </span>
            )}
          </div>
          {topSignals.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {topSignals.map((s) => (
                <span key={s} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {s}
                </span>
              ))}
            </div>
          )}
          <div className="pt-1 text-[10px] text-muted-foreground">
            From {deal.source.kind} · added {fmtDate(deal.createdAt)}
            {deal.createdByEmail ? ` by ${deal.createdByEmail}` : ""}
          </div>
        </div>

        {/* Contact + notes (editable) */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Contact</div>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Contact name"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <div className="flex gap-2">
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Phone"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
            />
            <input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Email"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes — owner situation, motivation, terms discussed…"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <button
            onClick={saveContact}
            disabled={savingContact || !dirty}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-teal/40 px-3 text-sm text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          {contactErr && <div className="text-xs text-amber-400">{contactErr}</div>}
        </div>

        {/* Next action */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            Next action
            {deal.nextFollowUpAt && <NextActionBadge at={deal.nextFollowUpAt} />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-teal"
            />
            <input
              value={nextNote}
              onChange={(e) => setNextNote(e.target.value)}
              placeholder="What to do next"
              className="h-9 grow rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
            />
            <button
              onClick={saveNext}
              disabled={!nextDate}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-teal/40 px-3 text-sm text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" /> Set
            </button>
            {deal.nextFollowUpAt && (
              <button
                onClick={clearNext}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
          {deal.nextFollowUpNote && <div className="text-xs text-muted-foreground">{deal.nextFollowUpNote}</div>}
        </div>

        {/* Activity log */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Activity log</div>
          <LogTouchForm dealId={dealId} />
          {activities === undefined ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : activities.length === 0 ? (
            <div className="text-sm text-muted-foreground">No touches logged yet.</div>
          ) : (
            <div>
              {activities.map((a) => (
                <ActivityRow key={a._id} activity={a} onDelete={() => void delActivity({ id: a._id })} />
              ))}
            </div>
          )}
        </div>

        {/* Delete */}
        <div className="border-t border-border pt-3">
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" /> Delete deal
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this deal?"
        description="This removes the deal and its activity log from the Potential pipeline. The source lead / sheriff / legal record is untouched."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await del({ id: dealId });
          onClose();
        }}
      />
    </div>
  );
}

/**
 * "Move to Potential" button (shared by /leads, Sheriff, Legal). Shows "In
 * Pipeline" + a link when the house was already promoted (dealByDedupeKey).
 */
export type PromoteArgs = {
  source: { kind: "lead" | "sheriff" | "legal" | "manual"; refId?: string };
  prclid?: string;
  address: string;
  ownerName?: string;
  propCity?: string;
  propZip?: string;
  beds?: string;
  baths?: string;
  sqft?: number;
  value?: number;
  equity?: number;
  score?: number;
  topSignals?: string[];
};

export function MoveToPotentialButton({ args, className }: { args: PromoteArgs; className?: string }) {
  const dedupeKey = dealDedupeKey({ prclid: args.prclid, address: args.address });
  const existing = useQuery(api.potentialData.dealByDedupeKey, { dedupeKey });
  const promote = useMutation(api.potentialData.promoteToPotential);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!dedupeKey) return <span className="text-xs text-muted-foreground">—</span>;

  if (existing) {
    return (
      <Link
        to="/potential"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400",
          className,
        )}
      >
        <ClipboardCheck className="h-3.5 w-3.5" /> In Pipeline
      </Link>
    );
  }

  const onClick = async () => {
    setBusy(true);
    setErr(null);
    try {
      await promote(args);
    } catch (e) {
      setErr(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={onClick}
        disabled={busy || existing === undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-teal/40 px-2.5 py-1 text-xs font-medium text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40",
          className,
        )}
      >
        <ClipboardPlus className="h-3.5 w-3.5" /> {busy ? "Adding…" : "Move to Potential"}
      </button>
      {err && <span className="text-[10px] text-amber-400">{err}</span>}
    </div>
  );
}

export function PotentialPage() {
  const deals = useQuery(api.potentialData.listDeals);
  const setStage = useMutation(api.potentialData.setDealStage);
  const [selectedId, setSelectedId] = useState<Id<"potentialDeals"> | null>(null);

  const onMove = (id: Id<"potentialDeals">, stage: string) => {
    if (isPotentialStage(stage)) void setStage({ id, stage });
  };

  return (
    <div>
      <div className="border-b border-border bg-background px-6 py-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <ClipboardList className="h-5 w-5 text-teal-glow" /> Potential
        </h1>
        <p className="text-sm text-muted-foreground">
          The deals you're actively working — promoted by hand from Leads, Sheriff Sales, or Legal Notices. Log
          every touch and set the next follow-up.
        </p>
      </div>

      <div className="space-y-5 p-6">
        {deals === undefined ? (
          <BoardSkeleton />
        ) : deals.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No deals in the pipeline yet. Open a lead, sheriff sale, or legal notice and click{" "}
            <span className="text-teal-glow">Move to Potential</span>.
          </div>
        ) : (
          <Board deals={deals} onOpen={setSelectedId} onMove={onMove} />
        )}
      </div>

      <Sheet open={!!selectedId} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
          {selectedId && (
            <>
              <SheetTitle className="sr-only">Deal detail</SheetTitle>
              <SheetDescription className="sr-only">
                Snapshot facts, contact, next action, and the activity log for this deal.
              </SheetDescription>
              <DealDetail dealId={selectedId} onClose={() => setSelectedId(null)} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
