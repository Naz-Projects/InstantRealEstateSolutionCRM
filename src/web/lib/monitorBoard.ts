// /monitor board logic (pure): tabs, filters, sort, "new since you looked",
// selection index and keyboard mapping. The page is a thin shell over these.
import { triageStatus, type TriageState } from "../../scraper/monitorTriage";
import { normalizeExit, type PresentRow } from "../../scraper/monitorPresent";

export type BoardTab = "new" | "shortlist" | "passed" | "all";
export type SortKey = "gap" | "cashflow" | "score" | "newest";
export type ExitFilter = "FLIP" | "RENTAL" | "WHOLESALE";
export const SORT_LABELS: Record<SortKey, string> = { gap: "Offer gap", cashflow: "Cash flow", score: "Score", newest: "Newest" };

export interface BoardRow extends PresentRow {
  _id: string;
  firstSeen: number;
  propZip?: string | null;
  triage?: TriageState | null;
}

export function inTab(r: BoardRow, tab: BoardTab, now: number): boolean {
  return tab === "all" || triageStatus(r.triage, now) === tab;
}
export function tabCounts(rows: BoardRow[], now: number): Record<BoardTab, number> {
  const c: Record<BoardTab, number> = { new: 0, shortlist: 0, passed: 0, all: rows.length };
  for (const r of rows) {
    const s = triageStatus(r.triage, now);
    if (s !== "snoozed") c[s]++;
  }
  return c;
}

export function filterRows<T extends BoardRow>(rows: T[], f: { exits: ExitFilter[]; zip: string | null }): T[] {
  return rows.filter((r) => {
    if (f.exits.length && !f.exits.includes(normalizeExit(r.bestExit) as ExitFilter)) return false;
    if (f.zip && r.propZip !== f.zip) return false;
    return true;
  });
}

const KEY: Record<SortKey, (r: BoardRow) => number | null | undefined> = {
  gap: (r) => r.roomVsList,
  cashflow: (r) => r.cashFlow,
  score: (r) => r.dealScore,
  newest: (r) => r.firstSeen,
};
export function sortRows<T extends BoardRow>(rows: T[], key: SortKey): T[] {
  const k = KEY[key];
  const v = (r: BoardRow) => { const x = k(r); return x == null || !Number.isFinite(x) ? null : x; };
  return [...rows].sort((a, b) => {
    const va = v(a), vb = v(b);
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    if (va != null && vb != null && va !== vb) return vb - va;
    const sa = a.dealScore ?? -Infinity, sb = b.dealScore ?? -Infinity;
    if (sa !== sb) return sb - sa;
    return b.firstSeen - a.firstSeen;
  });
}

export function zipOptions(rows: BoardRow[]): string[] {
  return [...new Set(rows.map((r) => r.propZip ?? "").filter(Boolean))].sort();
}

export function isNewSince(r: BoardRow, lastSeenAt: number | null): boolean {
  return lastSeenAt == null || r.firstSeen > lastSeenAt;
}
export function newSinceCount(rows: BoardRow[], lastSeenAt: number | null, now: number): number {
  return rows.filter((r) => triageStatus(r.triage, now) === "new" && isNewSince(r, lastSeenAt)).length;
}

export function clampIndex(i: number, len: number): number {
  if (len <= 0 || i < 0) return -1;
  return Math.min(i, len - 1);
}
export function nextIndex(i: number, dir: "down" | "up", len: number): number {
  if (len <= 0) return -1;
  if (i < 0) return 0;
  return dir === "down" ? Math.min(i + 1, len - 1) : Math.max(i - 1, 0);
}

// J/K with the deal sheet open. `openIndex` is the open deal's index in the visible
// list (-1 once P/S/Snooze moved it out). Then `sel` (the old slot) is the anchor:
// J opens the row that slid into the slot, K the one above it.
export function sheetStepIndex(openIndex: number, sel: number, dir: "down" | "up", len: number): number {
  if (openIndex >= 0) return nextIndex(openIndex, dir, len);
  const base = clampIndex(sel, len);
  if (base < 0) return nextIndex(-1, dir, len);
  return dir === "down" ? base : Math.max(base - 1, 0);
}

export type BoardKey ="down" | "up" | "pass" | "shortlist" | "open";
export interface KeyLike {
  key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown } | null;
}
export function boardKeyAction(e: KeyLike): BoardKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const t = e.target;
  const tag = (t?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return null;
  if (t?.closest?.('[role="menu"],[role="listbox"],[role="alertdialog"]')) return null;
  switch (e.key) {
    case "j": case "J": return "down";
    case "k": case "K": return "up";
    case "p": case "P": return "pass";
    case "s": case "S": return "shortlist";
    case "Enter": return tag === "BUTTON" || tag === "A" ? null : "open";
    default: return null;
  }
}
