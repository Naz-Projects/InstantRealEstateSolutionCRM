import { describe, it, expect } from "vitest";
import {
  POTENTIAL_STAGES,
  STAGE_LABELS,
  STAGE_COLORS,
  isPotentialStage,
  normalizeAddress,
  dealDedupeKey,
  ACTIVITY_TYPES,
  ACTIVITY_LABELS,
  isActivityType,
  OUTCOME_SUGGESTIONS,
  nextActionLabel,
} from "../src/scraper/potentialPipeline";

describe("potential pipeline stages", () => {
  it("runs the minimal curated-deal order", () => {
    expect(POTENTIAL_STAGES).toEqual([
      "to_work",
      "contacted",
      "negotiating",
      "under_contract",
      "closed",
      "dead",
    ]);
  });

  it("has a human label for every stage", () => {
    for (const s of POTENTIAL_STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy();
    }
  });

  it("has a color/chip class for every stage", () => {
    for (const s of POTENTIAL_STAGES) {
      expect(STAGE_COLORS[s]).toBeTruthy();
    }
  });

  it("guards stage strings", () => {
    expect(isPotentialStage("to_work")).toBe(true);
    expect(isPotentialStage("under_contract")).toBe(true);
    expect(isPotentialStage("marketing")).toBe(false); // a /leads stage, not a potential stage
    expect(isPotentialStage("bogus")).toBe(false);
  });
});

describe("normalizeAddress", () => {
  it("uppercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeAddress("123 Main St., Wilmington, DE 19801")).toBe(
      "123 MAIN ST WILMINGTON DE 19801",
    );
  });

  it("treats casing/punctuation variants as equal", () => {
    expect(normalizeAddress("123  main st")).toBe(normalizeAddress("123 MAIN ST."));
  });

  it("returns empty string for blank", () => {
    expect(normalizeAddress("")).toBe("");
    expect(normalizeAddress("   ")).toBe("");
  });
});

describe("dealDedupeKey", () => {
  it("uses the prclid (trimmed) when present", () => {
    expect(dealDedupeKey({ prclid: "  0801234567  ", address: "123 Main St" })).toBe("0801234567");
  });

  it("prclid wins over the address even when both are present", () => {
    const withPrclid = dealDedupeKey({ prclid: "0801234567", address: "123 Main St" });
    const addressOnly = dealDedupeKey({ address: "123 Main St" });
    expect(withPrclid).toBe("0801234567");
    expect(withPrclid).not.toBe(addressOnly);
  });

  it("falls back to the normalized address when prclid is missing/blank", () => {
    expect(dealDedupeKey({ prclid: "", address: "123 Main St., Newark DE 19711" })).toBe(
      "123 MAIN ST NEWARK DE 19711",
    );
    expect(dealDedupeKey({ prclid: "   ", address: "123 Main St" })).toBe("123 MAIN ST");
  });

  it("same address, different casing/punctuation → same key", () => {
    const a = dealDedupeKey({ address: "123 Main St., Wilmington, DE 19801" });
    const b = dealDedupeKey({ address: "123  MAIN  ST  WILMINGTON DE 19801" });
    expect(a).toBe(b);
  });

  it("blank prclid and blank address → empty string", () => {
    expect(dealDedupeKey({ address: "" })).toBe("");
    expect(dealDedupeKey({ prclid: "", address: "" })).toBe("");
  });
});

describe("activity types", () => {
  it("covers the five touch kinds", () => {
    expect(ACTIVITY_TYPES).toEqual(["call", "door_knock", "text", "email", "note"]);
  });

  it("has a label for every type", () => {
    for (const t of ACTIVITY_TYPES) {
      expect(ACTIVITY_LABELS[t]).toBeTruthy();
    }
  });

  it("guards activity-type strings", () => {
    expect(isActivityType("door_knock")).toBe(true);
    expect(isActivityType("bogus")).toBe(false);
  });

  it("offers a non-empty list of outcome suggestions", () => {
    expect(OUTCOME_SUGGESTIONS.length).toBeGreaterThan(0);
    for (const o of OUTCOME_SUGGESTIONS) expect(o).toBeTruthy();
  });
});

describe("nextActionLabel", () => {
  const now = Date.UTC(2026, 5, 26, 15, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;

  it("labels a past due day as Overdue", () => {
    expect(nextActionLabel(now - DAY, now)).toBe("Overdue");
  });

  it("labels the same UTC day as Today", () => {
    expect(nextActionLabel(Date.UTC(2026, 5, 26, 1, 0), now)).toBe("Today");
  });

  it("labels the next UTC day as Tomorrow", () => {
    expect(nextActionLabel(Date.UTC(2026, 5, 27, 1, 0), now)).toBe("Tomorrow");
  });

  it("labels further-out dates with a short date string (not Overdue/Today/Tomorrow)", () => {
    const label = nextActionLabel(now + 10 * DAY, now);
    expect(label).toBeTruthy();
    expect(["Overdue", "Today", "Tomorrow"]).not.toContain(label);
  });
});
