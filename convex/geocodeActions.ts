"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { geocodeAddress } from "../src/scraper/geocode";

function geoKey(): string {
  const k = (process.env.GOOGLE_GEOCODING_API_KEY ?? "").trim();
  if (!k) throw new Error("GOOGLE_GEOCODING_API_KEY is not set (npx convex env set GOOGLE_GEOCODING_API_KEY ...)");
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Geocode every row of `type` that's missing coordinates. Idempotent: only rows
// with no lat and not already marked failed are touched. A no-DE-result marks the
// row "failed" (won't retry); a thrown error (rate limit / network) leaves it for
// the next run.
export const backfillGeocodes = internalAction({
  args: { type: v.union(v.literal("sheriff"), v.literal("legal")) },
  handler: async (ctx, { type }): Promise<{ geocoded: number; failed: number }> => {
    const key = geoKey();
    const missing = await ctx.runQuery(internal.geocodeData.listMissing, { type });
    let geocoded = 0;
    let failed = 0;
    for (const row of missing) {
      try {
        const pt = await geocodeAddress(row.address, key);
        if (pt) {
          await ctx.runMutation(internal.geocodeData.setGeocode, {
            type, id: row.id, lat: pt.lat, lng: pt.lng, status: "ok",
          });
          geocoded++;
        } else {
          await ctx.runMutation(internal.geocodeData.setGeocode, { type, id: row.id, status: "failed" });
          failed++;
        }
      } catch {
        // transient — leave the row (lat still undefined, status not failed) for a later run
      }
      await sleep(200);
    }
    return { geocoded, failed };
  },
});
