import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Radar, RefreshCw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "./ConfirmDialog";
import { describeError } from "./lib/errorReporting";
import {
  boardKeyAction, clampIndex, filterRows, inTab, newSinceCount, nextIndex, sortRows, tabCounts, zipOptions,
  SORT_LABELS, type BoardTab, type ExitFilter, type SortKey,
} from "./lib/monitorBoard";
import { triageStatus, type PassReason, type TriageState } from "../scraper/monitorTriage";
import { BoardSkeleton, BoardTable, type BoardListing } from "./monitor/BoardTable";
import { DealSheet } from "./monitor/DealSheet";

// "Monitor the Web" — the /monitor triage inbox (Phase 3). Per-user tabs (New /
// Shortlist / Passed / All), filters, sort, a dense table (phone: compact list), a
// deal side sheet driven by ?id=, and J/K/P/S/Enter keys. All logic lives in
// src/web/lib/monitorBoard.ts + src/scraper/monitor{Present,Triage}.ts.
// Plan: docs/superpowers/plans/2026-10-04-monitor-phase3-triage-ui.md.

type LatestRun = FunctionReturnType<typeof api.monitorData.latestRun>;

function lastScanText(s: LatestRun | undefined): string {
  if (s === undefined) return "Loading…";
  if (s === null) return "No scans yet. The monitor runs nightly at 8 PM ET.";
  const t = s.run.finishedAt ?? s.run.startedAt;
  return `Last scan ${new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

const TABS: { value: BoardTab; label: string }[] = [
  { value: "new", label: "New" },
  { value: "shortlist", label: "Shortlist" },
  { value: "passed", label: "Passed" },
  { value: "all", label: "All" },
];
const EMPTY: Record<BoardTab, { title: string; description?: string }> = {
  new: { title: "Nothing new tonight — the filters are working.", description: "New keepers land here after the 8 PM scan." },
  shortlist: { title: "No shortlisted deals", description: "Press S on a row to save it here." },
  passed: { title: "Nothing passed yet." },
  all: { title: "No keepers on the board." },
};

function RunNow() {
  const requestScan = useMutation(api.monitorData.requestScan);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw data-icon="inline-start" />
        Run now
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Run a scan now?"
        description="Scrapes the newest New Castle County listings on Zillow and analyzes the new ones. Uses Firecrawl and LLM credits. The nightly scan runs at 8 PM ET either way."
        confirmLabel="Run scan"
        onConfirm={() => requestScan({})}
      />
    </>
  );
}

export function MonitorPage() {
  const latestRun = useQuery(api.monitorData.latestRun);
  const listings = useQuery(api.monitorData.board);
  const state = useQuery(api.monitorData.boardState);
  const me = useQuery(api.users.currentUser);
  const setTriage = useMutation(api.monitorData.setTriage);
  const markSeen = useMutation(api.monitorData.markSeen);
  const { id: openId } = useSearch({ from: "/monitor" });
  const navigate = useNavigate({ from: "/monitor" });

  const [tab, setTab] = useState<BoardTab>("new");
  const [exits, setExits] = useState<ExitFilter[]>([]);
  const [zip, setZip] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [selected, setSelected] = useState(-1);
  const [passMenuFor, setPassMenuFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = Date.now();

  // "New since you looked": capture the PREVIOUS watermark once, then stamp now.
  const [baseline, setBaseline] = useState<number | null | undefined>(undefined);
  const stamped = useRef(false);
  useEffect(() => {
    if (state === undefined || stamped.current) return;
    stamped.current = true;
    setBaseline(state.lastSeenAt);
    void markSeen({}).catch(() => {});
  }, [state, markSeen]);
  const lastSeenAt = baseline === undefined ? state?.lastSeenAt ?? null : baseline;

  // Merge the listing projection with the caller's triage (two queries so a P/S
  // keystroke only re-runs the tiny boardState query).
  const loading = listings === undefined || state === undefined;
  const all = useMemo<BoardListing[]>(() => {
    if (!listings || !state) return [];
    const byId = new Map<string, TriageState>(state.triage.map((t) => [t.listingId, t]));
    return listings.map((r) => ({ ...r, triage: byId.get(r._id) ?? null }));
  }, [listings, state]);
  const counts = tabCounts(all, now);
  const zips = useMemo(() => zipOptions(all), [all]);
  const visible = useMemo(
    () => sortRows(filterRows(all.filter((r) => inTab(r, tab, now)), { exits, zip: zip === "all" ? null : zip }), sort),
    // `now` intentionally omitted: recomputing per render tick is unnecessary
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, tab, exits, zip, sort],
  );
  const sel = clampIndex(selected, visible.length);
  const newCount = newSinceCount(all, lastSeenAt, now);

  const open = (id: string) => navigate({ search: (prev) => ({ ...prev, id }) });
  const close = () => navigate({ search: (prev) => ({ ...prev, id: undefined }) });

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); } catch (e) { setErr(describeError(e).message); }
  };
  const act = (id: string, action: "shortlist" | "unshortlist" | "snooze" | "restore") =>
    run(() => setTriage({ listingId: id as Id<"monitorListings">, action }));
  const pass = (id: string, reason: PassReason) => {
    setPassMenuFor(null);
    return run(() => setTriage({ listingId: id as Id<"monitorListings">, action: "pass", reason }));
  };
  const toggleShortlist = (r: BoardListing) =>
    act(r._id, triageStatus(r.triage, now) === "shortlist" ? "unshortlist" : "shortlist");

  // Keyboard: J/K move, Enter open, S shortlist, P pass menu. Esc is Radix's (closes
  // the sheet / menu). With the sheet open, J/K walk the sheet through the list.
  // No blanket "menu open" early return: Radix moves focus into [role="menu"], which
  // boardKeyAction already ignores, so a stuck passMenuFor can never lock the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The custom ConfirmDialog (Run now) is role="dialog" aria-modal: no board keys behind it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-slot="sheet-content"])')) return;
      const a = boardKeyAction({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      if (!a) return;
      // With the sheet open (incl. a deep link), J/K start from the open deal, not the old selection.
      const base = openId ? visible.findIndex((r) => r._id === openId) : sel;
      const current = openId ?? visible[sel]?._id;
      if (a === "down" || a === "up") {
        e.preventDefault();
        const ni = nextIndex(base, a, visible.length);
        setSelected(ni);
        if (openId && visible[ni]) navigate({ search: (prev) => ({ ...prev, id: visible[ni]._id }), replace: true });
        return;
      }
      if (!current) return;
      e.preventDefault();
      const r = all.find((x) => x._id === current);
      const s = r ? triageStatus(r.triage, now) : null;
      if (a === "open") open(current);
      // P only where a pass menu is actually rendered: not on passed rows / the Passed
      // tab, and not on a snoozed deal in the sheet (both show Restore instead).
      if (a === "pass" && r && s !== "passed" && (openId ? s !== "snoozed" : tab !== "passed")) setPassMenuFor(current);
      if (a === "shortlist" && r) void toggleShortlist(r);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    if (sel >= 0) document.querySelector(`[data-row-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const failed = latestRun?.run.status === "failed";
  const filtered = exits.length > 0 || zip !== "all";

  return (
    <div>
      {/* Status strip (the page title lives in the app header breadcrumb) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm text-muted-foreground md:px-6">
        <p className="flex flex-wrap items-center gap-x-2">
          <span>{lastScanText(latestRun)}</span>
          {failed && <span className="text-amber-400">· last scan failed</span>}
          {!loading && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-foreground">
                {newCount > 0 ? `${newCount} new since you looked` : "Nothing new since you looked"}
              </span>
            </>
          )}
        </p>
        {me?.role === "admin" && <RunNow />}
      </div>

      {/* Toolbar: tabs + filters + sort */}
      <div className="flex flex-col gap-3 px-4 pt-4 md:flex-row md:items-center md:justify-between md:px-6">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as BoardTab); setSelected(-1); }} className="overflow-x-auto">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                {t.label}
                <span className="tabular-nums text-muted-foreground">{counts[t.value]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="multiple" variant="outline" size="sm" value={exits} onValueChange={(v) => setExits(v as ExitFilter[])}>
            <ToggleGroupItem value="FLIP">Flip</ToggleGroupItem>
            <ToggleGroupItem value="RENTAL">Rental</ToggleGroupItem>
            <ToggleGroupItem value="WHOLESALE">Wholesale</ToggleGroupItem>
          </ToggleGroup>
          <Select value={zip} onValueChange={setZip}>
            <SelectTrigger size="sm" className="w-32" aria-label="ZIP"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All ZIPs</SelectItem>
                {zips.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      {err && <p role="status" className="px-4 pt-2 text-xs text-amber-400 md:px-6">{err}</p>}

      {/* Board */}
      <div className="px-0 pb-8 pt-3 md:px-6">
        {loading ? (
          <BoardSkeleton />
        ) : visible.length === 0 ? (
          // w-auto: Empty's base w-full + mx-4 would overflow the 390px viewport.
          <Empty className="mx-4 w-auto border border-dashed border-border md:mx-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Radar /></EmptyMedia>
              <EmptyTitle>{filtered && counts[tab] > 0 ? "No deals match these filters" : EMPTY[tab].title}</EmptyTitle>
              {!(filtered && counts[tab] > 0) && EMPTY[tab].description && <EmptyDescription>{EMPTY[tab].description}</EmptyDescription>}
            </EmptyHeader>
            {filtered && counts[tab] > 0 && (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => { setExits([]); setZip("all"); }}>Clear filters</Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <>
            <BoardTable
              rows={visible}
              selected={sel}
              tab={tab}
              lastSeenAt={lastSeenAt}
              now={now}
              passMenuFor={passMenuFor}
              sheetOpen={!!openId}
              onSelect={setSelected}
              onOpen={open}
              onShortlist={toggleShortlist}
              onPassMenu={setPassMenuFor}
              onPass={pass}
              onRestore={(id) => act(id, "restore")}
            />
            <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <Kbd>J</Kbd><Kbd>K</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>S</Kbd> shortlist · <Kbd>P</Kbd> pass · <Kbd>Esc</Kbd> close
            </p>
          </>
        )}
      </div>
      <DealSheet
        id={openId}
        passMenuOpen={!!openId && passMenuFor === openId}
        onPassMenu={(o) => setPassMenuFor(o && openId ? openId : null)}
        onClose={() => { setPassMenuFor(null); close(); }}
        onError={setErr}
      />
    </div>
  );
}
