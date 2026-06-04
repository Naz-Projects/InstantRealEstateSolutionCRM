# ARV from Comps — Design Spec

_Date: 2026-06-03. Status: approved design, pre-implementation._
_Builds on the Flip Analyzer (`docs/superpowers/specs/2026-06-03-flip-analyzer-design.md`). Research: `memory/flip-decision-features.md` (Tier-2 #7 "ARV from renovated comps")._

## Goal
Replace the Flip Analyzer's purely-manual ARV with an **ARV suggested from real recent sold comparables**. The user
clicks **"Pull comps"** on an analysis; the system scrapes recent Redfin sold listings near the property, parses
them, computes a suggested ARV, caches it on the analysis, and shows the comps + suggestion. **"Use as ARV"**
pre-fills the existing ARV field, which the user still adjusts (typically up for renovation) and saves.

## Decisions (locked with the user)
- **Data source: scrape Redfin** sold listings (free/owned via Firecrawl). Chosen over a paid comps/AVM API
  (RentCast/ATTOM) and over Zillow (a feasibility spike showed Redfin's sold markdown is cleanly structured —
  `SOLD <date>` / `$<price>Last sold price` / `<N> beds<M> baths<Z>sq ft` / `[address](redfin.com/DE/…)` — while
  Zillow's is messier).
- **ARV derivation: suggest + pre-fill, user adjusts.** Suggested ARV = `median($/sqft of selected comps) × subject
  sqft`, shown as a "comp-based market value — adjust up for your renovation" (sold comps are roughly as-sold, so
  the suggestion is a conservative floor). The manual ARV field is always the fallback/override.
- **Trigger: on-demand "Pull comps" button**, cached on the analysis record (no auto-fetch; controls scrape volume).

## Constraints
- **Additive only.** Do NOT modify the Sheriff/Legal pages, their actions/pipelines, or `src/scraper/deal.ts`.
  This feature extends the Flip Analyzer's own files plus new modules.
- Reuse: `FIRECRAWL_API_KEY` (already in Convex env), `firecrawlScrape`/`withRetry` (`src/scraper/firecrawl.ts`),
  the `"use node"` action pattern, and `internal.users.getCallerInternal` for action auth.

## Scope
**In:** Redfin sold-comp scrape + parse, comp selection, suggested-ARV math, an on-demand cached Convex action, and
the editor UI (Pull comps button, comps table, suggested-ARV chip, "Use as ARV").
**Out (YAGNI):** geocoded distance ranking, Zillow fallback / multi-source merge, auto-refresh, weighted/condition
models, and the RentCast/ATTOM API path (the pure `suggestArv` keeps these easy to add later).

---

## Architecture (files)
```
NEW   src/scraper/comps.ts        pure: parseZip, buildRedfinSoldUrl, parseRedfinComps, selectComps, suggestArv
NEW   tests/comps.test.ts         unit tests against a saved Redfin markdown fixture
NEW   convex/compsActions.ts      "use node" action pullComps (scrape → parse → select → suggest → store)
EDIT  convex/schema.ts            flipAnalyses += comps[], suggestedArv, compsPulledAt, compsError (additive)
EDIT  convex/flipData.ts          internal getAnalysisInternal query + storeComps mutation (the action reads/writes
                                  via them); public queries already return the row incl. the new fields
EDIT  src/web/FlipAnalyzer.tsx    "Pull comps" button + comps table + suggested-ARV chip + "Use as ARV"
```
`comps.ts` is a pure module (no Node/Convex imports), unit-tested, and called only by the `"use node"` action.

## `comps.ts` — pure parse + ARV math

### Types
```ts
export interface Comp {
  address: string;
  soldDate: string;        // as scraped, e.g. "MAY 18, 2026"
  soldPrice: number;       // required (comps without a price are dropped)
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pricePerSqft: number | null; // soldPrice / sqft when sqft known
}
export interface ArvSuggestion {
  arv: number | null;
  pricePerSqft: number | null; // median $/sqft of selected comps
  low: number | null;          // min selected comp $/sqft × subject sqft
  high: number | null;         // max selected comp $/sqft × subject sqft
  count: number;               // # comps used
}
```

### Functions
- `parseZip(address: string): string | null` — first 5-digit group (`/\b(\d{5})\b/`).
- `buildRedfinSoldUrl(zip: string): string` → `https://www.redfin.com/zipcode/${zip}/filter/include=sold-6mo`
  (6-month window — more comps than the 3-month spike while staying recent).
- `parseRedfinComps(markdown: string): Comp[]` — split the markdown on `SOLD <DATE>` markers; per block regex:
  - price: `/\$([\d,]+)\s*Last sold price/`
  - specs: `/(\d+)\s*beds?\s*(\d+(?:\.\d+)?)\s*baths?\s*([\d,]+)\s*sq\s*ft/i`
  - address: `/\[([^\]]+)\]\((https?:\/\/www\.redfin\.com\/[^)]+)\)/` — keep only links whose URL contains `/DE/`
    (reject wrong-state, mirroring the Zillow `isDelawareUrl` check).
  Drop blocks with no price or no address; compute `pricePerSqft` when sqft is present.
- `selectComps(comps, subject: { sqft: number | null; beds: number | null }): Comp[]` — keep comps with a
  `pricePerSqft`; if `subject.sqft` known, prefer comps within ±30% sqft and (if `subject.beds` known) beds ±1;
  sort most-recent-ish (keep input order, which Redfin returns newest-first) and cap at 8. If fewer than 3 pass the
  similarity filter, fall back to the top 8 price-per-sqft comps unfiltered (better a rough number than none).
- `suggestArv(selected, subjectSqft): ArvSuggestion` — `pricePerSqft = median(selected.pricePerSqft)`;
  `arv = subjectSqft != null ? round(pricePerSqft × subjectSqft) : median(selected.soldPrice)`;
  `low/high = min/max($/sqft) × subjectSqft` (null when subjectSqft unknown); `count = selected.length`.
  Returns all-null/`count:0` when `selected` is empty.

## Convex backend

### Schema additions (`flipAnalyses`, all optional → existing rows still validate)
```ts
comps: v.optional(v.array(v.object({
  address: v.string(),
  soldDate: v.string(),
  soldPrice: v.number(),
  beds: v.optional(v.number()),
  baths: v.optional(v.number()),
  sqft: v.optional(v.number()),
  pricePerSqft: v.optional(v.number()),
}))),
suggestedArv: v.optional(v.number()),
compsPulledAt: v.optional(v.number()),
compsError: v.optional(v.string()),
```

### `convex/flipData.ts` — `storeComps` internal mutation
```ts
export const storeComps = internalMutation({
  args: {
    id: v.id("flipAnalyses"),
    comps: v.array(/* the comp object above */),
    suggestedArv: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.id, {
      comps: a.comps,
      suggestedArv: a.suggestedArv,
      compsError: a.error,
      compsPulledAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
```
`listAnalyses`/`getAnalysis` already return the full row, so `comps`/`suggestedArv` flow to the UI automatically.

### `convex/compsActions.ts` — `pullComps` action (`"use node"`)
```ts
export const pullComps = action({
  args: { id: v.id("flipAnalyses") },
  handler: async (ctx, { id }): Promise<{ status: "ok" | "no-zip" | "no-comps" | "error"; count: number; suggestedArv: number | null; error?: string }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    const a = await ctx.runQuery(internal.flipData.getAnalysisInternal, { id });
    if (!a) throw new Error("Analysis not found");
    const zip = parseZip(a.address);
    if (!zip) {
      await ctx.runMutation(internal.flipData.storeComps, { id, comps: [], error: "No ZIP in address" });
      return { status: "no-zip", count: 0, suggestedArv: null };
    }
    try {
      const { markdown } = await firecrawlScrape({ url: buildRedfinSoldUrl(zip), apiKey: process.env.FIRECRAWL_API_KEY!, formats: ["markdown"], onlyMainContent: true, waitFor: 3000, timeoutMs: 60000, maxRetries: 1 });
      const selected = selectComps(parseRedfinComps(markdown), { sqft: a.sqft ?? null, beds: a.beds ? parseInt(a.beds) : null });
      const sug = suggestArv(selected, a.sqft ?? null);
      await ctx.runMutation(internal.flipData.storeComps, { id, comps: selected.map(/* → storage shape, null→undefined */), suggestedArv: sug.arv ?? undefined });
      return { status: selected.length ? "ok" : "no-comps", count: selected.length, suggestedArv: sug.arv };
    } catch (e) {
      await ctx.runMutation(internal.flipData.storeComps, { id, comps: [], error: (e as Error).message });
      return { status: "error", count: 0, suggestedArv: null, error: (e as Error).message };
    }
  },
});
```
- A new `internal` query `flipData.getAnalysisInternal({ id })` returns the raw doc for the action.
- The handler has an explicit `Promise<…>` return annotation (Convex circular-inference lesson).
- `beds` is stored on the analysis as a string snapshot; parse to int for `selectComps`.

## UI — `src/web/FlipAnalyzer.tsx` (in `AnalysisEditor`, near the ARV input)
- **"Pull comps"** button (lucide icon, no emoji). `const pull = useAction(api.compsActions.pullComps)`; on click set a
  local `pulling` state, `await pull({ id: analysis._id })`, clear it. Errors → inline message.
- When `analysis.suggestedArv` exists: a chip — **"Comp value ~$X · median $Y/sqft · N comps · adjust up for reno"** —
  with a **"Use as ARV"** button that `setArv(String(analysis.suggestedArv))` (fills the existing input; user still
  edits + Saves). `analysis.compsError` → a muted "couldn't pull comps: …" line.
- A collapsible **comps table**: Address · Sold date · Price · Beds/Baths · Sqft · $/sqft (reads `analysis.comps`).
- All reactive: the action caches onto the record, `listAnalyses` updates, the editor (same `_id`, not remounted)
  shows the new comps/suggestion without disturbing the user's in-progress inputs.

## Error handling & edges
- No ZIP → `no-zip` status + stored `compsError`, UI shows the reason. Manual ARV unaffected.
- Firecrawl block/empty → `firecrawlScrape` retries (`maxRetries`) then throws → caught → `error` status + stored message.
- Zero comps parsed → `no-comps`, `suggestedArv` null, "no comparable sales found."
- Subject sqft unknown → suggestion falls back to median sold price; low/high null.
- Wrong-state links filtered by `/DE/`. Comps without price/sqft dropped (sqft-less comps can't contribute $/sqft).

## Testing & verification
- `tests/comps.test.ts` against the saved spike markdown (`.firecrawl/spike-redfin-sold.md` content copied into a
  fixture): `parseRedfinComps` extracts known comps (e.g. `2104 Wildwood Dr` $250,000 / 3bd / 1.5ba / 1,650sqft;
  `513 Ohio Ave` $305,500 / 1,164sqft); `/DE/` filtering; `parseZip`; `selectComps` ±30%/±1 + fallback; `suggestArv`
  median + subject-sqft math + null/empty cases.
- Build chain (lessons): `npx convex dev --once` (validate + regen `_generated`) → `npm run build` → `npm test`
  (existing 54 stay green + new comps tests).
- Live smoke: open an analysis with a real DE address → "Pull comps" → comps appear, suggested ARV shows, "Use as
  ARV" fills the field → Save.

## Success criteria
1. "Pull comps" on a DE-address analysis returns recent Redfin sold comps + a suggested ARV, cached on the record.
2. "Use as ARV" pre-fills the ARV input; the user can still adjust and Save; the manual flow is unchanged otherwise.
3. The parser + ARV math match hand-checked values in the unit tests.
4. Errors (no ZIP / block / no comps) are surfaced, non-fatal, and never overwrite a manually-entered ARV.
5. `npm run build` + `npm test` green; no changes to `deal.ts`, Sheriff/Legal pages, or their pipelines.
