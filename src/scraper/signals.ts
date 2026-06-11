// Shared contract for distress-signal events (lead engine Phase 2). Every source
// parser (codeCases, courtConnect, …) emits this shape; the Convex `signalEvents`
// validator mirrors it. See docs/superpowers/specs/2026-06-11-lead-engine-phase2-*.

export type SignalCategory = "financial" | "life-event" | "physical" | "situational";

export interface SignalEventInput {
  prclid: string; // "" when the source row matched no parcel (kept for review)
  category: SignalCategory;
  type: string; // "code-violation" | "pre-foreclosure" | …
  source: string; // provenance, e.g. "ncc-arcgis-codecases"
  externalKey: string; // idempotency key (upsert target)
  observedDate: number; // ms epoch — recency for scoring
  status: string; // source-specific open/closed-ish state
  matchConfidence?: "exact" | "strong" | "weak"; // name-matched sources only
  payload: Record<string, unknown>;
}
