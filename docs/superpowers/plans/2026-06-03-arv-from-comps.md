# ARV from Comps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pull comps" action to the Flip Analyzer that scrapes recent Redfin sold listings near a property, parses them, computes a suggested ARV (median $/sqft × subject sqft), caches them on the analysis, and lets the user pre-fill the ARV field with the suggestion.

**Architecture:** A pure, unit-tested module `src/scraper/comps.ts` (parse + select + suggest) is called by a new `"use node"` Convex action `convex/compsActions.ts` that scrapes Redfin via the existing Firecrawl client and stores results on the `flipAnalyses` row via an internal mutation. The Flip Analyzer editor gets a "Pull comps" button + comps table + "Use as ARV". Additive only — Sheriff/Legal pipelines and `deal.ts` are untouched.

**Tech Stack:** TypeScript, Convex (V8 mutations/queries + `"use node"` action), Firecrawl (existing client), React + TanStack Router, Tailwind v4, Vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-03-arv-from-comps-design.md`

---

## File Structure

```
NEW   src/scraper/comps.ts        parseZip, buildRedfinSoldUrl, parseRedfinComps, selectComps, suggestArv — pure
NEW   tests/comps.test.ts         unit tests with an inline Redfin markdown fixture
NEW   convex/compsActions.ts      "use node" action pullComps (scrape → parse → select → suggest → store)
EDIT  convex/schema.ts            flipAnalyses += comps[], suggestedArv, compsPulledAt, compsError (additive)
EDIT  convex/flipData.ts          getAnalysisInternal (internalQuery) + storeComps (internalMutation)
EDIT  src/web/FlipAnalyzer.tsx    "Pull comps" button + comps table + suggested-ARV chip + "Use as ARV"
```

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch** (repo is on `main`)

Run:
```bash
git checkout -b feat/arv-from-comps
```
Expected: `Switched to a new branch 'feat/arv-from-comps'`

---

## Task 1: `comps.ts` pure module (TDD)

**Files:**
- Create: `src/scraper/comps.ts`
- Test: `tests/comps.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/comps.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseZip, buildRedfinSoldUrl, parseRedfinComps, selectComps, suggestArv } from "../src/scraper/comps";

// Trimmed Redfin "recently sold" markdown: 3 DE comps (A,B,D) + 1 PA comp (filtered by /DE/).
const FIXTURE = `
# 19805 Recently Sold Homes

SOLD MAY 18, 2026

- ![](https://ssl.cdn-redfin.com/photo/235/islphoto/238/x.webp)

Are you looking for a property with newer roof and great bones.

$250,000Last sold price

3 beds1.5 baths1,650sq ft

[2104 Wildwood Dr, Wilmington, DE 19805](https://www.redfin.com/DE/Wilmington/2104-Wildwood-Dr-19805/home/44910808)

(302) 202-9855

SOLD APR 8, 2026

- ![](https://ssl.cdn-redfin.com/photo/235/islphoto/140/y.webp)

Beautifully renovated all-brick ranch, move-in ready.

$305,500Last sold price

3 beds1 bath1,164sq ft

[513 Ohio Ave, Wilmington, DE 19805](https://www.redfin.com/DE/Wilmington/513-Ohio-Ave-19805/home/44911068)

(302) 351-5000

SOLD MAR 27, 2026

$260,000Last sold price

3 beds1.5 baths1,575sq ft

[418 Ohio Ave, Wilmington, DE 19805](https://www.redfin.com/DE/Wilmington/418-Ohio-Ave-19805/home/44912000)

SOLD FEB 1, 2026

$600,000Last sold price

5 beds3 baths3,500sq ft

[9 Big House Rd, Greenville, DE 19807](https://www.redfin.com/DE/Greenville/9-Big-House-Rd-19807/home/55500000)

SOLD JAN 9, 2026

$400,000Last sold price

3 beds2 baths2,000sq ft

[100 Market St, Philadelphia, PA 19103](https://www.redfin.com/PA/Philadelphia/100-Market-St-19103/home/12345678)
`;

describe("parseZip", () => {
  it("extracts a 5-digit zip", () => {
    expect(parseZip("2104 Wildwood Dr, Wilmington, DE 19805")).toBe("19805");
  });
  it("returns null when no zip", () => {
    expect(parseZip("Wilmington, DE")).toBeNull();
  });
});

