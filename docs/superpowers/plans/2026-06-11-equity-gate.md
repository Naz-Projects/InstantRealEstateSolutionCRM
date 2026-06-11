# P4 Equity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Model directive (user):** every implementer subagent runs on **Opus 4.8** (`model: "opus"`).

**Goal:** Funnel-only property-value + delinquent-balance enrichment per lead, manual lien entry, equity = value − liens, an equity multiplier in lead scoring, and equity column/filter/batch-enrich UI on /leads.

**Architecture:** New `parcelEquity` table keyed by prclid (spine stays pure ArcGIS). A `"use node"` action reuses the existing `scrapeZillow` (value) → comps fallback → `lookupParcel` (balances) scrapers, storing results via an internal mutation. The reactive `leads` query preloads `parcelEquity` into a Map, computes equity with pure helpers, and multiplies the score by an equity bucket from `SCORE_CONFIG`. Spec: `docs/superpowers/specs/2026-06-11-equity-gate-design.md`.

**Tech Stack:** Convex (V8 `equityData.ts` + node `equityActions.ts`), Firecrawl scrapers (existing), pure TS modules + vitest, React/TanStack/Tailwind (existing /leads page).

**Conventions that bind every task:**
- After ANY change under `convex/`, run `npx convex dev --once` (validates + regenerates `_generated`) BEFORE `npm run build`. The Windows `UV_HANDLE_CLOSING` assertion after Convex CLI output is cosmetic — trust the printed output, not the exit code.
- Stage explicit paths in git (never `git add -A`). Single-line `-m` commit messages (PowerShell).
- Icons: lucide-react only, never emojis.
- One deliberate spec deviation: `equityBucket()` + the equity config live in `src/scraper/leadScore.ts` (next to `SCORE_CONFIG`, avoiding an import cycle with `equity.ts`); `equity.ts` holds the zero-dependency money math.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/equity-gate
git branch --show-current   # expect: feat/equity-gate
```

Every later task verifies `git branch --show-current` = `feat/equity-gate` before committing.

---

### Task 1: Pure equity math (`equity.ts`)

**Files:**
- Create: `src/scraper/equity.ts`
- Test: `tests/equity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/equity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeEquity, parseZestimate } from "../src/scraper/equity";

describe("parseZestimate", () => {
  it("parses a plain dollar figure", () => {
    expect(parseZestimate("$123,456")).toBe(123456);
  });
  it("parses K-suffixed figures", () => {
    expect(parseZestimate("$350K")).toBe(350000);
    expect(parseZestimate("$350.5k")).toBe(350500);
  });
  it("parses M-suffixed figures", () => {
    expect(parseZestimate("$1.2M")).toBe(1200000);
  });
  it("returns null for missing/garbage input", () => {
    expect(parseZestimate(undefined)).toBeNull();
    expect(parseZestimate(null)).toBeNull();
    expect(parseZestimate("")).toBeNull();
    expect(parseZestimate("SCRAPE FAILED")).toBeNull();
  });
});

