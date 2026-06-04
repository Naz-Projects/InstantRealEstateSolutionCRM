"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { firecrawlScrape } from "../src/scraper/firecrawl";
import {
  parseZip,
  buildRedfinSoldUrl,
  parseRedfinComps,
  selectComps,
  suggestArv,
  type Comp,
} from "../src/scraper/comps";

type PullResult = {
  status: "ok" | "no-zip" | "no-comps" | "error";
  count: number;
  suggestedArv: number | null;
  error?: string;
};

// Map a parsed Comp to the Convex storage shape (null → undefined for optionals).
function toStored(c: Comp) {
  return {
    address: c.address,
    soldDate: c.soldDate,
    soldPrice: c.soldPrice,
    beds: c.beds ?? undefined,
    baths: c.baths ?? undefined,
    sqft: c.sqft ?? undefined,
    pricePerSqft: c.pricePerSqft ?? undefined,
  };
}

export const pullComps = action({
  args: { id: v.id("flipAnalyses") },
  handler: async (ctx, { id }): Promise<PullResult> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });

    const a = await ctx.runQuery(internal.flipData.getAnalysisInternal, { id });
    if (!a) throw new Error("Analysis not found");

    const zip = parseZip(a.address);
    if (!zip) {
      await ctx.runMutation(internal.flipData.storeComps, {
        id,
        comps: [],
        error: "No ZIP found in the property address",
      });
      return { status: "no-zip", count: 0, suggestedArv: null };
    }

    const apiKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");

    try {
      const { markdown } = await firecrawlScrape({
        url: buildRedfinSoldUrl(zip),
        apiKey,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
        timeoutMs: 60000,
        maxRetries: 1,
      });
      const subjectBeds = a.beds && /^\d+$/.test(a.beds) ? parseInt(a.beds, 10) : null;
      const selected = selectComps(parseRedfinComps(markdown), {
        sqft: a.sqft ?? null,
        beds: subjectBeds,
      });
      const sug = suggestArv(selected, a.sqft ?? null);
      await ctx.runMutation(internal.flipData.storeComps, {
        id,
        comps: selected.map(toStored),
        suggestedArv: sug.arv ?? undefined,
        suggestedPricePerSqft: sug.pricePerSqft ?? undefined,
        error: selected.length === 0 ? "No comparable sold homes found near this ZIP." : undefined,
      });
      return {
        status: selected.length > 0 ? "ok" : "no-comps",
        count: selected.length,
        suggestedArv: sug.arv,
      };
    } catch (e) {
      const msg = (e as Error).message;
      await ctx.runMutation(internal.flipData.storeComps, { id, comps: [], error: msg });
      return { status: "error", count: 0, suggestedArv: null, error: msg };
    }
  },
});
