import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUser } from "./helpers";
import { FRED_SERIES, isFresh } from "../src/scraper/fred";

const groupValidator = v.union(
  v.literal("rates"),
  v.literal("inventory"),
  v.literal("temperature"),
);
const unitValidator = v.union(
  v.literal("percent"),
  v.literal("usd"),
  v.literal("count"),
  v.literal("days"),
);

// Insert-or-update one series snapshot (keyed by FRED seriesId). Called by the
// refresh action; idempotent (re-running just refreshes the snapshot).
export const upsertMetric = internalMutation({
  args: {
    metric: v.string(),
    seriesId: v.string(),
    region: v.string(),
    group: groupValidator,
    label: v.string(),
    unit: unitValidator,
    latestDate: v.string(),
    latestValue: v.number(),
    priorValue: v.optional(v.number()),
    yearAgoValue: v.optional(v.number()),
    history: v.array(v.object({ date: v.string(), value: v.number() })),
    source: v.string(),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("marketMetrics")
      .withIndex("by_seriesId", (q) => q.eq("seriesId", args.seriesId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, args);
    else await ctx.db.insert("marketMetrics", args);
  },
});

function toItem(r: Doc<"marketMetrics">) {
  return {
    metric: r.metric,
    seriesId: r.seriesId,
    region: r.region,
    group: r.group,
    label: r.label,
    unit: r.unit,
    latestDate: r.latestDate,
    latestValue: r.latestValue,
    priorValue: r.priorValue ?? null,
    yearAgoValue: r.yearAgoValue ?? null,
    history: r.history,
    source: r.source,
  };
}

// Market data grouped for the dashboard. Stale "temperature" extras (series with
// a freshnessDays gate whose latest observation is too old) are hidden, never
// shown as if current. requireUser-gated like the rest of the app.
export const dashboardMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("marketMetrics").collect();

    const order = new Map(FRED_SERIES.map((s, i) => [s.seriesId, i]));
    const freshnessDays = new Map(
      FRED_SERIES.map((s) => [s.seriesId, s.freshnessDays]),
    );
    const now = new Date();

    const visible = rows
      .filter((r) => {
        const fd = freshnessDays.get(r.seriesId);
        return fd == null ? true : isFresh(r.latestDate, fd, now);
      })
      .sort((a, b) => (order.get(a.seriesId) ?? 99) - (order.get(b.seriesId) ?? 99));

    const pick = (g: string) =>
      visible.filter((r) => r.group === g).map(toItem);

    return {
      rates: pick("rates"),
      inventory: pick("inventory"),
      temperature: pick("temperature"),
      updatedAt: rows.length
        ? Math.max(...rows.map((r) => r.fetchedAt))
        : null,
    };
  },
});
