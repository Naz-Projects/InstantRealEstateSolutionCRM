// Shared deal-pipeline stages — used by the table (pages.tsx) and the map
// (PropertyMap.tsx). Kept in its own module to avoid a circular import.
export const DEAL_STAGES = ["new", "reviewing", "contacted", "offer", "dead"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const STAGE_LABEL: Record<DealStage, string> = {
  new: "New",
  reviewing: "Reviewing",
  contacted: "Contacted",
  offer: "Offer",
  dead: "Dead",
};
