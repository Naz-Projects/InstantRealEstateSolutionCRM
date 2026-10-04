import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, Eye, ImageOff, RotateCcw, Star, X } from "lucide-react";
import type { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { money, safeHref, verdictFor, type Tone } from "../../scraper/monitorPresent";
import { triageStatus, type PassReason, type TriageState } from "../../scraper/monitorTriage";
import { isNewSince } from "../lib/monitorBoard";
import { AlertTagChip } from "./AlertTagChip";
import { ExitBadge } from "./ExitBadge";
import { PassMenu } from "./PassMenu";

// A board projection row merged with the caller's triage (MonitorPage does the merge).
export type BoardListing = FunctionReturnType<typeof api.monitorData.board>[number] & { triage: TriageState | null };

export const TONE_TEXT: Record<Tone, string> = {
  pos: "text-emerald-400",
  neg: "text-red-400",
  neutral: "text-foreground",
};

function Thumb({ src, alt, className }: { src: string | undefined; alt: string; className: string }) {
  const [err, setErr] = useState(false);
  const url = safeHref(src);
  if (!url || err) {
    return (
      <div className={cn("grid shrink-0 place-items-center rounded-md bg-muted", className)}>
        <ImageOff className="size-4 text-muted-foreground opacity-50" />
      </div>
    );
  }
  return <img src={url} alt={alt} loading="lazy" onError={() => setErr(true)} className={cn("shrink-0 rounded-md bg-muted object-cover", className)} />;
}

function NewDot() {
  return (
    <>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-teal-glow" />
      <span className="sr-only">New</span>
    </>
  );
}

function subline(r: BoardListing): string {
  return [
    [r.propCity, r.propZip].filter(Boolean).join(" "),
    r.beds != null && r.beds !== "" ? `${r.beds} bd` : null,
    r.baths != null && r.baths !== "" ? `${r.baths} ba` : null,
    r.sqft ? `${r.sqft.toLocaleString("en-US")} sqft` : null,
  ].filter(Boolean).join(" · ");
}

export interface BoardTableProps {
  rows: BoardListing[];
  selected: number;
  lastSeenAt: number | null;
  now: number;
  passMenuFor: string | null;
  sheetOpen: boolean;
  onSelect: (i: number) => void;
  onOpen: (id: string) => void;
  onShortlist: (r: BoardListing) => void;
  onPassMenu: (id: string | null) => void;
  onPass: (id: string, reason: PassReason) => void;
  onRestore: (id: string) => void;
}

export function BoardTable(p: BoardTableProps) {
  return (
    <>
      {/* Desktop: dense table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {["", "Score", "Address", "List", "Verdict", ""].map((h, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    "h-9 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                    i === 0 && "w-16", i === 1 && "w-28", (i === 3 || i === 4) && "text-right",
                    i === 3 && "w-28", i === 4 && "w-40", i === 5 && "w-32",
                  )}
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.rows.map((r, i) => {
              const v = verdictFor(r);
              const status = triageStatus(r.triage, p.now);
              const isSel = i === p.selected;
              return (
                <TableRow
                  key={r._id}
                  data-row-index={i}
                  aria-selected={isSel}
                  onClick={() => { p.onSelect(i); p.onOpen(r._id); }}
                  className={cn("h-14 cursor-pointer hover:bg-muted/40", isSel && "bg-accent shadow-[inset_2px_0_0_var(--color-teal)] hover:bg-accent")}
                >
                  <TableCell className="py-2"><Thumb src={r.photo} alt="" className="h-9 w-12" /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold tabular-nums text-foreground">{r.dealScore ?? "—"}</span>
                      <ExitBadge exit={r.bestExit} />
                      <AlertTagChip alertTag={r.alertTag} alertedEventAt={r.alertedEventAt} />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <div className="flex items-center gap-1.5">
                      {status === "new" && isNewSince(r, p.lastSeenAt) && <NewDot />}
                      <span className="truncate font-medium text-foreground">{r.address}</span>
                      {r.hasOwnerSignal && (
                        <span title="Owner signal on the parcel"><Eye className="size-3.5 shrink-0 text-red-400" /></span>
                      )}
                      {status === "snoozed" && <span className="shrink-0 text-xs text-muted-foreground">Snoozed</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{subline(r)}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.listPrice)}</TableCell>
                  <TableCell className="text-right">
                    <div className={cn("font-semibold tabular-nums", TONE_TEXT[v.tone])}>{v.value}</div>
                    {v.caption && <div className="text-xs tabular-nums text-muted-foreground">{v.caption}</div>}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon-sm"
                        aria-label={status === "shortlist" ? "Remove from shortlist" : "Shortlist"}
                        aria-pressed={status === "shortlist"}
                        onClick={() => p.onShortlist(r)}
                      >
                        <Star className={cn(status === "shortlist" && "fill-current text-primary")} />
                      </Button>
                      {status === "passed" || status === "snoozed" ? (
                        <Button variant="ghost" size="icon-sm" aria-label="Restore" onClick={() => p.onRestore(r._id)}>
                          <RotateCcw />
                        </Button>
                      ) : (
                        <PassMenu
                          open={p.passMenuFor === r._id && !p.sheetOpen}
                          onOpenChange={(o) => p.onPassMenu(o ? r._id : null)}
                          onPick={(reason) => p.onPass(r._id, reason)}
                          trigger={<Button variant="ghost" size="icon-sm" aria-label="Pass"><X /></Button>}
                        />
                      )}
                      <Button variant="ghost" size="icon-sm" aria-label="Open deal" onClick={() => { p.onSelect(i); p.onOpen(r._id); }}>
                        <ChevronRight />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Phone: edge-to-edge rows, 64px thumb + address + two number lines */}
      <ul className="divide-y divide-border border-y border-border md:hidden">
        {p.rows.map((r, i) => {
          const v = verdictFor(r);
          const status = triageStatus(r.triage, p.now);
          return (
            <li key={r._id}>
              <button
                type="button"
                onClick={() => { p.onSelect(i); p.onOpen(r._id); }}
                className={cn("flex w-full gap-3 px-4 py-3 text-left", i === p.selected && "bg-accent")}
              >
                <Thumb src={r.photo} alt="" className="size-16" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    {status === "new" && isNewSince(r, p.lastSeenAt) && <NewDot />}
                    <span className="truncate text-sm font-medium text-foreground">{r.address}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                    <ExitBadge exit={r.bestExit} />
                    <AlertTagChip alertTag={r.alertTag} alertedEventAt={r.alertedEventAt} />
                    <span>{r.dealScore ?? "—"}</span>
                    <span className="truncate">List {money(r.listPrice)}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 text-xs tabular-nums">
                    <span className={cn("font-semibold", TONE_TEXT[v.tone])}>{v.value}</span>
                    {v.caption && <span className="truncate text-muted-foreground">{v.caption}</span>}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function BoardSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-14 items-center gap-4 border-b border-border px-2 last:border-0">
            <Skeleton className="h-9 w-12 rounded-md" />
            <Skeleton className="h-4 w-16" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-border md:hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3 px-4 py-3">
            <Skeleton className="size-16 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
