import { describe, it, expect } from "vitest";
import {
  statusBucket, cardCutFields, sightingPatch, recheckPatch, nextRecheckAt, reAlertDecision, digestAlertTag,
  type TrackedRow,
} from "../src/scraper/monitorRecheck";
import { MONITOR } from "../src/scraper/monitorListings";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-04T14:00:00Z");
const G = MONITOR.recheckGraceMs; // due times sit a grace period early (cron-drift guard)
const row = (o: Partial<TrackedRow> = {}): TrackedRow => ({ listPrice: 300000, keeper: true, lastSeen: NOW - 5 * DAY, ...o });
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

describe("statusBucket", () => {
  it("maps verified and tolerant Zillow statuses", () => {
    expect(statusBucket("FOR_SALE")).toBe("active");
    expect(statusBucket("COMING_SOON")).toBe("active");
    expect(statusBucket("FOR_SALE", true)).toBe("pending"); // detail listingSubType.isPending
    expect(statusBucket("PENDING")).toBe("pending");
    expect(statusBucket("Under contract")).toBe("pending");
    expect(statusBucket("RECENTLY_SOLD")).toBe("sold");
    expect(statusBucket("SOLD")).toBe("sold");
    expect(statusBucket("OTHER")).toBe("off_market");
    expect(statusBucket("OFF_MARKET")).toBe("off_market");
  });
  it("unknown or empty is null (take no action)", () => {
    expect(statusBucket("")).toBeNull();
    expect(statusBucket(undefined)).toBeNull();
    expect(statusBucket("SOMETHING_NEW")).toBeNull();
  });
});

describe("cardCutFields", () => {
  it("seeds the cut from Zillow's own priceChange on insert", () => {
    expect(cardCutFields({ priceChange: -23100, datePriceChanged: 1790924400000 }, NOW))
      .toEqual({ lastPriceCut: 23100, lastPriceCutAt: 1790924400000 });
    expect(cardCutFields({ priceChange: -5000 }, NOW)).toEqual({ lastPriceCut: 5000, lastPriceCutAt: NOW });
  });
  it("no cut for an increase or a missing change", () => {
    expect(cardCutFields({ priceChange: 5000 }, NOW)).toEqual({});
    expect(cardCutFields({}, NOW)).toEqual({});
  });
});

describe("sightingPatch (search card seen for an existing row)", () => {
  it("a lower card price is a cut: moves the price down and stamps the event", () => {
    const r = sightingPatch(row(), { price: 285000, homeStatus: "FOR_SALE" }, NOW);
    expect(r.priceDropped).toBe(true);
    expect(r.backOnMarket).toBe(false);
    expect(r.patch).toMatchObject({ lastSeen: NOW, prevListPrice: 300000, listPrice: 285000, lastPriceCut: 15000, lastPriceCutAt: NOW, homeStatus: "FOR_SALE" });
    expect(has(r.patch, "archivedAt")).toBe(false);
  });
  it("the cut date is Zillow's datePriceChanged when the card carries it", () => {
    const r = sightingPatch(row(), { price: 285000, homeStatus: "FOR_SALE", datePriceChanged: NOW - 20 * DAY }, NOW);
    expect(r.patch.lastPriceCutAt).toBe(NOW - 20 * DAY);
    expect(r.patch.lastSeen).toBe(NOW);
  });
  it("same price: only lastSeen/homeStatus move (a cut can never fire twice)", () => {
    const r = sightingPatch(row(), { price: 300000 }, NOW);
    expect(r.priceDropped).toBe(false);
    expect(has(r.patch, "lastPriceCut")).toBe(false);
    expect(has(r.patch, "listPrice")).toBe(false);
  });
  it("PENDING-archived row seen for sale = back on market, revived", () => {
    const r = sightingPatch(row({ archivedAt: NOW - DAY, archivedReason: "PENDING" }), { price: 300000, homeStatus: "FOR_SALE" }, NOW);
    expect(r.backOnMarket).toBe(true);
    expect(has(r.patch, "archivedAt")).toBe(true);
    expect(r.patch.archivedAt).toBeUndefined();
    expect(r.patch.archivedReason).toBeUndefined();
    expect(r.patch.backOnMarketAt).toBe(NOW);
  });
  it("a card that itself says PENDING is not back on market", () => {
    const r = sightingPatch(row({ archivedAt: NOW - DAY, archivedReason: "PENDING" }), { price: 300000, homeStatus: "PENDING" }, NOW);
    expect(r.backOnMarket).toBe(false);
    expect(has(r.patch, "archivedAt")).toBe(false);
  });
  it("SOLD-archived row seen for sale is revived (relist under the same zpid)", () => {
    const r = sightingPatch(row({ archivedAt: NOW - 20 * DAY, archivedReason: "SOLD" }), { price: 420000, homeStatus: "FOR_SALE" }, NOW);
    expect(r.backOnMarket).toBe(true);
    expect(has(r.patch, "archivedAt")).toBe(true);
  });
  it("aged-out (stale or legacy) row: revived only by a NEW cut, never by a plain sighting", () => {
    const stale = row({ archivedAt: NOW - DAY, archivedReason: "stale" });
    expect(has(sightingPatch(stale, { price: 300000 }, NOW).patch, "archivedAt")).toBe(false);
    const cut = sightingPatch(stale, { price: 280000 }, NOW);
    expect(cut.priceDropped).toBe(true);
    expect(cut.backOnMarket).toBe(false);
    expect(has(cut.patch, "archivedAt")).toBe(true);
    const legacy = sightingPatch(row({ archivedAt: NOW - DAY }), { price: 280000 }, NOW);
    expect(has(legacy.patch, "archivedAt")).toBe(true);
  });
});

