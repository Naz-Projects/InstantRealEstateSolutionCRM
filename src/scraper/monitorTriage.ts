// Per-user /monitor triage rules (pure; shared by convex/monitorData.ts and the page).
// States are mutually exclusive: new | shortlisted | passed(reason) | snoozed(7 days).

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// Keep in sync with the passReason union in convex/schema.ts + monitorData.setTriage.
export const PASS_REASONS = [
  { value: "bad_area", label: "Bad area" },
  { value: "arv_wrong", label: "ARV is wrong" },
  { value: "rehab_heavy", label: "Rehab too heavy" },
  { value: "overpriced", label: "Overpriced" },
  { value: "other", label: "Other" },
] as const;
export type PassReason = (typeof PASS_REASONS)[number]["value"];
export function passReasonLabel(r: PassReason | null | undefined): string {
  return PASS_REASONS.find((x) => x.value === r)?.label ?? "Passed";
}

export interface TriageState { passedAt?: number; passReason?: PassReason; shortlistedAt?: number; snoozedUntil?: number }
export type TriageAction =
  | { kind: "shortlist" } | { kind: "unshortlist" } | { kind: "pass"; reason: PassReason }
  | { kind: "snooze" } | { kind: "restore" };

// The full new state (only defined keys). The mutation writes every field, so keys
// absent here are cleared on the stored row.
export function applyTriage(a: TriageAction, now: number): TriageState {
  switch (a.kind) {
    case "shortlist": return { shortlistedAt: now };
    case "pass": return { passedAt: now, passReason: a.reason };
    case "snooze": return { snoozedUntil: now + SNOOZE_MS };
    case "unshortlist":
    case "restore": return {};
  }
}

export type TriageStatus = "new" | "shortlist" | "passed" | "snoozed";
export function triageStatus(t: TriageState | null | undefined, now: number): TriageStatus {
  if (t?.passedAt != null) return "passed";
  if (t?.shortlistedAt != null) return "shortlist";
  if (t?.snoozedUntil != null && t.snoozedUntil > now) return "snoozed";
  return "new";
}

// Run-now guard (admin requestScan). A `running` row older than 30 min is a killed
// action (lessons 2026-06-11), so it must not lock the button forever.
export const SCAN_COOLDOWN_MS = 10 * 60 * 1000;
export const STALE_RUNNING_MS = 30 * 60 * 1000;
export function scanBlockedReason(recent: { status: string; startedAt: number } | null, now: number): string | null {
  if (!recent) return null;
  const age = now - recent.startedAt;
  if (recent.status === "running" && age < STALE_RUNNING_MS) return "A scan is already running.";
  if (age < SCAN_COOLDOWN_MS) return "A scan started less than 10 minutes ago.";
  return null;
}
