import { describe, it, expect } from "vitest";
import { canTransition, summarizeOffers, isOfferStatus, type OfferLike } from "../src/scraper/offers";

const mk = (o: Partial<OfferLike>): OfferLike => ({ amount: 100000, status: "pending", createdAt: 1, ...o });

describe("isOfferStatus", () => {
  it("validates", () => {
    expect(isOfferStatus("accepted")).toBe(true);
    expect(isOfferStatus("nope")).toBe(false);
  });
});
describe("canTransition", () => {
  it("allows non-terminal → other status", () => {
    expect(canTransition("pending", "accepted")).toBe(true);
    expect(canTransition("pending", "countered")).toBe(true);
    expect(canTransition("countered", "accepted")).toBe(true);
  });
  it("blocks terminal → anything and same → same", () => {
    expect(canTransition("accepted", "rejected")).toBe(false);
    expect(canTransition("rejected", "pending")).toBe(false);
    expect(canTransition("pending", "pending")).toBe(false);
  });
});
describe("summarizeOffers", () => {
  it("latest by createdAt, active count, accepted offer + price", () => {
    const offers = [
      mk({ amount: 90000, status: "rejected", createdAt: 1 }),
      mk({ amount: 95000, status: "accepted", createdAt: 3 }),
      mk({ amount: 92000, status: "pending", createdAt: 2 }),
    ];
    const s = summarizeOffers(offers);
    expect(s.latest!.createdAt).toBe(3);
    expect(s.activeCount).toBe(1);
    expect(s.acceptedOffer!.amount).toBe(95000);
    expect(s.acceptedPrice).toBe(95000);
  });
  it("empty → nulls", () => {
    expect(summarizeOffers([])).toEqual({ latest: null, activeCount: 0, acceptedOffer: null, acceptedPrice: null });
  });
  it("uses the counterAmount as the agreed price when an accepted offer was countered", () => {
    const offers = [
      mk({ amount: 90000, status: "accepted", counterAmount: 102000, createdAt: 5 }),
    ];
    const s = summarizeOffers(offers);
    expect(s.acceptedOffer!.amount).toBe(90000);
    expect(s.acceptedPrice).toBe(102000); // the agreed price is the counter, not the pre-counter amount
  });
  it("falls back to amount when an accepted offer has no counterAmount", () => {
    const s = summarizeOffers([mk({ amount: 88000, status: "accepted", createdAt: 5 })]);
    expect(s.acceptedPrice).toBe(88000);
  });
});
