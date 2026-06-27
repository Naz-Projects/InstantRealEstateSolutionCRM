// Pure logic for the "Potential" curated deals pipeline — the board of houses the
// team is actively working (door-knocking / cold-calling), promoted by hand from
// Leads / Sheriff / Legal. Runtime-agnostic + unit-tested; imported by BOTH the
// Convex data layer (dedupe key) and the React board (stages / labels / colors)
// so the de-dup and stage config are identical on both sides.
// Spec: docs/superpowers/specs/2026-06-26-potential-deals-pipeline-design.md.

// Minimal curated-deal stages (acquisition → close/dead). The Convex
// `potentialDeals.stage` validator mirrors this list — keep them in sync.
export const POTENTIAL_STAGES = [
  "to_work",
  "contacted",
  "negotiating",
  "under_contract",
  "closed",
  "dead",
] as const;

export type PotentialStage = (typeof POTENTIAL_STAGES)[number];

export const STAGE_LABELS: Record<PotentialStage, string> = {
  to_work: "To work",
  contacted: "Contacted",
  negotiating: "Negotiating",
  under_contract: "Under contract",
  closed: "Closed",
  dead: "Dead",
};

// Tailwind chip classes per stage — mirrors the /leads board STAGE_CHIP palette so
// the two pipelines read consistently in the dark theme.
export const STAGE_COLORS: Record<PotentialStage, string> = {
  to_work: "border-border text-muted-foreground",
  contacted: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  negotiating: "border-teal/40 bg-teal/10 text-teal-glow",
  under_contract: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  closed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  dead: "border-border bg-muted/40 text-muted-foreground line-through",
};

export function isPotentialStage(s: string): s is PotentialStage {
  return (POTENTIAL_STAGES as readonly string[]).includes(s);
}

/**
 * Normalize an address for de-duplication: uppercase, strip punctuation, collapse
 * whitespace. So "123 Main St., Wilmington, DE" and "123 MAIN ST WILMINGTON DE"
 * resolve to the same key. (A lighter cousin of address.ts cleanAddress, which is
 * tuned for Zillow search rather than equality.)
 */
export function normalizeAddress(address: string): string {
  return (address ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The upsert key for a worked deal: the prclid (trimmed) when we have one,
 * otherwise the normalized address. Two promotions of the same house collapse to
 * one row. Blank prclid AND blank address → "".
 */
export function dealDedupeKey({ prclid, address }: { prclid?: string; address: string }): string {
  const p = (prclid ?? "").trim();
  if (p) return p;
  return normalizeAddress(address ?? "");
}

// The touch kinds logged per deal. The Convex `dealActivities.type` validator
// mirrors this list — keep them in sync.
export const ACTIVITY_TYPES = ["call", "door_knock", "text", "email", "note"] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: "Call",
  door_knock: "Door knock",
  text: "Text",
  email: "Email",
  note: "Note",
};

export function isActivityType(s: string): s is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(s);
}

// Quick outcome chips for a logged touch — free text is still allowed.
export const OUTCOME_SUGGESTIONS = [
  "No answer",
  "Left voicemail",
  "Spoke — interested",
  "Not interested",
  "Callback requested",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Relative human label for a next-action due time, classified by UTC day:
 * past day = "Overdue", same day = "Today", +1 = "Tomorrow", else a short date.
 * Drives the card "next:" line + the overdue/today badge.
 */
export function nextActionLabel(at: number, now: number): string {
  const dueDay = Math.floor(at / DAY_MS);
  const today = Math.floor(now / DAY_MS);
  const diff = dueDay - today;
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Google Street View Static API image URL for a card thumbnail. Pure (takes the
 * key as a param) — the component passes import.meta.env.VITE_GOOGLE_MAPS_API_KEY.
 * The static API geocodes the address, so no coords are needed. Default size fits
 * the board card; pass a larger size for the drawer.
 */
export function streetViewStaticUrl({
  location,
  key,
  size,
}: {
  location: string;
  key: string;
  size?: string;
}): string {
  return `https://maps.googleapis.com/maps/api/streetview?size=${size ?? "320x140"}&location=${encodeURIComponent(location)}&key=${key}`;
}

/**
 * A "open Street View" deep link. With finite coords, a panorama link at that
 * exact point; otherwise a Maps search by address (Google drops you on the
 * nearest panorama).
 */
export function streetViewLink({
  lat,
  lng,
  address,
}: {
  lat?: number | null;
  lng?: number | null;
  address: string;
}): string {
  if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
    return `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * Tailwind chip classes for a sheriff-cushion tier (from deal.ts: good/ok/thin/
 * verify/bad/unknown). Mirrors the dark-theme palette used elsewhere.
 */
export function cushionTierColor(tier: string): string {
  switch (tier) {
    case "good":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "ok":
      return "border-teal/40 bg-teal/10 text-teal-glow";
    case "thin":
    case "verify":
      return "border-amber-500/40 bg-amber-500/10 text-amber-400";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}
