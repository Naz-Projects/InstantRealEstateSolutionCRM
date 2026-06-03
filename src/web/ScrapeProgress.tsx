import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  Stepper,
  StepperItem,
  StepperNav,
  StepperTrigger,
  StepperIndicator,
  StepperTitle,
} from "@/components/ui/stepper";

type ScrapeType = "sheriff" | "legal";

// The scraper's real pipeline phases, personalized per source. `etaSec` is used
// only to *animate* the bar within a step so it always looks alive; the active
// step is still driven by the real backend phase. The "enrich" step uses real
// processed/total counts instead of a time guess.
type StepDef = { key: string; title: string; etaSec: number; countBased?: boolean };
const STEPS: Record<ScrapeType, StepDef[]> = {
  sheriff: [
    { key: "fetch", title: "Fetch county PDF", etaSec: 15 },
    { key: "parse", title: "Parse listings", etaSec: 3 },
    { key: "enrich", title: "Enrich · parcel + Zillow", etaSec: 0, countBased: true },
    { key: "done", title: "Done", etaSec: 0 },
  ],
  legal: [
    { key: "fetch", title: "Fetch county PDF", etaSec: 15 },
    { key: "extract", title: "AI extract estates", etaSec: 20 },
    { key: "enrich", title: "Enrich · Zillow", etaSec: 0, countBased: true },
    { key: "done", title: "Done", etaSec: 0 },
  ],
};

const LEVEL_CLASS: Record<string, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-400",
  error: "text-red-400",
};

// Smooth, self-animating fill for the active step. Time-based steps ease toward
// ~92% (never "done" until the real phase advances); the enrich step shows the
// true processed/total fraction.
function useActiveFill(phaseKey: string, etaSec: number, countFraction: number | null) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (countFraction !== null || etaSec <= 0) return;
    setT(0);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setT(Math.min(0.92, 1 - Math.exp(-elapsed / (etaSec / 2))));
    }, 120);
    return () => clearInterval(id);
  }, [phaseKey, etaSec, countFraction]);
  return countFraction !== null ? countFraction : t;
}

export function ScrapeProgress({ type }: { type: ScrapeType }) {
  const run = useQuery(api.runs.latestRun, { type });
  const events = useQuery(api.runs.listEvents, run ? { runId: run._id } : "skip");
  const logRef = useRef<HTMLDivElement>(null);
  const [logsOpen, setLogsOpen] = useState(false);

  // Auto-scroll the log to the newest event (also when first opened).
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events?.length, logsOpen]);

  const steps = STEPS[type];
  const running = run?.status === "running";
  const errored = run?.status === "failed";
  const complete = run?.status === "complete";

  // Which step is active (1-based to match StepperItem.step).
  const phaseKey = run?.phase ?? "starting";
  const phaseIdx = steps.findIndex((s) => s.key === phaseKey);
  const activeStep = complete
    ? steps.length + 1 // mark every step completed
    : phaseIdx >= 0
      ? phaseIdx + 1
      : 1; // "starting" / unknown -> first step
  const failedStepNumber = activeStep;

  const processed = (run?.enrichedCount ?? 0) + (run?.failedCount ?? 0);
  const total = run?.listingCount ?? 0;
  const activeDef = steps[activeStep - 1];
  const countFraction =
    running && activeDef?.countBased ? (total > 0 ? processed / total : 0) : null;
  const fill = useActiveFill(phaseKey, activeDef?.etaSec ?? 0, countFraction);
  const latestMsg = events && events.length > 0 ? events[events.length - 1].message : null;

  if (run === undefined) return null; // loading
  if (run === null) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        No scrape has run yet. Click the scrape button above to start — you'll see live progress here.
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">
          {running ? "Scraping in progress" : complete ? "Last scrape complete" : "Last scrape failed"}
          {run.label ? <span className="ml-2 font-normal text-muted-foreground">· {run.label}</span> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {total > 0 && (
            <>
              <span className="font-medium text-foreground">{run.enrichedCount}</span> enriched
              {(run.failedCount ?? 0) > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-red-400">{run.failedCount}</span> failed
                </>
              )}
              {" / "}
              {total}
            </>
          )}
        </div>
      </div>

      <Stepper value={activeStep} orientation="horizontal">
        <StepperNav className="gap-3">
          {steps.map((s, i) => {
            const stepNum = i + 1;
            const isErrorStep = errored && stepNum === failedStepNumber;
            return (
              <StepperItem
                key={s.key}
                step={stepNum}
                loading={running && stepNum === activeStep && !s.countBased}
                className="relative flex-1 items-start"
              >
                <StepperTrigger className="w-full flex-col items-start gap-1.5" tabIndex={-1}>
                  <StepperIndicator
                    className={cn(
                      "h-1.5 w-full rounded-full bg-border",
                      "data-[state=active]:bg-primary data-[state=completed]:bg-primary data-[state=active]:animate-pulse",
                      isErrorStep && "bg-destructive data-[state=active]:bg-destructive data-[state=active]:animate-none",
                    )}
                  />
                  <StepperTitle
                    className={cn(
                      "text-xs font-medium text-foreground",
                      stepNum > activeStep && "text-muted-foreground",
                      isErrorStep && "text-destructive",
                    )}
                  >
                    {s.title}
                  </StepperTitle>
                  {s.etaSec > 0 && (
                    <span className="text-[10px] text-muted-foreground">~{s.etaSec}s</span>
                  )}
                  {s.countBased && total > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {processed}/{total}
                    </span>
                  )}
                </StepperTrigger>
              </StepperItem>
            );
          })}
        </StepperNav>
      </Stepper>

      {/* Active-step detail: smooth determinate sub-bar + current activity. */}
      {running && (
        <div className="mt-4">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${Math.round(fill * 100)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="truncate">{latestMsg ?? "Working…"}</span>
          </div>
        </div>
      )}

      {errored && run.error && (
        <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{run.error}</div>
      )}

      {/* Live step-by-step event log — collapsed by default behind a toggle. */}
      {events && events.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setLogsOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition", logsOpen && "rotate-180")} />
            {logsOpen ? "Hide logs" : `Show logs (${events.length})`}
          </button>
          {logsOpen && (
            <div
              ref={logRef}
              className="mt-2 max-h-44 overflow-y-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed"
            >
              {events.map((e) => (
                <div key={e._id} className={cn("whitespace-pre-wrap", LEVEL_CLASS[e.level] ?? "text-muted-foreground")}>
                  {e.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
