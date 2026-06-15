// Pure contract logic for P6 e-sign. Zero-dep; imported by the Convex contract layer,
// the ContractPDF, and the SignPortal. Spec: 2026-06-14-offers-contracts-esign-design.md.

export type ContractType = "psa" | "assignment";
export type ContractStatus = "draft" | "sent" | "signed" | "declined" | "voided";
export const CONTRACT_STATUSES: ContractStatus[] = ["draft", "sent", "signed", "declined", "voided"];

export interface ContractTerms {
  propertyAddress: string;
  buyerEntity: string;
  sellerName?: string;
  price?: number;
  earnestMoney?: number;
  closingDate?: string;
  inspectionDays?: number;
  assigneeName?: string;
  assignmentFee?: number;
  underlyingContractRef?: string;
}

export interface PsaLeadInput { propertyAddress: string; ownerName?: string; }
export interface PsaOfferInput { amount: number; earnestMoney?: number; closingDate?: string; inspectionDays?: number; }

export function buildPsaTerms(
  lead: PsaLeadInput, offer: PsaOfferInput, buyerEntity: string,
): { terms: ContractTerms; signerName: string; signerRole: "seller" } {
  const sellerName = lead.ownerName ?? "Property Owner";
  return {
    terms: {
      propertyAddress: lead.propertyAddress, buyerEntity, sellerName,
      price: offer.amount, earnestMoney: offer.earnestMoney,
      closingDate: offer.closingDate, inspectionDays: offer.inspectionDays,
    },
    signerName: sellerName, signerRole: "seller",
  };
}

export function buildAssignmentTerms(
  lead: { propertyAddress: string }, buyer: { name: string }, assignmentFee: number,
  buyerEntity: string, underlyingContractRef?: string,
): { terms: ContractTerms; signerName: string; signerRole: "buyer" } {
  return {
    terms: {
      propertyAddress: lead.propertyAddress, buyerEntity,
      assigneeName: buyer.name, assignmentFee, underlyingContractRef,
    },
    signerName: buyer.name, signerRole: "buyer",
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export function isSignerNameMatch(typed: string, expected: string): boolean {
  return norm(typed) === norm(expected) && norm(typed).length > 0;
}

export function isTokenExpired(c: { expiresAt: number }, now: number): boolean {
  return now > c.expiresAt;
}
export function canAccept(c: { status: ContractStatus; expiresAt: number }, now: number): boolean {
  return c.status === "sent" && !isTokenExpired(c, now);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "contract";
}

const NEXT: Record<ContractStatus, ContractStatus[]> = {
  draft: ["sent", "voided"],
  sent: ["signed", "declined", "voided"],
  signed: [], declined: [], voided: [],
};
export function canContractTransition(from: ContractStatus, to: ContractStatus): boolean {
  return NEXT[from]?.includes(to) ?? false;
}