describe("nextRecheckAt (rotation membership)", () => {
  it("active keeper every recheckEveryDays; non-keeper out", () => {
    expect(nextRecheckAt(row(), NOW)).toBe(NOW + 3 * DAY - G);
    expect(nextRecheckAt(row({ keeper: false }), NOW)).toBeNull();
  });
  it("PENDING-archived watched weekly; SOLD / OFF_MARKET / stale out", () => {
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "PENDING" }), NOW)).toBe(NOW + 7 * DAY - G);
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "SOLD" }), NOW)).toBeNull();
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "OFF_MARKET" }), NOW)).toBeNull();
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "stale" }), NOW)).toBeNull();
  });
  it("a row checked minutes after the cron is due again by the cron N days later (no drift)", () => {
    const checkedAt = NOW + 15 * 60_000; // 14:15, after the sweep
    expect(nextRecheckAt(row(), checkedAt)!).toBeLessThanOrEqual(NOW + 3 * DAY);
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "PENDING" }), checkedAt)!).toBeLessThanOrEqual(NOW + 7 * DAY);
    expect(recheckPatch(row(), null, checkedAt).patch.recheckAt!).toBeLessThanOrEqual(NOW + DAY);
  });
  it("not seen in a search for more than trackDays -> out", () => {
    expect(nextRecheckAt(row({ lastSeen: NOW - 46 * DAY }), NOW)).toBeNull();
    expect(nextRecheckAt(row({ lastSeen: NOW - 44 * DAY }), NOW)).toBe(NOW + 3 * DAY - G);
  });
});

