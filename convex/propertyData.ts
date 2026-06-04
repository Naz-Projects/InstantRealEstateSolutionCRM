import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUser } from "./helpers";
import { parseMoney } from "../src/scraper/deal";
import { summarizeProperty } from "../src/scraper/portfolio";

const dealTypeV = v.union(v.literal("flip"), v.literal("rental"));
const statusV = v.union(
  v.literal("in_progress"),
  v.literal("sold"),
  v.literal("active"),
  v.literal("vacant"),
);
const directionV = v.union(v.literal("expense"), v.literal("income"));

type LedgerRow = Doc<"propertyLedger">;

function summaryFor(p: Doc<"properties">, ledger: LedgerRow[]) {
  return summarizeProperty(
    {
      dealType: p.dealType,
      status: p.status,
      purchasePrice: p.purchasePrice ?? null,
      salePrice: p.salePrice ?? null,
    },
    ledger.map((e) => ({ direction: e.direction, amount: e.amount })),
  );
}

export const listProperties = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("properties").order("desc").collect();
    return Promise.all(
      rows.map(async (p) => {
        const ledger = await ctx.db
          .query("propertyLedger")
          .withIndex("by_property", (q) => q.eq("propertyId", p._id))
          .collect();
        return { ...p, summary: summaryFor(p, ledger) };
      }),
    );
  },
});

export const getProperty = query({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const p = await ctx.db.get(id);
    if (!p) return null;
    const ledger = await ctx.db
      .query("propertyLedger")
      .withIndex("by_property", (q) => q.eq("propertyId", id))
      .collect();
    ledger.sort((a, b) => b.date - a.date);
    return { ...p, ledger, summary: summaryFor(p, ledger) };
  },
});

// Recent sheriff + legal + flip rows for the "seed from existing" picker. Read-only.
export const candidates = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const sheriff = await ctx.db.query("sheriffListings").order("desc").take(200);
    const legal = await ctx.db.query("legalNotices").order("desc").take(200);
    const flip = await ctx.db.query("flipAnalyses").order("desc").take(200);
    const pick = (r: { _id: unknown; address: string }) => ({ id: String(r._id), address: r.address });
    return { sheriff: sheriff.map(pick), legal: legal.map(pick), flip: flip.map(pick) };
  },
});

type Facts = {
  address: string;
  beds?: string;
  baths?: string;
  sqft?: number;
  purchasePrice?: number;
  zillowUrl?: string;
};

