// Phase 4 (wider net) — pure tracking logic for the Monitor re-check lane. Convex
// mutations read a row, call these, and ctx.db.patch the result: a key present with
// value undefined DELETES that field (patch semantics), which is how archive/revive
// and leaving the rotation are expressed. No Date.now() in here — callers pass `now`.
import { MONITOR } from "./monitorListings";

const DAY_MS = 86_400_000;

export type StatusBucket = "active" | "pending" | "sold" | "off_market";
export type ArchivedReason = "stale" | "PENDING" | "SOLD" | "OFF_MARKET";

export interface TrackedRow {
  listPrice?: number;
  keeper?: boolean;
  archivedAt?: number;
  archivedReason?: string;
  lastSeen: number;
  lastPriceCut?: number;
  lastPriceCutAt?: number;
  backOnMarketAt?: number;
  alertedEventAt?: number;
  recheckAt?: number;
  lastRecheckAt?: number;
}

export interface TrackingPatch {
  updatedAt: number;
  lastSeen?: number;
  lastRecheckAt?: number;
  homeStatus?: string;
  prevListPrice?: number;
  listPrice?: number;
  lastPriceCut?: number;
  lastPriceCutAt?: number;
  backOnMarketAt?: number;
  archivedAt?: number;
  archivedReason?: string;
  recheckAt?: number;
}

