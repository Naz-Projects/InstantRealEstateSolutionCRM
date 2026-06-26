import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requireUser } from "./helpers";
import { getAuthUser } from "./lib/getAuthUser";
import {
  buildPsaTerms, buildAssignmentTerms, isSignerNameMatch, canAccept,
  canContractTransition, sanitizeFilename, type ContractStatus,
} from "../src/scraper/contracts";

// P6 contracts — V8 data layer. TEAM fns are auth-gated (requireUser); the PORTAL
// fns are PUBLIC and gated SOLELY by the secret `publicToken` (re-validated every
// call). Spec: 2026-06-14-offers-contracts-esign-design.md.

const BUYER_ENTITY = "Instant Real Estate Solution";

// Private (NOT exported) — the single credential check shared by every portal fn.
async function tokenLookup(ctx: QueryCtx | MutationCtx, token: string) {
  // SECURITY: publicToken is an optional indexed field — an empty/undefined token would q.eq-match tokenless
  // draft/voided rows (an auth bypass). Reject falsy tokens, and re-check the matched row actually has one.
  if (!token) return null;
  const row = await ctx.db
    .query("contracts")
    .withIndex("by_token", (q) => q.eq("publicToken", token))
    .first();
  return row?.publicToken ? row : null;
}

// ---------------------------------------------------------------------------
// TEAM functions (auth-gated — requireUser first).
// ---------------------------------------------------------------------------

