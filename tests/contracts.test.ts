import { describe, it, expect } from "vitest";
import {
  buildPsaTerms,
  buildAssignmentTerms,
  isSignerNameMatch,
  isTokenExpired,
  canAccept,
  sanitizeFilename,
  canContractTransition,
} from "../src/scraper/contracts";

describe("buildPsaTerms", () => {
  it("maps lead + offer + buyerEntity into seller-signed PSA terms", () => {
    const r = buildPsaTerms(
      { propertyAddress: "1 A St", ownerName: "Jane Doe" },
      { amount: 200000, earnestMoney: 5000, closingDate: "2026-08-01", inspectionDays: 10 },
      "IRES",
    );
    expect(r.terms.propertyAddress).toBe("1 A St");
    expect(r.terms.price).toBe(200000);
    expect(r.terms.sellerName).toBe("Jane Doe");
    expect(r.terms.earnestMoney).toBe(5000);
    expect(r.terms.closingDate).toBe("2026-08-01");
    expect(r.terms.inspectionDays).toBe(10);
    expect(r.terms.buyerEntity).toBe("IRES");
    expect(r.signerName).toBe("Jane Doe");
    expect(r.signerRole).toBe("seller");
  });

  it("falls back to 'Property Owner' when ownerName is missing", () => {
    const r = buildPsaTerms(
      { propertyAddress: "1 A St" },
      { amount: 200000 },
      "IRES",
    );
    expect(r.terms.sellerName).toBe("Property Owner");
    expect(r.signerName).toBe("Property Owner");
    expect(r.signerRole).toBe("seller");
  });
});

describe("buildAssignmentTerms", () => {
  it("maps lead + buyer + fee + ref into buyer-signed assignment terms", () => {
    const r = buildAssignmentTerms(
      { propertyAddress: "1 A St" },
      { name: "Acme LLC" },
      15000,
      "IRES",
      "PSA dated 2026-08-01",
    );
    expect(r.terms.propertyAddress).toBe("1 A St");
    expect(r.terms.buyerEntity).toBe("IRES");
    expect(r.terms.assigneeName).toBe("Acme LLC");
    expect(r.terms.assignmentFee).toBe(15000);
    expect(r.terms.underlyingContractRef).toBe("PSA dated 2026-08-01");
    expect(r.signerName).toBe("Acme LLC");
    expect(r.signerRole).toBe("buyer");
  });
});

describe("isSignerNameMatch", () => {
  it("matches after trimming and collapsing whitespace, case-insensitive", () => {
    expect(isSignerNameMatch("  John   Smith ", "john smith")).toBe(true);
    expect(isSignerNameMatch("JANE DOE", "jane doe")).toBe(true);
  });
  it("rejects different names", () => {
    expect(isSignerNameMatch("Jane", "John")).toBe(false);
  });
  it("treats empty as not a match", () => {
    expect(isSignerNameMatch("", "")).toBe(false);
  });
});

describe("isTokenExpired", () => {
  it("true once now passes expiresAt", () => {
    expect(isTokenExpired({ expiresAt: 100 }, 101)).toBe(true);
  });
  it("false before expiresAt", () => {
    expect(isTokenExpired({ expiresAt: 100 }, 99)).toBe(false);
  });
});

describe("canAccept", () => {
  it("true when sent and not expired", () => {
    expect(canAccept({ status: "sent", expiresAt: 100 }, 50)).toBe(true);
  });
  it("false when status is draft", () => {
    expect(canAccept({ status: "draft", expiresAt: 100 }, 50)).toBe(false);
  });
  it("false when status is signed", () => {
    expect(canAccept({ status: "signed", expiresAt: 100 }, 50)).toBe(false);
  });
  it("false when sent but expired", () => {
    expect(canAccept({ status: "sent", expiresAt: 100 }, 200)).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("strips characters outside [A-Za-z0-9._-]", () => {
    const out = sanitizeFilename("Jän/e:*.pdf");
    expect(out).toBe("J_n_e__.pdf");
    expect(out).toMatch(/^[A-Za-z0-9._-]+$/);
  });
  it("clamps to 120 characters", () => {
    const out = sanitizeFilename("a".repeat(500));
    expect(out.length).toBeLessThanOrEqual(120);
  });
  it("falls back to 'contract' for empty input", () => {
    expect(sanitizeFilename("")).toBe("contract");
  });
});

describe("canContractTransition", () => {
  it("allows valid forward transitions", () => {
    expect(canContractTransition("draft", "sent")).toBe(true);
    expect(canContractTransition("draft", "voided")).toBe(true);
    expect(canContractTransition("sent", "signed")).toBe(true);
    expect(canContractTransition("sent", "declined")).toBe(true);
    expect(canContractTransition("sent", "voided")).toBe(true);
  });
  it("blocks invalid transitions", () => {
    expect(canContractTransition("signed", "sent")).toBe(false);
    expect(canContractTransition("signed", "voided")).toBe(false);
    expect(canContractTransition("voided", "sent")).toBe(false);
    expect(canContractTransition("draft", "signed")).toBe(false);
  });
});
