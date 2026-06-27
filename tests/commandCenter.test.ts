import { describe, it, expect } from "vitest";
import {
  bucketFollowUps,
  isNewThisWeek,
  buyerFitsLead,
  relativeDueLabel,
} from "../src/scraper/commandCenter";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 26, 15, 0, 0); // 2026-06-26 15:00 UTC

describe("bucketFollowUps", () => {
  const fu = (id: string, dueAt: number, done = false) => ({ _id: id, dueAt, done });

  it("splits open follow-ups into overdue / today / thisWeek and excludes far + done", () => {
    const rows = [
      fu("overdue", Date.UTC(2026, 5, 24, 9, 0)), // 2 days ago
      fu("today", Date.UTC(2026, 5, 26, 1, 0)), // same UTC day, earlier
      fu("plus3", NOW + 3 * DAY), // +3 days → thisWeek
      fu("plus10", NOW + 10 * DAY), // +10 days → excluded (beyond 7)
      fu("done", NOW - 5 * DAY, true), // done → excluded
    ];
    const { overdue, today, thisWeek } = bucketFollowUps(rows, NOW);
    expect(overdue.map((r) => r._id)).toEqual(["overdue"]);
    expect(today.map((r) => r._id)).toEqual(["today"]);
    expect(thisWeek.map((r) => r._id)).toEqual(["plus3"]);
  });

  it("includes day 7 in thisWeek and excludes day 8", () => {
    const rows = [fu("d7", NOW + 7 * DAY), fu("d8", NOW + 8 * DAY)];
    const { thisWeek } = bucketFollowUps(rows, NOW);
    expect(thisWeek.map((r) => r._id)).toEqual(["d7"]);
  });

  it("returns empty buckets for no input", () => {
    expect(bucketFollowUps([], NOW)).toEqual({ overdue: [], today: [], thisWeek: [] });
  });
});

describe("isNewThisWeek", () => {
  const lead = (...ages: number[]) => ({
    signals: ages.map((d) => ({ observedDate: NOW - d * DAY })),
  });

  it("is true when the newest signal is within 7 days", () => {
    expect(isNewThisWeek(lead(2, 30), NOW)).toBe(true);
  });

  it("is false when the newest signal is older than 7 days", () => {
    expect(isNewThisWeek(lead(20, 40), NOW)).toBe(false);
  });

  it("is false with no signals", () => {
    expect(isNewThisWeek({ signals: [] }, NOW)).toBe(false);
  });

  it("includes the exact 7-day boundary", () => {
    expect(isNewThisWeek(lead(7), NOW)).toBe(true);
  });
});

describe("buyerFitsLead", () => {
  const lead = (propCity: string, propZip: string, value: number | null) => ({
    propCity,
    propZip,
    value: value ?? undefined,
  });

  it("matches when target areas contain the lead city (case-insensitive)", () => {
    const buyer = { active: true, targetAreas: "Newark, Wilmington", maxPrice: null };
    expect(buyerFitsLead(buyer, lead("NEWARK", "19711", 200000))).toBe(true);
  });

  it("matches on zip", () => {
    const buyer = { active: true, targetAreas: "19711 19702", maxPrice: null };
    expect(buyerFitsLead(buyer, lead("Bear", "19702", 200000))).toBe(true);
  });

  it("misses when target areas exclude the lead area", () => {
    const buyer = { active: true, targetAreas: "Dover", maxPrice: null };
    expect(buyerFitsLead(buyer, lead("Wilmington", "19805", 200000))).toBe(false);
  });

  it("misses when the lead value exceeds maxPrice", () => {
    const buyer = { active: true, targetAreas: null, maxPrice: 150000 };
    expect(buyerFitsLead(buyer, lead("Wilmington", "19805", 200000))).toBe(false);
  });

  it("matches when the lead value is under maxPrice", () => {
    const buyer = { active: true, targetAreas: null, maxPrice: 250000 };
    expect(buyerFitsLead(buyer, lead("Wilmington", "19805", 200000))).toBe(true);
  });

  it("a buyer with no criteria matches any lead", () => {
    const buyer = { active: true, targetAreas: null, maxPrice: null };
    expect(buyerFitsLead(buyer, lead("Wilmington", "19805", 999999))).toBe(true);
  });

  it("an inactive buyer never fits", () => {
    const buyer = { active: false, targetAreas: null, maxPrice: null };
    expect(buyerFitsLead(buyer, lead("Wilmington", "19805", 100000))).toBe(false);
  });

  it("matches on price when the lead value is unknown", () => {
    const buyer = { active: true, targetAreas: null, maxPrice: 100000 };
    expect(buyerFitsLead(buyer, lead("Wilmington", "19805", null))).toBe(true);
  });

  it("does not falsely match an empty lead area against a non-empty target", () => {
    const buyer = { active: true, targetAreas: "Newark", maxPrice: null };
    expect(buyerFitsLead(buyer, lead("", "", 100000))).toBe(false);
  });
});

describe("relativeDueLabel", () => {
  it("labels overdue / today / upcoming with correct pluralization", () => {
    expect(relativeDueLabel(NOW - 2 * DAY, NOW)).toBe("2 days overdue");
    expect(relativeDueLabel(NOW - 1 * DAY, NOW)).toBe("1 day overdue");
    expect(relativeDueLabel(NOW + 1 * 60 * 60 * 1000, NOW)).toBe("today");
    expect(relativeDueLabel(NOW + 3 * DAY, NOW)).toBe("in 3 days");
    expect(relativeDueLabel(NOW + 1 * DAY, NOW)).toBe("in 1 day");
  });
});
