import { describe, it, expect } from "vitest";
import {
  inTab, tabCounts, filterRows, sortRows, zipOptions, isNewSince, newSinceCount,
  clampIndex, nextIndex, sheetStepIndex, boardKeyAction, type BoardRow,
} from "../src/web/lib/monitorBoard";

const NOW = 1_800_000_000_000;
const row = (o: Partial<BoardRow> & { _id: string }): BoardRow => ({ firstSeen: NOW - 1000, ...o });

const A = row({ _id: "a", bestExit: "FLIP", roomVsList: 5000, dealScore: 90, propZip: "19801", firstSeen: NOW - 3000 });
const B = row({ _id: "b", bestExit: "RENTAL", cashFlow: 300, dealScore: 72, propZip: "19805", triage: { shortlistedAt: 1 } });
const C = row({ _id: "c", bestExit: "WHOLESALE", spread: 40000, dealScore: 40, propZip: "19801", triage: { passedAt: 1, passReason: "overpriced" } });
const D = row({ _id: "d", bestExit: "FLIP", roomVsList: -2000, dealScore: 75, propZip: "19711", triage: { snoozedUntil: NOW + 5 } });
const E = row({ _id: "e", bestExit: "RENTAL", cashFlow: 50, dealScore: 72, propZip: "19711", triage: { snoozedUntil: NOW - 5 }, firstSeen: NOW - 10 });
const ALL = [A, B, C, D, E];

describe("tabs", () => {
  it("New = untriaged, excluding active snoozes; expired snooze returns", () => {
    expect(ALL.filter((r) => inTab(r, "new", NOW)).map((r) => r._id)).toEqual(["a", "e"]);
  });
  it("Shortlist / Passed / All", () => {
    expect(ALL.filter((r) => inTab(r, "shortlist", NOW)).map((r) => r._id)).toEqual(["b"]);
    expect(ALL.filter((r) => inTab(r, "passed", NOW)).map((r) => r._id)).toEqual(["c"]);
    expect(ALL.filter((r) => inTab(r, "all", NOW))).toHaveLength(5);
  });
  it("tabCounts", () => {
    expect(tabCounts(ALL, NOW)).toEqual({ new: 2, shortlist: 1, passed: 1, all: 5 });
  });
});

describe("filterRows / zipOptions", () => {
  it("no exits selected = all exits; zip null = all zips", () => {
    expect(filterRows(ALL, { exits: [], zip: null })).toHaveLength(5);
  });
  it("filters by exit set and zip", () => {
    expect(filterRows(ALL, { exits: ["FLIP"], zip: null }).map((r) => r._id)).toEqual(["a", "d"]);
    expect(filterRows(ALL, { exits: ["FLIP", "WHOLESALE"], zip: "19801" }).map((r) => r._id)).toEqual(["a", "c"]);
  });
  it("zipOptions: sorted unique non-empty", () => {
    expect(zipOptions([...ALL, row({ _id: "z", propZip: "" }), row({ _id: "y" })])).toEqual(["19711", "19801", "19805"]);
  });
});

describe("sortRows", () => {
  it("gap: offer gap desc, rows without one last (ties by score, then newest)", () => {
    expect(sortRows(ALL, "gap").map((r) => r._id)).toEqual(["a", "d", "e", "b", "c"]);
  });
  it("cashflow: desc, nulls last (ties by score)", () => {
    expect(sortRows(ALL, "cashflow").map((r) => r._id)).toEqual(["b", "e", "a", "d", "c"]);
  });
  it("score: desc, ties by newest firstSeen", () => {
    expect(sortRows(ALL, "score").map((r) => r._id)).toEqual(["a", "d", "e", "b", "c"]);
  });
  it("newest: firstSeen desc", () => {
    expect(sortRows(ALL, "newest")[0]._id).toBe("e");
  });
  it("does not mutate its input", () => {
    const copy = [...ALL];
    sortRows(ALL, "score");
    expect(ALL).toEqual(copy);
  });
});