describe("recheckPatch (detail re-scrape outcome)", () => {
  it("null detail (shell page) retries tomorrow, touches nothing else", () => {
    const r = recheckPatch(row(), null, NOW);
    expect(r.outcome).toBe("unknown");
    expect(r.reanalyze).toBe(false);
    expect(r.patch.recheckAt).toBe(NOW + DAY - G);
    expect(has(r.patch, "archivedAt")).toBe(false);
  });
  it("unknown status past the tracking window leaves the rotation", () => {
    const r = recheckPatch(row({ lastSeen: NOW - 50 * DAY }), { homeStatus: "WHO_KNOWS", isPending: false, price: 300000 }, NOW);
    expect(r.outcome).toBe("unknown");
    expect(has(r.patch, "recheckAt")).toBe(true);
    expect(r.patch.recheckAt).toBeUndefined();
  });
  it("pending keeper is archived PENDING and watched weekly", () => {
    const r = recheckPatch(row(), { homeStatus: "FOR_SALE", isPending: true, price: 300000 }, NOW);
    expect(r.outcome).toBe("archive");
    expect(r.patch).toMatchObject({ archivedAt: NOW, archivedReason: "PENDING", recheckAt: NOW + 7 * DAY - G, lastRecheckAt: NOW });
    expect(r.reanalyze).toBe(false);
  });
  it("sold keeper is archived SOLD and leaves the rotation", () => {
    const r = recheckPatch(row(), { homeStatus: "RECENTLY_SOLD", isPending: false, price: null }, NOW);
    expect(r.patch).toMatchObject({ archivedAt: NOW, archivedReason: "SOLD", homeStatus: "RECENTLY_SOLD" });
    expect(has(r.patch, "recheckAt")).toBe(true);
    expect(r.patch.recheckAt).toBeUndefined();
  });
  it("already-PENDING row still pending: unchanged, keeps watching", () => {
    const r = recheckPatch(row({ archivedAt: NOW - 7 * DAY, archivedReason: "PENDING" }), { homeStatus: "PENDING", isPending: true, price: 300000 }, NOW);
    expect(r.outcome).toBe("unchanged");
    expect(has(r.patch, "archivedAt")).toBe(false);
    expect(r.patch.recheckAt).toBe(NOW + 7 * DAY - G);
  });
  it("PENDING row back for sale at a lower price: revived + cut + re-analyze", () => {
    const r = recheckPatch(row({ archivedAt: NOW - 7 * DAY, archivedReason: "PENDING" }), { homeStatus: "FOR_SALE", isPending: false, price: 280000 }, NOW);
    expect(r.outcome).toBe("backOnMarket");
    expect(r.reanalyze).toBe(true);
    expect(r.patch.archivedAt).toBeUndefined();
    expect(has(r.patch, "archivedAt")).toBe(true);
    expect(r.patch).toMatchObject({ backOnMarketAt: NOW, listPrice: 280000, prevListPrice: 300000, lastPriceCut: 20000, lastPriceCutAt: NOW });
  });
  it("active keeper with a lower detail price is a cut", () => {
    const r = recheckPatch(row(), { homeStatus: "FOR_SALE", isPending: false, price: 290000 }, NOW);
    expect(r.outcome).toBe("cut");
    expect(r.reanalyze).toBe(true);
    expect(r.patch).toMatchObject({ listPrice: 290000, lastPriceCut: 10000, recheckAt: NOW + 3 * DAY - G });
  });
  it("nothing changed: next check scheduled, non-keeper drops out", () => {
    const r = recheckPatch(row(), { homeStatus: "FOR_SALE", isPending: false, price: 300000 }, NOW);
    expect(r.outcome).toBe("unchanged");
    expect(r.patch).toMatchObject({ homeStatus: "FOR_SALE", recheckAt: NOW + 3 * DAY - G });
    const nk = recheckPatch(row({ keeper: false }), { homeStatus: "FOR_SALE", isPending: false, price: 300000 }, NOW);
    expect(has(nk.patch, "recheckAt")).toBe(true);
    expect(nk.patch.recheckAt).toBeUndefined();
  });
});

describe("reAlertDecision (loop guard)", () => {
  const cut = row({ lastPriceCut: 15000, lastPriceCutAt: NOW - DAY });
  it("a new cut on a digest-worthy row re-opens it, tagged with the amount", () => {
    expect(reAlertDecision(cut, true)).toEqual({ reopen: true, alertedEventAt: NOW - DAY, alertTag: "PRICE CUT $15,000" });
  });
  it("the same event never re-opens twice", () => {
    expect(reAlertDecision({ ...cut, alertedEventAt: NOW - DAY }, true)).toEqual({ reopen: false });
  });
  it("not digest-worthy after the cut: no re-open, event NOT consumed", () => {
    expect(reAlertDecision(cut, false)).toEqual({ reopen: false });
  });
  it("back on market newer than the last cut is tagged BACK ON MARKET", () => {
    expect(reAlertDecision({ ...cut, backOnMarketAt: NOW }, true)).toEqual({ reopen: true, alertedEventAt: NOW, alertTag: "BACK ON MARKET" });
  });
  it("no event at all: nothing", () => {
    expect(reAlertDecision(row(), true)).toEqual({ reopen: false });
  });
});

describe("digestAlertTag", () => {
  it("shows a fresh tag, hides a stale or missing one", () => {
    expect(digestAlertTag({ alertTag: "PRICE CUT $5,000", alertedEventAt: NOW - 2 * DAY }, NOW)).toBe("PRICE CUT $5,000");
    expect(digestAlertTag({ alertTag: "PRICE CUT $5,000", alertedEventAt: NOW - 8 * DAY }, NOW)).toBeNull();
    expect(digestAlertTag({}, NOW)).toBeNull();
  });
});
