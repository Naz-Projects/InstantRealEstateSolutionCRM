import { describe, it, expect } from "vitest";
import {
  parseZipList, normalizeBuyBox, isEmptyBuyBox, matchesBuyBox, planRecipientDigests, shouldStampDigest,
  type BuyBox, type BuyBoxRow,
} from "../src/scraper/monitorBuyBox";

const box = (o: Partial<BuyBox> = {}): BuyBox => ({ zips: [], exits: [], ...o });
const flip = (o: Partial<BuyBoxRow> = {}): BuyBoxRow =>
  ({ address: "1 A St, Wilmington, DE 19805", propZip: "19805", listPrice: 250000, beds: 3, bestExit: "FLIP", flipProfit: 40000, ...o });
const rental = (o: Partial<BuyBoxRow> = {}): BuyBoxRow =>
  ({ address: "2 B St, Newark, DE 19711", propZip: "19711", listPrice: 180000, beds: 2, bestExit: "RENTAL", cashFlow: 150, ...o });

describe("parseZipList", () => {
  it("splits on commas/spaces, trims ZIP+4, dedupes, reports junk", () => {
    expect(parseZipList(" 19805, 19806 19711-1234 ,19805 abc 1980 ")).toEqual({ zips: ["19805", "19806", "19711"], invalid: ["abc", "1980"] });
    expect(parseZipList("")).toEqual({ zips: [], invalid: [] });
  });
});

describe("normalizeBuyBox", () => {
  it("accepts a full box and normalizes ZIPs", () => {
    const r = normalizeBuyBox({ zips: ["19805-1234", "19806"], priceMin: 100000, priceMax: 300000, minBeds: 3, exits: ["FLIP"], minFlipProfit: 30000, minCashFlow: -50 });
    expect(r).toEqual({ ok: true, box: { zips: ["19805", "19806"], priceMin: 100000, priceMax: 300000, minBeds: 3, exits: ["FLIP"], minFlipProfit: 30000, minCashFlow: -50 } });
  });
  it("rejects min price above max price", () => {
    expect(normalizeBuyBox({ zips: [], priceMin: 300000, priceMax: 200000, exits: [] })).toEqual({ ok: false, error: "Min price is above max price" });
  });
  it("rejects a bad ZIP, a bad exit, a negative price and a non-finite number", () => {
    expect(normalizeBuyBox({ zips: ["abc"], exits: [] })).toEqual({ ok: false, error: "Not a 5-digit ZIP: abc" });
    expect(normalizeBuyBox({ zips: [], exits: ["WHOLESALE"] })).toEqual({ ok: false, error: "Exits must be FLIP or RENTAL" });
    expect(normalizeBuyBox({ zips: [], exits: [], priceMin: -1 })).toEqual({ ok: false, error: "Numbers must be 0 or more (except min cash flow)" });
    expect(normalizeBuyBox({ zips: [], exits: [], minBeds: Number.NaN })).toEqual({ ok: false, error: "Numbers must be 0 or more (except min cash flow)" });
  });
  it("an all-empty box is empty (= everything)", () => {
    const r = normalizeBuyBox({ zips: [], exits: [] });
    expect(r.ok && isEmptyBuyBox(r.box)).toBe(true);
    expect(isEmptyBuyBox(box({ zips: ["19805"] }))).toBe(false);
  });
});

describe("matchesBuyBox", () => {
  it("no box = everything", () => {
    expect(matchesBuyBox(flip(), null)).toBe(true);
    expect(matchesBuyBox(flip(), undefined)).toBe(true);
  });
  it("ZIPs: propZip, else the address ZIP; a missing ZIP fails a ZIP box", () => {
    expect(matchesBuyBox(flip(), box({ zips: ["19805"] }))).toBe(true);
    expect(matchesBuyBox(flip({ propZip: undefined }), box({ zips: ["19805"] }))).toBe(true);
    expect(matchesBuyBox(rental(), box({ zips: ["19805"] }))).toBe(false);
    expect(matchesBuyBox(flip({ propZip: undefined, address: "no zip here" }), box({ zips: ["19805"] }))).toBe(false);
  });
  it("price band", () => {
    expect(matchesBuyBox(flip(), box({ priceMin: 200000, priceMax: 250000 }))).toBe(true);
    expect(matchesBuyBox(flip(), box({ priceMax: 249999 }))).toBe(false);
    expect(matchesBuyBox(flip(), box({ priceMin: 250001 }))).toBe(false);
  });
  it("min beds: numeric or string beds compared, unknown beds pass", () => {
    expect(matchesBuyBox(flip({ beds: "3" }), box({ minBeds: 3 }))).toBe(true);
    expect(matchesBuyBox(flip({ beds: 2 }), box({ minBeds: 3 }))).toBe(false);
    expect(matchesBuyBox(flip({ beds: undefined }), box({ minBeds: 3 }))).toBe(true);
  });
  it("exits wanted", () => {
    expect(matchesBuyBox(rental(), box({ exits: ["FLIP"] }))).toBe(false);
    expect(matchesBuyBox(rental(), box({ exits: ["FLIP", "RENTAL"] }))).toBe(true);
  });
  it("min flip profit applies to FLIP rows only; min cash flow to RENTAL rows only", () => {
    const b = box({ minFlipProfit: 50000, minCashFlow: 200 });
    expect(matchesBuyBox(flip(), b)).toBe(false);
    expect(matchesBuyBox(flip({ flipProfit: 60000 }), b)).toBe(true);
    expect(matchesBuyBox(rental(), b)).toBe(false);
    expect(matchesBuyBox(rental({ cashFlow: 250 }), b)).toBe(true);
    expect(matchesBuyBox(flip({ flipProfit: undefined }), box({ minFlipProfit: 1 }))).toBe(false);
  });
});

describe("planRecipientDigests", () => {
  const rows = [flip(), rental()];
  it("filters per recipient by their box; fallback has no box; duplicate fallback ignored", () => {
    const plan = planRecipientDigests(rows, [
      { email: "Ann@x.com", box: box({ exits: ["RENTAL"] }) },
      { email: "bob@x.com", box: null },
    ], "ann@x.com");
    expect(plan).toEqual([
      { to: "Ann@x.com", rows: [rows[1]] },
      { to: "bob@x.com", rows },
    ]);
  });
  it("the RESEND_TO fallback alone gets everything", () => {
    expect(planRecipientDigests(rows, [], "ops@x.com")).toEqual([{ to: "ops@x.com", rows }]);
  });
  it("a recipient whose box matches nothing is omitted", () => {
    expect(planRecipientDigests(rows, [{ email: "c@x.com", box: box({ zips: ["19999"] }) }])).toEqual([]);
  });
});

describe("shouldStampDigest", () => {
  it("stamp when nothing to send or any send succeeded; not when every send failed", () => {
    expect(shouldStampDigest(0, 0)).toBe(true);
    expect(shouldStampDigest(3, 1)).toBe(true);
    expect(shouldStampDigest(2, 0)).toBe(false);
  });
});