describe("new since you looked", () => {
  it("first visit (no lastSeenAt) counts every untriaged row", () => {
    expect(isNewSince(A, null)).toBe(true);
    expect(newSinceCount(ALL, null, NOW)).toBe(2);
  });
  it("only rows first seen after lastSeenAt, and only untriaged ones", () => {
    expect(isNewSince(A, NOW - 2000)).toBe(false);
    expect(newSinceCount(ALL, NOW - 2000, NOW)).toBe(1); // e only (b is shortlisted)
  });
});

describe("selection index", () => {
  it("clampIndex keeps the slot after a row leaves the list", () => {
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(4, 4)).toBe(3);
    expect(clampIndex(0, 0)).toBe(-1);
    expect(clampIndex(-1, 3)).toBe(-1);
  });
  it("nextIndex moves and clamps; first press selects row 0", () => {
    expect(nextIndex(-1, "down", 3)).toBe(0);
    expect(nextIndex(0, "down", 3)).toBe(1);
    expect(nextIndex(2, "down", 3)).toBe(2);
    expect(nextIndex(0, "up", 3)).toBe(0);
    expect(nextIndex(1, "up", 0)).toBe(-1);
  });
  it("sheetStepIndex walks from the open deal while it is still listed", () => {
    expect(sheetStepIndex(1, 0, "down", 4)).toBe(2);
    expect(sheetStepIndex(1, 3, "up", 4)).toBe(0);
    expect(sheetStepIndex(3, 3, "down", 4)).toBe(3);
  });
  it("sheetStepIndex: open deal left the list (P/S/Snooze) - J opens the row that slid into its slot, K the one above", () => {
    expect(sheetStepIndex(-1, 2, "down", 4)).toBe(2);
    expect(sheetStepIndex(-1, 2, "up", 4)).toBe(1);
    expect(sheetStepIndex(-1, 4, "down", 4)).toBe(3); // was the last row: clamp
    expect(sheetStepIndex(-1, 4, "up", 4)).toBe(2);
    expect(sheetStepIndex(-1, 0, "up", 4)).toBe(0);
    expect(sheetStepIndex(-1, -1, "down", 4)).toBe(0); // deep link, no selection
    expect(sheetStepIndex(-1, 2, "down", 0)).toBe(-1); // list now empty
  });
});

describe("boardKeyAction", () => {
  const body = { tagName: "BODY", closest: () => null };
  it("maps J/K/P/S/Enter", () => {
    expect(boardKeyAction({ key: "j", target: body })).toBe("down");
    expect(boardKeyAction({ key: "K", target: body })).toBe("up");
    expect(boardKeyAction({ key: "p", target: body })).toBe("pass");
    expect(boardKeyAction({ key: "s", target: body })).toBe("shortlist");
    expect(boardKeyAction({ key: "Enter", target: body })).toBe("open");
    expect(boardKeyAction({ key: "x", target: body })).toBeNull();
  });
  it("ignores modifier chords (Ctrl+S, Cmd+K)", () => {
    expect(boardKeyAction({ key: "s", ctrlKey: true, target: body })).toBeNull();
    expect(boardKeyAction({ key: "k", metaKey: true, target: body })).toBeNull();
    expect(boardKeyAction({ key: "j", altKey: true, target: body })).toBeNull();
  });
  it("ignores typing targets and open menus/listboxes", () => {
    expect(boardKeyAction({ key: "j", target: { tagName: "INPUT" } })).toBeNull();
    expect(boardKeyAction({ key: "j", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(boardKeyAction({ key: "s", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(boardKeyAction({ key: "j", target: { tagName: "DIV", closest: (s: string) => (s.includes("menu") ? {} : null) } })).toBeNull();
  });
  it("Enter on a focused button or link is left to the browser", () => {
    expect(boardKeyAction({ key: "Enter", target: { tagName: "BUTTON", closest: () => null } })).toBeNull();
    expect(boardKeyAction({ key: "Enter", target: { tagName: "A", closest: () => null } })).toBeNull();
  });
});
