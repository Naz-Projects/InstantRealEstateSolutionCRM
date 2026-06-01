import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireUser } from "./helpers";

const scrapeType = v.union(v.literal("sheriff"), v.literal("legal"));

// 2-word error codes the scrapers write when data is unavailable — never geocode these.
const ERROR_CODES = new Set([
  "PENDING", "NOT FOUND", "SCRAPE FAILED", "NO ADDRESS", "WRONG STATE",
  "NO PARCEL", "NO STATE", "BAD ADDRESS",
]);

// Rows still missing coordinates (and not already marked failed). Returns the best
// address to geocode per row: the enriched/cleaned propertyAddress (sheriff) when
// available, else the raw scraped address.
export const listMissing = internalQuery({
  args: { type: scrapeType },
  handler: async (ctx, { type }) => {
    const rows =
      type === "sheriff"
        ? await ctx.db.query("sheriffListings").collect()
        : await ctx.db.query("legalNotices").collect();
    return rows
      .filter((r) => r.lat === undefined && r.geocodeStatus !== "failed")
      .map((r) => {
        const cleaned = (r as { propertyAddress?: string }).propertyAddress;
        const best = cleaned && !ERROR_CODES.has(cleaned) ? cleaned : r.address;
        return { id: r._id as string, address: best };
      });
  },
});

// Store (or fail) a row's geocode. Resolves the typed id per table.
export const setGeocode = internalMutation({
  args: {
    type: scrapeType,
    id: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    status: v.union(v.literal("ok"), v.literal("failed")),
  },
  handler: async (ctx, { type, id, lat, lng, status }) => {
    const fields = { lat, lng, geocodeStatus: status, updatedAt: Date.now() };
    if (type === "sheriff") {
      const docId = ctx.db.normalizeId("sheriffListings", id);
      if (docId) await ctx.db.patch(docId, fields);
    } else {
      const docId = ctx.db.normalizeId("legalNotices", id);
      if (docId) await ctx.db.patch(docId, fields);
    }
  },
});

// "Geocode N missing" button (and the post-scrape auto-trigger) schedule the backfill.
export const startGeocode = mutation({
  args: { type: scrapeType },
  handler: async (ctx, { type }) => {
    await requireUser(ctx);
    const rows =
      type === "sheriff"
        ? await ctx.db.query("sheriffListings").collect()
        : await ctx.db.query("legalNotices").collect();
    const missing = rows.filter((r) => r.lat === undefined && r.geocodeStatus !== "failed").length;
    if (missing === 0) return { scheduled: 0 };
    await ctx.scheduler.runAfter(0, internal.geocodeActions.backfillGeocodes, { type });
    return { scheduled: missing };
  },
});
