# Flip Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, additive `/flip` page that turns any property (a Sheriff/Legal listing or a manual address) into a flip P&L — ARV minus a tiered rehab estimate minus the full cost stack → MAO, profit, ROI, and a grade — saved per analysis.

**Architecture:** A pure, unit-tested math module (`src/scraper/flip.ts`, mirrors `deal.ts`) holds the rehab tiers and the flip P&L. A new Convex table `flipAnalyses` stores each analysis (a self-contained snapshot + editable inputs); a new `convex/flipData.ts` exposes gated queries/mutations that attach `computeFlip()` metrics. A new `src/web/FlipAnalyzer.tsx` page imports the *same* pure module to compute results live as the user edits, then persists on Save. The Sheriff/Legal pages, their queries, and `deal.ts` are NOT modified — only read.

**Tech Stack:** TypeScript, Convex (V8 queries/mutations), React + TanStack Router, Tailwind v4 (dark "Industrial Precision" theme), Vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-03-flip-analyzer-design.md`

---

## File Structure

```
NEW   src/scraper/flip.ts            REHAB_TIERS, FLIP_DEFAULTS, estimateRehab(), computeFlip() — pure
NEW   tests/flip.test.ts             unit tests for flip.ts
NEW   convex/flipData.ts             listAnalyses, getAnalysis, candidates, createFromSheriff/Legal/Manual,
                                     updateAnalysis, setFlipDealStatus, deleteAnalysis (all requireUser-gated)
NEW   src/web/FlipAnalyzer.tsx       the /flip page (own file — pages.tsx untouched)
EDIT  convex/schema.ts               ADD flipAnalyses table (existing tables unchanged)
EDIT  src/web/app.tsx                ADD route /flip
EDIT  src/components/app-shared.tsx  ADD nav item "Flip Analyzer"
```

Each unit has one responsibility: `flip.ts` = math, `flipData.ts` = persistence/exposure, `FlipAnalyzer.tsx` = UI. `flip.ts` is shared verbatim by the backend query and the frontend live preview (single source of truth for the math).

---

## Task 0: Branch

- [ ] **Step 1: Create a feature branch** (repo is on `main`)

Run:
```bash
git checkout -b feat/flip-analyzer
```
Expected: `Switched to a new branch 'feat/flip-analyzer'`

---

## Task 1: Rehab tiers + `estimateRehab` (TDD)

**Files:**
- Create: `src/scraper/flip.ts`
- Test: `tests/flip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/flip.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { REHAB_TIERS, FLIP_DEFAULTS, estimateRehab } from "../src/scraper/flip";

describe("REHAB_TIERS / FLIP_DEFAULTS", () => {
  it("has the three tiers with per-sqft midpoints", () => {
    expect(REHAB_TIERS.cosmetic.perSqft).toBe(18);
    expect(REHAB_TIERS.moderate.perSqft).toBe(42);
    expect(REHAB_TIERS.gut.perSqft).toBe(95);
  });
  it("has sane defaults", () => {
    expect(FLIP_DEFAULTS.contingencyPct).toBe(0.10);
    expect(FLIP_DEFAULTS.assumptions.annualRate).toBe(0.11);
    expect(FLIP_DEFAULTS.assumptions.holdingMonths).toBe(6);
  });
});

