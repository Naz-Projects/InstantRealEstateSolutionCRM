"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  buildCodeCasesUrl,
  parseCodeCaseFeature,
  toArcgisTimestamp,
} from "../src/scraper/codeCases";
import {
  PLAINTIFF_STEMS,
  buildPartySearchUrl,
  parsePartySearchHtml,
  isNccForeclosure,
  formatCourtDate,
  extractDefendants,
  matchDefendantToOwners,
  selectAutoAttachMatch,
  type CourtPartyRow,
  type OwnerMatch,
} from "../src/scraper/courtConnect";
import type { SignalEventInput } from "../src/scraper/signals";

const CHUNK = 250; // upsert batch per mutation (txn limits)
const OVERLAP_MS = 3 * 24 * 60 * 60 * 1000; // re-pull window; upserts make it idempotent

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ArcGIS returns errors as HTTP 200 + {error:{...}} — surface as throws, retry transient.
async function fetchArcgis(url: string, attempts = 3): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      // 30s cap — a hung connection otherwise stalls the action silently.
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}: ${text.slice(0, 160)}`);
      const json = JSON.parse(text);
      if (json.error) throw new Error(`ArcGIS ${json.error.code}: ${json.error.message}`);
      return json;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

async function upsertAll(ctx: any, events: SignalEventInput[]) {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < events.length; i += CHUNK) {
    const r = await ctx.runMutation(internal.signalData.upsertEventsBatch, {
      rows: events.slice(i, i + CHUNK),
    });
    inserted += r.inserted;
    updated += r.updated;
  }
  return { inserted, updated };
}

type CodeCasesResult = { fetched: number; inserted: number; updated: number; watermark: string };

/**
 * Pull NCC code-enforcement cases since the stored watermark (full backfill on the
 * first run — the layer is only ~2.8k rows / ~3 pages). Keyset-paged by APNO;
 * idempotent (upsert by externalKey); watermark = max APDTTM seen, minus overlap upstream.
 */
export const syncCodeCases = internalAction({
  args: {},
  handler: async (ctx): Promise<CodeCasesResult> => {
    const source = "ncc-arcgis-codecases";
    try {
      const wm = await ctx.runQuery(internal.signalData.getWatermark, { source });
      const sinceIso = wm
        ? toArcgisTimestamp(Date.parse(wm.watermark) - OVERLAP_MS)
        : undefined;

      let fetched = 0;
      let maxObserved = wm ? Date.parse(wm.watermark) : 0;
      let cursor: string | undefined;
      const all: SignalEventInput[] = [];
      for (;;) {
        const json = await fetchArcgis(
          buildCodeCasesUrl({ sinceIso, afterApno: cursor, pageSize: 1000 }),
        );
        const feats: Array<{ attributes: Record<string, unknown> }> = json.features ?? [];
        if (feats.length === 0) break;
        for (const f of feats) {
          const ev = parseCodeCaseFeature(f.attributes);
          all.push(ev);
          if (ev.observedDate > maxObserved) maxObserved = ev.observedDate;
        }
        fetched += feats.length;
        cursor = String(feats[feats.length - 1].attributes.APNO ?? "");
        if (feats.length < 1000 || !cursor) break;
      }

      const { inserted, updated } = await upsertAll(ctx, all);
      const watermark = new Date(maxObserved || Date.now()).toISOString();
      await ctx.runMutation(internal.signalData.setWatermark, {
        source,
        watermark,
        lastResult: `fetched ${fetched}, inserted ${inserted}, updated ${updated}`,
      });
      return { fetched, inserted, updated, watermark };
    } catch (e) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: `syncCodeCases failed: ${String((e as Error).message).slice(0, 300)}`,
        context: "signalActions.syncCodeCases",
      });
      throw e;
    }
  },
});

type ForeclosureResult = {
  stemsSwept: number;
  stemsFailed: number;
  casesFound: number;
  matched: number;
  unmatched: number;
  inserted: number;
  updated: number;
};

/**
 * Weekly CourtConnect sweep: for each lender stem, party-search the trailing window,
 * keep NCC L-docket (mortgage foreclosure) PLAINTIFF rows, dedupe by case number,
 * match caption defendants to spine owners (token matcher, conservative), upsert one
 * event per matched parcel (or one unmatched row). Polite: sequential, ~400ms apart,
 * page cap per stem. Tolerant per-stem — one bad page never kills the sweep.
 */
export const syncForeclosures = internalAction({
  args: {},
  handler: async (ctx): Promise<ForeclosureResult> => {
    const source = "de-courtconnect";
    const wm = await ctx.runQuery(internal.signalData.getWatermark, { source });
    const beginMs = wm
      ? Date.parse(wm.watermark) - OVERLAP_MS
      : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const endMs = Date.now();
    const beginDate = formatCourtDate(beginMs);
    const endDate = formatCourtDate(endMs);

    const byCase = new Map<string, CourtPartyRow>();
    let stemsFailed = 0;
    for (const stem of PLAINTIFF_STEMS) {
      try {
        for (let pageNo = 1; pageNo <= 5; pageNo++) {
          const res = await fetch(buildPartySearchUrl({ stem, beginDate, endDate, pageNo }), {
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const page = parsePartySearchHtml(await res.text());
          for (const row of page.rows) {
            if (!isNccForeclosure(row.caseId)) continue;
            if (row.partyType !== "PLAINTIFF") continue;
            if (!byCase.has(row.caseId)) byCase.set(row.caseId, row);
          }
          await sleep(400);
          if (!page.hasNextPage) break;
        }
      } catch {
        stemsFailed++; // tolerated; counted
      }
    }

    if (stemsFailed === PLAINTIFF_STEMS.length) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: "syncForeclosures: every plaintiff-stem request failed (CourtConnect unreachable?)",
        context: "signalActions.syncForeclosures",
      });
      throw new Error("CourtConnect sweep failed for all stems");
    }

    let matched = 0;
    let unmatched = 0;
    const events: SignalEventInput[] = [];
    for (const [caseId, row] of byCase) {
      const defendants = extractDefendants(row.caption);
      const allMatches: OwnerMatch[] = [];
      const ownerByPrclid = new Map<string, string>();
      for (const defendant of defendants) {
        const candidates = await ctx.runQuery(internal.signalData.ownerCandidates, {
          name: defendant,
        });
        for (const c of candidates) ownerByPrclid.set(c.prclid, c.ownerName);
        allMatches.push(...matchDefendantToOwners(defendant, candidates));
      }
      // Only auto-attach (→ scored, mailable lead) on a UNIQUE exact match; every
      // looser/ambiguous case becomes an unmatched row for human review — the
      // foreclosure is never lost, but the wrong owner is never auto-mailed.
      const autoPrclid = selectAutoAttachMatch(allMatches);
      const base = {
        category: "financial" as const,
        type: "pre-foreclosure",
        source,
        observedDate: row.filingDate,
        status: row.caseStatus,
        payload: {
          caseId,
          caption: row.caption,
          plaintiff: row.partyName,
          defendants,
        },
      };
      if (autoPrclid) {
        matched++;
        events.push({
          ...base,
          prclid: autoPrclid,
          externalKey: `fc:${caseId}:${autoPrclid}`,
          matchConfidence: "exact",
        });
      } else {
        unmatched++;
        // Carry the (non-unique/loose) candidate owners into the review payload so a
        // human can resolve the filing — distinct by parcel, with confidence + name.
        const seen = new Set<string>();
        const candidates: Array<{ prclid: string; ownerName: string; confidence: string }> = [];
        for (const m of allMatches) {
          if (seen.has(m.prclid)) continue;
          seen.add(m.prclid);
          candidates.push({
            prclid: m.prclid,
            ownerName: ownerByPrclid.get(m.prclid) ?? "",
            confidence: m.confidence,
          });
        }
        events.push({
          ...base,
          prclid: "",
          externalKey: `fc:${caseId}`,
          payload: { ...base.payload, candidates },
        });
      }
    }

    const { inserted, updated } = await upsertAll(ctx, events);
    // Partial stem failure: keep the window open (watermark stays at beginMs) so the
    // next run re-sweeps it — idempotent upserts make the re-pull free of duplicates.
    const nextWatermark = stemsFailed > 0 ? beginMs : endMs;
    await ctx.runMutation(internal.signalData.setWatermark, {
      source,
      watermark: new Date(nextWatermark).toISOString(),
      lastResult:
        `swept ${PLAINTIFF_STEMS.length - stemsFailed}/${PLAINTIFF_STEMS.length} stems, ` +
        `${byCase.size} cases (${matched} matched, ${unmatched} unmatched), ` +
        `inserted ${inserted}, updated ${updated}`,
    });
    return {
      stemsSwept: PLAINTIFF_STEMS.length - stemsFailed,
      stemsFailed,
      casesFound: byCase.size,
      matched,
      unmatched,
      inserted,
      updated,
    };
  },
});
