import { useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import { Target, CalendarClock } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LEAD_STAGES, STAGE_LABELS } from "../scraper/wholesalePipeline";
import { cn } from "@/lib/utils";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Wholesaling funnel at a glance: worked leads by stage, fees, follow-up urgency. */
export function FunnelWidget() {
  const stats = useQuery(api.pipelineData.funnelStats);
  if (!stats) return null;
  const worked = Object.values(stats.byStage).reduce((a, b) => a + b, 0);
  if (worked === 0 && stats.openFollowUps === 0) return null; // nothing staged yet — stay quiet

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-4 w-4 text-teal-glow" /> Wholesaling funnel
        </CardTitle>
        <CardDescription>
          Worked leads by stage —{" "}
          <Link className="text-teal-glow underline-offset-2 hover:underline" to="/leads">
            open the pipeline
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {LEAD_STAGES.map((s) => {
          const n = stats.byStage[s] ?? 0;
          if (n === 0) return null;
          return (
            <div key={s} className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-foreground">{n}</span>
              <span className="text-xs text-muted-foreground">{STAGE_LABELS[s]}</span>
            </div>
          );
        })}
        {stats.pipelineFees > 0 && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-teal-glow">{money(stats.pipelineFees)}</span>
            <span className="text-xs text-muted-foreground">fees in pipeline</span>
          </div>
        )}
        {stats.closedFees > 0 && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-emerald-400">{money(stats.closedFees)}</span>
            <span className="text-xs text-muted-foreground">closed fees</span>
          </div>
        )}
        {(stats.overdue > 0 || stats.dueToday > 0) && (
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
              stats.overdue > 0
                ? "border-red-500/40 bg-red-500/10 text-red-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400",
            )}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            {stats.overdue > 0 && `${stats.overdue} overdue`}
            {stats.overdue > 0 && stats.dueToday > 0 && " · "}
            {stats.dueToday > 0 && `${stats.dueToday} due today`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
