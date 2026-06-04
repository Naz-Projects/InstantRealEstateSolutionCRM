"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  FRED_SERIES,
  parseFredJson,
  parseFredCsv,
  pickLatest,
} from "../src/scraper/fred";

// Pull every catalogued FRED series and upsert its latest snapshot. Tolerant: a
// single series failing (404 / empty / network) is logged and skipped, never
// aborts the rest. Prefers the keyed JSON API; falls back to the no-key CSV
// endpoint when FRED_API_KEY is unset. Explicit return type per the Convex
// circular-inference lesson.
export const refreshMarketData = internalAction({
  args: {},
  handler: async (ctx): Promise<{ updated: number; skipped: number }> => {
    const apiKey = (process.env.FRED_API_KEY ?? "").trim();
    let updated = 0;
    let skipped = 0;

    for (const def of FRED_SERIES) {
      try {
        let observations;
        if (apiKey) {
          const url =
            `https://api.stlouisfed.org/fred/series/observations` +
            `?series_id=${def.seriesId}&api_key=${apiKey}` +
            `&file_type=json&sort_order=desc&limit=25`;
          const res = await fetch(url);
          if (!res.ok) {
            console.error(`FRED ${def.seriesId}: HTTP ${res.status}`);
            skipped++;
            continue;
          }
          observations = parseFredJson(await res.json());
        } else {
          const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${def.seriesId}`;
          const res = await fetch(url);
          if (!res.ok) {
            console.error(`FRED ${def.seriesId}: HTTP ${res.status}`);
            skipped++;
            continue;
          }
          observations = parseFredCsv(await res.text());
        }

        const snap = pickLatest(observations);
        if (!snap) {
          console.warn(`FRED ${def.seriesId}: no usable observations`);
          skipped++;
          continue;
        }

        await ctx.runMutation(internal.marketData.upsertMetric, {
          metric: def.metric,
          seriesId: def.seriesId,
          region: def.region,
          group: def.group,
          label: def.label,
          unit: def.unit,
          source: def.source,
          latestDate: snap.latestDate,
          latestValue: snap.latestValue,
          priorValue: snap.priorValue ?? undefined,
          yearAgoValue: snap.yearAgoValue ?? undefined,
          history: snap.history,
          fetchedAt: Date.now(),
        });
        updated++;
      } catch (err) {
        console.error(`FRED ${def.seriesId} failed`, err);
        skipped++;
      }
    }

    return { updated, skipped };
  },
});
