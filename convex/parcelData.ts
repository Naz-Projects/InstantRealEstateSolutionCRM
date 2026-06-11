import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./helpers";

// One parcel row as the seed/sync action passes it (parsed + derived in arcgisParcels.ts).
const parcelRow = v.object({
  prclid: v.string(),
  situsStreet: v.string(),
  propCity: v.string(),
  propState: v.string(),
  propZip: v.string(),
  propClass: v.string(),
  lotSz: v.optional(v.number()),
  ownerName: v.string(),
  ownerAddr: v.string(),
  ownerAddr2: v.string(),
  ownerCity: v.string(),
  ownerState: v.string(),
  ownerZip: v.string(),
  ownerCountry: v.string(),
  absentee: v.boolean(),
  absenteeReason: v.string(),
  searchText: v.string(),
  contentHash: v.string(),
});

// ---- sync lifecycle (internal; driven by parcelActions) ----

export const createSync = internalMutation({
  args: { kind: v.union(v.literal("seed"), v.literal("sync")), total: v.optional(v.number()) },
  handler: async (ctx, { kind, total }) => {
    return await ctx.db.insert("parcelSync", {
      kind,
      status: "running",
      total,
      processed: 0,
      inserted: 0,
      updated: 0,
      absentee: 0,
      startedAt: Date.now(),
    });
  },
});

export const upsertParcelsBatch = internalMutation({
  args: { rows: v.array(parcelRow) },
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    let absentee = 0;
    for (const row of rows) {
      if (row.absentee) absentee++;
      const existing = await ctx.db
        .query("parcels")
        .withIndex("by_prclid", (q) => q.eq("prclid", row.prclid))
        .first();
      if (!existing) {
        await ctx.db.insert("parcels", { ...row, firstSeen: now, lastSeen: now, active: true });
        inserted++;
      } else if (existing.contentHash !== row.contentHash) {
        await ctx.db.patch(existing._id, { ...row, lastSeen: now, active: true });
        updated++;
      } else if (!existing.active) {
        // Parcel reappeared in the source after being marked inactive — reactivate.
        await ctx.db.patch(existing._id, { lastSeen: now, active: true });
      }
      // Unchanged active rows get NO write: patching lastSeen on all 203k rows made
      // every full re-seed cost ~203k writes (the 2026-06 quota burn); lastSeen is
      // not read anywhere, and vanished-detection is the CDC key-diff's job.
    }
    return { inserted, updated, absentee };
  },
});

export const updateSyncProgress = internalMutation({
  args: {
    syncId: v.id("parcelSync"),
    cursor: v.string(),
    processedDelta: v.number(),
    inserted: v.number(),
    updated: v.number(),
    absentee: v.number(),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.syncId);
    if (!row) return;
    await ctx.db.patch(a.syncId, {
      cursor: a.cursor,
      processed: row.processed + a.processedDelta,
      inserted: row.inserted + a.inserted,
      updated: row.updated + a.updated,
      absentee: row.absentee + a.absentee,
    });
  },
});

export const finishSync = internalMutation({
  args: {
    syncId: v.id("parcelSync"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { syncId, status, error }) => {
    await ctx.db.patch(syncId, { status, error, finishedAt: Date.now() });
  },
});

export const markInactiveByPrclids = internalMutation({
  args: { prclids: v.array(v.string()) },
  handler: async (ctx, { prclids }) => {
    let n = 0;
    for (const prclid of prclids) {
      const row = await ctx.db
        .query("parcels")
        .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
        .first();
      if (row && row.active) {
        await ctx.db.patch(row._id, { active: false });
        n++;
      }
    }
    return { deactivated: n };
  },
});

// Active stored PRCLIDs within a keyset range (cursor, lastInclusive] — for the CDC
// range-merge diff. Bounded (one key page ≈ one source range ≈ ~1000 docs).
export const storedActivePrclidsInRange = internalQuery({
  args: { after: v.optional(v.string()), lastInclusive: v.string() },
  handler: async (ctx, { after, lastInclusive }) => {
    const rows = await ctx.db
      .query("parcels")
      .withIndex("by_prclid", (q) =>
        after ? q.gt("prclid", after).lte("prclid", lastInclusive) : q.lte("prclid", lastInclusive),
      )
      .collect();
    return rows.filter((r) => r.active).map((r) => r.prclid);
  },
});

// CLI-callable count (bypasses auth via the deploy key) — for proving the seed.
export const statsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const latest = await ctx.db.query("parcelSync").withIndex("by_started").order("desc").first();
    return latest;
  },
});

// ---- browser-facing queries (auth-gated) ----

export const parcelStats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    // Few rows (one per seed/sync run). Totals come from the latest SEED (full counts);
    // a "sync" only records deltas, so reading it for totals would wrongly show ~0.
    const runs = await ctx.db.query("parcelSync").withIndex("by_started").order("desc").collect();
    if (runs.length === 0) return null;
    const latestSeed = runs.find((r) => r.kind === "seed");
    const lastRun = runs[0];
    const base = latestSeed ?? lastRun;
    return {
      total: base.processed,
      absentee: base.absentee,
      status: base.status,
      lastSyncedAt: lastRun.finishedAt ?? lastRun.startedAt,
    };
  },
});

export const searchParcels = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    await requireUser(ctx);
    const term = q.trim();
    if (!term) return [];
    const rows = await ctx.db
      .query("parcels")
      .withSearchIndex("search_text", (s) => s.search("searchText", term))
      .take(25);
    return rows.map((r) => ({
      _id: r._id,
      prclid: r.prclid,
      situsStreet: r.situsStreet,
      propCity: r.propCity,
      propZip: r.propZip,
      propClass: r.propClass,
      ownerName: r.ownerName,
      absentee: r.absentee,
      absenteeReason: r.absenteeReason,
      active: r.active,
    }));
  },
});

export const getParcel = query({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("parcels")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
  },
});

export const ownerParcels = query({
  args: { ownerName: v.string() },
  handler: async (ctx, { ownerName }) => {
    await requireUser(ctx);
    if (!ownerName.trim()) return [];
    return await ctx.db
      .query("parcels")
      .withIndex("by_owner", (q) => q.eq("ownerName", ownerName))
      .take(50);
  },
});
