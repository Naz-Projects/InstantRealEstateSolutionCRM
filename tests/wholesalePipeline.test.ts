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

describe("followUpState", () => {
  it("classifies by UTC day: overdue / today / upcoming", async () => {
    const { followUpState } = await import("../src/scraper/wholesalePipeline");
    const now = Date.UTC(2026, 5, 11, 15, 0, 0);
    expect(followUpState(Date.UTC(2026, 5, 10, 23, 59), now)).toBe("overdue");
    expect(followUpState(Date.UTC(2026, 5, 11, 0, 0), now)).toBe("today");
    expect(followUpState(Date.UTC(2026, 5, 11, 23, 0), now)).toBe("today");
    expect(followUpState(Date.UTC(2026, 5, 12, 1, 0), now)).toBe("upcoming");
  });
});