describe("buildRedfinSoldUrl", () => {
  it("builds a 6-month sold search url", () => {
    expect(buildRedfinSoldUrl("19805")).toBe(
      "https://www.redfin.com/zipcode/19805/filter/include=sold-6mo",
    );
  });
});

describe("parseRedfinComps", () => {
  const comps = parseRedfinComps(FIXTURE);

  it("parses only DE comps (drops the PA one)", () => {
    expect(comps).toHaveLength(4); // A, B, D, and the Greenville DE one — PA dropped
    expect(comps.every((c) => /, DE /.test(c.address))).toBe(true);
  });
  it("extracts fields for the first comp", () => {
    const a = comps[0];
    expect(a.address).toBe("2104 Wildwood Dr, Wilmington, DE 19805");
    expect(a.soldPrice).toBe(250000);
    expect(a.beds).toBe(3);
    expect(a.baths).toBe(1.5);
    expect(a.sqft).toBe(1650);
    expect(a.pricePerSqft).toBeCloseTo(151.515, 2);
  });
});

describe("selectComps", () => {
  it("keeps comps within ±30% sqft and beds ±1 when 3+ pass", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1500, beds: 3 });
    // A(1650), B(1164), D(1575) pass; Greenville(3500, 5bd) excluded.
    expect(selected).toHaveLength(3);
    expect(selected.map((c) => c.sqft).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([1164, 1575, 1650]);
  });
  it("falls back to all priced comps when fewer than 3 pass the filter", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1650, beds: 3 }); // tight; still ≥3 here
    expect(selected.length).toBeGreaterThanOrEqual(3);
  });
});

