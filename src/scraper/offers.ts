// Pure offer-negotiation logic for P6. Zero-dep; imported by the Convex offer layer
// AND the LeadOffers UI. Spec: docs/superpowers/specs/2026-06-14-offers-contracts-esign-design.md.

export type OfferStatus = "pending" | "countered" | "accepted" | "rejected" | "withdrawn" | "expired";
export const OFFER_STATUSES: OfferStatus[] = ["pending", "countered", "accepted", "rejected", "withdrawn", "expired"];
const TERMINAL: OfferStatus[] = ["accepted", "rejected", "withdrawn", "expired"];

export interface OfferLike {
  _id?: string;
  amount: number;
  status: OfferStatus;
  counterAmount?: number;
  earnestMoney?: number;
  closingDate?: string;
  inspectionDays?: number;
  notes?: string;
  createdAt: number;
}

export function isOfferStatus(s: string): s is OfferStatus {
  return (OFFER_STATUSES as string[]).includes(s);
}

/** A non-terminal offer (pending|countered) may move to any OTHER status; terminal states are final. */
export function canTransition(from: OfferStatus, to: OfferStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  return true;
}

export function summarizeOffers(offers: OfferLike[]): {
  latest: OfferLike | null;
  activeCount: number;
  acceptedOffer: OfferLike | null;
  acceptedPrice: number | null;
} {
  const sorted = [...offers].sort((a, b) => b.createdAt - a.createdAt);
  const latest = sorted[0] ?? null;
  const activeCount = offers.filter((o) => o.status === "pending" || o.status === "countered").length;
  const acceptedOffer = sorted.find((o) => o.status === "accepted") ?? null;
  // The agreed price is the counter when the deal was accepted ON a counter; the
  // original amount otherwise. A PSA built from this must use the counter price.
  const acceptedPrice = acceptedOffer
    ? acceptedOffer.counterAmount ?? acceptedOffer.amount
    : null;
  return { latest, activeCount, acceptedOffer, acceptedPrice };
}
