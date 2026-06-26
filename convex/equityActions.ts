"use node";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { scrapeZillow, isDelawareUrl } from "../src/scraper/zillow";
import { lookupParcel } from "../src/scraper/parcel";
import { parseZestimate } from "../src/scraper/equity";
import { parseMoney } from "../src/scraper/deal";
import { firecrawlScrape } from "../src/scraper/firecrawl";
import {
  parseZip,
  buildRedfinSoldUrl,
  parseRedfinComps,
  selectComps,
  suggestArv,
} from "../src/scraper/comps";

// P4 equity gate — funnel-only enrichment: Zillow value (comps fallback) + NCC
// delinquent balances per parcel, stored in parcelEquity. NEVER run against the
// 203k spine; per-lead button + capped batch only. Spec: 2026-06-11-equity-gate*.

export const BATCH_CAP = 50;
const STAGGER_MS = 2500; // matches the sheriff enrich stagger (NCC rate limits)

type EnrichResult = {
  status: "ok" | "partial" | "error";
  value: number | null;
  valueSource: "zestimate" | "comps" | null;
  balances: boolean;
  error?: string;
};

async function doEnrich(ctx: ActionCtx, prclid: string): Promise<EnrichResult> {
  const apiKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

  const parcel = await ctx.runQuery(internal.equityData.getParcelInternal, { prclid });
  if (!parcel) throw new Error(`No spine parcel for prclid ${prclid}`);
  const address = `${parcel.situsStreet}, ${parcel.propCity} ${parcel.propState} ${parcel.propZip}`;

  const errors: string[] = [];
  let value: number | null = null;
  let valueSource: "zestimate" | "comps" | null = null;
  let sqft: number | null = null;

  // 1) Value: Zillow zestimate (validate the -DE- homedetails match).
  try {
    const z = await scrapeZillow(address, apiKey);
    if (z.zillowUrl && isDelawareUrl(z.zillowUrl)) {
      value = parseZestimate(z.zestimate);
      if (value != null) valueSource = "zestimate";
      sqft = z.sqft ? parseMoney(z.sqft) : null;
    } else {
      errors.push("Zillow: no Delaware match");
    }
  } catch (e) {
    errors.push(`Zillow: ${(e as Error).message}`);
  }

  // 1b) Fallback: comps median $/sqft × sqft (only when Zillow gave sqft but no value).
  if (value == null && sqft != null && sqft > 0) {
    try {
      const zip = parseZip(address);
      if (zip) {
        const { markdown } = await firecrawlScrape({
          url: buildRedfinSoldUrl(zip),
          apiKey,
          formats: ["markdown"],
          onlyMainContent: true,
          waitFor: 3000,
          timeoutMs: 60000,
          maxRetries: 1,
        });
        const selected = selectComps(parseRedfinComps(markdown), { sqft, beds: null });
        const sug = suggestArv(selected, sqft);
        if (sug.arv != null) {
          value = sug.arv;
          valueSource = "comps";
        } else {
          errors.push("Comps: no comparable solds");
        }
      } else {
        errors.push("Comps: no ZIP in address");
      }
    } catch (e) {
      errors.push(`Comps: ${(e as Error).message}`);
    }
  }

  // 2) Delinquent balances + assessment from the NCC parcel site.
  // ArcGIS PRCLID is the digits-only parcel number — the same string the sheriff
  // flow produces by stripping -/. before lookup. If this consistently fails with
  // "detail page not reached", investigate the format before blaming Reblaze.
  let balances = false;
  let bal: { county: number | null; school: number | null; sewer: number | null; assessed: number | null } = {
    county: null, school: null, sewer: null, assessed: null,
  };
  try {
    const p = await lookupParcel(prclid, apiKey);
    bal = {
      county: parseMoney(p.countyBalanceDue),
      school: parseMoney(p.schoolBalanceDue),
      sewer: parseMoney(p.sewerBalanceDue),
      assessed: parseMoney(p.assessmentTotal),
    };
    balances = true;
  } catch (e) {
    errors.push(`NCC balances: ${(e as Error).message}`);
  }

  const now = Date.now();
  await ctx.runMutation(internal.equityData.storeEnrichment, {
    prclid,
    ...(value != null && valueSource != null
      ? { value, valueSource, valueAt: now }
      : {}),
    ...(balances
      ? {
          countyBalance: bal.county ?? 0,
          schoolBalance: bal.school ?? 0,
          sewerBalance: bal.sewer ?? 0,
          ...(bal.assessed != null ? { assessedValue: bal.assessed } : {}),
          balancesAt: now,
        }
      : {}),
    lastError: errors.length ? errors.join(" · ") : null,
  });

  const gotValue = value != null;
  return {
    status: gotValue && balances ? "ok" : gotValue || balances ? "partial" : "error",
    value,
    valueSource,
    balances,
    error: errors.length ? errors.join(" · ") : undefined,
  };
}

/** Scheduled worker (no auth context — scheduled fns have no user identity). */
export const enrichEquityInternal = internalAction({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }): Promise<EnrichResult> => {
    return await doEnrich(ctx, prclid);
  },
});

/** Per-lead button: enrich one parcel now. */
export const enrichEquity = action({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }): Promise<EnrichResult> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || !me.isActive) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    return await doEnrich(ctx, prclid);
  },
});

/** Batch button: fan out up to BATCH_CAP parcels, staggered for NCC rate limits. */
export const enrichBatch = action({
  args: { prclids: v.array(v.string()) },
  handler: async (ctx, { prclids }): Promise<{ scheduled: number }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me || !me.isActive) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    if (prclids.length === 0) return { scheduled: 0 };
    if (prclids.length > BATCH_CAP) {
      throw new ConvexError({
        code: "BATCH_TOO_LARGE",
        message: `Batch is capped at ${BATCH_CAP} parcels per click`,
      });
    }
    const unique = [...new Set(prclids)];
    for (let i = 0; i < unique.length; i++) {
      await ctx.scheduler.runAfter(i * STAGGER_MS, internal.equityActions.enrichEquityInternal, {
        prclid: unique[i],
      });
    }
    return { scheduled: unique.length };
  },
});
