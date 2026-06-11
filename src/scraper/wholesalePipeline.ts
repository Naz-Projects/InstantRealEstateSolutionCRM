// Wholesaling deal-pipeline stages (acquisition → disposition). The Convex
// `leadStatus.stage` validator mirrors this list — keep them in sync.
// Spec: docs/superpowers/specs/2026-06-11-wholesaling-pipeline-crm.md.

export const LEAD_STAGES = [
  "new",
  "contacted",
  "negotiating",
  "under_contract",
  "marketing",
  "assigned",
  "closed",
  "dead",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  negotiating: "Negotiating",
  under_contract: "Under contract",
  marketing: "Marketing to buyers",
  assigned: "Assigned",
  closed: "Closed",
  dead: "Dead",
};

export function isLeadStage(s: string): s is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(s);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Follow-up urgency by UTC day: before today = overdue, today = today, after = upcoming. */
export function followUpState(dueAt: number, now: number): "overdue" | "today" | "upcoming" {
  const dueDay = Math.floor(dueAt / DAY_MS);
  const today = Math.floor(now / DAY_MS);
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  return "upcoming";
}
