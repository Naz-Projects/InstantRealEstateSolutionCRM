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
});