describe("computeEquity", () => {
  it("computes equity and ratio from value minus tax balances", () => {
    const r = computeEquity({ value: 200000, countyBalance: 3000, schoolBalance: 1500, sewerBalance: 500 });
    expect(r.equity).toBe(195000);
    expect(r.equityRatio).toBeCloseTo(0.975);
    expect(r.basis).toBe("taxes-only");
  });
  it("includes manual liens and switches basis", () => {
    const r = computeEquity({ value: 200000, countyBalance: 5000, manualLiens: 150000 });
    expect(r.equity).toBe(45000);
    expect(r.equityRatio).toBeCloseTo(0.225);
    expect(r.basis).toBe("incl-manual-liens");
  });
  it("treats missing balances as 0 (taxes-only proxy)", () => {
    const r = computeEquity({ value: 100000 });
    expect(r.equity).toBe(100000);
    expect(r.equityRatio).toBe(1);
    expect(r.basis).toBe("taxes-only");
  });
  it("allows negative equity", () => {
    const r = computeEquity({ value: 100000, manualLiens: 150000 });
    expect(r.equity).toBe(-50000);
    expect(r.equityRatio).toBeCloseTo(-0.5);
  });
  it("returns all-null when value is unknown", () => {
    const r = computeEquity({ value: null, countyBalance: 5000, manualLiens: 100000 });
    expect(r.equity).toBeNull();
    expect(r.equityRatio).toBeNull();
    expect(r.basis).toBeNull();
  });
  it("manualLiens of 0 still counts as taxes-only basis", () => {
    expect(computeEquity({ value: 100000, manualLiens: 0 }).basis).toBe("taxes-only");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/equity.test.ts`
Expected: FAIL — `Cannot find module '../src/scraper/equity'` (or equivalent).

- [ ] **Step 3: Write the implementation**

Create `src/scraper/equity.ts`:

```ts
// Equity math for the P4 equity gate (lead engine). Pure, zero-dependency:
// imported by BOTH the Convex leads query and the UI so displayed == computed.
// Spec: docs/superpowers/specs/2026-06-11-equity-gate-design.md.

export interface EquityInput {
  value: number | null; // best-known as-is value (zestimate or comps-derived)
  countyBalance?: number | null;
  schoolBalance?: number | null;
  sewerBalance?: number | null;
  manualLiens?: number | null; // team-entered known liens/payoff (e.g. mortgage)
}

export interface EquityResult {
  equity: number | null;
  equityRatio: number | null; // equity / value
  basis: "taxes-only" | "incl-manual-liens" | null;
}

/**
 * Equity = value − known liens. Missing balances count as 0 — this is a
 * taxes-only PROXY until a mortgage payoff is entered (mortgages aren't in any
 * free feed); basis labels which case the number represents.
 */
export function computeEquity(input: EquityInput): EquityResult {
  if (input.value == null || input.value <= 0) {
    return { equity: null, equityRatio: null, basis: null };
  }
  const taxes =
    (input.countyBalance ?? 0) + (input.schoolBalance ?? 0) + (input.sewerBalance ?? 0);
  const manual = input.manualLiens ?? 0;
  const equity = input.value - taxes - manual;
  return {
    equity,
    equityRatio: equity / input.value,
    basis: manual > 0 ? "incl-manual-liens" : "taxes-only",
  };
}

/**
 * Parse a Zillow zestimate string to dollars. Unlike deal.ts parseMoney, this
 * handles the K/M suffixes Zillow uses on search cards ("$350K", "$1.2M").
 */
export function parseZestimate(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.trim().match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*([MKmk])?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toUpperCase();
  return Math.round(suffix === "M" ? n * 1_000_000 : suffix === "K" ? n * 1_000 : n);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/equity.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/equity.ts tests/equity.test.ts
git commit -m "feat(equity): pure equity math + zestimate parser (P4 equity gate)"
```

---

### Task 2: Equity bucket + multiplier in lead scoring

**Files:**
- Modify: `src/scraper/leadScore.ts`
- Test: `tests/leadScore.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/leadScore.test.ts` (inside the file, after the existing `describe` block; also extend the import):

Change line 2 to:

```ts
import { SCORE_CONFIG, computeLeadScore, equityBucket } from "../src/scraper/leadScore";
```

Append at the end of the file:

```ts
describe("equityBucket", () => {
  it("buckets by the configured ratio thresholds", () => {
    expect(equityBucket(0.6)).toBe("high");
    expect(equityBucket(0.5)).toBe("high");
    expect(equityBucket(0.3)).toBe("medium");
    expect(equityBucket(0.2)).toBe("medium");
    expect(equityBucket(0.1)).toBe("low");
    expect(equityBucket(-0.5)).toBe("low");
  });
  it("returns unknown for null ratio", () => {
    expect(equityBucket(null)).toBe("unknown");
  });
});

describe("computeLeadScore equity multiplier", () => {
  const sig = [{ type: "code-violation", observedDate: NOW }];
  const base = computeLeadScore(sig, { absentee: false }, NOW);

  it("multiplies by the bucket multiplier", () => {
    expect(computeLeadScore(sig, { absentee: false }, NOW, "high")).toBe(
      Math.round(base * SCORE_CONFIG.equityMultipliers.high),
    );
    expect(computeLeadScore(sig, { absentee: false }, NOW, "low")).toBe(
      Math.round(base * SCORE_CONFIG.equityMultipliers.low),
    );
  });
  it("unknown bucket and omitted arg leave the score unchanged", () => {
    expect(computeLeadScore(sig, { absentee: false }, NOW, "unknown")).toBe(base);
    expect(computeLeadScore(sig, { absentee: false }, NOW)).toBe(base);
  });
  it("stacks with the absentee multiplier", () => {
    expect(computeLeadScore(sig, { absentee: true }, NOW, "high")).toBe(
      Math.round(
        SCORE_CONFIG.typeWeights["code-violation"] *
          SCORE_CONFIG.absenteeMultiplier *
          SCORE_CONFIG.equityMultipliers.high,
      ),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/leadScore.test.ts`
Expected: FAIL — `equityBucket` is not exported / `equityMultipliers` undefined.

- [ ] **Step 3: Implement**

In `src/scraper/leadScore.ts`, add to `SCORE_CONFIG` (after `absenteeMultiplier: 1.5,`):

```ts
  // P4 equity gate: equityRatio (equity/value) → bucket → score multiplier.
  // "unknown" (not yet enriched) = 1.0 so un-enriched leads score as before.
  equityBuckets: { highMin: 0.5, mediumMin: 0.2 },
  equityMultipliers: { high: 1.5, medium: 1.2, low: 0.5, unknown: 1.0 },
```

Add below the `SCORE_CONFIG` block:

```ts
export type EquityBucketName = "high" | "medium" | "low" | "unknown";

export function equityBucket(ratio: number | null): EquityBucketName {
  if (ratio == null) return "unknown";
  if (ratio >= SCORE_CONFIG.equityBuckets.highMin) return "high";
  if (ratio >= SCORE_CONFIG.equityBuckets.mediumMin) return "medium";
  return "low";
}
```

Change `computeLeadScore`'s signature and final lines to:

```ts
export function computeLeadScore(
  signals: ScorableSignal[],
  parcel: { absentee: boolean },
  now: number,
  equity?: EquityBucketName,
): number {
  if (signals.length === 0) return 0;
  const halfLifeMs = SCORE_CONFIG.recencyHalfLifeDays * 24 * 60 * 60 * 1000;
  let total = 0;
  for (const s of signals) {
    const weight = SCORE_CONFIG.typeWeights[s.type] ?? SCORE_CONFIG.defaultWeight;
    const ageMs = Math.max(0, now - s.observedDate);
    total += weight * Math.pow(0.5, ageMs / halfLifeMs);
  }
  total += SCORE_CONFIG.stackBonus * (signals.length - 1);
  if (parcel.absentee) total *= SCORE_CONFIG.absenteeMultiplier;
  total *= SCORE_CONFIG.equityMultipliers[equity ?? "unknown"];
  return Math.round(total);
}
```

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: ALL PASS (152 existing + the new ones — the optional 4th arg must not break any existing test).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/leadScore.ts tests/leadScore.test.ts
git commit -m "feat(equity): equity buckets + multiplier in SCORE_CONFIG and computeLeadScore"
```

---

### Task 3: `parcelEquity` schema + data layer

**Files:**
- Modify: `convex/schema.ts` (insert after the `buyers` table, before `errorLogs`)
- Create: `convex/equityData.ts`

- [ ] **Step 1: Add the table to `convex/schema.ts`**

Insert after the `buyers` table definition (after its `.index("by_active", ["active"]),` line):

```ts
  // P4 equity gate — funnel-only enrichment per parcel (value + delinquent
  // balances + manual liens). Separate from `parcels` ON PURPOSE: the spine's
  // contentHash CDC must never touch scraped/hand-entered data. Tiny table:
  // only leads someone chose to enrich. Spec: 2026-06-11-equity-gate-design.md.
  parcelEquity: defineTable({
    prclid: v.string(),
    value: v.optional(v.number()), // as-is value in dollars
    valueSource: v.optional(v.union(v.literal("zestimate"), v.literal("comps"))),
    valueAt: v.optional(v.number()), // ms — when the value was scraped
    countyBalance: v.optional(v.number()),
    schoolBalance: v.optional(v.number()),
    sewerBalance: v.optional(v.number()),
    assessedValue: v.optional(v.number()), // county assessment total (context)
    balancesAt: v.optional(v.number()), // ms — when balances were scraped
    manualLiens: v.optional(v.number()), // team-entered known liens/payoff $
    manualLiensNote: v.optional(v.string()),
    lastError: v.optional(v.string()), // last enrich failure (visible, never silent)
    updatedAt: v.number(),
  }).index("by_prclid", ["prclid"]),
```

- [ ] **Step 2: Create `convex/equityData.ts`**

```ts
import { v } from "convex/values";
import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { requireUser } from "./helpers";

// P4 equity gate — V8 data layer for the parcelEquity enrichment table.
// Shared-team model (same as pipelineData): any signed-in member acts on any lead.

/** Spine row for the enrich action (address + prclid). */
export const getParcelInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    return await ctx.db
      .query("parcels")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
  },
});

/** CLI/live-verify reader (deploy-key access bypasses function auth). */
export const getEquityInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    return await ctx.db
      .query("parcelEquity")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
  },
});

/**
 * Upsert enrichment results by prclid — only provided fields change, so the
 * value scrape and the balances scrape can land independently (partial success
 * is fine). `lastError: null` clears a stale error after a clean run.
 */
export const storeEnrichment = internalMutation({
  args: {
    prclid: v.string(),
    value: v.optional(v.number()),
    valueSource: v.optional(v.union(v.literal("zestimate"), v.literal("comps"))),
    valueAt: v.optional(v.number()),
    countyBalance: v.optional(v.number()),
    schoolBalance: v.optional(v.number()),
    sewerBalance: v.optional(v.number()),
    assessedValue: v.optional(v.number()),
    balancesAt: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { prclid, lastError, ...fields }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) patch[k] = val;
    }
    if (lastError !== undefined) patch.lastError = lastError ?? undefined;
    const existing = await ctx.db
      .query("parcelEquity")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("parcelEquity", { prclid, ...patch } as any);
  },
});

/** Team-entered known liens (e.g. mortgage payoff from the docket). null clears. */
export const setManualLiens = mutation({
  args: {
    prclid: v.string(),
    amount: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { prclid, amount, note }) => {
    await requireUser(ctx);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (amount !== undefined) patch.manualLiens = amount ?? undefined;
    if (note !== undefined) patch.manualLiensNote = note ?? undefined;
    const existing = await ctx.db
      .query("parcelEquity")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("parcelEquity", { prclid, ...patch } as any);
  },
});
```

- [ ] **Step 3: Validate + regenerate codegen**

Run: `npx convex dev --once`
Expected: schema + functions push cleanly to dev; `convex/_generated` updated. (Ignore the Windows `UV_HANDLE_CLOSING` teardown assertion.)

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/equityData.ts convex/_generated
git commit -m "feat(equity): parcelEquity table + data layer (storeEnrichment, setManualLiens)"
```

---

### Task 4: Enrichment actions (`equityActions.ts`)

**Files:**
- Create: `convex/equityActions.ts`

- [ ] **Step 1: Create `convex/equityActions.ts`**

```ts
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
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    return await doEnrich(ctx, prclid);
  },
});

/** Batch button: fan out up to BATCH_CAP parcels, staggered for NCC rate limits. */
export const enrichBatch = action({
  args: { prclids: v.array(v.string()) },
  handler: async (ctx, { prclids }): Promise<{ scheduled: number }> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
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
```

- [ ] **Step 2: Validate + typecheck**

Run: `npx convex dev --once`
Expected: pushes cleanly (note: explicit `Promise<...>` return annotations on every handler — required by the project's TS7022/TS7023 lesson).
Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add convex/equityActions.ts convex/_generated
git commit -m "feat(equity): enrichEquity/enrichBatch actions - zillow value, comps fallback, NCC balances"
```

---

### Task 5: Equity in the `leads` query

**Files:**
- Modify: `convex/signalData.ts`

- [ ] **Step 1: Wire equity into the query**

In `convex/signalData.ts`:

(a) Extend the imports (line 4):

```ts
import { computeLeadScore, equityBucket } from "../src/scraper/leadScore";
import { computeEquity } from "../src/scraper/equity";
```

(b) Add to the `leads` args object (after `limit`):

```ts
    minEquityRatio: v.optional(v.number()), // 0–1; set ⇒ unknown-equity leads are excluded
```

and to the handler destructuring: `minEquityRatio`.

(c) After the `statusByPrclid` Map is built (line ~155), preload equity the same way:

```ts
    // Enrichment rows (small table: only enriched leads — funnel-only).
    const equityRows = await ctx.db.query("parcelEquity").collect();
    const equityByPrclid = new Map(equityRows.map((e) => [e.prclid, e]));
```

(d) Extend the `out` array's element type with (after `assignmentFee?: number;`):

```ts
      value?: number;
      valueSource?: "zestimate" | "comps";
      valueAt?: number;
      countyBalance?: number;
      schoolBalance?: number;
      sewerBalance?: number;
      assessedValue?: number;
      balancesAt?: number;
      manualLiens?: number;
      manualLiensNote?: string;
      equity: number | null;
      equityRatio: number | null;
      equityBucket: "high" | "medium" | "low" | "unknown";
      equityBasis: "taxes-only" | "incl-manual-liens" | null;
      equityError?: string;
```

(e) Inside the `for (const [prclid, sigs] of byParcel)` loop, after the `absenteeOnly` check, compute + filter:

```ts
      const eq = equityByPrclid.get(prclid);
      const equityResult = computeEquity({
        value: eq?.value ?? null,
        countyBalance: eq?.countyBalance,
        schoolBalance: eq?.schoolBalance,
        sewerBalance: eq?.sewerBalance,
        manualLiens: eq?.manualLiens,
      });
      if (minEquityRatio !== undefined) {
        if (equityResult.equityRatio == null || equityResult.equityRatio < minEquityRatio) continue;
      }
      const bucket = equityBucket(equityResult.equityRatio);
```

(f) In the `out.push({...})` object: change the `score:` line to pass the bucket —

```ts
        score: computeLeadScore(
          sigs.map((s) => ({ type: s.type, observedDate: s.observedDate })),
          { absentee: parcel.absentee },
          now,
          bucket,
        ),
```

and add after `assignmentFee: status?.assignmentFee,`:

```ts
        value: eq?.value,
        valueSource: eq?.valueSource,
        valueAt: eq?.valueAt,
        countyBalance: eq?.countyBalance,
        schoolBalance: eq?.schoolBalance,
        sewerBalance: eq?.sewerBalance,
        assessedValue: eq?.assessedValue,
        balancesAt: eq?.balancesAt,
        manualLiens: eq?.manualLiens,
        manualLiensNote: eq?.manualLiensNote,
        equity: equityResult.equity,
        equityRatio: equityResult.equityRatio,
        equityBucket: bucket,
        equityBasis: equityResult.basis,
        equityError: eq?.lastError,
```

- [ ] **Step 2: Validate + typecheck**

Run: `npx convex dev --once` then `npm run build`
Expected: both clean.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add convex/signalData.ts convex/_generated
git commit -m "feat(equity): leads query joins parcelEquity - equity fields, bucket multiplier, minEquityRatio filter"
```

---

### Task 6: Mail CSV gains value/equity columns

**Files:**
- Modify: `src/web/lib/mailCsv.ts`
- Test: `tests/mailCsv.test.ts` (append — the file exists; check its existing style first)

- [ ] **Step 1: Write the failing test**

Append to `tests/mailCsv.test.ts` (match the existing test fixtures' shape — add the two new fields to any existing fixture objects to satisfy the type):

```ts
it("includes value and equity columns, blank when unknown", () => {
  const csv = buildMailCsv([
    {
      ownerName: "JONES JOHN", ownerAddr: "1 MAIN ST", ownerAddr2: "", ownerCity: "WILMINGTON",
      ownerState: "DE", ownerZip: "19801", situsStreet: "2 OAK AVE", propCity: "NEWARK",
      propZip: "19711", score: 80, signalTypes: ["pre-foreclosure"],
      value: 250000, equity: 245000,
    },
    {
      ownerName: "SMITH SUE", ownerAddr: "9 ELM ST", ownerAddr2: "", ownerCity: "DOVER",
      ownerState: "DE", ownerZip: "19901", situsStreet: "4 PINE RD", propCity: "BEAR",
      propZip: "19701", score: 40, signalTypes: ["code-violation"],
      value: null, equity: null,
    },
  ]);
  const lines = csv.trim().split("\n");
  expect(lines[0]).toContain("value,equity");
  expect(lines[1]).toContain("250000,245000");
  expect(lines[2].endsWith(",,")).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/mailCsv.test.ts`
Expected: FAIL (type error on the new fields / missing columns).

- [ ] **Step 3: Implement**

In `src/web/lib/mailCsv.ts`: add to `MailCsvLead`:

```ts
  value: number | null;
  equity: number | null;
```

Change `HEADERS` to:

```ts
const HEADERS = [
  "owner_name", "mail_address", "mail_address_2", "mail_city", "mail_state", "mail_zip",
  "property_address", "property_city", "property_zip", "score", "signals", "value", "equity",
];
```

In the row array (inside `buildMailCsv`), after `l.signalTypes.join("|"),` add:

```ts
      l.value ?? "", l.equity ?? "",
```

(`cell` accepts `string | number` — `""` covers the null case.)

- [ ] **Step 4: Run tests + fix the existing fixtures**

Run: `npx vitest run tests/mailCsv.test.ts`
Existing fixtures in this test file will now fail typecheck — add `value: null, equity: null` to each. Then expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/lib/mailCsv.ts tests/mailCsv.test.ts
git commit -m "feat(equity): mail CSV gains value/equity columns"
```

---

### Task 7: /leads UI — equity column, enrich buttons, manual liens, filter

**Files:**
- Modify: `src/web/LeadsPage.tsx`

- [ ] **Step 1: Imports + helpers**

In `src/web/LeadsPage.tsx`:

(a) Extend the convex import (line 2): `import { useAction, useMutation, useQuery } from "convex/react";`

(b) Add lucide icons to the existing import list: `RefreshCw`, `Zap`.

(c) Add component imports after the existing ones:

```ts
import { ConfirmDialog } from "./ConfirmDialog";
```

(d) Add helpers after `scoreColor` (line ~72):

```ts
function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const EQUITY_CHIP: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  medium: "border-teal/40 bg-teal/10 text-teal-glow",
  low: "border-red-500/40 bg-red-500/10 text-red-400",
  unknown: "border-border text-muted-foreground",
};
```

- [ ] **Step 2: `LeadEquity` expanded-row panel**

Add this component after `LeadWorkflow` (line ~287):

```tsx
/** Equity panel in the expanded row: enrich button, balances detail, manual liens (P4). */
function LeadEquity({ lead }: { lead: Lead }) {
  const enrich = useAction(api.equityActions.enrichEquity);
  const setLiens = useMutation(api.equityData.setManualLiens);
  const [pulling, setPulling] = useState(false);
  const [pullErr, setPullErr] = useState<string | null>(null);
  const [liens, setLiens_] = useState(lead.manualLiens?.toString() ?? "");
  const [liensNote, setLiensNote] = useState(lead.manualLiensNote ?? "");

  const pull = async () => {
    setPulling(true);
    setPullErr(null);
    try {
      await enrich({ prclid: lead.prclid });
    } catch (e) {
      setPullErr((e as Error).message);
    } finally {
      setPulling(false);
    }
  };

  const saveLiens = async () => {
    const n = Number(liens.replace(/[^0-9.]/g, ""));
    await setLiens({
      prclid: lead.prclid,
      amount: liens.trim() === "" ? null : n,
      note: liensNote.trim() === "" ? null : liensNote.trim(),
    });
  };

  return (
    <div className="space-y-2 border-t border-border/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          Value: <span className="text-foreground">{fmtMoney(lead.value)}</span>
          {lead.valueSource && (
            <span className="ml-1 text-xs">({lead.valueSource}, {fmtDate(lead.valueAt ?? 0)})</span>
          )}
        </span>
        <span className="text-muted-foreground">
          Balances:{" "}
          <span className="text-foreground">
            {lead.balancesAt
              ? `county ${fmtMoney(lead.countyBalance)} · school ${fmtMoney(lead.schoolBalance)} · sewer ${fmtMoney(lead.sewerBalance)}`
              : "—"}
          </span>
          {lead.balancesAt ? <span className="ml-1 text-xs">({fmtDate(lead.balancesAt)})</span> : null}
        </span>
        {lead.assessedValue != null && (
          <span className="text-muted-foreground">
            Assessed: <span className="text-foreground">{fmtMoney(lead.assessedValue)}</span>
          </span>
        )}
        <button
          onClick={pull}
          disabled={pulling}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-teal/40 px-2.5 text-sm text-teal-glow transition-colors hover:bg-teal/10 disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", pulling && "animate-spin")} />
          {pulling ? "Pulling…" : "Pull value & balances"}
        </button>
      </div>
      {(pullErr ?? lead.equityError) && (
        <div className="text-xs text-amber-400">{pullErr ?? lead.equityError}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Known liens $</span>
        <input
          value={liens}
          onChange={(e) => setLiens_(e.target.value)}
          placeholder="e.g. 150000"
          className="h-8 w-28 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <input
          value={liensNote}
          onChange={(e) => setLiensNote(e.target.value)}
          placeholder="Note — e.g. mortgage per docket"
          className="h-8 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal"
        />
        <button
          onClick={saveLiens}
          disabled={liens === (lead.manualLiens?.toString() ?? "") && liensNote === (lead.manualLiensNote ?? "")}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Table column**

In the table `<thead>` row, insert after the `Score` th:

```tsx
                  <th className="px-4 py-2.5 font-medium">Equity</th>
```

In the body row, insert after the score `<td>`:

```tsx
                      <td className="px-4 py-2.5">
                        {l.equity != null ? (
                          <div>
                            <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-medium", EQUITY_CHIP[l.equityBucket])}>
                              {fmtMoney(l.equity)} · {Math.round((l.equityRatio ?? 0) * 100)}%
                            </span>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {l.equityBasis === "incl-manual-liens" ? "incl. liens" : "taxes-only"} · worth {fmtMoney(l.value)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
```

(The row callback's variable is `l`.) Update the expanded row's `colSpan={7}` to `colSpan={8}`.

Mount the panel in the expanded row, after `<SignalTimeline …/>`:

```tsx
                          <LeadEquity key={`eq-${l.prclid}`} lead={l} />
```

- [ ] **Step 4: Toolbar — min-equity filter + Enrich top N**

In `LeadsPage`: add state after `view`:

```ts
  const [minEquity, setMinEquity] = useState("any");
  const [enrichOpen, setEnrichOpen] = useState(false);
  const enrichBatch = useAction(api.equityActions.enrichBatch);
```

Add `minEquityRatio` to the `useQuery(api.signalData.leads, {...})` args:

```ts
    minEquityRatio: minEquity === "any" ? undefined : Number(minEquity),
```

In the filter row, after the absentee-only button, add:

```tsx
          <Select value={minEquity} onValueChange={setMinEquity}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any equity</SelectItem>
              <SelectItem value="0">Positive equity</SelectItem>
              <SelectItem value="0.2">≥20% equity</SelectItem>
              <SelectItem value="0.5">≥50% equity</SelectItem>
            </SelectContent>
          </Select>
```

Before the Export button, add the batch button + dialog (50 = `BATCH_CAP` in `convex/equityActions.ts` — keep in sync):

```tsx
          <button
            onClick={() => setEnrichOpen(true)}
            disabled={!leads || leads.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
          >
            <Zap className="h-4 w-4" /> Enrich top {Math.min(leads?.length ?? 0, 50)}
          </button>
          <ConfirmDialog
            open={enrichOpen}
            onOpenChange={setEnrichOpen}
            title="Enrich top leads?"
            description={`Pull value + county balances for the top ${Math.min(leads?.length ?? 0, 50)} filtered leads. Uses ~2 Firecrawl credits per lead and runs staggered in the background (~${Math.ceil((Math.min(leads?.length ?? 0, 50) * 2.5) / 60)} min).`}
            confirmLabel="Enrich"
            onConfirm={() => enrichBatch({ prclids: (leads ?? []).slice(0, 50).map((l) => l.prclid) })}
          />
```

- [ ] **Step 5: CSV export fields**

In the `exportCsv` mapping, add after `signalTypes: …`:

```ts
          value: l.value ?? null,
          equity: l.equity,
```

- [ ] **Step 6: Build + typecheck**

Run: `npm run build`
Expected: clean. (If `api.equityActions`/`api.equityData` symbols are missing, re-run `npx convex dev --once` first.)

- [ ] **Step 7: Commit**

```bash
git add src/web/LeadsPage.tsx
git commit -m "feat(equity): /leads equity column, pull & batch-enrich buttons, manual liens, min-equity filter"
```

---

### Task 8: Score legend equity rows

**Files:**
- Modify: `src/components/score-legend.tsx`

- [ ] **Step 1: Add equity rows**

In the `space-y-0.5` block (after the `Halves every … days` Row), add:

```tsx
            <Row
              label={`High equity (≥${SCORE_CONFIG.equityBuckets.highMin * 100}%)`}
              value={`×${SCORE_CONFIG.equityMultipliers.high}`}
            />
            <Row
              label={`Some equity (≥${SCORE_CONFIG.equityBuckets.mediumMin * 100}%)`}
              value={`×${SCORE_CONFIG.equityMultipliers.medium}`}
            />
            <Row label="Low/negative equity" value={`×${SCORE_CONFIG.equityMultipliers.low}`} />
          </div>
```

(i.e. the three new `Row`s go inside the existing `div.space-y-0.5`, before its closing tag. Unknown equity is ×1.0 — intentionally not listed; the legend shows only score-changing factors.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/score-legend.tsx
git commit -m "feat(equity): equity multipliers in the sidebar score legend"
```

---

### Task 9: Full verification (tests, build, live dev run)

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

```bash
npx vitest run        # expect: all pass (~165+)
npx convex dev --once # expect: clean push to dev
npm run build         # expect: clean
```

- [ ] **Step 2: Confirm PRCLID format against a real spine row**

```bash
npx convex data parcels --limit 1
```

Expected: `prclid` is a digits-only string (e.g. `1100830074`) — the same shape `lookupParcel` receives from the sheriff flow after dash-stripping.

- [ ] **Step 3: Live enrich one real lead on dev (CLI uses the internal action — public ones are auth-gated)**

Pick a prclid that actually has signals: run

```bash
npx convex run signalData:signalStatsInternal
npx convex data signalEvents --limit 5
```

take a `prclid` from the output, then:

```bash
npx convex run equityActions:enrichEquityInternal '{"prclid":"<PRCLID>"}'
npx convex run equityData:getEquityInternal '{"prclid":"<PRCLID>"}'
```

Expected: the action returns `status: "ok"` (or `"partial"` with a real error string), and the equity row holds `value`/`valueSource`/`balances*`/`updatedAt`. ⚠ The CLI may print "✖ Failed to run function" on long actions while the action SUCCEEDS server-side — verify via the `getEquityInternal` read, not the exit code.
If balances consistently fail with "detail page not reached": try the dashed parcel format from the NCC site manually before blaming Reblaze (see Task 4 comment).

- [ ] **Step 4: Live-verify the leads query effect**

```bash
npx convex data parcelEquity
```

Expected: one row per enriched parcel. Then (UI, user step at review time): /leads shows the equity badge on the enriched lead, its score shifts by the bucket multiplier, the min-equity filter excludes un-enriched leads, the legend shows the equity rows.

- [ ] **Step 5: Batch smoke (3 parcels)**

```bash
npx convex run equityActions:enrichEquityInternal '{"prclid":"<PRCLID2>"}'
```

(Single internal calls suffice to prove the worker; the batch fan-out is `scheduler.runAfter` + the same worker — verify `enrichBatch`'s cap by reading the code. The UI batch button is exercised in the user click-through.)

- [ ] **Step 6: Commit any fixups + report**

```bash
git status   # only intended files
```

Report: test count, live-verify outcomes (value source hit, balances hit/fail + why), any deviations from this plan.

---

## Out of scope (per spec)
Recorder of Deeds lookup · staleness cron · derived "tax-delinquent" signal · Kanban-card equity display · merge to main / prod deploy (separate decision after review + user click-through on dev).
