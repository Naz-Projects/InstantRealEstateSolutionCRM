import { describe, it, expect } from "vitest";
import { LEAD_STAGES, STAGE_LABELS, isLeadStage } from "../src/scraper/wholesalePipeline";

describe("wholesaling pipeline stages", () => {
  it("runs the full acquisition→disposition order", () => {
    expect(LEAD_STAGES).toEqual([
      "new",
      "contacted",
      "negotiating",
      "under_contract",
      "marketing",
      "assigned",
      "closed",
      "dead",
    ]);
  });

  it("has a human label for every stage", () => {
    for (const s of LEAD_STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy();
    }
  });

  it("guards stage strings", () => {
    expect(isLeadStage("marketing")).toBe(true);
    expect(isLeadStage("bogus")).toBe(false);
  });
});
