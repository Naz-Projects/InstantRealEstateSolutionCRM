import { useMemo } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import {
  Flame,
  CalendarClock,
  Sparkles,
  Gavel,
  TriangleAlert,
  CircleHelp,
  Check,
  MapPin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, isLeadStage } from "../scraper/wholesalePipeline";
import { bucketFollowUps, isNewThisWeek, relativeDueLabel } from "../scraper/commandCenter";
import { FunnelWidget } from "@/components/funnel-widget";

type Lead = FunctionReturnType<typeof api.signalData.leads>[number];
type FollowUp = FunctionReturnType<typeof api.pipelineData.openFollowUps>[number];

const DAY = 24 * 60 * 60 * 1000;
const HOT_COUNT = 8;

// Mirrors the score tiers in score-legend.tsx (70+ hot, 40+ warm, <40 cool).
// score-legend doesn't export a color fn, so the thresholds are replicated here.
function scoreColor(score: number): string {
  if (score >= 70) return "text-red-400";
  if (score >= 40) return "text-amber-400";
  return "text-foreground";
}

function humanizeSignal(type: string): string {
  return type
    .replace(/-/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

const SIGNAL_META: Record<string, { label: string; chip: string; Icon: LucideIcon }> = {
  "pre-foreclosure": {
    label: "Pre-foreclosure",
    chip: "border-red-500/40 bg-red-500/10 text-red-400",
    Icon: Gavel,
  },
  "code-violation": {
    label: "Code violation",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    Icon: TriangleAlert,
  },
};
const signalMeta = (type: string) =>
  SIGNAL_META[type] ?? {
    label: humanizeSignal(type),
    chip: "border-border bg-muted/40 text-muted-foreground",
    Icon: CircleHelp,
  };

// Equity bucket → chip color (command-center palette per spec):
// high=emerald, medium=amber, low/unknown=muted. Unknown is hidden entirely.
const EQUITY_CHIP: Record<string, { label: string; chip: string }> = {
  high: { label: "High equity", chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  medium: { label: "Some equity", chip: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  low: { label: "Low equity", chip: "border-border bg-muted/40 text-muted-foreground" },
};

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function SignalChips({ lead }: { lead: Lead }) {
  const types = [...new Set(lead.signals.map((s) => s.type))];
  return (
    <>
      {types.map((t) => {
        const m = signalMeta(t);
        const Icon = m.Icon;
        return (
          <Chip key={t} className={m.chip}>
            <Icon className="h-3 w-3" /> {m.label}
          </Chip>
        );
      })}
    </>
  );
}

/** "Work these now": the top score-sorted leads, each linking to the pipeline. */
function HotLeads({ leads }: { leads: Lead[] }) {
  const hot = leads.slice(0, HOT_COUNT);
  return (
    <Card className="shadow-none lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-red-400" /> Work these now
        </CardTitle>
        <CardDescription>
          Your highest-priority leads —{" "}
          <Link className="text-teal-glow underline-offset-2 hover:underline" to="/leads">
            open the pipeline
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hot.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No scored leads yet — distress signals sync weekly.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {hot.map((l) => (
              <Link
                key={l.prclid}
                to="/leads"
                className="block rounded-lg border border-border/60 bg-background px-3 py-2 transition-colors hover:border-teal/40 hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn("w-9 shrink-0 text-center text-lg font-bold tabular-nums", scoreColor(l.score))}
                  >
                    {l.score}
                  </span>
                  <div className="min-w-0 grow">
                    <div className="truncate text-sm font-medium text-foreground">
                      {l.situsStreet || "—"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[l.propCity, l.propZip].filter(Boolean).join(" ")}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {STAGE_LABELS[isLeadStage(l.stage) ? l.stage : "new"]}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-12">
                  <SignalChips lead={l} />
                  {l.absentee && (
                    <Chip className="border-amber-500/40 bg-amber-500/10 text-amber-400">
                      <MapPin className="h-3 w-3" /> Absentee
                    </Chip>
                  )}
                  {l.equityBucket !== "unknown" && EQUITY_CHIP[l.equityBucket] && (
                    <Chip className={EQUITY_CHIP[l.equityBucket].chip}>
                      {EQUITY_CHIP[l.equityBucket].label}
                    </Chip>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "Needs attention": open follow-ups grouped overdue / today / this week. */
function NeedsAttention({
  followUps,
  leadByPrclid,
}: {
  followUps: FollowUp[];
  leadByPrclid: Map<string, Lead>;
}) {
  const setDone = useMutation(api.pipelineData.setFollowUpDone);
  const now = Date.now();
  const { overdue, today, thisWeek } = useMemo(
    () => bucketFollowUps(followUps, now),
    [followUps, now],
  );
  const empty = overdue.length === 0 && today.length === 0 && thisWeek.length === 0;

  const Row = ({ f }: { f: FollowUp }) => {
    const lead = leadByPrclid.get(f.prclid);
    const label = relativeDueLabel(f.dueAt, now);
    const state =
      Math.floor(f.dueAt / DAY) < Math.floor(now / DAY)
        ? "overdue"
        : Math.floor(f.dueAt / DAY) === Math.floor(now / DAY)
          ? "today"
          : "upcoming";
    return (
      <div className="flex items-start gap-2">
        <button
          onClick={() => setDone({ id: f._id, done: true })}
          aria-label="Mark follow-up done"
          className="mt-0.5 shrink-0 rounded-md border border-border p-1 text-muted-foreground transition-colors hover:border-teal/40 hover:text-teal-glow"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 grow">
          <Link
            to="/leads"
            className="block truncate text-sm font-medium text-foreground hover:text-teal-glow"
          >
            {lead?.situsStreet || `Parcel ${f.prclid.slice(0, 12)}`}
          </Link>
          <div className="truncate text-xs text-muted-foreground">{f.note}</div>
        </div>
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            state === "overdue" && "text-red-400",
            state === "today" && "text-amber-400",
            state === "upcoming" && "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </div>
    );
  };

  const Group = ({ title, rows }: { title: string; rows: FollowUp[] }) =>
    rows.length === 0 ? null : (
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} ({rows.length})
        </div>
        {rows.map((f) => (
          <Row key={f._id} f={f} />
        ))}
      </div>
    );

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-amber-400" /> Needs attention
        </CardTitle>
        <CardDescription>Follow-ups due now and this week</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {empty ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            You&apos;re all caught up — no follow-ups due.
          </div>
        ) : (
          <>
            <Group title="Overdue" rows={overdue} />
            <Group title="Due today" rows={today} />
            <Group title="This week" rows={thisWeek} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "New this week": leads whose newest signal landed in the last 7 days. */
function NewThisWeek({ leads }: { leads: Lead[] }) {
  const now = Date.now();
  const fresh = useMemo(() => leads.filter((l) => isNewThisWeek(l, now)), [leads, now]);
  const freshForeclosures = fresh.filter((l) =>
    l.signals.some((s) => s.type === "pre-foreclosure" && s.observedDate >= now - 7 * DAY),
  );

  const daysAgo = (l: Lead): string => {
    const newest = Math.max(...l.signals.map((s) => s.observedDate));
    const d = Math.floor((now - newest) / DAY);
    return d <= 0 ? "today" : `${d}d ago`;
  };

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-teal-glow" /> New this week
        </CardTitle>
        <CardDescription>
          {fresh.length} lead{fresh.length === 1 ? "" : "s"} with a fresh signal
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {fresh.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No new signals in the last 7 days.
          </div>
        ) : (
          <>
            {freshForeclosures.length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-sm font-medium text-red-400">
                <Gavel className="h-4 w-4 shrink-0" />
                {freshForeclosures.length} new pre-foreclosure
                {freshForeclosures.length === 1 ? "" : "s"} — months of runway
              </div>
            )}
            <div className="flex flex-col gap-2">
              {fresh.slice(0, 6).map((l) => {
                const newestType = [...l.signals].sort((a, b) => b.observedDate - a.observedDate)[0]
                  ?.type;
                const m = signalMeta(newestType ?? "");
                return (
                  <Link
                    key={l.prclid}
                    to="/leads"
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 transition-colors hover:border-teal/40 hover:bg-muted/50"
                  >
                    <div className="min-w-0 grow">
                      <div className="truncate text-sm font-medium text-foreground">
                        {l.situsStreet || "—"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[l.propCity, l.propZip].filter(Boolean).join(" ")}
                      </div>
                    </div>
                    <Chip className={cn("shrink-0", m.chip)}>{m.label}</Chip>
                    <span className="shrink-0 text-xs text-muted-foreground">{daysAgo(l)}</span>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CommandCenterSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Skeleton className="h-80 w-full lg:col-span-2" />
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-64 w-full lg:col-span-2" />
    </div>
  );
}

/**
 * Command Center — the wholesaler's daily cockpit. Reads the scored leads once
 * and derives "what to work today" client-side: hot leads, follow-ups due, fresh
 * signals, plus the pipeline snapshot. Mounted at the top of the dashboard.
 */
export function CommandCenter() {
  const leads = useQuery(api.signalData.leads, { limit: 200 });
  const openFollowUps = useQuery(api.pipelineData.openFollowUps);

  const leadByPrclid = useMemo(
    () => new Map((leads ?? []).map((l) => [l.prclid, l])),
    [leads],
  );

  if (leads === undefined || openFollowUps === undefined) {
    return <CommandCenterSkeleton />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <HotLeads leads={leads} />
      <NeedsAttention followUps={openFollowUps} leadByPrclid={leadByPrclid} />
      <NewThisWeek leads={leads} />
      <div className="lg:col-span-2">
        <FunnelWidget />
      </div>
    </div>
  );
}
