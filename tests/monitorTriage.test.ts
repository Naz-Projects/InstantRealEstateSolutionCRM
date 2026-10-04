import { describe, it, expect } from "vitest";
import {
  SNOOZE_MS, PASS_REASONS, passReasonLabel, applyTriage, triageStatus,
  scanBlockedReason, SCAN_COOLDOWN_MS, STALE_RUNNING_MS,
} from "../src/scraper/monitorTriage";

const NOW = 1_800_000_000_000;

describe("applyTriage", () => {
  it("states are mutually exclusive and carry only their own keys", () => {
    expect(applyTriage({ kind: "shortlist" }, NOW)).toEqual({ shortlistedAt: NOW });
    expect(applyTriage({ kind: "pass", reason: "overpriced" }, NOW)).toEqual({ passedAt: NOW, passReason: "overpriced" });
    expect(applyTriage({ kind: "snooze" }, NOW)).toEqual({ snoozedUntil: NOW + SNOOZE_MS });
    expect(applyTriage({ kind: "unshortlist" }, NOW)).toEqual({});
    expect(applyTriage({ kind: "restore" }, NOW)).toEqual({});
  });
  it("snooze is 7 days", () => {
    expect(SNOOZE_MS).toBe(604_800_000);
  });
});

describe("triageStatus", () => {
  it("no state = new", () => {
    expect(triageStatus(null, NOW)).toBe("new");
    expect(triageStatus({}, NOW)).toBe("new");
  });
  it("passed and shortlisted", () => {
    expect(triageStatus({ passedAt: 1, passReason: "other" }, NOW)).toBe("passed");
    expect(triageStatus({ shortlistedAt: 1 }, NOW)).toBe("shortlist");
  });
  it("an active snooze hides the row; an expired one returns it to new", () => {
    expect(triageStatus({ snoozedUntil: NOW + 1 }, NOW)).toBe("snoozed");
    expect(triageStatus({ snoozedUntil: NOW }, NOW)).toBe("new");
  });
});

describe("PASS_REASONS", () => {
  it("lists the five spec reasons in order with labels", () => {
    expect(PASS_REASONS.map((r) => r.label)).toEqual(["Bad area", "ARV is wrong", "Rehab too heavy", "Overpriced", "Other"]);
    expect(passReasonLabel("rehab_heavy")).toBe("Rehab too heavy");
  });
});

describe("scanBlockedReason", () => {
  it("allows a scan when there is no run or the last run is old and done", () => {
    expect(scanBlockedReason(null, NOW)).toBeNull();
    expect(scanBlockedReason({ status: "complete", startedAt: NOW - SCAN_COOLDOWN_MS - 1 }, NOW)).toBeNull();
  });
  it("blocks while a fresh run is running", () => {
    expect(scanBlockedReason({ status: "running", startedAt: NOW - 15 * 60 * 1000 }, NOW)).toBe("A scan is already running.");
  });
  it("a stale running row (killed action) does not lock the button forever", () => {
    expect(scanBlockedReason({ status: "running", startedAt: NOW - STALE_RUNNING_MS - 1 }, NOW)).toBeNull();
  });
  it("blocks any run that started under 10 minutes ago", () => {
    expect(scanBlockedReason({ status: "complete", startedAt: NOW - 60_000 }, NOW)).toBe("A scan started less than 10 minutes ago.");
  });
});
