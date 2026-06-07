"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  ARCGIS_PARCELS_QUERY,
  buildParcelPageUrl,
  parseParcelFeature,
  deriveAbsentee,
  parcelContentHash,
  type Parcel,
} from "../src/scraper/arcgisParcels";

// 1000/page is reliable now that we request an explicit field list (not outFields=*,
// which 400s on a corrupt field in a dense region). Adaptive halving is kept as a
// belt-and-suspenders safety net for any other region that might still choke.
const START_PAGE = 1000;
const CHUNK = 250; // upsert batch per mutation (stay clear of Convex txn limits)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ArcGIS returns errors as HTTP 200 + {error:{...}} — surface them as throws.
// Retries transient failures (the layer intermittently 400s "Failed to execute
// query" under load) so one hiccup doesn't kill a 200-page seed.
async function fetchArcgis(url: string, attempts = 4): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}: ${text.slice(0, 160)}`);
      const json = JSON.parse(text);
      if (json.error) throw new Error(`ArcGIS ${json.error.code}: ${json.error.message}`);
      return json;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1000 * (i + 1)); // 1s, 2s, 3s backoff
    }
  }
  throw lastErr;
}

// Fetch one full-field page, halving the page size on a persistent failure (dense
// regions exceed a server limit at large page sizes). Always terminates: a 1-record
// page serializes fine. Returns the features array.
async function fetchPageAdaptive(
  afterPrclid: string | undefined,
): Promise<Array<{ attributes: Record<string, unknown> }>> {
  let size = START_PAGE;
  for (;;) {
    try {
      const json = await fetchArcgis(buildParcelPageUrl({ afterPrclid, pageSize: size }), 3);
      return json.features ?? [];
    } catch (e) {
      if (size <= 1) throw e;
      size = Math.max(1, Math.floor(size / 2));
    }
  }
}

function toRow(p: Parcel) {
  const a = deriveAbsentee(p);
  return {
    prclid: p.prclid,
    situsStreet: p.situsStreet,
    propCity: p.propCity,
    propState: p.propState,
    propZip: p.propZip,
    propClass: p.propClass,
    lotSz: p.lotSz ?? undefined,
    ownerName: p.ownerName,
    ownerAddr: p.ownerAddr,
    ownerAddr2: p.ownerAddr2,
    ownerCity: p.ownerCity,
    ownerState: p.ownerState,
    ownerZip: p.ownerZip,
    ownerCountry: p.ownerCountry,
    absentee: a.absentee,
    absenteeReason: a.reason,
    searchText: [p.situsStreet, p.propCity, p.propZip, p.ownerName, p.prclid].join(" "),
    contentHash: parcelContentHash(p),
  };
}

type SeedResult = {
  syncId: Id<"parcelSync">;
  cursor: string | null;
  processed: number;
  inserted: number;
  updated: number;
  done: boolean;
};

/**
 * Seed/refresh the parcel spine via KEYSET pagination (where PRCLID > cursor, ordered).
 * Resumable + idempotent: self-reschedules one page at a time, upserting by PRCLID.
 * Initial run (no syncId) fetches the source count for progress, then walks all pages.
 */
export const seedSpine = internalAction({
  args: { syncId: v.optional(v.id("parcelSync")), afterPrclid: v.optional(v.string()) },
  handler: async (ctx, { syncId, afterPrclid }): Promise<SeedResult> => {
    let id = syncId;
    try {
      if (!id) {
        let total: number | undefined;
        try {
          const c = await fetchArcgis(`${ARCGIS_PARCELS_QUERY}?where=1%3D1&returnCountOnly=true&f=json`);
          total = typeof c.count === "number" ? c.count : undefined;
        } catch {
          /* count is best-effort */
        }
        id = await ctx.runMutation(internal.parcelData.createSync, { kind: "seed", total });
      }

      const feats = await fetchPageAdaptive(afterPrclid);
      const rows = feats.map((f) => toRow(parseParcelFeature(f.attributes)));
      const done = rows.length === 0; // keyset: no rows after the cursor = end of data
      const nextCursor = rows.length ? rows[rows.length - 1].prclid : (afterPrclid ?? null);

      let inserted = 0;
      let updated = 0;
      let absentee = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await ctx.runMutation(internal.parcelData.upsertParcelsBatch, {
          rows: rows.slice(i, i + CHUNK),
        });
        inserted += r.inserted;
        updated += r.updated;
        absentee += r.absentee;
      }

      if (rows.length) {
        await ctx.runMutation(internal.parcelData.updateSyncProgress, {
          syncId: id,
          cursor: nextCursor ?? "",
          processedDelta: rows.length,
          inserted,
          updated,
          absentee,
        });
      }

      if (!done && nextCursor) {
        await ctx.scheduler.runAfter(0, internal.parcelActions.seedSpine, {
          syncId: id,
          afterPrclid: nextCursor,
        });
      } else {
        await ctx.runMutation(internal.parcelData.finishSync, { syncId: id, status: "complete" });
      }
      return { syncId: id, cursor: nextCursor, processed: rows.length, inserted, updated, done };
    } catch (e) {
      if (id) {
        await ctx.runMutation(internal.parcelData.finishSync, {
          syncId: id,
          status: "failed",
          error: String((e as Error).message).slice(0, 500),
        });
      }
      throw e;
    }
  },
});