describe("estimateRehab", () => {
  it("computes base = perSqft * sqft, plus contingency", () => {
    const r = estimateRehab(42, 1500, 0.10);
    expect(r.base).toBe(63000);
    expect(r.contingency).toBe(6300);
    expect(r.total).toBe(69300);
  });
  it("override wins over perSqft * sqft", () => {
    const r = estimateRehab(42, 1500, 0.10, 50000);
    expect(r.base).toBe(50000);
    expect(r.total).toBe(55000);
  });
  it("returns nulls when sqft is unknown and no override", () => {
    const r = estimateRehab(42, null, 0.10);
    expect(r.base).toBeNull();
    expect(r.total).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/flip.test.ts`
Expected: FAIL — `Failed to resolve import "../src/scraper/flip"` / module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/scraper/flip.ts`:
```ts
// Flip economics — the "should I flip this, and at what max offer?" screen.
// Pure + deterministic so it's unit-tested and safe to run in a Convex query
// AND imported by the React page for a live preview. Does NOT touch deal.ts.

export type RehabTier = "cosmetic" | "moderate" | "gut" | "custom";

export interface RehabTierInfo {
  perSqft: number;
  label: string;
  range: string;
}

// Per-sqft midpoints from the research (ranges shown for the UI); all editable.
export const REHAB_TIERS: Record<Exclude<RehabTier, "custom">, RehabTierInfo> = {
  cosmetic: { perSqft: 18, label: "Cosmetic", range: "$10-25/sqft" },
  moderate: { perSqft: 42, label: "Moderate", range: "$25-60/sqft" },
  gut: { perSqft: 95, label: "Full Gut", range: "$60-150+/sqft" },
};

export interface FlipAssumptions {
  closingPct: number;     // purchase-side closing, fraction of purchase
  downPct: number;        // down payment, fraction of purchase
  loanPoints: number;     // fraction of loan amount
  annualRate: number;     // hard-money annual interest, fraction
  holdingMonths: number;
  monthlyHolding: number; // taxes+insurance+utilities+misc, $/month
  sellAgentPct: number;   // fraction of ARV
  sellTransferPct: number;// fraction of ARV (DE seller transfer-tax portion)
  sellClosingPct: number; // fraction of ARV
}

export const FLIP_DEFAULTS: { contingencyPct: number; assumptions: FlipAssumptions } = {
  contingencyPct: 0.10,
  assumptions: {
    closingPct: 0.02,
    downPct: 0.10,
    loanPoints: 0.02,
    annualRate: 0.11,
    holdingMonths: 6,
    monthlyHolding: 400,
    sellAgentPct: 0.05,
    sellTransferPct: 0.02,
    sellClosingPct: 0.01,
  },
};

export interface RehabEstimate {
  base: number | null;
  contingency: number | null;
  total: number | null;
}

/** Tiered rehab estimate: override wins; else perSqft * sqft; + contingency. */
export function estimateRehab(
  perSqft: number,
  sqft: number | null,
  contingencyPct: number,
  override?: number | null,
): RehabEstimate {
  const base = override != null ? override : sqft != null ? perSqft * sqft : null;
  if (base === null) return { base: null, contingency: null, total: null };
  const contingency = base * contingencyPct;
  return { base, contingency, total: base + contingency };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/flip.test.ts`
Expected: PASS (6 tests in this file so far).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/flip.ts tests/flip.test.ts
git commit -m "feat(flip): rehab tiers + estimateRehab (pure, tested)"
```

---

## Task 2: `computeFlip` P&L (TDD)

**Files:**
- Modify: `src/scraper/flip.ts` (append types + `computeFlip`)
- Test: `tests/flip.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/flip.test.ts`:
```ts
import { computeFlip } from "../src/scraper/flip";

describe("computeFlip", () => {
  const A = FLIP_DEFAULTS.assumptions;

  it("golden case: profit, MAO, ROI, grade ok", () => {
    const m = computeFlip({ arv: 300000, purchasePrice: 150000, rehabTotal: 50000, assumptions: A });
    expect(m.mao).toBe(160000);            // 300000*0.7 - 50000
    expect(m.profit).toBe(56725);
    expect(m.cashInvested).toBe(34275);
    expect(m.roi).toBeCloseTo(1.65496, 4);
    expect(m.annualizedRoi).toBeCloseTo(3.30993, 4);
    expect(m.margin).toBeCloseTo(0.18908, 4);
    expect(m.grade).toBe("ok");
    expect(m.flags).toEqual([]);
    expect(m.dataComplete).toBe(true);
  });

  it("high-margin deal grades good", () => {
    const m = computeFlip({ arv: 400000, purchasePrice: 120000, rehabTotal: 40000, assumptions: A });
    expect(m.grade).toBe("good");
    expect(m.profit).toBe(192100);
  });

  it("overpaying past the 70% rule with a thin margin", () => {
    const m = computeFlip({ arv: 300000, purchasePrice: 200000, rehabTotal: 40000, assumptions: A });
    expect(m.mao).toBe(170000);
    expect(m.flags).toContain("over-70%-rule");
    expect(m.flags).toContain("thin-margin");
    expect(m.grade).toBe("thin");
  });

  it("negative profit grades bad", () => {
    const m = computeFlip({ arv: 200000, purchasePrice: 160000, rehabTotal: 20000, assumptions: A });
    expect(m.profit).toBeLessThan(0);
    expect(m.grade).toBe("bad");
    expect(m.flags).toContain("negative-profit");
  });

  it("missing ARV → unknown grade, MAO null, missing-arv flag", () => {
    const m = computeFlip({ arv: null, purchasePrice: 100000, rehabTotal: 50000, assumptions: A });
    expect(m.dataComplete).toBe(false);
    expect(m.grade).toBe("unknown");
    expect(m.mao).toBeNull();
    expect(m.profit).toBeNull();
    expect(m.flags).toContain("missing-arv");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/flip.test.ts`
Expected: FAIL — `computeFlip is not a function` / export missing.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/scraper/flip.ts`:
```ts
export type FlipGrade = "good" | "ok" | "thin" | "bad" | "unknown";

export interface FlipInput {
  arv: number | null;
  purchasePrice: number | null;
  rehabTotal: number | null;
  assumptions: FlipAssumptions;
}

export interface FlipMetrics {
  mao: number | null;
  closingCost: number | null;
  financingCost: number | null;
  holdingCost: number | null;
  sellingCost: number | null;
  totalCost: number | null;
  profit: number | null;
  cashInvested: number | null;
  roi: number | null;
  annualizedRoi: number | null;
  margin: number | null;
  grade: FlipGrade;
  dataComplete: boolean;
  flags: string[];
}

export function computeFlip(input: FlipInput): FlipMetrics {
  const { arv, purchasePrice, rehabTotal, assumptions: a } = input;
  const flags: string[] = [];
  if (arv === null) flags.push("missing-arv");
  if (purchasePrice === null) flags.push("missing-purchase");
  if (rehabTotal === null) flags.push("missing-rehab");

  // MAO needs ARV + rehab only (the quick offer ceiling).
  const mao = arv !== null && rehabTotal !== null ? arv * 0.7 - rehabTotal : null;

  const dataComplete = arv !== null && purchasePrice !== null && rehabTotal !== null;
  if (!dataComplete) {
    return {
      mao, closingCost: null, financingCost: null, holdingCost: null, sellingCost: null,
      totalCost: null, profit: null, cashInvested: null, roi: null, annualizedRoi: null,
      margin: null, grade: "unknown", dataComplete: false, flags,
    };
  }

  const closingCost = purchasePrice * a.closingPct;
  const downPayment = purchasePrice * a.downPct;
  const loanAmount = purchasePrice - downPayment + rehabTotal; // hard money funds rest of purchase + 100% rehab
  const points = loanAmount * a.loanPoints;
  const interest = loanAmount * a.annualRate * (a.holdingMonths / 12);
  const financingCost = points + interest;
  const holdingCost = a.monthlyHolding * a.holdingMonths;
  const sellingCost = arv * (a.sellAgentPct + a.sellTransferPct + a.sellClosingPct);

  const totalCost = purchasePrice + closingCost + rehabTotal + financingCost + holdingCost + sellingCost;
  const profit = arv - totalCost;
  const cashInvested = downPayment + closingCost + points + interest + holdingCost;
  const roi = cashInvested > 0 ? profit / cashInvested : null;
  const annualizedRoi = roi !== null && a.holdingMonths > 0 ? roi * (12 / a.holdingMonths) : null;
  const margin = arv > 0 ? profit / arv : null;

  if (mao !== null && purchasePrice > mao) flags.push("over-70%-rule");
  if (profit <= 0) flags.push("negative-profit");
  if (margin !== null && margin > 0 && margin < 0.1) flags.push("thin-margin");

  let grade: FlipGrade = "unknown";
  if (margin !== null) {
    if (margin <= 0) grade = "bad";
    else if (margin < 0.1) grade = "thin";
    else if (margin < 0.2) grade = "ok";
    else grade = "good";
  }

  return {
    mao, closingCost, financingCost, holdingCost, sellingCost, totalCost,
    profit, cashInvested, roi, annualizedRoi, margin, grade, dataComplete, flags,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/flip.test.ts`
Expected: PASS (all flip tests green).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — the prior 44 tests plus the new flip tests.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/flip.ts tests/flip.test.ts
git commit -m "feat(flip): computeFlip P&L (MAO, profit, ROI, grade) + tests"
```

---

## Task 3: Add the `flipAnalyses` table to the schema

**Files:**
- Modify: `convex/schema.ts` (add one `defineTable` block inside `defineSchema({...})`, after `legalNotices`)

- [ ] **Step 1: Add the table**

In `convex/schema.ts`, immediately before the final closing `});` of `defineSchema`, add:
```ts
  // Flip analyses — additive, self-contained. Reads sheriff/legal rows only at
  // creation (snapshot); never writes back to them.
  flipAnalyses: defineTable({
    source: v.object({
      kind: v.union(v.literal("sheriff"), v.literal("legal"), v.literal("manual")),
      listingId: v.optional(v.string()), // source row _id (string) — reference only
    }),
    // snapshot of property facts at creation
    address: v.string(),
    sqft: v.optional(v.number()),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    asIsValue: v.optional(v.number()), // parsed Zestimate snapshot
    // editable inputs
    arv: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    rehabTier: v.union(
      v.literal("cosmetic"),
      v.literal("moderate"),
      v.literal("gut"),
      v.literal("custom"),
    ),
    rehabPerSqft: v.number(),
    rehabOverride: v.optional(v.number()),
    contingencyPct: v.number(),
    assumptions: v.object({
      closingPct: v.number(),
      downPct: v.number(),
      loanPoints: v.number(),
      annualRate: v.number(),
      holdingMonths: v.number(),
      monthlyHolding: v.number(),
      sellAgentPct: v.number(),
      sellTransferPct: v.number(),
      sellClosingPct: v.number(),
    }),
    // workflow (its OWN copy — never writes to the source listing)
    dealStatus,
    notes: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_dealStatus", ["dealStatus"]),
```
(`dealStatus` is already imported/defined at the top of this file and reused by the other tables.)

- [ ] **Step 2: Validate the schema + regenerate `_generated`**

Run: `npx convex dev --once`
Expected: completes and regenerates `convex/_generated` with the new table types. (On Windows, ignore the cosmetic `UV_HANDLE_CLOSING` assertion that fires after the real output — see lessons.)

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(flip): add flipAnalyses table"
```

---

## Task 4: Convex queries + mutations (`convex/flipData.ts`)

**Files:**
- Create: `convex/flipData.ts`

- [ ] **Step 1: Write the file**

Create `convex/flipData.ts`:
```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUser } from "./helpers";
import { dealStatus } from "./schema";
import { parseMoney } from "../src/scraper/deal";
import {
  computeFlip,
  estimateRehab,
  REHAB_TIERS,
  FLIP_DEFAULTS,
} from "../src/scraper/flip";

const assumptionsValidator = v.object({
  closingPct: v.number(),
  downPct: v.number(),
  loanPoints: v.number(),
  annualRate: v.number(),
  holdingMonths: v.number(),
  monthlyHolding: v.number(),
  sellAgentPct: v.number(),
  sellTransferPct: v.number(),
  sellClosingPct: v.number(),
});

// Attach the computed rehab estimate + flip metrics to a stored analysis.
function withMetrics(a: Doc<"flipAnalyses">) {
  const rehab = estimateRehab(a.rehabPerSqft, a.sqft ?? null, a.contingencyPct, a.rehabOverride ?? null);
  const metrics = computeFlip({
    arv: a.arv ?? null,
    purchasePrice: a.purchasePrice ?? null,
    rehabTotal: rehab.total,
    assumptions: a.assumptions,
  });
  return { ...a, rehab, metrics };
}

export const listAnalyses = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("flipAnalyses").order("desc").collect();
    const withM = rows.map(withMetrics);
    const RANK: Record<string, number> = { good: 0, ok: 1, thin: 2, bad: 3, unknown: 4 };
    withM.sort((x, y) => {
      const rx = RANK[x.metrics.grade] ?? 9;
      const ry = RANK[y.metrics.grade] ?? 9;
      if (rx !== ry) return rx - ry;
      const px = x.metrics.profit;
      const py = y.metrics.profit;
      if (px === null && py === null) return 0;
      if (px === null) return 1;
      if (py === null) return -1;
      return py - px;
    });
    return withM;
  },
});

export const getAnalysis = query({
  args: { id: v.id("flipAnalyses") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const a = await ctx.db.get(id);
    return a ? withMetrics(a) : null;
  },
});

// Recent sheriff + legal rows to populate the "create from listing" picker.
// Read-only — does not modify those tables.
export const candidates = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const sheriff = await ctx.db.query("sheriffListings").order("desc").take(200);
    const legal = await ctx.db.query("legalNotices").order("desc").take(200);
    const pick = (r: { _id: string; address: string }) => ({ id: r._id, address: r.address });
    return { sheriff: sheriff.map(pick), legal: legal.map(pick) };
  },
});

function seed(
  source: Doc<"flipAnalyses">["source"],
  facts: { address: string; sqft?: number; beds?: string; baths?: string; asIsValue?: number },
  createdBy: string,
) {
  const now = Date.now();
  return {
    source,
    address: facts.address,
    sqft: facts.sqft,
    beds: facts.beds,
    baths: facts.baths,
    asIsValue: facts.asIsValue,
    arv: facts.asIsValue, // pre-fill ARV with the as-is Zestimate as an anchor
    purchasePrice: undefined,
    rehabTier: "moderate" as const,
    rehabPerSqft: REHAB_TIERS.moderate.perSqft,
    rehabOverride: undefined,
    contingencyPct: FLIP_DEFAULTS.contingencyPct,
    assumptions: FLIP_DEFAULTS.assumptions,
    dealStatus: "new" as const,
    notes: undefined,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export const createFromSheriff = mutation({
  args: { listingId: v.id("sheriffListings") },
  handler: async (ctx, { listingId }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Sheriff listing not found");
    return ctx.db.insert(
      "flipAnalyses",
      seed(
        { kind: "sheriff", listingId: String(listingId) },
        {
          address: l.address,
          sqft: parseMoney(l.sqft) ?? undefined,
          beds: l.beds,
          baths: l.baths,
          asIsValue: parseMoney(l.zestimate) ?? undefined,
        },
        user,
      ),
    );
  },
});

export const createFromLegal = mutation({
  args: { listingId: v.id("legalNotices") },
  handler: async (ctx, { listingId }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Legal notice not found");
    return ctx.db.insert(
      "flipAnalyses",
      seed(
        { kind: "legal", listingId: String(listingId) },
        {
          address: l.address,
          sqft: parseMoney(l.sqft) ?? undefined,
          beds: l.beds,
          baths: l.baths,
          asIsValue: parseMoney(l.zestimate) ?? undefined,
        },
        user,
      ),
    );
  },
});

export const createManual = mutation({
  args: {
    address: v.string(),
    sqft: v.optional(v.number()),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    asIsValue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return ctx.db.insert("flipAnalyses", seed({ kind: "manual" }, args, user));
  },
});

export const updateAnalysis = mutation({
  args: {
    id: v.id("flipAnalyses"),
    patch: v.object({
      arv: v.optional(v.union(v.number(), v.null())),
      purchasePrice: v.optional(v.union(v.number(), v.null())),
      rehabTier: v.optional(
        v.union(v.literal("cosmetic"), v.literal("moderate"), v.literal("gut"), v.literal("custom")),
      ),
      rehabPerSqft: v.optional(v.number()),
      rehabOverride: v.optional(v.union(v.number(), v.null())),
      contingencyPct: v.optional(v.number()),
      assumptions: v.optional(assumptionsValidator),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireUser(ctx);
    const a = await ctx.db.get(id);
    if (!a) throw new Error("Analysis not found");
    await ctx.db.patch(id, {
      arv: "arv" in patch ? patch.arv ?? undefined : a.arv,
      purchasePrice: "purchasePrice" in patch ? patch.purchasePrice ?? undefined : a.purchasePrice,
      rehabTier: patch.rehabTier ?? a.rehabTier,
      rehabPerSqft: patch.rehabPerSqft ?? a.rehabPerSqft,
      rehabOverride: "rehabOverride" in patch ? patch.rehabOverride ?? undefined : a.rehabOverride,
      contingencyPct: patch.contingencyPct ?? a.contingencyPct,
      assumptions: patch.assumptions ?? a.assumptions,
      notes: patch.notes ?? a.notes,
      updatedAt: Date.now(),
    });
  },
});

export const setFlipDealStatus = mutation({
  args: { id: v.id("flipAnalyses"), dealStatus },
  handler: async (ctx, { id, dealStatus }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { dealStatus, updatedAt: Date.now() });
  },
});

export const deleteAnalysis = mutation({
  args: { id: v.id("flipAnalyses") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 2: Validate + regenerate the API types**

Run: `npx convex dev --once`
Expected: pushes/validates cleanly; `convex/_generated/api.d.ts` now includes `flipData`. (Ignore the cosmetic Windows `UV_HANDLE_CLOSING` assertion.)

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: `tsc` + Vite build succeed (no type errors). If `tsc` complains about an unused import, remove it.

- [ ] **Step 4: Commit**

```bash
git add convex/flipData.ts convex/_generated
git commit -m "feat(flip): flipData queries + mutations (read-only on sheriff/legal)"
```

---

## Task 5: The `/flip` page (`src/web/FlipAnalyzer.tsx`)

**Files:**
- Create: `src/web/FlipAnalyzer.tsx`

The page imports `computeFlip`/`estimateRehab` from the pure module to preview results live as the user edits, then persists with `updateAnalysis` on Save. Styling mirrors `pages.tsx` (native `<select>`/`<input>` + dark Tailwind classes).

- [ ] **Step 1: Write the page**

Create `src/web/FlipAnalyzer.tsx`:
```tsx
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Calculator, Plus, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "./dealStages";
import {
  estimateRehab,
  computeFlip,
  REHAB_TIERS,
  type RehabTier,
  type FlipAssumptions,
} from "../scraper/flip";

function fmtMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("en-US");
}
function fmtPct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : (n * 100).toFixed(1) + "%";
}
function num(s: string): number | null {
  if (s.trim() === "") return null;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const GRADE_COLOR: Record<string, string> = {
  good: "text-emerald-400",
  ok: "text-teal-glow",
  thin: "text-amber-400",
  bad: "text-red-400",
  unknown: "text-muted-foreground",
};
const GRADE_LABEL: Record<string, string> = {
  good: "Good", ok: "OK", thin: "Thin", bad: "Bad", unknown: "—",
};

const inputCls =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none";

const ASSUMPTION_FIELDS: { key: keyof FlipAssumptions; label: string; kind: "pct" | "int" | "money" }[] = [
  { key: "closingPct", label: "Purchase closing %", kind: "pct" },
  { key: "downPct", label: "Down payment %", kind: "pct" },
  { key: "loanPoints", label: "Loan points %", kind: "pct" },
  { key: "annualRate", label: "Hard-money rate %", kind: "pct" },
  { key: "holdingMonths", label: "Holding months", kind: "int" },
  { key: "monthlyHolding", label: "Monthly holding $", kind: "money" },
  { key: "sellAgentPct", label: "Agent commission %", kind: "pct" },
  { key: "sellTransferPct", label: "Transfer tax %", kind: "pct" },
  { key: "sellClosingPct", label: "Sale closing %", kind: "pct" },
];

type Analysis = NonNullable<ReturnType<typeof useFlipList>>[number];
function useFlipList() {
  return useQuery(api.flipData.listAnalyses);
}

export function FlipAnalyzer() {
  const analyses = useFlipList();
  const candidates = useQuery(api.flipData.candidates);
  const createFromSheriff = useMutation(api.flipData.createFromSheriff);
  const createFromLegal = useMutation(api.flipData.createFromLegal);
  const createManual = useMutation(api.flipData.createManual);
  const setStatus = useMutation(api.flipData.setFlipDealStatus);
  const del = useMutation(api.flipData.deleteAnalysis);

  const [selectedId, setSelectedId] = useState<Id<"flipAnalyses"> | null>(null);
  const [pick, setPick] = useState("");        // "sheriff:<id>" | "legal:<id>"
  const [manualAddr, setManualAddr] = useState("");

  const selected = analyses?.find((a) => a._id === selectedId) ?? null;

  const addFromListing = async () => {
    if (!pick) return;
    const [kind, id] = pick.split(":");
    const newId =
      kind === "sheriff"
        ? await createFromSheriff({ listingId: id as Id<"sheriffListings"> })
        : await createFromLegal({ listingId: id as Id<"legalNotices"> });
    setPick("");
    setSelectedId(newId as Id<"flipAnalyses">);
  };
  const addManual = async () => {
    if (!manualAddr.trim()) return;
    const newId = await createManual({ address: manualAddr.trim() });
    setManualAddr("");
    setSelectedId(newId as Id<"flipAnalyses">);
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Calculator className="h-5 w-5 text-teal-glow" /> Flip Analyzer
          </h1>
          <p className="text-sm text-muted-foreground">
            ARV − rehab − costs → max offer, profit, ROI. Pulls from Sheriff/Legal or a manual address.
          </p>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {/* New analysis */}
        <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From a scraped listing</label>
            <div className="flex gap-2">
              <select className={inputCls} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Select a property…</option>
                {candidates && (
                  <>
                    <optgroup label="Sheriff Sales">
                      {candidates.sheriff.map((c) => (
                        <option key={c.id} value={`sheriff:${c.id}`}>{c.address}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Legal Notices">
                      {candidates.legal.map((c) => (
                        <option key={c.id} value={`legal:${c.id}`}>{c.address}</option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>
              <button
                onClick={addFromListing}
                className="btn-metal-yellow flex items-center gap-1 rounded-md px-3 py-1 text-sm font-semibold"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Or a manual address</label>
            <div className="flex gap-2">
              <input
                className={inputCls}
                placeholder="123 Main St, Wilmington, DE"
                value={manualAddr}
                onChange={(e) => setManualAddr(e.target.value)}
              />
              <button
                onClick={addManual}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:border-teal"
              >
                <Plus className="h-4 w-4" /> Add manual
              </button>
            </div>
          </div>
        </div>

        {/* Saved analyses */}
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">ARV</th>
                <th className="px-3 py-2 text-right">Rehab</th>
                <th className="px-3 py-2 text-right">MAO</th>
                <th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2 text-right">ROI</th>
                <th className="px-3 py-2">Grade</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {analyses?.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                    No analyses yet. Add one above.
                  </td>
                </tr>
              )}
              {analyses?.map((a) => (
                <tr
                  key={a._id}
                  onClick={() => setSelectedId(a._id)}
                  className={
                    "cursor-pointer border-b border-border/50 hover:bg-muted " +
                    (a._id === selectedId ? "bg-muted" : "")
                  }
                >
                  <td className="px-3 py-2">{a.address}</td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{a.source.kind}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(a.arv)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(a.rehab.total)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(a.metrics.mao)}</td>
                  <td className={"px-3 py-2 text-right font-semibold " + GRADE_COLOR[a.metrics.grade]}>
                    {fmtMoney(a.metrics.profit)}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtPct(a.metrics.roi)}</td>
                  <td className={"px-3 py-2 font-semibold " + GRADE_COLOR[a.metrics.grade]}>
                    {GRADE_LABEL[a.metrics.grade]}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={a.dealStatus}
                      onChange={(e) => setStatus({ id: a._id, dealStatus: e.target.value as DealStage })}
                      className="rounded-md border border-border bg-card px-2 py-1 text-xs focus:border-primary focus:outline-none"
                    >
                      {DEAL_STAGES.map((s) => (
                        <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        if (a._id === selectedId) setSelectedId(null);
                        void del({ id: a._id });
                      }}
                      className="text-muted-foreground hover:text-red-400"
                      aria-label="Delete analysis"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Editor */}
        {selected && <AnalysisEditor key={selected._id} analysis={selected} />}
      </div>
    </div>
  );
}

function AnalysisEditor({ analysis }: { analysis: Analysis }) {
  const update = useMutation(api.flipData.updateAnalysis);
  const [arv, setArv] = useState(analysis.arv?.toString() ?? "");
  const [purchase, setPurchase] = useState(analysis.purchasePrice?.toString() ?? "");
  const [tier, setTier] = useState<RehabTier>(analysis.rehabTier);
  const [perSqft, setPerSqft] = useState(analysis.rehabPerSqft.toString());
  const [override, setOverride] = useState(analysis.rehabOverride?.toString() ?? "");
  const [cont, setCont] = useState((analysis.contingencyPct * 100).toString());
  const [assumptions, setAssumptions] = useState<FlipAssumptions>(analysis.assumptions);
  const [notes, setNotes] = useState(analysis.notes ?? "");
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [saved, setSaved] = useState(false);

  const onTier = (t: RehabTier) => {
    setTier(t);
    if (t !== "custom") setPerSqft(REHAB_TIERS[t].perSqft.toString());
  };
  const setAssumption = (key: keyof FlipAssumptions, kind: string, raw: string) => {
    const parsed = num(raw) ?? 0;
    setAssumptions((a) => ({ ...a, [key]: kind === "pct" ? parsed / 100 : parsed }));
  };

  const contFrac = (num(cont) ?? 0) / 100;
  const rehab = estimateRehab(num(perSqft) ?? 0, analysis.sqft ?? null, contFrac, num(override));
  const metrics = computeFlip({
    arv: num(arv),
    purchasePrice: num(purchase),
    rehabTotal: rehab.total,
    assumptions,
  });

  const save = async () => {
    await update({
      id: analysis._id,
      patch: {
        arv: num(arv),
        purchasePrice: num(purchase),
        rehabTier: tier,
        rehabPerSqft: num(perSqft) ?? 0,
        rehabOverride: num(override),
        contingencyPct: contFrac,
        assumptions,
        notes,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const Result = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={"text-lg font-semibold " + (cls ?? "text-foreground")}>{value}</span>
    </div>
  );

  return (
    <div className="grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-2">
      {/* Inputs */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">
          {analysis.address}
          {analysis.sqft ? <span className="ml-2 text-xs text-muted-foreground">{analysis.sqft} sqft</span> : null}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-muted-foreground">
            ARV ($)
            <input className={inputCls} value={arv} onChange={(e) => setArv(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Purchase price ($)
            <input className={inputCls} value={purchase} onChange={(e) => setPurchase(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Rehab tier
            <select className={inputCls} value={tier} onChange={(e) => onTier(e.target.value as RehabTier)}>
              {(["cosmetic", "moderate", "gut"] as const).map((t) => (
                <option key={t} value={t}>{REHAB_TIERS[t].label} ({REHAB_TIERS[t].range})</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            $/sqft
            <input className={inputCls} value={perSqft} onChange={(e) => { setPerSqft(e.target.value); setTier("custom"); }} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Rehab override ($)
            <input className={inputCls} placeholder="optional" value={override} onChange={(e) => setOverride(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">
            Contingency %
            <input className={inputCls} value={cont} onChange={(e) => setCont(e.target.value)} />
          </label>
        </div>

        <button
          onClick={() => setShowAssumptions((s) => !s)}
          className="text-xs text-teal-glow hover:underline"
        >
          {showAssumptions ? "Hide" : "Show"} cost assumptions
        </button>
        {showAssumptions && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 p-3">
            {ASSUMPTION_FIELDS.map((f) => (
              <label key={f.key} className="block text-xs text-muted-foreground">
                {f.label}
                <input
                  className={inputCls}
                  defaultValue={f.kind === "pct" ? (assumptions[f.key] * 100).toString() : assumptions[f.key].toString()}
                  onChange={(e) => setAssumption(f.key, f.kind, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}

        <label className="block text-xs text-muted-foreground">
          Notes
          <textarea className={inputCls + " h-16"} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <button onClick={save} className="btn-metal-yellow rounded-md px-4 py-1.5 text-sm font-semibold">
          {saved ? "Saved" : "Save analysis"}
        </button>
      </div>

      {/* Live results */}
      <div className="space-y-4 rounded-lg border border-teal/40 bg-background p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase text-muted-foreground">Live results</span>
          <span className={"rounded-md px-2 py-0.5 text-xs font-semibold " + GRADE_COLOR[metrics.grade]}>
            {GRADE_LABEL[metrics.grade]}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Result label="Max offer (70% rule)" value={fmtMoney(metrics.mao)} />
          <Result label="Rehab (incl. contingency)" value={fmtMoney(rehab.total)} />
          <Result label="Net profit" value={fmtMoney(metrics.profit)} cls={GRADE_COLOR[metrics.grade]} />
          <Result label="Profit margin" value={fmtPct(metrics.margin)} />
          <Result label="ROI (cash invested)" value={fmtPct(metrics.roi)} />
          <Result label="Annualized ROI" value={fmtPct(metrics.annualizedRoi)} />
          <Result label="Holding + financing" value={fmtMoney((metrics.holdingCost ?? 0) + (metrics.financingCost ?? 0))} />
          <Result label="Selling costs" value={fmtMoney(metrics.sellingCost)} />
        </div>
        {metrics.flags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {metrics.flags.map((f) => (
              <span key={f} className="rounded-md border border-amber-400/40 px-2 py-0.5 text-xs text-amber-400">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck/build**

Run: `npm run build`
Expected: succeeds. If `tsc` flags the `Analysis`/`useFlipList` circular type, replace the `Analysis` type alias with:
`type Analysis = NonNullable<typeof analyses>[number];` is not available at module scope — keep the `useFlipList` helper as written (it scopes the inference). If issues persist, type the editor prop as `analysis: Doc<"flipAnalyses"> & { rehab: { total: number | null }; metrics: ReturnType<typeof computeFlip> }` importing `Doc` from `../../convex/_generated/dataModel`.

- [ ] **Step 3: Commit**

```bash
git add src/web/FlipAnalyzer.tsx
git commit -m "feat(flip): Flip Analyzer page with live P&L preview"
```

---

## Task 6: Register the route + nav item

**Files:**
- Modify: `src/web/app.tsx`
- Modify: `src/components/app-shared.tsx`

- [ ] **Step 1: Add the route**

In `src/web/app.tsx`:
- Add the import after the `SheriffSales, LegalNotices` import line:
```ts
import { FlipAnalyzer } from "./FlipAnalyzer";
```
- Add the route after `legalRoute`:
```ts
const flipRoute = createRoute({ getParentRoute: () => rootRoute, path: "/flip", component: FlipAnalyzer });
```
- Add `flipRoute` to the `addChildren` array:
```ts
export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, flipRoute, adminRoute]);
```

- [ ] **Step 2: Add the nav item**

In `src/components/app-shared.tsx`:
- Add `Calculator` to the lucide import:
```ts
import { LayoutDashboard, Gavel, Scale, ShieldCheck, Calculator } from "lucide-react";
```
- Add the nav item after the Legal Notices entry (before Admin):
```ts
	{ title: "Flip Analyzer", path: "/flip", icon: Calculator },
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/web/app.tsx src/components/app-shared.tsx
git commit -m "feat(flip): register /flip route + nav item"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — the prior 44 tests + the new flip tests, all green.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `tsc` + Vite build succeed.

- [ ] **Step 3: Confirm the two existing features were not touched**

Run: `git diff --name-only main...feat/flip-analyzer`
Expected: the only changed pre-existing files are `convex/schema.ts`, `convex/_generated/*`, `src/web/app.tsx`, `src/components/app-shared.tsx`. Confirm **`convex/sheriffData.ts`, `convex/legalData.ts`, `convex/sheriffActions.ts`, `convex/legalActions.ts`, `src/web/pages.tsx`, and `src/scraper/deal.ts` are NOT in the list.**

- [ ] **Step 4: Manual smoke test (local dev)**

Run (two terminals): `npx convex dev` then `npm run dev`. In the browser (signed in):
1. Open `/flip` from the sidebar.
2. Add an analysis from a Sheriff listing → it appears with ARV pre-filled from the Zestimate.
3. Add one from a Legal listing, and one from a manual address.
4. Edit ARV / purchase / rehab tier / an assumption → MAO, profit, ROI, grade update live.
5. Save → reopen → values persist; change deal status; delete a row.
6. Open `/sheriff` and `/legal` → confirm they look and behave exactly as before.

- [ ] **Step 5: Visual check (optional, per the headless-screenshot lesson)**

Screenshot `/flip` to confirm dark-theme rendering, then revert any throwaway preview files.

- [ ] **Step 6: Final commit (if Step 5 produced anything) / wrap up**

The feature branch `feat/flip-analyzer` is complete. Use the finishing-a-development-branch skill to decide merge/PR.

---

## Self-Review

**Spec coverage:** flipAnalyses table (Task 3) ✓; flip math incl. MAO/profit/ROI/grade (Tasks 1-2) ✓; tiered rehab + override + contingency (Task 1) ✓; ARV pre-filled from Zestimate (Task 4 `seed`) ✓; create from sheriff/legal/manual (Task 4) ✓; live preview + persistence (Task 5) ✓; route + nav (Task 6) ✓; no changes to deal.ts/sheriff/legal pages (Task 7 Step 3 verifies) ✓; tests + build (Tasks 1-2, 7) ✓.

**Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output.

**Type consistency:** `estimateRehab(perSqft, sqft, contingencyPct, override?)` and `computeFlip({arv, purchasePrice, rehabTotal, assumptions})` signatures match across `flip.ts`, `flipData.ts` (`withMetrics`), and `FlipAnalyzer.tsx`. `FlipAssumptions` field names identical in `flip.ts`, the schema `assumptions` object, `assumptionsValidator`, and `ASSUMPTION_FIELDS`. `RehabTier` union identical in `flip.ts`, schema, and `updateAnalysis`. `dealStatus`/`DealStage` reused from the shared modules.

**Note on holding-cost taxes:** modeled as the editable `monthlyHolding` assumption, NOT derived from the parcel `*BalanceDue` arrears (which are delinquent balances, not annual tax) — as the spec requires.