// Zillow homeStatus -> bucket. Verified live 2026-10-04: FOR_SALE (cards + detail) and
// the detail listingSubType.isPending boolean. The sold / off-market strings were NOT
// observed live, so matching is tolerant; anything unrecognized or empty is null =
// take no action (never archive on a guess).
export function statusBucket(homeStatus: string | null | undefined, isPending = false): StatusBucket | null {
  const s = (homeStatus || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (/SOLD/.test(s)) return "sold"; // SOLD, RECENTLY_SOLD
  if (isPending || /PENDING|UNDER_CONTRACT|CONTINGENT/.test(s)) return "pending";
  if (s === "OTHER" || /OFF_MARKET|FOR_RENT|REMOVED|WITHDRAWN/.test(s)) return "off_market";
  if (/FOR_SALE|COMING_SOON|AUCTION|(^|_)ACTIVE(_|$)/.test(s)) return "active"; // INACTIVE is not ACTIVE
  return null;
}

const STATUS_REASON: Record<Exclude<StatusBucket, "active">, ArchivedReason> = {
  pending: "PENDING", sold: "SOLD", off_market: "OFF_MARKET",
};
function isStatusArchive(reason: string | undefined): boolean {
  return reason === "PENDING" || reason === "SOLD" || reason === "OFF_MARKET";
}

// A strictly lower price vs the STORED one = a cut: move the price down (so the same
// cut can never fire twice) and stamp the event. Shared by both entry paths.
// `at` = when the cut happened: Zillow card datePriceChanged when known (the first sweep
// finds weeks-old cuts on tracked rows; stamping them "now" would tag them as fresh).
function cutFields(row: TrackedRow, price: number | null, at: number) {
  return price != null && row.listPrice != null && price < row.listPrice
    ? { prevListPrice: row.listPrice, listPrice: price, lastPriceCut: row.listPrice - price, lastPriceCutAt: at }
    : {};
}

// New row from a card that carries Zillow's own cut (the price-cut sweep): seed the
// event so the first digest can tag it (alertedEventAt then guards re-sends).
export function cardCutFields(card: { priceChange?: number; datePriceChanged?: number }, now: number): { lastPriceCut?: number; lastPriceCutAt?: number } {
  return card.priceChange != null && card.priceChange < 0
    ? { lastPriceCut: -card.priceChange, lastPriceCutAt: card.datePriceChanged ?? now }
    : {};
}

// An existing row seen on a search card (nightly scan or price-cut sweep).
// Status-archived (PENDING/SOLD/OFF_MARKET) rows are owned by the DETAIL page: a card can
// say FOR_SALE while the detail says isPending, and trusting the card looped archive ->
// revive -> BACK ON MARKET email forever. So a card that SAYS active (a status-less card,
// or one whose text reads under contract, is no evidence) only queues a detail confirm
// (recheckAt = now; recheckPatch revives + stamps backOnMarketAt), at most once per
// recheckEveryDays of detail checks. No cut, revive, homeStatus or analysis from the card.
// An aged-out row ("stale" or a legacy reason-less archive) is revived by a NEW cut; it
// re-enters (keeper) or leaves (non-keeper) the rotation right here, so a failed
// re-analysis can't leave a revived keeper unscheduled.
export function sightingPatch(row: TrackedRow, card: { price: number | null; homeStatus?: string; datePriceChanged?: number; statusText?: string }, now: number): { patch: TrackingPatch; priceDropped: boolean; confirm: boolean } {
  if (row.archivedAt != null && isStatusArchive(row.archivedReason)) {
    const cardActive = statusBucket(card.homeStatus) === "active" && !/pending|contingent|backup|under contract/i.test(card.statusText ?? "");
    const checkedRecently = row.lastRecheckAt != null && now - row.lastRecheckAt < MONITOR.recheckEveryDays * DAY_MS - MONITOR.recheckGraceMs;
    const confirm = cardActive && !checkedRecently;
    return { patch: { lastSeen: now, updatedAt: now, ...(confirm ? { recheckAt: now } : {}) }, priceDropped: false, confirm };
  }
  const cut = cutFields(row, card.price, card.datePriceChanged ?? now);
  const priceDropped = "lastPriceCut" in cut;
  const revive = row.archivedAt != null && priceDropped;
  const patch: TrackingPatch = {
    lastSeen: now,
    updatedAt: now,
    ...(card.homeStatus ? { homeStatus: card.homeStatus } : {}),
    ...cut,
    ...(revive
      ? {
          archivedAt: undefined,
          archivedReason: undefined,
          recheckAt: nextRecheckAt({ keeper: row.keeper, archivedAt: undefined, archivedReason: undefined, lastSeen: now }, now) ?? undefined,
        }
      : {}),
  };
  return { patch, priceDropped, confirm: false };
}

// Rotation membership: the next detail re-check time, or null = leave the rotation.
export function nextRecheckAt(row: Pick<TrackedRow, "keeper" | "archivedAt" | "archivedReason" | "lastSeen">, now: number): number | null {
  if (now - row.lastSeen > MONITOR.trackDays * DAY_MS) return null;
  // Due times are stamped minutes after the daily cron fires; minus the grace so the
  // check lands on the cron N days later instead of drifting to N+1.
  const after = (days: number) => now + days * DAY_MS - MONITOR.recheckGraceMs;
  if (row.archivedAt != null) return row.archivedReason === "PENDING" ? after(MONITOR.pendingRecheckDays) : null;
  return row.keeper ? after(MONITOR.recheckEveryDays) : null;
}

export interface RecheckDetail { homeStatus?: string; isPending: boolean; price: number | null; }
export type RecheckOutcome = "unknown" | "archive" | "backOnMarket" | "cut" | "unchanged";

// One detail re-scrape -> the row patch. Never archives on an unknown status or a shell
// page (retry tomorrow; nextRecheckAt still ends it once the row leaves trackDays).
export function recheckPatch(row: TrackedRow, d: RecheckDetail | null, now: number): { patch: TrackingPatch; reanalyze: boolean; outcome: RecheckOutcome } {
  const base = { lastRecheckAt: now, updatedAt: now };
  const bucket = d ? statusBucket(d.homeStatus, d.isPending) : null;
  if (!d || bucket == null) {
    const stay = nextRecheckAt(row, now) != null;
    return { patch: { ...base, recheckAt: stay ? now + DAY_MS - MONITOR.recheckGraceMs : undefined }, reanalyze: false, outcome: "unknown" };
  }
  const homeStatus = d.homeStatus || (d.isPending ? "PENDING" : "");
  const hs = homeStatus ? { homeStatus } : {};
  if (bucket !== "active") {
    const reason = STATUS_REASON[bucket];
    if (row.archivedAt != null && row.archivedReason === reason) {
      return { patch: { ...base, ...hs, recheckAt: nextRecheckAt(row, now) ?? undefined }, reanalyze: false, outcome: "unchanged" };
    }
    const next = nextRecheckAt({ ...row, archivedAt: now, archivedReason: reason }, now);
    return { patch: { ...base, ...hs, archivedAt: now, archivedReason: reason, recheckAt: next ?? undefined }, reanalyze: false, outcome: "archive" };
  }
  if (row.archivedAt != null && isStatusArchive(row.archivedReason)) {
    const next = nextRecheckAt({ ...row, archivedAt: undefined, archivedReason: undefined }, now);
    return {
      patch: { ...base, ...hs, archivedAt: undefined, archivedReason: undefined, backOnMarketAt: now, ...cutFields(row, d.price, now), recheckAt: next ?? undefined },
      reanalyze: true,
      outcome: "backOnMarket",
    };
  }
  const cut = cutFields(row, d.price, now);
  const next = nextRecheckAt(row, now) ?? undefined;
  if ("lastPriceCut" in cut) return { patch: { ...base, ...hs, ...cut, recheckAt: next }, reanalyze: true, outcome: "cut" };
  return { patch: { ...base, ...hs, recheckAt: next }, reanalyze: false, outcome: "unchanged" };
}

// Re-alert loop guard (decided in analyzeOne AFTER the new numbers): re-open the digest
// only for an event newer than the last one alerted AND only when the row is
// digest-worthy now. A non-worthy result does not consume the event.
export function reAlertDecision(row: TrackedRow, digestWorthy: boolean): { reopen: boolean; alertedEventAt?: number; alertTag?: string } {
  const cutAt = row.lastPriceCutAt ?? 0;
  const bomAt = row.backOnMarketAt ?? 0;
  const eventAt = Math.max(cutAt, bomAt);
  if (!digestWorthy || eventAt === 0 || eventAt <= (row.alertedEventAt ?? 0)) return { reopen: false };
  const alertTag = bomAt >= cutAt
    ? "BACK ON MARKET"
    : `PRICE CUT $${Math.round(row.lastPriceCut ?? 0).toLocaleString("en-US")}`;
  return { reopen: true, alertedEventAt: eventAt, alertTag };
}

// The digest/board tag, only while the event is recent.
export function digestAlertTag(row: { alertTag?: string; alertedEventAt?: number }, now: number): string | null {
  if (!row.alertTag || row.alertedEventAt == null) return null;
  return now - row.alertedEventAt <= MONITOR.alertTagFreshDays * DAY_MS ? row.alertTag : null;
}
