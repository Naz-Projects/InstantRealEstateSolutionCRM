import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { requireUser } from "./helpers";
import { getAuthUser } from "./lib/getAuthUser";
import { canTransition, type OfferStatus } from "../src/scraper/offers";

// P6 offers — V8 data layer (shared-team requireUser). Spec: 2026-06-14-offers-contracts-esign-design.md.

const statusV = v.union(
  v.literal("pending"), v.literal("countered"), v.literal("accepted"),
  v.literal("rejected"), v.literal("withdrawn"), v.literal("expired"),
);

export const offersForParcel = query({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("offers").withIndex("by_prclid", (q) => q.eq("prclid", prclid)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const addOffer = mutation({
  args: {
    prclid: v.string(), amount: v.number(),
    earnestMoney: v.optional(v.number()), closingDate: v.optional(v.string()),
    inspectionDays: v.optional(v.number()), notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireUser(ctx);
    const me = await getAuthUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("offers", {
      prclid: a.prclid, amount: a.amount, status: "pending",
      earnestMoney: a.earnestMoney, closingDate: a.closingDate,
      inspectionDays: a.inspectionDays, notes: a.notes,
      createdByEmail: me?.email, createdAt: now, updatedAt: now,
    });
  },
});

export const updateOfferStatus = mutation({
  args: { offerId: v.id("offers"), status: statusV, counterAmount: v.optional(v.number()) },
  handler: async (ctx, { offerId, status, counterAmount }) => {
    await requireUser(ctx);
    const offer = await ctx.db.get(offerId);
    if (!offer) throw new ConvexError({ code: "NOT_FOUND", message: "Offer not found" });
    if (!canTransition(offer.status as OfferStatus, status)) {
      throw new ConvexError({ code: "BAD_TRANSITION", message: `Cannot move offer from ${offer.status} to ${status}` });
    }
    await ctx.db.patch(offerId, {
      status,
      ...(counterAmount !== undefined ? { counterAmount } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const deleteOffer = mutation({
  args: { offerId: v.id("offers") },
  handler: async (ctx, { offerId }) => {
    await requireUser(ctx);
    await ctx.db.delete(offerId);
  },
});

/** For the contract builder: the accepted offer (if any) for a parcel. */
export const getAcceptedOfferInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    const rows = await ctx.db.query("offers").withIndex("by_prclid", (q) => q.eq("prclid", prclid)).collect();
    return rows.find((o) => o.status === "accepted") ?? null;
  },
});