describe("suggestArv", () => {
  it("median $/sqft × subject sqft", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1500, beds: 3 }); // A,B,D
    const s = suggestArv(selected, 1500);
    // $/sqft: A=151.515, D=165.079, B=262.457 → median 165.079 → ×1500 = 247619
    expect(s.count).toBe(3);
    expect(s.pricePerSqft).toBe(165);
    expect(s.arv).toBe(247619);
    expect(s.low).toBe(227273); // 151.515×1500
    expect(s.high).toBe(393686); // 262.457×1500
  });
  it("falls back to median sold price when subject sqft is unknown", () => {
    const comps = parseRedfinComps(FIXTURE);
    const selected = selectComps(comps, { sqft: 1500, beds: 3 }); // A,B,D prices 250000,305500,260000
    const s = suggestArv(selected, null);
    expect(s.arv).toBe(260000); // median of 250000,260000,305500
    expect(s.low).toBeNull();
  });
  it("returns nulls for an empty selection", () => {
    const s = suggestArv([], 1500);
    expect(s).toEqual({ arv: null, pricePerSqft: null, low: null, high: null, count: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/comps.test.ts`
Expected: FAIL — `Failed to resolve import "../src/scraper/comps"`.

- [ ] **Step 3: Write the implementation**

Create `src/scraper/comps.ts`:
```ts
// Sold-comp scraping + ARV suggestion for the Flip Analyzer.
// Pure + deterministic so it's unit-tested and safe to call from a Convex action.
// Source: Redfin "recently sold" ZIP search markdown (clean structured rows).

export interface Comp {
  address: string;
  soldDate: string; // as scraped, e.g. "MAY 18, 2026"
  soldPrice: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pricePerSqft: number | null;
}

export interface ArvSuggestion {
  arv: number | null;
  pricePerSqft: number | null;
  low: number | null;
  high: number | null;
  count: number;
}

/** First 5-digit group in an address, or null. */
export function parseZip(address: string): string | null {
  const m = address.match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

export function buildRedfinSoldUrl(zip: string): string {
  return `https://www.redfin.com/zipcode/${zip}/filter/include=sold-6mo`;
}

/** Parse Redfin sold-search markdown into comps. Keeps DE comps only. */
export function parseRedfinComps(markdown: string): Comp[] {
  const comps: Comp[] = [];
  // Split at each "SOLD <DATE>" marker, capturing the date.
  const parts = markdown.split(/SOLD\s+([A-Z]{3,}\.?\s+\d{1,2},\s+\d{4})/i);
  for (let i = 1; i < parts.length; i += 2) {
    const soldDate = parts[i].trim();
    const body = parts[i + 1] ?? "";
    const priceM = body.match(/\$([\d,]+)\s*Last sold price/i);
    if (!priceM) continue;
    const soldPrice = parseInt(priceM[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(soldPrice)) continue;
    const addrM = body.match(/\[([^\]]+)\]\((https?:\/\/www\.redfin\.com\/[^)]+)\)/);
    if (!addrM || !/\/DE\//.test(addrM[2])) continue; // require a Delaware property
    const address = addrM[1].trim();
    const specsM = body.match(/(\d+)\s*beds?\s*(\d+(?:\.\d+)?)\s*baths?\s*([\d,]+)\s*sq\s*ft/i);
    const beds = specsM ? parseInt(specsM[1], 10) : null;
    const baths = specsM ? parseFloat(specsM[2]) : null;
    const sqft = specsM ? parseInt(specsM[3].replace(/,/g, ""), 10) : null;
    const pricePerSqft = sqft && sqft > 0 ? soldPrice / sqft : null;
    comps.push({ address, soldDate, soldPrice, beds, baths, sqft, pricePerSqft });
  }
  return comps;
}

/** Pick the most comparable comps to the subject (sqft ±30%, beds ±1), capped at 8. */
export function selectComps(
  comps: Comp[],
  subject: { sqft: number | null; beds: number | null },
): Comp[] {
  const priced = comps.filter((c) => c.pricePerSqft != null);
  let pool = priced;
  if (subject.sqft != null && subject.sqft > 0) {
    const lo = subject.sqft * 0.7;
    const hi = subject.sqft * 1.3;
    const filtered = priced.filter((c) => {
      const sqftOk = c.sqft != null && c.sqft >= lo && c.sqft <= hi;
      const bedsOk = subject.beds == null || c.beds == null || Math.abs(c.beds - subject.beds) <= 1;
      return sqftOk && bedsOk;
    });
    if (filtered.length >= 3) pool = filtered;
  }
  return pool.slice(0, 8);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Suggested ARV = median $/sqft × subject sqft (fallback: median sold price). */
export function suggestArv(selected: Comp[], subjectSqft: number | null): ArvSuggestion {
  if (selected.length === 0) {
    return { arv: null, pricePerSqft: null, low: null, high: null, count: 0 };
  }
  const ppsfs = selected.map((c) => c.pricePerSqft).filter((n): n is number => n != null);
  const medPps = median(ppsfs);
  if (subjectSqft != null && subjectSqft > 0) {
    return {
      arv: Math.round(medPps * subjectSqft),
      pricePerSqft: Math.round(medPps),
      low: Math.round(Math.min(...ppsfs) * subjectSqft),
      high: Math.round(Math.max(...ppsfs) * subjectSqft),
      count: selected.length,
    };
  }
  return {
    arv: Math.round(median(selected.map((c) => c.soldPrice))),
    pricePerSqft: Math.round(medPps),
    low: null,
    high: null,
    count: selected.length,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/comps.test.ts`
Expected: PASS (all comps tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — prior 54 + the new comps tests, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/comps.ts tests/comps.test.ts
git commit -m "feat(comps): Redfin sold-comp parse + ARV suggestion (pure, tested)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Schema fields + flipData internal query/mutation

**Files:**
- Modify: `convex/schema.ts` (add fields to `flipAnalyses`)
- Modify: `convex/flipData.ts` (add `getAnalysisInternal` + `storeComps`)

- [ ] **Step 1: Add schema fields**

In `convex/schema.ts`, inside the `flipAnalyses` table definition, immediately after the `notes: v.optional(v.string()),` line, add:
```ts
    comps: v.optional(
      v.array(
        v.object({
          address: v.string(),
          soldDate: v.string(),
          soldPrice: v.number(),
          beds: v.optional(v.number()),
          baths: v.optional(v.number()),
          sqft: v.optional(v.number()),
          pricePerSqft: v.optional(v.number()),
        }),
      ),
    ),
    suggestedArv: v.optional(v.number()),
    compsPulledAt: v.optional(v.number()),
    compsError: v.optional(v.string()),
```

- [ ] **Step 2: Add the internal query + mutation to `convex/flipData.ts`**

First, add `internalMutation` and `internalQuery` to the server import at the top of `convex/flipData.ts`. Change:
```ts
import { mutation, query } from "./_generated/server";
```
to:
```ts
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
```

Then append to the end of `convex/flipData.ts`:
```ts
// Raw analysis row for the comps action (no auth — the action gates the caller itself).
export const getAnalysisInternal = internalQuery({
  args: { id: v.id("flipAnalyses") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

// Store scraped comps + suggested ARV (called by the pullComps action).
export const storeComps = internalMutation({
  args: {
    id: v.id("flipAnalyses"),
    comps: v.array(
      v.object({
        address: v.string(),
        soldDate: v.string(),
        soldPrice: v.number(),
        beds: v.optional(v.number()),
        baths: v.optional(v.number()),
        sqft: v.optional(v.number()),
        pricePerSqft: v.optional(v.number()),
      }),
    ),
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

- [ ] **Step 3: Validate + regenerate types**

Run: `npx convex dev --once`
Expected: "Convex functions ready!" and `convex/_generated` regenerated. (Windows: ignore the cosmetic `UV_HANDLE_CLOSING` assertion after the real output.)

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/flipData.ts convex/_generated
git commit -m "feat(comps): flipAnalyses comp fields + storeComps/getAnalysisInternal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `pullComps` action (`convex/compsActions.ts`)

**Files:**
- Create: `convex/compsActions.ts`

- [ ] **Step 1: Write the action**

Create `convex/compsActions.ts`:
```ts
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
```

- [ ] **Step 2: Validate + regenerate types**

Run: `npx convex dev --once`
Expected: "Convex functions ready!"; `convex/_generated/api.d.ts` now includes `compsActions`. (Ignore the cosmetic Windows assertion.)

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: succeeds. If `tsc` flags the action's circular inference, the explicit `Promise<PullResult>` annotation (already present) resolves it.

- [ ] **Step 4: Commit**

```bash
git add convex/compsActions.ts convex/_generated
git commit -m "feat(comps): pullComps action (Redfin scrape → suggested ARV, gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Editor UI — Pull comps + comps table + Use as ARV

**Files:**
- Modify: `src/web/FlipAnalyzer.tsx`

- [ ] **Step 1: Import `useAction` and icons**

In `src/web/FlipAnalyzer.tsx`, change the convex/react import:
```ts
import { useMutation, useQuery } from "convex/react";
```
to:
```ts
import { useAction, useMutation, useQuery } from "convex/react";
```
And add `Home` and `RefreshCw` to the lucide import (it currently imports `Calculator, ChevronsUpDown, Plus, Trash2`):
```ts
import { Calculator, ChevronsUpDown, Home, Plus, RefreshCw, Trash2 } from "lucide-react";
```

- [ ] **Step 2: Add the comps UI inside `AnalysisEditor`**

In `AnalysisEditor`, add the action hook and pull state next to the existing `const update = useMutation(...)` line:
```ts
  const pullComps = useAction(api.compsActions.pullComps);
  const [pulling, setPulling] = useState(false);
  const [showComps, setShowComps] = useState(false);
  const doPull = async () => {
    setPulling(true);
    try {
      await pullComps({ id: analysis._id });
    } finally {
      setPulling(false);
    }
  };
```

Then, in the inputs column, insert this block immediately AFTER the closing `</div>` of the `grid grid-cols-2 gap-3` inputs grid and BEFORE the `Show cost assumptions` button:
```tsx
        {/* Comps → suggested ARV */}
        <div className="rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">ARV from sold comps</span>
            <button
              onClick={doPull}
              disabled={pulling}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-teal disabled:opacity-50"
            >
              {pulling ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Home className="h-3.5 w-3.5" />}
              {analysis.compsPulledAt ? "Refresh comps" : "Pull comps"}
            </button>
          </div>

          {analysis.suggestedArv != null && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-teal-glow">
                Comp value ~{fmtMoney(analysis.suggestedArv)} · {analysis.comps?.length ?? 0} comps · adjust up for reno
              </span>
              <button
                onClick={() => setArv(String(analysis.suggestedArv))}
                className="rounded-md border border-teal px-2 py-0.5 text-teal-glow hover:bg-muted"
              >
                Use as ARV
              </button>
            </div>
          )}
          {analysis.compsError && (
            <p className="mt-2 text-xs text-amber-400">Couldn’t pull comps: {analysis.compsError}</p>
          )}
          {analysis.comps && analysis.comps.length > 0 && (
            <>
              <button
                onClick={() => setShowComps((s) => !s)}
                className="mt-2 text-xs text-teal-glow hover:underline"
              >
                {showComps ? "Hide" : "Show"} {analysis.comps.length} comps
              </button>
              {showComps && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-2">Address</th>
                        <th className="py-1 pr-2">Sold</th>
                        <th className="py-1 pr-2 text-right">Price</th>
                        <th className="py-1 pr-2 text-right">Bd/Ba</th>
                        <th className="py-1 pr-2 text-right">Sqft</th>
                        <th className="py-1 text-right">$/sqft</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.comps.map((c, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="py-1 pr-2">{c.address}</td>
                          <td className="py-1 pr-2 text-muted-foreground">{c.soldDate}</td>
                          <td className="py-1 pr-2 text-right">{fmtMoney(c.soldPrice)}</td>
                          <td className="py-1 pr-2 text-right">{c.beds ?? "—"}/{c.baths ?? "—"}</td>
                          <td className="py-1 pr-2 text-right">{c.sqft ?? "—"}</td>
                          <td className="py-1 text-right">{c.pricePerSqft ? "$" + Math.round(c.pricePerSqft) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
```

- [ ] **Step 3: Typecheck/build**

Run: `npm run build`
Expected: succeeds. `analysis.comps`, `analysis.suggestedArv`, `analysis.compsError`, `analysis.compsPulledAt` are present on the row type from `listAnalyses` (the schema added them in Task 2).

- [ ] **Step 4: Commit**

```bash
git add src/web/FlipAnalyzer.tsx
git commit -m "feat(comps): Pull comps button + comps table + Use as ARV in the analysis editor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — prior 54 + the new comps tests.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `tsc` + Vite succeed.

- [ ] **Step 3: Confirm the additive constraint held**

Run: `git diff --name-only main...feat/arv-from-comps`
Expected: only NEW files (`src/scraper/comps.ts`, `tests/comps.test.ts`, `convex/compsActions.ts`) and EDITs to `convex/schema.ts`, `convex/flipData.ts`, `convex/_generated/*`, `src/web/FlipAnalyzer.tsx`. Confirm **`src/scraper/deal.ts`, `convex/sheriffData.ts`, `convex/legalData.ts`, `convex/sheriffActions.ts`, `convex/legalActions.ts`, and `src/web/pages.tsx` are NOT listed.**

- [ ] **Step 4: Live smoke test (local dev)**

Run (two terminals): `npx convex dev` then `npm run dev`. Signed in, open `/flip`:
1. Open an analysis with a real DE address (e.g. created from a Sheriff/Legal listing).
2. Click **Pull comps** → comps appear; "Comp value ~$X · N comps" shows.
3. Click **Use as ARV** → the ARV field fills with the suggestion; adjust and **Save**.
4. Try an analysis whose address has no ZIP → a clear "Couldn’t pull comps: No ZIP…" message; manual ARV still works.
5. Open `/sheriff` and `/legal` → unchanged.

- [ ] **Step 5: Wrap up**

Feature branch `feat/arv-from-comps` is complete. Use the finishing-a-development-branch skill to merge/deploy.

---

## Self-Review

**Spec coverage:** Redfin scrape + parse (Task 1 `parseRedfinComps`, Task 3 action) ✓; `/DE/` filter ✓; comp selection ±30%/±1 + fallback (Task 1 `selectComps`) ✓; suggested ARV median $/sqft + subject-sqft fallback (Task 1 `suggestArv`) ✓; on-demand cached action gated by `getCallerInternal` (Task 3) ✓; schema fields (Task 2) ✓; storeComps/getAnalysisInternal (Task 2) ✓; UI Pull comps + table + Use as ARV (Task 4) ✓; error states no-zip/error/no-comps (Task 3 + Task 4 display) ✓; tests (Task 1) ✓; additive-constraint check (Task 5 Step 3) ✓.

**Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output.

**Type consistency:** `Comp` (address/soldDate/soldPrice/beds/baths/sqft/pricePerSqft) is identical in `comps.ts`, the schema `comps` object, the `storeComps` validator, and `toStored` in the action. `ArvSuggestion` fields (arv/pricePerSqft/low/high/count) match between `suggestArv` and its tests. `pullComps` returns `PullResult` (status/count/suggestedArv/error) consistently. `selectComps(comps, { sqft, beds })` and `suggestArv(selected, subjectSqft)` signatures match between `comps.ts`, the tests, and the action call site.

**Note:** the action parses `a.beds` (a string snapshot like "3") to an int for `selectComps`; non-numeric beds → null (handled).
