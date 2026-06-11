import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./helpers";
import { computeLeadScore } from "../src/scraper/leadScore";

// One signal event as the sync actions pass it (parsed in src/scraper/*).
const signalEventInput = v.object({
  prclid: v.string(),
  category: v.union(
    v.literal("financial"),
    v.literal("life-event"),
    v.literal("physical"),
    v.literal("situational"),
  ),
  type: v.string(),
  source: v.string(),
  externalKey: v.string(),
  observedDate: v.number(),
  status: v.string(),
  matchConfidence: v.optional(
    v.union(v.literal("exact"), v.literal("strong"), v.literal("weak")),
  ),
  payload: v.any(),
});

// ---- internal: written by the sync actions ----

export const upsertEventsBatch = internalMutation({
  args: { rows: v.array(signalEventInput) },
  handler: async (ctx, { rows }) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = await ctx.db
        .query("signalEvents")
        .withIndex("by_externalKey", (q) => q.eq("externalKey", row.externalKey))
        .first();
      if (!existing) {
        await ctx.db.insert("signalEvents", { ...row, firstSeen: now, lastSeen: now });
        inserted++;
      } else if (
        existing.status !== row.status ||
        existing.observedDate !== row.observedDate ||
        existing.prclid !== row.prclid
      ) {
        await ctx.db.patch(existing._id, { ...row, lastSeen: now });
        updated++;
      }
      // unchanged → no write (quota-aware, same rule as the parcel upsert)
    }
    return { inserted, updated };
  },
});

export const getWatermark = internalQuery({
  args: { source: v.string() },
  handler: async (ctx, { source }) => {
    return await ctx.db
      .query("signalWatermarks")
      .withIndex("by_source", (q) => q.eq("source", source))
      .first();
  },
});

export const setWatermark = internalMutation({
  args: { source: v.string(), watermark: v.string(), lastResult: v.string() },
  handler: async (ctx, { source, watermark, lastResult }) => {
    const existing = await ctx.db
      .query("signalWatermarks")
      .withIndex("by_source", (q) => q.eq("source", source))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { watermark, lastRunAt: Date.now(), lastResult });
    } else {
      await ctx.db.insert("signalWatermarks", {
        source,
        watermark,
        lastRunAt: Date.now(),
        lastResult,
      });
    }
  },
});

// Owner-name candidates for the foreclosure defendant match: probe the parcel
// search index with the defendant's name, return slim {prclid, ownerName} rows.
// The strict token matcher (courtConnect.matchDefendantToOwners) filters these.
export const ownerCandidates = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    if (!name.trim()) return [];
    const rows = await ctx.db
      .query("parcels")
      .withSearchIndex("search_text", (s) => s.search("searchText", name))
      .take(10);
    return rows
      .filter((r) => r.active)
      .map((r) => ({ prclid: r.prclid, ownerName: r.ownerName }));
  },
});

// CLI-callable stats (deploy-key access) — for live verification of the syncs.
export const signalStatsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("signalEvents").collect();
    const byType: Record<string, number> = {};
    let unmatched = 0;
    for (const e of events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (!e.prclid) unmatched++;
    }
    const watermarks = await ctx.db.query("signalWatermarks").collect();
    return {
      total: events.length,
      byType,
      unmatched,
      watermarks: watermarks.map((w) => ({
        source: w.source,
        watermark: w.watermark,
        lastResult: w.lastResult,
      })),
    };
  },
});

// ---- browser-facing (auth-gated) ----

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derived leads: signal events (recent window) grouped by parcel, joined to the
 * spine, scored by the shared rules config. No stored leads table — reactive.
 */
export const leads = query({
  args: {
    type: v.optional(v.string()), // filter: only leads carrying this signal type
    absenteeOnly: v.optional(v.boolean()),
    minStack: v.optional(v.number()), // minimum distinct signals on the parcel
    windowDays: v.optional(v.number()), // how far back signals count (default 365)
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { type, absenteeOnly, minStack, windowDays, limit }) => {
    await requireUser(ctx);
    const cutoff = Date.now() - (windowDays ?? 365) * DAY_MS;
    const events = await ctx.db
      .query("signalEvents")
      .withIndex("by_observedDate", (q) => q.gte("observedDate", cutoff))
      .collect();

    const byParcel = new Map<string, typeof events>();
    for (const e of events) {
      if (!e.prclid) continue; // unmatched rows live in unmatchedSignals
      const list = byParcel.get(e.prclid);
      if (list) list.push(e);
      else byParcel.set(e.prclid, [e]);
    }

    const now = Date.now();
    const out: Array<{
      prclid: string;
      score: number;
      situsStreet: string;
      propCity: string;
      propZip: string;
      propClass: string;
      ownerName: string;
      ownerAddr: string;
      ownerAddr2: string;
      ownerCity: string;
      ownerState: string;
      ownerZip: string;
      absentee: boolean;
      absenteeReason: string;
      signals: Array<{
        type: string;
        category: string;
        observedDate: number;
        status: string;
        matchConfidence?: "exact" | "strong" | "weak";
        payload: any;
      }>;
    }> = [];

    for (const [prclid, sigs] of byParcel) {
      if (type && !sigs.some((s) => s.type === type)) continue;
      if (minStack && new Set(sigs.map((s) => s.type)).size < minStack) continue;
      const parcel = await ctx.db
        .query("parcels")
        .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
        .first();
      if (!parcel) continue;
      if (absenteeOnly && !parcel.absentee) continue;
      out.push({
        prclid,
        score: computeLeadScore(
          sigs.map((s) => ({ type: s.type, observedDate: s.observedDate })),
          { absentee: parcel.absentee },
          now,
        ),
        situsStreet: parcel.situsStreet,
        propCity: parcel.propCity,
        propZip: parcel.propZip,
        propClass: parcel.propClass,
        ownerName: parcel.ownerName,
        ownerAddr: parcel.ownerAddr,
        ownerAddr2: parcel.ownerAddr2,
        ownerCity: parcel.ownerCity,
        ownerState: parcel.ownerState,
        ownerZip: parcel.ownerZip,
        absentee: parcel.absentee,
        absenteeReason: parcel.absenteeReason,
        signals: sigs
          .sort((a, b) => b.observedDate - a.observedDate)
          .map((s) => ({
            type: s.type,
            category: s.category,
            observedDate: s.observedDate,
            status: s.status,
            matchConfidence: s.matchConfidence,
            payload: s.payload,
          })),
      });
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit ?? 200);
  },
});

/** Foreclosure filings whose defendant matched no parcel — manual-review list. */
export const unmatchedSignals = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("signalEvents")
      .withIndex("by_prclid", (q) => q.eq("prclid", ""))
      .collect();
    return rows
      .sort((a, b) => b.observedDate - a.observedDate)
      .slice(0, 100)
      .map((e) => ({
        type: e.type,
        source: e.source,
        observedDate: e.observedDate,
        status: e.status,
        payload: e.payload,
      }));
  },
});

/** Signal timeline for one parcel (the /parcels detail panel). */
export const eventsForParcel = query({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    await requireUser(ctx);
    if (!prclid) return [];
    const rows = await ctx.db
      .query("signalEvents")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .collect();
    return rows.sort((a, b) => b.observedDate - a.observedDate);
  },
});