export const contractsForParcel = query({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("contracts")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createContract = mutation({
  args: { prclid: v.string(), type: v.union(v.literal("psa"), v.literal("assignment")) },
  handler: async (ctx, { prclid, type }) => {
    await requireUser(ctx);
    const me = await getAuthUser(ctx);

    const p = await ctx.db
      .query("parcels")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (!p) throw new ConvexError({ code: "NO_PARCEL", message: "No parcel for this lead" });
    const propertyAddress = `${p.situsStreet}, ${p.propCity} ${p.propState} ${p.propZip}`;

    let terms, signerName, signerRole;
    if (type === "psa") {
      const offers = await ctx.db
        .query("offers")
        .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
        .collect();
      const offer = offers.find((o) => o.status === "accepted");
      if (!offer) throw new ConvexError({ code: "NO_ACCEPTED_OFFER", message: "Accept an offer before generating a PSA" });
      ({ terms, signerName, signerRole } = buildPsaTerms(
        { propertyAddress, ownerName: p.ownerName },
        // Agreed price = the counter when the offer was accepted on a counter.
        { amount: offer.counterAmount ?? offer.amount, earnestMoney: offer.earnestMoney, closingDate: offer.closingDate, inspectionDays: offer.inspectionDays },
        BUYER_ENTITY,
      ));
    } else {
      const ls = await ctx.db
        .query("leadStatus")
        .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
        .first();
      if (!ls?.buyerId || ls.assignmentFee == null) {
        throw new ConvexError({ code: "NO_BUYER", message: "Assign a buyer + fee before generating an assignment" });
      }
      const buyer = await ctx.db.get(ls.buyerId);
      if (!buyer) throw new ConvexError({ code: "NO_BUYER", message: "Assign a buyer + fee before generating an assignment" });
      ({ terms, signerName, signerRole } = buildAssignmentTerms(
        { propertyAddress },
        { name: buyer.name },
        ls.assignmentFee,
        BUYER_ENTITY,
      ));
    }

    const now = Date.now();
    return await ctx.db.insert("contracts", {
      prclid, type, status: "draft", terms, signerName, signerRole,
      createdByEmail: me?.email, createdAt: now, updatedAt: now,
    });
  },
});

export const sendContract = mutation({
  args: { contractId: v.id("contracts"), signerEmail: v.optional(v.string()) },
  handler: async (ctx, { contractId, signerEmail }): Promise<{ token: string }> => {
    await requireUser(ctx);
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError({ code: "NOT_FOUND", message: "Contract not found" });
    if (!canContractTransition(contract.status as ContractStatus, "sent")) {
      throw new ConvexError({ code: "BAD_STATE", message: `Cannot send a ${contract.status} contract` });
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    const now = Date.now();
    await ctx.db.patch(contractId, {
      publicToken: token,
      tokenCreatedAt: now,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      status: "sent",
      ...(signerEmail !== undefined ? { signerEmail } : {}),
      updatedAt: now,
    });
    if (signerEmail) {
      await ctx.scheduler.runAfter(0, internal.contractActions.emailSigningRequest, { contractId });
    }
    return { token };
  },
});

export const voidContract = mutation({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    await requireUser(ctx);
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError({ code: "NOT_FOUND", message: "Contract not found" });
    if (!canContractTransition(contract.status as ContractStatus, "voided")) {
      throw new ConvexError({ code: "BAD_STATE", message: `Cannot void a ${contract.status} contract` });
    }
    await ctx.db.patch(contractId, { status: "voided", updatedAt: Date.now() });
  },
});

export const getSignedUrl = query({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    await requireUser(ctx);
    const contract = await ctx.db.get(contractId);
    if (!contract) throw new ConvexError({ code: "NOT_FOUND", message: "Contract not found" });
    if (contract.signedStorageId) return await ctx.storage.getUrl(contract.signedStorageId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// PUBLIC PORTAL functions — NO requireUser. The secret token is the ONLY
// credential, re-validated on EVERY call via tokenLookup + canAccept/status.
// ---------------------------------------------------------------------------

export const getContractByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const c = await tokenLookup(ctx, token);
    if (!c || c.status === "voided") return { found: false as const };
    // SAFE projection ONLY — never prclid / row id / createdByEmail / other rows.
    return {
      found: true as const,
      type: c.type,
      status: c.status,
      terms: c.terms,
      signerName: c.signerName,
      signerRole: c.signerRole,
      expiresAt: c.expiresAt ?? 0,
      acceptedAt: c.acceptedAt ?? null,
      signed: c.status === "signed",
    };
  },
});

export const generateSignUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const c = await tokenLookup(ctx, token);
    if (!c) throw new ConvexError({ code: "INVALID_TOKEN", message: "Invalid signing link" });
    if (!canAccept({ status: c.status, expiresAt: c.expiresAt ?? 0 }, Date.now())) {
      throw new ConvexError({ code: "NOT_SIGNABLE", message: "This contract is not awaiting signature" });
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const acceptContract = mutation({
  args: {
    token: v.string(),
    signedStorageId: v.id("_storage"),
    signatureMode: v.union(v.literal("typed"), v.literal("drawn")),
    acceptedByName: v.string(),
    acknowledgments: v.object({ bindingContract: v.boolean() }),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ alreadySigned: boolean }> => {
    const c = await tokenLookup(ctx, a.token);
    if (!c) throw new ConvexError({ code: "INVALID_TOKEN", message: "Invalid signing link" });
    if (c.status === "signed") return { alreadySigned: true as const };
    if (!canAccept({ status: c.status, expiresAt: c.expiresAt ?? 0 }, Date.now())) {
      throw new ConvexError({ code: "NOT_SIGNABLE", message: "This contract is not awaiting signature" });
    }
    if (a.signatureMode === "typed" && !isSignerNameMatch(a.acceptedByName, c.signerName)) {
      throw new ConvexError({ code: "NAME_MISMATCH", message: "Typed name doesn't match the expected signer" });
    }

    const now = Date.now();
    await ctx.db.patch(c._id, {
      status: "signed",
      acceptedAt: now,
      acceptedByName: a.acceptedByName,
      acceptedUserAgent: a.userAgent,
      acknowledgments: a.acknowledgments,
      signatureMode: a.signatureMode,
      signedStorageId: a.signedStorageId,
      signedFilename: sanitizeFilename(`${c.type}-${c.signerName}-signed.pdf`),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.contractActions.emailSignedCopy, { contractId: c._id });
    return { alreadySigned: false as const };
  },
});

export const declineContract = mutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { token, reason }) => {
    const c = await tokenLookup(ctx, token);
    if (!c) throw new ConvexError({ code: "INVALID_TOKEN", message: "Invalid signing link" });
    if (c.status !== "sent") {
      throw new ConvexError({ code: "NOT_SIGNABLE", message: "This contract can't be declined" });
    }
    const now = Date.now();
    await ctx.db.patch(c._id, {
      status: "declined",
      declinedAt: now,
      declineReason: reason,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// INTERNAL — for CLI/verify + the future email action.
// ---------------------------------------------------------------------------

export const getContractInternal = internalQuery({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, { contractId }) => {
    return await ctx.db.get(contractId);
  },
});
