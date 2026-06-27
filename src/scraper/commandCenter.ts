// Pure helpers for the dashboard Command Center (frontend-only batch).
// Day-based comparisons mirror funnelStats / wholesalePipeline.followUpState:
// floor(ms / DAY) buckets a timestamp to its UTC calendar day, so urgency is
// computed by whole-day deltas (not raw hour differences). Imported by the
// command-center + LeadsPage components; unit-tested in tests/commandCenter.test.ts.

const DAY = 24 * 60 * 60 * 1000;

const dayDelta = (when: number, now: number): number =>
  Math.floor(when / DAY) - Math.floor(now / DAY);

export interface BucketableFollowUp {
  dueAt: number;
  done: boolean;
}

/**
 * Split open follow-ups by due-date urgency (whole-day deltas):
 *  - overdue: due before today
 *  - today:   due today
 *  - thisWeek: due in the next 1..7 days (day 8+ is excluded — too far to be "this week")
 * Done follow-ups are excluded from all buckets. Input order is preserved.
 */
export function bucketFollowUps<T extends BucketableFollowUp>(
  followUps: T[],
  now: number,
): { overdue: T[]; today: T[]; thisWeek: T[] } {
  const overdue: T[] = [];
  const today: T[] = [];
  const thisWeek: T[] = [];
  for (const f of followUps) {
    if (f.done) continue;
    const d = dayDelta(f.dueAt, now);
    if (d < 0) overdue.push(f);
    else if (d === 0) today.push(f);
    else if (d <= 7) thisWeek.push(f);
  }
  return { overdue, today, thisWeek };
}

export interface DatedSignal {
  observedDate: number;
}

/** True when the lead's NEWEST signal was observed within the last 7 days. */
export function isNewThisWeek(lead: { signals: DatedSignal[] }, now: number): boolean {
  if (lead.signals.length === 0) return false;
  const newest = Math.max(...lead.signals.map((s) => s.observedDate));
  return newest >= now - 7 * DAY;
}

export interface FitBuyer {
  active: boolean;
  targetAreas?: string | null;
  maxPrice?: number | null;
}
export interface FitLead {
  propCity?: string | null;
  propZip?: string | null;
  value?: number | null;
}

/**
 * Does this buyer fit this lead? (disposition match heuristic, G6)
 *  - buyer is active, AND
 *  - no target areas OR the target-areas text contains the lead city or zip
 *    (case-insensitive substring), AND
 *  - no max price OR the lead value is unknown OR maxPrice >= value.
 */
export function buyerFitsLead(buyer: FitBuyer, lead: FitLead): boolean {
  if (!buyer.active) return false;

  const areas = (buyer.targetAreas ?? "").trim().toLowerCase();
  const city = (lead.propCity ?? "").trim().toLowerCase();
  const zip = (lead.propZip ?? "").trim().toLowerCase();
  const areaOk =
    areas === "" ||
    (city !== "" && areas.includes(city)) ||
    (zip !== "" && areas.includes(zip));
  if (!areaOk) return false;

  const priceOk =
    buyer.maxPrice == null || lead.value == null || buyer.maxPrice >= lead.value;
  return priceOk;
}

/** Human-friendly due label: "2 days overdue" / "today" / "in 3 days" (whole-day deltas). */
export function relativeDueLabel(dueAt: number, now: number): string {
  const d = dayDelta(dueAt, now);
  if (d === 0) return "today";
  if (d < 0) {
    const n = -d;
    return `${n} day${n === 1 ? "" : "s"} overdue`;
  }
  return `in ${d} day${d === 1 ? "" : "s"}`;
}
