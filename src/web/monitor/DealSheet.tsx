import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Link } from "@tanstack/react-router";
import {
  AlarmClock, Calculator, CircleDashed, ClipboardCheck, ClipboardPlus, ExternalLink, Eye, History, Phone,
  RotateCcw, ShieldCheck, Star, TriangleAlert, X,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { describeError } from "../lib/errorReporting";
import {
  analystNote, displayFlags, humanizeFlag, numberGroups, ownerSignal, safeHref, sellerMotivation,
} from "../../scraper/monitorPresent";
import { passReasonLabel, triageStatus, type PassReason } from "../../scraper/monitorTriage";
import { ExitBadge } from "./ExitBadge";
import { PassMenu } from "./PassMenu";
import { TONE_TEXT } from "./BoardTable";

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{icon}{title}</h3>
      {children}
    </section>
  );
}

// The deal side sheet. Its open state is the /monitor ?id= search param (deep link
// from the digest email); garbage/foreign ids resolve to null in listingForMe.
export function DealSheet({
  id, passMenuOpen, onPassMenu, onClose,
}: {
  id: string | undefined;
  passMenuOpen: boolean;
  onPassMenu: (open: boolean) => void;
  onClose: () => void;
}) {
  const data = useQuery(api.monitorData.listingForMe, id ? { id } : "skip");
  const setTriage = useMutation(api.monitorData.setTriage);
  const promote = useMutation(api.potentialData.promoteToPotential);
  const markPromoted = useMutation(api.monitorData.markPromoted);
  const [busy, setBusy] = useState(false);
  // Errors live in the sheet (the page's error line is hidden behind the modal
  // overlay). Keyed by deal id so J/K to another deal never shows a stale error.
  const [errFor, setErrFor] = useState<{ id: string; msg: string } | null>(null);
  const err = errFor && errFor.id === id ? errFor.msg : null;
  const now = Date.now();

  const run = async (fn: () => Promise<unknown>) => {
    const forId = id;
    setErrFor(null);
    setBusy(true);
    try { await fn(); } catch (e) { if (forId) setErrFor({ id: forId, msg: describeError(e).message }); } finally { setBusy(false); }
  };

  const l = data?.listing;
  const status = triageStatus(data?.triage, now);
  const lid = l?._id as Id<"monitorListings"> | undefined;
  const act = (action: "shortlist" | "unshortlist" | "snooze" | "restore") => lid && run(() => setTriage({ listingId: lid, action }));
  const pass = (reason: PassReason) => { onPassMenu(false); if (lid) void run(() => setTriage({ listingId: lid, action: "pass", reason })); };

  const cityZip = l ? [l.propCity, l.propZip].filter(Boolean).join(" ") : "";
  const fullAddress = l ? [l.address, cityZip].filter(Boolean).join(", ") : "";
  const facts = l
    ? [cityZip, l.beds != null && l.beds !== "" ? `${l.beds} bd` : null, l.baths != null && l.baths !== "" ? `${l.baths} ba` : null,
       l.sqft ? `${l.sqft.toLocaleString("en-US")} sqft` : null, l.yearBuilt ? `built ${l.yearBuilt}` : null].filter(Boolean).join(" · ")
    : "";
  const photos = (l?.photoUrls ?? []).map((u) => safeHref(u)).filter((u): u is string => !!u).slice(0, 10);
  const zillow = safeHref(l?.url);
  const owner = l ? ownerSignal(l) : null;
  const note = l ? analystNote(l) : null;
  const flags = l ? displayFlags(l) : [];
  const gates = (l?.verifyGates ?? []).map(humanizeFlag);
  const motivation = l ? sellerMotivation(l) : null;

  const onPromote = () => l && run(async () => {
    const res = await promote({
      source: { kind: "manual", refId: l.zpid },
      address: fullAddress,
      propCity: l.propCity ?? undefined,
      propZip: l.propZip ?? undefined,
      beds: l.beds != null ? String(l.beds) : undefined,
      baths: l.baths != null ? String(l.baths) : undefined,
      sqft: l.sqft ?? undefined,
      value: l.conservativeArv ?? undefined,
      score: l.dealScore ?? undefined,
      topSignals: l.matchedRequirements ?? undefined,
      contactName: l.agentName ?? undefined,
      contactPhone: l.agentPhone ?? undefined,
      lat: l.lat ?? undefined,
      lng: l.lng ?? undefined,
    });
    // promoteToPotential dedupes on the normalized address, so a retry after a
    // failed link returns the same deal instead of creating a duplicate.
    try {
      await markPromoted({ id: l._id, promotedDealId: res.id });
    } catch {
      throw new ConvexError({ message: "Added to Potential, but this listing could not be marked as in pipeline. Press Promote again to link it (no duplicate is created)." });
    }
  });

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) { setErrFor(null); onClose(); } }}>
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        // Loading / not-found states have no SheetDescription (avoids the Radix warning).
        {...(data && data.listing ? {} : { "aria-describedby": undefined })}
      >
        {data === undefined ? (
          <div className="flex flex-col gap-4 p-4">
            <SheetTitle className="sr-only">Loading deal</SheetTitle>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <div className="grid grid-cols-3 gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          </div>
        ) : data === null || !l ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <SheetTitle className="text-base font-medium text-muted-foreground">This deal is no longer available.</SheetTitle>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="border-b border-border pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <ExitBadge exit={l.bestExit} />
                <span className="text-sm font-semibold tabular-nums">{l.dealScore ?? "—"}</span>
                {status === "passed" && <span className="text-xs text-muted-foreground">Passed: {passReasonLabel(data.triage?.passReason)}</span>}
                {status === "snoozed" && data.triage?.snoozedUntil && (
                  <span className="text-xs text-muted-foreground">
                    Snoozed to {new Date(data.triage.snoozedUntil).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
              <SheetTitle className="text-lg">{l.address}</SheetTitle>
              {facts && <SheetDescription>{facts}</SheetDescription>}
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
              {photos.length > 0 && (
                <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4">
                  {photos.map((u, i) => (
                    <img key={u} src={u} alt={i === 0 ? l.address : ""} loading="lazy" className="h-40 w-60 shrink-0 snap-start rounded-lg bg-muted object-cover" />
                  ))}
                </div>
              )}

              {numberGroups(l).map((g) => (
                <Section key={g.title} title={g.title}>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    {g.cells.map((c) => (
                      <div key={c.label} className="flex flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">{c.label}</dt>
                        <dd className={cn("text-sm font-semibold tabular-nums", TONE_TEXT[c.tone])}>{c.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              ))}

              {motivation && (
                <Section title="Seller motivation" icon={<History className="size-3.5" />}>
                  {motivation.facts.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      {motivation.facts.map((f) => (
                        <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
                          <dt className="text-xs text-muted-foreground">{f.label}</dt>
                          <dd className="text-sm font-semibold tabular-nums">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {motivation.signals.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {motivation.signals.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
                    </div>
                  )}
                  {motivation.history.length > 0 && (
                    <ul className="flex flex-col divide-y divide-border">
                      {motivation.history.map((h, i) => (
                        <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm text-foreground">{h.event}</span>
                            <span className="text-xs text-muted-foreground">{h.date}</span>
                          </div>
                          <div className="flex shrink-0 flex-col items-end tabular-nums">
                            <span className="text-sm text-foreground">{h.price}</span>
                            {h.change && <span className={cn("text-xs", h.tone === "cut" ? "text-amber-400" : "text-muted-foreground")}>{h.change}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {gates.length > 0 && (
                <Section title="Verify before you bid" icon={<ShieldCheck className="size-3.5 text-amber-400" />}>
                  <ul className="flex flex-col gap-1.5">
                    {gates.map((g) => (
                      <li key={g} className="flex gap-2 text-sm text-foreground">
                        <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-400" />{g}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {flags.length > 0 && (
                <Section title="Red flags" icon={<TriangleAlert className="size-3.5 text-amber-400" />}>
                  <ul className="flex flex-col gap-1.5">
                    {flags.map((f) => <li key={f} className="text-sm text-foreground">{f}</li>)}
                  </ul>
                </Section>
              )}

              {owner && (
                <p className="flex items-center gap-1.5 text-sm text-red-400"><Eye className="size-4 shrink-0" />Owner: {owner}</p>
              )}

              {(l.aiReason || l.breakdown || note) && (
                <Section title="Analyst note">
                  {l.aiReason && <p className="text-sm text-foreground">{l.aiReason}</p>}
                  {l.breakdown && <p className="text-sm leading-relaxed text-muted-foreground">{l.breakdown}</p>}
                  {note && <p className="text-xs text-muted-foreground">{note}</p>}
                </Section>
              )}

              {(l.agentName || l.agentPhone || zillow) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {(l.agentName || l.agentPhone) && (
                    <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <Phone className="size-4" />
                      {l.agentName}
                      {l.agentPhone && (
                        <a className="text-teal-glow hover:underline" href={`tel:${(/^\s*\+/.test(l.agentPhone) ? "+" : "") + l.agentPhone.replace(/\D/g, "")}`}>{l.agentPhone}</a>
                      )}
                    </span>
                  )}
                  {zillow && (
                    <a className="flex items-center gap-1.5 text-teal-glow hover:underline" href={zillow} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" />Zillow
                    </a>
                  )}
                </div>
              )}
            </div>

            {err && (
              <p role="alert" className="border-t border-border px-4 pt-3 text-xs text-amber-400">{err}</p>
            )}
            <SheetFooter className={cn("flex-row flex-wrap", !err && "border-t border-border")}>
              {l.promotedDealId ? (
                <Button variant="outline" asChild>
                  <Link to="/potential"><ClipboardCheck data-icon="inline-start" />In pipeline</Link>
                </Button>
              ) : (
                <Button onClick={onPromote} disabled={busy}><ClipboardPlus data-icon="inline-start" />Promote</Button>
              )}
              <Button variant="outline" disabled={busy} aria-pressed={status === "shortlist"} onClick={() => act(status === "shortlist" ? "unshortlist" : "shortlist")}>
                <Star data-icon="inline-start" className={cn(status === "shortlist" && "fill-current text-primary")} />
                {status === "shortlist" ? "Shortlisted" : "Shortlist"}
              </Button>
              {status === "passed" || status === "snoozed" ? (
                <Button variant="outline" disabled={busy} onClick={() => act("restore")}><RotateCcw data-icon="inline-start" />Restore</Button>
              ) : (
                <>
                  <PassMenu
                    open={passMenuOpen}
                    onOpenChange={onPassMenu}
                    onPick={pass}
                    trigger={<Button variant="outline" disabled={busy}><X data-icon="inline-start" />Pass</Button>}
                  />
                  <Button variant="ghost" disabled={busy} onClick={() => act("snooze")}><AlarmClock data-icon="inline-start" />Snooze 7 days</Button>
                </>
              )}
              <Button variant="ghost" asChild>
                <Link to="/flip" search={{ address: fullAddress, value: l.conservativeArv ?? undefined, sqft: l.sqft ?? undefined }}>
                  <Calculator data-icon="inline-start" />Flip analyzer
                </Link>
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