function seed(
  dealType: "flip" | "rental",
  source: Doc<"properties">["source"],
  facts: Facts,
  createdBy: string,
): Omit<Doc<"properties">, "_id" | "_creationTime"> {
  const now = Date.now();
  return {
    dealType,
    status: dealType === "flip" ? "in_progress" : "active",
    source,
    address: facts.address,
    beds: facts.beds,
    baths: facts.baths,
    sqft: facts.sqft,
    purchasePrice: facts.purchasePrice,
    acquiredDate: undefined,
    salePrice: undefined,
    soldDate: undefined,
    zillowUrl: facts.zillowUrl,
    imageUrl: undefined,
    imageStatus: facts.address ? "pending" : undefined,
    notes: undefined,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export const createManual = mutation({
  args: {
    dealType: dealTypeV,
    address: v.string(),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    sqft: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    zillowUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const id = await ctx.db.insert(
      "properties",
      seed(args.dealType, { kind: "manual" }, args, user),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const createFromSheriff = mutation({
  args: { listingId: v.id("sheriffListings"), dealType: dealTypeV },
  handler: async (ctx, { listingId, dealType }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Sheriff listing not found");
    const id = await ctx.db.insert(
      "properties",
      seed(
        dealType,
        { kind: "sheriff", refId: String(listingId) },
        {
          address: l.address,
          beds: l.beds || undefined,
          baths: l.baths || undefined,
          sqft: parseMoney(l.sqft) ?? undefined,
          zillowUrl: l.zillowUrl || undefined,
        },
        user,
      ),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const createFromLegal = mutation({
  args: { listingId: v.id("legalNotices"), dealType: dealTypeV },
  handler: async (ctx, { listingId, dealType }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Legal notice not found");
    const id = await ctx.db.insert(
      "properties",
      seed(
        dealType,
        { kind: "legal", refId: String(listingId) },
        {
          address: l.address,
          beds: l.beds || undefined,
          baths: l.baths || undefined,
          sqft: parseMoney(l.sqft) ?? undefined,
          zillowUrl: l.zillowUrl || undefined,
        },
        user,
      ),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const createFromFlip = mutation({
  args: { analysisId: v.id("flipAnalyses"), dealType: dealTypeV },
  handler: async (ctx, { analysisId, dealType }) => {
    const user = await requireUser(ctx);
    const a = await ctx.db.get(analysisId);
    if (!a) throw new Error("Flip analysis not found");
    const id = await ctx.db.insert(
      "properties",
      seed(
        dealType,
        { kind: "flip", refId: String(analysisId) },
        {
          address: a.address,
          beds: a.beds,
          baths: a.baths,
          sqft: a.sqft,
          purchasePrice: a.purchasePrice,
        },
        user,
      ),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const updateProperty = mutation({
  args: {
    id: v.id("properties"),
    patch: v.object({
      dealType: v.optional(dealTypeV),
      status: v.optional(statusV),
      address: v.optional(v.string()),
      beds: v.optional(v.union(v.string(), v.null())),
      baths: v.optional(v.union(v.string(), v.null())),
      sqft: v.optional(v.union(v.number(), v.null())),
      zestimate: v.optional(v.union(v.string(), v.null())),
      purchasePrice: v.optional(v.union(v.number(), v.null())),
      acquiredDate: v.optional(v.union(v.number(), v.null())),
      zillowUrl: v.optional(v.union(v.string(), v.null())),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireUser(ctx);
    const p = await ctx.db.get(id);
    if (!p) throw new Error("Property not found");
    await ctx.db.patch(id, {
      dealType: patch.dealType ?? p.dealType,
      status: patch.status ?? p.status,
      address: patch.address ?? p.address,
      beds: "beds" in patch ? patch.beds ?? undefined : p.beds,
      baths: "baths" in patch ? patch.baths ?? undefined : p.baths,
      sqft: "sqft" in patch ? patch.sqft ?? undefined : p.sqft,
      zestimate: "zestimate" in patch ? patch.zestimate ?? undefined : p.zestimate,
      purchasePrice: "purchasePrice" in patch ? patch.purchasePrice ?? undefined : p.purchasePrice,
      acquiredDate: "acquiredDate" in patch ? patch.acquiredDate ?? undefined : p.acquiredDate,
      zillowUrl: "zillowUrl" in patch ? patch.zillowUrl ?? undefined : p.zillowUrl,
      notes: patch.notes ?? p.notes,
      updatedAt: Date.now(),
    });
  },
});

export const markSold = mutation({
  args: { id: v.id("properties"), salePrice: v.number(), soldDate: v.number() },
  handler: async (ctx, { id, salePrice, soldDate }) => {
    await requireUser(ctx);
    const p = await ctx.db.get(id);
    if (!p) throw new Error("Property not found");
    await ctx.db.patch(id, { status: "sold", salePrice, soldDate, updatedAt: Date.now() });
  },
});

export const setPhotoUrl = mutation({
  args: { id: v.id("properties"), imageUrl: v.string() },
  handler: async (ctx, { id, imageUrl }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { imageUrl, imageStatus: "ok", updatedAt: Date.now() });
  },
});

export const refreshPropertyImage = mutation({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { imageStatus: "pending" });
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
  },
});

export const addLedgerEntry = mutation({
  args: {
    propertyId: v.id("properties"),
    direction: directionV,
    category: v.string(),
    amount: v.number(),
    date: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return ctx.db.insert("propertyLedger", { ...args, createdBy: user, createdAt: Date.now() });
  },
});

export const deleteLedgerEntry = mutation({
  args: { id: v.id("propertyLedger") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.delete(id);
  },
});

export const deleteProperty = mutation({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const entries = await ctx.db
      .query("propertyLedger")
      .withIndex("by_property", (q) => q.eq("propertyId", id))
      .collect();
    for (const e of entries) await ctx.db.delete(e._id);
    await ctx.db.delete(id);
  },
});

// --- internal helpers for the image-scrape action ---

export const getForImage = internalQuery({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p) return null;
    return { address: p.address, zillowUrl: p.zillowUrl };
  },
});

// Auto-fill beds/baths/sqft/zestimate from the Zillow scrape that runs on create + the
// "Refresh photo" button. Fill-ONLY-empty: never clobbers seeded (sheriff/legal) facts or
// values the user typed. The caller (scrapePropertyImage) only sends facts on a confident
// Delaware match, so this just applies them to still-empty fields.
export const applyZillowFacts = internalMutation({
  args: {
    id: v.id("properties"),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    sqft: v.optional(v.number()),
    zestimate: v.optional(v.string()),
  },
  handler: async (ctx, { id, beds, baths, sqft, zestimate }) => {
    const p = await ctx.db.get(id);
    if (!p) return;
    const patch: Partial<Doc<"properties">> = {};
    if (!p.beds && beds) patch.beds = beds;
    if (!p.baths && baths) patch.baths = baths;
    if (p.sqft == null && sqft != null) patch.sqft = sqft;
    if (!p.zestimate && zestimate) patch.zestimate = zestimate;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
  },
});

export const setImage = internalMutation({
  args: {
    id: v.id("properties"),
    imageUrl: v.optional(v.string()),
    status: v.union(v.literal("ok"), v.literal("failed")),
  },
  handler: async (ctx, { id, imageUrl, status }) => {
    const patch: { imageStatus: "ok" | "failed"; updatedAt: number; imageUrl?: string } = {
      imageStatus: status,
      updatedAt: Date.now(),
    };
    if (imageUrl) patch.imageUrl = imageUrl;
    await ctx.db.patch(id, patch);
  },
});
