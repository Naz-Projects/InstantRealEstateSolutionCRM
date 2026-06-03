# Properties (Portfolio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a "Properties" section to manage owned houses (flip or rental) with a list page, a detail page, a unified expense/income ledger, flip-to-sale profit math, and a house photo pulled from Zillow via Firecrawl.

**Architecture:** Two new Convex tables (`properties`, `propertyLedger`) + a pure `portfolio.ts` summary module + a pure `extractImageUrl()` added to the existing Zillow scraper + an internal `"use node"` action that scrapes the photo. Two new TanStack routes (`/properties`, `/properties/$id`). Purely additive — no existing table, query, page, or pipeline is modified.

**Tech Stack:** Convex (reactive DB + actions + scheduler), TanStack Router, React 19, Tailwind v4 + shadcn (dark "Industrial Precision" theme), lucide-react icons (never emojis), Firecrawl REST, vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-properties-portfolio-design.md`

**Build/verify conventions (from `memory/lessons.md`):**
- After changing `convex/`, run `npx convex dev --once` FIRST (it validates `convex/` and regenerates `_generated`), THEN `npm run build`.
- The Windows `UV_HANDLE_CLOSING` assertion from the Convex CLI is cosmetic — trust the printed output, not the exit code.
- Convex `"use node"` files contain actions ONLY; V8 queries/mutations live in `*Data.ts`.
- Annotate Convex action handlers that call other functions with an explicit return type (`: Promise<...>`).
- Pure scraper modules import siblings with a `.js` extension; test files import without an extension.
- lucide-react icons only — never emojis (memory `never-use-emojis`).

---

### Task 1: De-risk — verify the Zillow photo is actually scrapable

**Why first:** the whole image feature rests on Firecrawl returning a usable property photo URL from the Zillow *search* page. Confirm what it actually returns before building the regex, action, and UI on top of it. (Homedetails URLs 403, so the search page is the only target.)

**Files:**
- Create (throwaway, NOT committed): `scripts/check-zillow-image.ts`

- [ ] **Step 1: Write the probe script**

```ts
// scripts/check-zillow-image.ts — throwaway probe; delete after Task 1.
import { config } from "dotenv";
import { buildZillowSearchUrl } from "../src/scraper/zillow.js";
import { firecrawlScrape } from "../src/scraper/firecrawl.js";

config({ path: ".env.local" });

const apiKey = (process.env.FIRECRAWL_API_KEY ?? "").trim();
const address = process.env.ADDR ?? "2316 W 17th St, Wilmington, DE 19806";

const url = buildZillowSearchUrl(address);
console.log("Scraping:", url);

const { markdown, rawHtml } = await firecrawlScrape({
  url, apiKey, formats: ["markdown", "rawHtml"],
  onlyMainContent: true, waitFor: 3000, timeoutMs: 60000, maxRetries: 1,
});

const photos = [...rawHtml.matchAll(/https?:\/\/photos\.zillowstatic\.com\/[^\s"')<>]+?\.(?:jpg|jpeg|png|webp)/gi)].map(m => m[0]);
const og = rawHtml.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

console.log("\nmarkdown length:", markdown.length, " rawHtml length:", rawHtml.length);
console.log("\nphotos.zillowstatic matches (first 5):");
console.log(photos.slice(0, 5).join("\n") || "  (none)");
console.log("\nog:image:", og ? og[1] : "(none)");
```

- [ ] **Step 2: Run it against a real address**

Run: `npx tsx scripts/check-zillow-image.ts`
Expected: prints non-zero rawHtml length and at least one `https://photos.zillowstatic.com/...jpg` URL (the property photo). If `photos.zillowstatic` is empty but `og:image` is a `photos.zillowstatic` URL, that's fine too — the Task 2 regex handles both. Note which source won so Task 2's fixtures mirror reality. If BOTH are empty/blocked, retry once with a different known DE address (`ADDR="..." npx tsx scripts/check-zillow-image.ts`); if still empty, the feature still ships — the photo just degrades to the placeholder + paste-URL control, so proceed and note it.

- [ ] **Step 3: Delete the throwaway probe**

```bash
rm scripts/check-zillow-image.ts
```
No commit — this task produces knowledge, not code.

---

### Task 2: `extractImageUrl()` pure helper (TDD)

**Files:**
- Modify: `src/scraper/zillow.ts` (append a new exported function; do not touch existing functions)
- Test: `tests/zillow.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing test** (append to `tests/zillow.test.ts`)

```ts
import { extractImageUrl } from "../src/scraper/zillow";

describe("extractImageUrl", () => {
  it("prefers a photos.zillowstatic.com listing photo over the og:image", () => {
    const text =
      'noise ![](https://photos.zillowstatic.com/fp/abc123-cc_ft_768.jpg) more ' +
      '<meta property="og:image" content="https://maps.googleapis.com/maps/api/staticmap?center=x"/>';
    expect(extractImageUrl(text)).toBe("https://photos.zillowstatic.com/fp/abc123-cc_ft_768.jpg");
  });
  it("falls back to og:image when no zillowstatic photo is present", () => {
    const text = '<meta property="og:image" content="https://www.zillow.com/static/logo.svg"/>';
    expect(extractImageUrl(text)).toBe("https://www.zillow.com/static/logo.svg");
  });
  it("returns null when there is no image", () => {
    expect(extractImageUrl("just some text, no images")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/zillow.test.ts -t extractImageUrl`
Expected: FAIL — `extractImageUrl is not a function` / import error.

- [ ] **Step 3: Implement** (append to the END of `src/scraper/zillow.ts`)

```ts
/**
 * Pull a property photo URL out of Zillow page content (markdown or rawHtml).
 * Prefers an actual listing photo on the Zillow CDN; falls back to the og:image
 * meta tag (which on a search page may be a generic map/logo). Pure + testable.
 */
export function extractImageUrl(text: string): string | null {
  const photo = text.match(
    /https?:\/\/photos\.zillowstatic\.com\/[^\s"')<>]+?\.(?:jpg|jpeg|png|webp)/i,
  );
  if (photo) return photo[0];
  const og = text.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og) return og[1];
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/zillow.test.ts`
Expected: PASS (all zillow tests, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/zillow.ts tests/zillow.test.ts
git commit -m "feat(properties): add extractImageUrl() Zillow photo extractor (pure, tested)"
```

---

### Task 3: `portfolio.ts` financial summary (TDD)

**Files:**
- Create: `src/scraper/portfolio.ts`
- Test: `tests/portfolio.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/portfolio.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { summarizeProperty, type LedgerLike } from "../src/scraper/portfolio";

const exp = (amount: number): LedgerLike => ({ direction: "expense", amount });
const inc = (amount: number): LedgerLike => ({ direction: "income", amount });

describe("summarizeProperty — flip", () => {
  it("in-progress: invested = purchase + expenses; profit/roi null; grade pending", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "in_progress", purchasePrice: 200000 },
      [exp(50000), exp(20000)],
    );
    expect(s.totalExpenses).toBe(70000);
    expect(s.invested).toBe(270000);
    expect(s.realizedProfit).toBeNull();
    expect(s.roi).toBeNull();
    expect(s.netCashFlow).toBeNull();
    expect(s.grade).toBe("pending");
  });
  it("sold: realized profit, roi, and grade ok at ~18.5% return", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "sold", purchasePrice: 200000, salePrice: 320000 },
      [exp(70000)],
    );
    expect(s.invested).toBe(270000);
    expect(s.realizedProfit).toBe(50000);
    expect(s.roi).toBeCloseTo(0.1852, 3);
    expect(s.grade).toBe("ok");
  });
  it("sold at a loss: grade bad", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "sold", purchasePrice: 300000, salePrice: 350000 },
      [exp(80000)],
    );
    expect(s.realizedProfit).toBe(-30000);
    expect(s.grade).toBe("bad");
  });
  it("no purchase price + no expenses but a sale: roi null (no divide-by-zero), profit positive, grade good", () => {
    const s = summarizeProperty(
      { dealType: "flip", status: "sold", salePrice: 50000 },
      [],
    );
    expect(s.invested).toBe(0);
    expect(s.realizedProfit).toBe(50000);
    expect(s.roi).toBeNull();
    expect(s.grade).toBe("good");
  });
});

describe("summarizeProperty — rental", () => {
  it("computes net cash flow; grade good when positive", () => {
    const s = summarizeProperty(
      { dealType: "rental", status: "active" },
      [inc(1500), inc(1500), inc(1500), exp(400), exp(600)],
    );
    expect(s.totalIncome).toBe(4500);
    expect(s.totalExpenses).toBe(1000);
    expect(s.netCashFlow).toBe(3500);
    expect(s.realizedProfit).toBeNull();
    expect(s.grade).toBe("good");
  });
  it("no income yet: grade pending", () => {
    const s = summarizeProperty({ dealType: "rental", status: "vacant" }, [exp(500)]);
    expect(s.totalIncome).toBe(0);
    expect(s.netCashFlow).toBe(-500);
    expect(s.grade).toBe("pending");
  });
  it("negative cash flow with income: grade bad", () => {
    const s = summarizeProperty({ dealType: "rental", status: "active" }, [inc(800), exp(1000)]);
    expect(s.netCashFlow).toBe(-200);
    expect(s.grade).toBe("bad");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/portfolio.test.ts`
Expected: FAIL — cannot find module `../src/scraper/portfolio`.

- [ ] **Step 3: Implement** (`src/scraper/portfolio.ts`)

```ts
// Portfolio actuals math for owned properties. Pure + testable (like deal.ts/flip.ts);
// safe to run inside a Convex V8 query. Computes money-in / money-out summaries from a
// unified ledger and turns a sold flip into realized profit + ROI.

export type Direction = "expense" | "income";
export type Grade = "good" | "ok" | "thin" | "bad" | "pending";

export interface LedgerLike {
  direction: Direction;
  amount: number;
}

export interface PropertyFinancials {
  dealType: "flip" | "rental";
  status: "in_progress" | "sold" | "active" | "vacant";
  purchasePrice?: number | null;
  salePrice?: number | null;
}

export interface PortfolioSummary {
  totalExpenses: number;
  totalIncome: number;
  invested: number; // (purchasePrice ?? 0) + totalExpenses — running money-in
  realizedProfit: number | null; // sold flips only
  roi: number | null; // realizedProfit / invested, when invested > 0
  netCashFlow: number | null; // rentals only
  grade: Grade;
}

export function summarizeProperty(
  p: PropertyFinancials,
  ledger: LedgerLike[],
): PortfolioSummary {
  let totalExpenses = 0;
  let totalIncome = 0;
  for (const e of ledger) {
    if (e.direction === "expense") totalExpenses += e.amount;
    else totalIncome += e.amount;
  }
  const purchase = p.purchasePrice ?? 0;
  const invested = purchase + totalExpenses;

  if (p.dealType === "flip") {
    if (p.status === "sold" && p.salePrice != null) {
      const realizedProfit = p.salePrice + totalIncome - purchase - totalExpenses;
      const roi = invested > 0 ? realizedProfit / invested : null;
      let grade: Grade;
      if (realizedProfit <= 0) grade = "bad";
      else if (roi != null && roi < 0.1) grade = "thin";
      else if (roi != null && roi < 0.2) grade = "ok";
      else grade = "good";
      return { totalExpenses, totalIncome, invested, realizedProfit, roi, netCashFlow: null, grade };
    }
    return {
      totalExpenses, totalIncome, invested,
      realizedProfit: null, roi: null, netCashFlow: null, grade: "pending",
    };
  }

  // rental
  const netCashFlow = totalIncome - totalExpenses;
  let grade: Grade;
  if (totalIncome === 0) grade = "pending";
  else if (netCashFlow < 0) grade = "bad";
  else grade = "good";
  return { totalExpenses, totalIncome, invested, realizedProfit: null, roi: null, netCashFlow, grade };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/portfolio.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/portfolio.ts tests/portfolio.test.ts
git commit -m "feat(properties): add portfolio.ts summary math (flip profit/ROI, rental cash flow)"
```

---

### Task 4: Schema — add `properties` + `propertyLedger` tables

**Files:**
- Modify: `convex/schema.ts` (add two tables inside `defineSchema({...})`; leave all existing tables untouched)

- [ ] **Step 1: Add the two tables**

Insert these two table definitions inside the `defineSchema({ ... })` object in `convex/schema.ts`, immediately after the `flipAnalyses` table (before the closing `});`):

```ts
  // Owned properties (acquired/"won") — flip or rental. Actuals, distinct from
  // flipAnalyses (pre-purchase projection). Photo scraped from Zillow.
  properties: defineTable({
    dealType: v.union(v.literal("flip"), v.literal("rental")),
    status: v.union(
      v.literal("in_progress"), // flip
      v.literal("sold"),        // flip
      v.literal("active"),      // rental
      v.literal("vacant"),      // rental
    ),
    source: v.object({
      kind: v.union(
        v.literal("manual"),
        v.literal("sheriff"),
        v.literal("legal"),
        v.literal("flip"),
      ),
      refId: v.optional(v.string()), // source row _id (string) — reference only
    }),
    address: v.string(),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    sqft: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    acquiredDate: v.optional(v.number()),
    salePrice: v.optional(v.number()), // flip, set when sold
    soldDate: v.optional(v.number()),
    zillowUrl: v.optional(v.string()), // reference link + (search built from address is the scrape target)
    imageUrl: v.optional(v.string()),
    imageStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ok"), v.literal("failed")),
    ),
    notes: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dealType", ["dealType"])
    .index("by_status", ["status"]),

  // Unified per-property ledger: expenses AND income, date-stamped. One shape for
  // flip costs and rental income; sums are computed by direction in portfolio.ts.
  propertyLedger: defineTable({
    propertyId: v.id("properties"),
    direction: v.union(v.literal("expense"), v.literal("income")),
    category: v.string(),
    amount: v.number(), // positive; direction gives the sign
    date: v.number(), // entry date (ms epoch)
    description: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_property", ["propertyId"]),
```

- [ ] **Step 2: Validate the schema + regenerate types**

Run: `npx convex dev --once`
Expected: pushes successfully and regenerates `convex/_generated` (the new tables appear in `dataModel.d.ts`). Ignore any trailing `UV_HANDLE_CLOSING` assertion (cosmetic). If it reports a schema/type error, fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(properties): add properties + propertyLedger tables to schema"
```

---

### Task 5: `convex/propertyData.ts` — queries + mutations

**Files:**
- Create: `convex/propertyData.ts`

- [ ] **Step 1: Write the full data module**

```ts
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUser } from "./helpers";
import { parseMoney } from "../src/scraper/deal";
import { summarizeProperty } from "../src/scraper/portfolio";

const dealTypeV = v.union(v.literal("flip"), v.literal("rental"));
const statusV = v.union(
  v.literal("in_progress"),
  v.literal("sold"),
  v.literal("active"),
  v.literal("vacant"),
);
const directionV = v.union(v.literal("expense"), v.literal("income"));

type LedgerRow = Doc<"propertyLedger">;

function summaryFor(p: Doc<"properties">, ledger: LedgerRow[]) {
  return summarizeProperty(
    {
      dealType: p.dealType,
      status: p.status,
      purchasePrice: p.purchasePrice ?? null,
      salePrice: p.salePrice ?? null,
    },
    ledger.map((e) => ({ direction: e.direction, amount: e.amount })),
  );
}

export const listProperties = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("properties").order("desc").collect();
    return Promise.all(
      rows.map(async (p) => {
        const ledger = await ctx.db
          .query("propertyLedger")
          .withIndex("by_property", (q) => q.eq("propertyId", p._id))
          .collect();
        return { ...p, summary: summaryFor(p, ledger) };
      }),
    );
  },
});

export const getProperty = query({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const p = await ctx.db.get(id);
    if (!p) return null;
    const ledger = await ctx.db
      .query("propertyLedger")
      .withIndex("by_property", (q) => q.eq("propertyId", id))
      .collect();
    ledger.sort((a, b) => b.date - a.date);
    return { ...p, ledger, summary: summaryFor(p, ledger) };
  },
});

// Recent sheriff + legal + flip rows for the "seed from existing" picker. Read-only.
export const candidates = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const sheriff = await ctx.db.query("sheriffListings").order("desc").take(200);
    const legal = await ctx.db.query("legalNotices").order("desc").take(200);
    const flip = await ctx.db.query("flipAnalyses").order("desc").take(200);
    const pick = (r: { _id: unknown; address: string }) => ({ id: String(r._id), address: r.address });
    return { sheriff: sheriff.map(pick), legal: legal.map(pick), flip: flip.map(pick) };
  },
});

type Facts = {
  address: string;
  beds?: string;
  baths?: string;
  sqft?: number;
  purchasePrice?: number;
  zillowUrl?: string;
};

function seed(
  dealType: "flip" | "rental",
  source: Doc<"properties">["source"],
  facts: Facts,
  createdBy: string,
): Omit<Doc<"properties">, "_id" | "_creationTime"> {
  const now = Date.now();
  return {
    dealType,
    status: dealType === "flip" ? "in_progress" : "active",
    source,
    address: facts.address,
    beds: facts.beds,
    baths: facts.baths,
    sqft: facts.sqft,
    purchasePrice: facts.purchasePrice,
    acquiredDate: undefined,
    salePrice: undefined,
    soldDate: undefined,
    zillowUrl: facts.zillowUrl,
    imageUrl: undefined,
    imageStatus: facts.address ? "pending" : undefined,
    notes: undefined,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export const createManual = mutation({
  args: {
    dealType: dealTypeV,
    address: v.string(),
    beds: v.optional(v.string()),
    baths: v.optional(v.string()),
    sqft: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    zillowUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const id = await ctx.db.insert(
      "properties",
      seed(args.dealType, { kind: "manual" }, args, user),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const createFromSheriff = mutation({
  args: { listingId: v.id("sheriffListings"), dealType: dealTypeV },
  handler: async (ctx, { listingId, dealType }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Sheriff listing not found");
    const id = await ctx.db.insert(
      "properties",
      seed(
        dealType,
        { kind: "sheriff", refId: String(listingId) },
        {
          address: l.address,
          beds: l.beds || undefined,
          baths: l.baths || undefined,
          sqft: parseMoney(l.sqft) ?? undefined,
          zillowUrl: l.zillowUrl || undefined,
        },
        user,
      ),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const createFromLegal = mutation({
  args: { listingId: v.id("legalNotices"), dealType: dealTypeV },
  handler: async (ctx, { listingId, dealType }) => {
    const user = await requireUser(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) throw new Error("Legal notice not found");
    const id = await ctx.db.insert(
      "properties",
      seed(
        dealType,
        { kind: "legal", refId: String(listingId) },
        {
          address: l.address,
          beds: l.beds || undefined,
          baths: l.baths || undefined,
          sqft: parseMoney(l.sqft) ?? undefined,
          zillowUrl: l.zillowUrl || undefined,
        },
        user,
      ),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const createFromFlip = mutation({
  args: { analysisId: v.id("flipAnalyses"), dealType: dealTypeV },
  handler: async (ctx, { analysisId, dealType }) => {
    const user = await requireUser(ctx);
    const a = await ctx.db.get(analysisId);
    if (!a) throw new Error("Flip analysis not found");
    const id = await ctx.db.insert(
      "properties",
      seed(
        dealType,
        { kind: "flip", refId: String(analysisId) },
        {
          address: a.address,
          beds: a.beds,
          baths: a.baths,
          sqft: a.sqft,
          purchasePrice: a.purchasePrice,
        },
        user,
      ),
    );
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
    return id;
  },
});

export const updateProperty = mutation({
  args: {
    id: v.id("properties"),
    patch: v.object({
      dealType: v.optional(dealTypeV),
      status: v.optional(statusV),
      address: v.optional(v.string()),
      beds: v.optional(v.union(v.string(), v.null())),
      baths: v.optional(v.union(v.string(), v.null())),
      sqft: v.optional(v.union(v.number(), v.null())),
      purchasePrice: v.optional(v.union(v.number(), v.null())),
      acquiredDate: v.optional(v.union(v.number(), v.null())),
      zillowUrl: v.optional(v.union(v.string(), v.null())),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireUser(ctx);
    const p = await ctx.db.get(id);
    if (!p) throw new Error("Property not found");
    await ctx.db.patch(id, {
      dealType: patch.dealType ?? p.dealType,
      status: patch.status ?? p.status,
      address: patch.address ?? p.address,
      beds: "beds" in patch ? patch.beds ?? undefined : p.beds,
      baths: "baths" in patch ? patch.baths ?? undefined : p.baths,
      sqft: "sqft" in patch ? patch.sqft ?? undefined : p.sqft,
      purchasePrice: "purchasePrice" in patch ? patch.purchasePrice ?? undefined : p.purchasePrice,
      acquiredDate: "acquiredDate" in patch ? patch.acquiredDate ?? undefined : p.acquiredDate,
      zillowUrl: "zillowUrl" in patch ? patch.zillowUrl ?? undefined : p.zillowUrl,
      notes: patch.notes ?? p.notes,
      updatedAt: Date.now(),
    });
  },
});

export const markSold = mutation({
  args: { id: v.id("properties"), salePrice: v.number(), soldDate: v.number() },
  handler: async (ctx, { id, salePrice, soldDate }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { status: "sold", salePrice, soldDate, updatedAt: Date.now() });
  },
});

export const setPhotoUrl = mutation({
  args: { id: v.id("properties"), imageUrl: v.string() },
  handler: async (ctx, { id, imageUrl }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { imageUrl, imageStatus: "ok", updatedAt: Date.now() });
  },
});

export const refreshPropertyImage = mutation({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { imageStatus: "pending" });
    await ctx.scheduler.runAfter(0, internal.propertyActions.scrapePropertyImage, { id });
  },
});

export const addLedgerEntry = mutation({
  args: {
    propertyId: v.id("properties"),
    direction: directionV,
    category: v.string(),
    amount: v.number(),
    date: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return ctx.db.insert("propertyLedger", { ...args, createdBy: user, createdAt: Date.now() });
  },
});

export const deleteLedgerEntry = mutation({
  args: { id: v.id("propertyLedger") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.delete(id);
  },
});

export const deleteProperty = mutation({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const entries = await ctx.db
      .query("propertyLedger")
      .withIndex("by_property", (q) => q.eq("propertyId", id))
      .collect();
    for (const e of entries) await ctx.db.delete(e._id);
    await ctx.db.delete(id);
  },
});

// --- internal helpers for the image-scrape action ---

export const getForImage = internalQuery({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p) return null;
    return { address: p.address, zillowUrl: p.zillowUrl };
  },
});

export const setImage = internalMutation({
  args: {
    id: v.id("properties"),
    imageUrl: v.optional(v.string()),
    status: v.union(v.literal("ok"), v.literal("failed")),
  },
  handler: async (ctx, { id, imageUrl, status }) => {
    const patch: { imageStatus: "ok" | "failed"; updatedAt: number; imageUrl?: string } = {
      imageStatus: status,
      updatedAt: Date.now(),
    };
    if (imageUrl) patch.imageUrl = imageUrl;
    await ctx.db.patch(id, patch);
  },
});
```

- [ ] **Step 2: Validate + regenerate** (the file references `internal.propertyActions.scrapePropertyImage`, which does not exist yet — so expect a codegen reference error until Task 6; do NOT push yet)

Skip pushing here. Proceed to Task 6, then validate both together. (Convex codegen needs the action to exist before `internal.propertyActions` resolves.)

---

### Task 6: `convex/propertyActions.ts` — Zillow photo scrape

**Files:**
- Create: `convex/propertyActions.ts`

- [ ] **Step 1: Write the action** (`convex/propertyActions.ts`)

```ts
"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { firecrawlScrape, withRetry } from "../src/scraper/firecrawl.js";
import { buildZillowSearchUrl, extractImageUrl } from "../src/scraper/zillow.js";

function fcKey(): string {
  const k = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (!k) throw new Error("FIRECRAWL_API_KEY is not set (npx convex env set FIRECRAWL_API_KEY ...)");
  return k;
}

// Scrape a property's Zillow photo. ALWAYS scrapes the SEARCH URL built from the
// address — the stored zillowUrl is a homedetails URL, which 403s on a direct
// scrape (project lesson). Patches imageUrl/imageStatus; failure -> "failed".
export const scrapePropertyImage = internalAction({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }): Promise<void> => {
    const p = await ctx.runQuery(internal.propertyData.getForImage, { id });
    if (!p || !p.address) {
      await ctx.runMutation(internal.propertyData.setImage, { id, status: "failed" });
      return;
    }
    const url = buildZillowSearchUrl(p.address);
    try {
      const { markdown, rawHtml } = await withRetry(
        () =>
          firecrawlScrape({
            url,
            apiKey: fcKey(),
            formats: ["markdown", "rawHtml"],
            onlyMainContent: true,
            waitFor: 3000,
            timeoutMs: 60000,
            maxRetries: 1,
          }),
        { attempts: 2, baseDelayMs: 2000, label: `Zillow image ${p.address}` },
      );
      const imageUrl = extractImageUrl(rawHtml) ?? extractImageUrl(markdown);
      await ctx.runMutation(
        internal.propertyData.setImage,
        imageUrl ? { id, imageUrl, status: "ok" } : { id, status: "failed" },
      );
    } catch {
      await ctx.runMutation(internal.propertyData.setImage, { id, status: "failed" });
    }
  },
});
```

- [ ] **Step 2: Validate the whole Convex layer + regenerate types**

Run: `npx convex dev --once`
Expected: pushes successfully; `convex/_generated/api.d.ts` now includes `propertyData` and `propertyActions`. Ignore the cosmetic `UV_HANDLE_CLOSING` line. Fix any type errors (e.g. TS7023 — add the `: Promise<void>` return annotation, already present) before continuing.

- [ ] **Step 3: Commit**

```bash
git add convex/propertyData.ts convex/propertyActions.ts convex/_generated
git commit -m "feat(properties): Convex data layer + Zillow photo scrape action"
```

---

### Task 7: Nav + routes + `/properties` list page

**Files:**
- Modify: `src/components/app-shared.tsx` (add one nav item)
- Modify: `src/web/app.tsx` (add two routes)
- Create: `src/web/Properties.tsx`

- [ ] **Step 1: Add the nav item** (`src/components/app-shared.tsx`)

Change the icon import line to add `Building2`:
```ts
import { LayoutDashboard, Gavel, Scale, ShieldCheck, Calculator, Building2 } from "lucide-react";
```
Add this entry to the `navItems` array, after the Flip Analyzer item:
```ts
	{ title: "Properties", path: "/properties", icon: Building2 },
```

- [ ] **Step 2: Register the two routes** (`src/web/app.tsx`)

Add the import near the other page imports:
```ts
import { Properties } from "./Properties";
import { PropertyDetail } from "./PropertyDetail";
```
Add the route definitions after `flipRoute`:
```ts
const propertiesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/properties", component: Properties });
const propertyDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/properties/$id", component: PropertyDetail });
```
Add both to the route tree:
```ts
export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, flipRoute, propertiesRoute, propertyDetailRoute, adminRoute]);
```
(`PropertyDetail` is created in Task 8; this import will fail the build until then — that's expected. Build is run at the end of Task 8.)

- [ ] **Step 3: Write the list page** (`src/web/Properties.tsx`)

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Home, Plus, ChevronsUpDown } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

function fmtMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("en-US");
}

export const GRADE_COLOR: Record<string, string> = {
  good: "text-emerald-400",
  ok: "text-teal-glow",
  thin: "text-amber-400",
  bad: "text-red-400",
  pending: "text-muted-foreground",
};
export const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  sold: "Sold",
  active: "Active",
  vacant: "Vacant",
};

const inputCls =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none";

type DealType = "flip" | "rental";
type Candidate = { id: string; address: string };

function CandidateCombobox({
  candidates,
  value,
  onChange,
}: {
  candidates: { sheriff: Candidate[]; legal: Candidate[]; flip: Candidate[] } | undefined;
  value: string; // "sheriff:<id>" | "legal:<id>" | "flip:<id>"
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = (() => {
    if (!value || !candidates) return "";
    const [kind, id] = value.split(":");
    const list =
      kind === "sheriff" ? candidates.sheriff : kind === "legal" ? candidates.legal : candidates.flip;
    return list.find((c) => c.id === id)?.address ?? "";
  })();

  const group = (heading: string, kind: string, list: Candidate[] | undefined) =>
    list && list.length > 0 ? (
      <CommandGroup heading={heading}>
        {list.map((c) => (
          <CommandItem
            key={c.id}
            value={`${kind} ${c.address}`}
            onSelect={() => {
              onChange(`${kind}:${c.id}`);
              setOpen(false);
            }}
          >
            {c.address}
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex w-80 items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1 text-left text-sm focus:border-primary focus:outline-none",
            !label && "text-muted-foreground",
          )}
        >
          <span className="truncate">{label || "Select a record…"}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search address…" />
          <CommandList>
            <CommandEmpty>No record found.</CommandEmpty>
            {group("Sheriff Sales", "sheriff", candidates?.sheriff)}
            {group("Legal Notices", "legal", candidates?.legal)}
            {group("Flip Analyses", "flip", candidates?.flip)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type PropertyRow = FunctionReturnType<typeof api.propertyData.listProperties>[number];

function PropertyCard({ p, onClick }: { p: PropertyRow; onClick: () => void }) {
  const headline =
    p.dealType === "flip"
      ? p.status === "sold"
        ? { label: "Profit", value: fmtMoney(p.summary.realizedProfit), cls: GRADE_COLOR[p.summary.grade] }
        : { label: "Invested", value: fmtMoney(p.summary.invested), cls: "" }
      : { label: "Net cash flow", value: fmtMoney(p.summary.netCashFlow), cls: GRADE_COLOR[p.summary.grade] };

  return (
    <button
      onClick={onClick}
      className="overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-teal"
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
        {p.imageUrl ? (
          <img src={p.imageUrl} alt={p.address} className="h-full w-full object-cover" />
        ) : (
          <Home className="h-10 w-10 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-teal/40 px-2 py-0.5 text-xs capitalize text-teal-glow">
            {p.dealType}
          </span>
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {STATUS_LABEL[p.status]}
          </span>
        </div>
        <div className="font-semibold text-foreground">{p.address}</div>
        <div className="text-sm text-muted-foreground">
          {p.beds || "?"} bd · {p.baths || "?"} ba · {p.sqft ? p.sqft.toLocaleString() + " sqft" : "— sqft"}
        </div>
        <div className="flex justify-between border-t border-border/50 pt-2 text-sm">
          <span className="text-muted-foreground">{headline.label}</span>
          <span className={"font-semibold " + headline.cls}>{headline.value}</span>
        </div>
      </div>
    </button>
  );
}

export function Properties() {
  const properties = useQuery(api.propertyData.listProperties);
  const candidates = useQuery(api.propertyData.candidates);
  const createManual = useMutation(api.propertyData.createManual);
  const createFromSheriff = useMutation(api.propertyData.createFromSheriff);
  const createFromLegal = useMutation(api.propertyData.createFromLegal);
  const createFromFlip = useMutation(api.propertyData.createFromFlip);
  const navigate = useNavigate();

  const [filter, setFilter] = useState<"all" | "flip" | "rental">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [dealType, setDealType] = useState<DealType>("flip");
  const [manualAddr, setManualAddr] = useState("");
  const [pick, setPick] = useState("");

  const all = properties ?? [];
  const counts = {
    all: all.length,
    flip: all.filter((p) => p.dealType === "flip").length,
    rental: all.filter((p) => p.dealType === "rental").length,
  };
  const shown = all.filter((p) => filter === "all" || p.dealType === filter);

  const goTo = (id: Id<"properties">) => navigate({ to: "/properties/$id", params: { id } });

  const addManual = async () => {
    if (!manualAddr.trim()) return;
    const id = await createManual({ dealType, address: manualAddr.trim() });
    setManualAddr("");
    setShowAdd(false);
    goTo(id as Id<"properties">);
  };
  const addFromExisting = async () => {
    if (!pick) return;
    const [kind, rid] = pick.split(":");
    let id: unknown;
    if (kind === "sheriff") id = await createFromSheriff({ listingId: rid as Id<"sheriffListings">, dealType });
    else if (kind === "legal") id = await createFromLegal({ listingId: rid as Id<"legalNotices">, dealType });
    else id = await createFromFlip({ analysisId: rid as Id<"flipAnalyses">, dealType });
    setPick("");
    setShowAdd(false);
    goTo(id as Id<"properties">);
  };

  const TABS: { key: "all" | "flip" | "rental"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "flip", label: "Flips" },
    { key: "rental", label: "Rentals" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Building2 className="h-5 w-5 text-teal-glow" /> Properties
          </h1>
          <p className="text-sm text-muted-foreground">
            Houses we own — flips and rentals. Track expenses, income, and sale outcomes.
          </p>
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="btn-metal-yellow flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" /> Add property
        </button>
      </div>

      <div className="space-y-6 p-6">
        {showAdd && (
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-card p-4">
            <label className="block text-xs text-muted-foreground">
              Type
              <select
                className={inputCls}
                value={dealType}
                onChange={(e) => setDealType(e.target.value as DealType)}
              >
                <option value="flip">Flip</option>
                <option value="rental">Rental</option>
              </select>
            </label>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">From an existing record</label>
              <div className="flex gap-2">
                <CandidateCombobox candidates={candidates} value={pick} onChange={setPick} />
                <button
                  onClick={addFromExisting}
                  className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:border-teal"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Or a manual address</label>
              <div className="flex gap-2">
                <input
                  className={inputCls + " w-72"}
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
        )}

        <div className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "rounded-md border px-3 py-1 text-sm",
                filter === t.key
                  ? "border-teal text-teal-glow"
                  : "border-border text-muted-foreground hover:border-teal/50",
              )}
            >
              {t.label} <span className="opacity-60">{counts[t.key]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-3 py-16 text-center text-muted-foreground">
            No properties yet. Click "Add property" to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <PropertyCard key={p._id} p={p} onClick={() => goTo(p._id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

(No build yet — `PropertyDetail` is written in Task 8; build runs there.)

---

### Task 8: `/properties/$id` detail page

**Files:**
- Create: `src/web/PropertyDetail.tsx`

- [ ] **Step 1: Write the detail page** (`src/web/PropertyDetail.tsx`)

```tsx
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Home, RefreshCw, Trash2, Plus, ExternalLink } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GRADE_COLOR, STATUS_LABEL } from "./Properties";

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
function toDateInput(ms: number | null | undefined): string {
  if (ms == null) return "";
  return new Date(ms).toISOString().slice(0, 10);
}
function fromDateInput(s: string): number | null {
  if (!s) return null;
  const t = new Date(s + "T00:00:00").getTime();
  return Number.isFinite(t) ? t : null;
}

const inputCls =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none";

const STATUS_OPTIONS: Record<"flip" | "rental", { value: string; label: string }[]> = {
  flip: [
    { value: "in_progress", label: "In progress" },
    { value: "sold", label: "Sold" },
  ],
  rental: [
    { value: "active", label: "Active" },
    { value: "vacant", label: "Vacant" },
  ],
};
const EXPENSE_CATS = [
  "Purchase", "Rehab/Materials", "Labor", "Permits", "Taxes", "Insurance", "Utilities", "Financing", "Closing", "Other",
];
const INCOME_CATS = ["Rent", "Deposit", "Late fee", "Other"];

export function PropertyDetail() {
  const params = useParams({ strict: false }) as { id: string };
  const pid = params.id as Id<"properties">;
  const data = useQuery(api.propertyData.getProperty, { id: pid });

  if (data === undefined) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (data === null) {
    return (
      <div className="p-6">
        <Link to="/properties" className="text-sm text-teal-glow hover:underline">
          ← Back to properties
        </Link>
        <p className="mt-4 text-muted-foreground">Property not found.</p>
      </div>
    );
  }

  // Keyed by _id so all the useState fields reset when navigating between properties.
  return <PropertyDetailInner key={data._id} data={data} pid={pid} />;
}

type DetailData = NonNullable<FunctionReturnType<typeof api.propertyData.getProperty>>;

function PropertyDetailInner({ data, pid }: { data: DetailData; pid: Id<"properties"> }) {
  // useMutation hooks are called unconditionally at the top of the component (rules of
  // hooks satisfied — same order every render); grouped into `m` for readability.
  const m = {
    update: useMutation(api.propertyData.updateProperty),
    markSold: useMutation(api.propertyData.markSold),
    setPhotoUrl: useMutation(api.propertyData.setPhotoUrl),
    refreshImage: useMutation(api.propertyData.refreshPropertyImage),
    addEntry: useMutation(api.propertyData.addLedgerEntry),
    delEntry: useMutation(api.propertyData.deleteLedgerEntry),
    delProperty: useMutation(api.propertyData.deleteProperty),
  };
  const p = data;
  const s = data.summary;

  // facts form
  const [status, setStatus] = useState(p.status);
  const [beds, setBeds] = useState(p.beds ?? "");
  const [baths, setBaths] = useState(p.baths ?? "");
  const [sqft, setSqft] = useState(p.sqft?.toString() ?? "");
  const [purchase, setPurchase] = useState(p.purchasePrice?.toString() ?? "");
  const [acquired, setAcquired] = useState(toDateInput(p.acquiredDate));
  const [zillow, setZillow] = useState(p.zillowUrl ?? "");
  const [notes, setNotes] = useState(p.notes ?? "");
  const [savedFacts, setSavedFacts] = useState(false);

  // sale form
  const [salePrice, setSalePrice] = useState(p.salePrice?.toString() ?? "");
  const [soldDate, setSoldDate] = useState(toDateInput(p.soldDate) || toDateInput(Date.now()));

  // photo paste
  const [photoUrl, setPhotoUrl] = useState("");

  // ledger add form
  const [dir, setDir] = useState<"expense" | "income">("expense");
  const cats = dir === "expense" ? EXPENSE_CATS : INCOME_CATS;
  const [cat, setCat] = useState(EXPENSE_CATS[0]);
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(toDateInput(Date.now()));
  const [desc, setDesc] = useState("");

  const saveFacts = async () => {
    await m.update({
      id: pid,
      patch: {
        status,
        beds: beds.trim() || null,
        baths: baths.trim() || null,
        sqft: num(sqft),
        purchasePrice: num(purchase),
        acquiredDate: fromDateInput(acquired),
        zillowUrl: zillow.trim() || null,
        notes,
      },
    });
    setSavedFacts(true);
    setTimeout(() => setSavedFacts(false), 1500);
  };

  const doMarkSold = async () => {
    const sp = num(salePrice);
    const sd = fromDateInput(soldDate);
    if (sp == null || sd == null) return;
    await m.markSold({ id: pid, salePrice: sp, soldDate: sd });
    setStatus("sold");
  };

  const onChangeDir = (d: "expense" | "income") => {
    setDir(d);
    setCat((d === "expense" ? EXPENSE_CATS : INCOME_CATS)[0]);
  };
  const addLedger = async () => {
    const amt = num(amount);
    const dt = fromDateInput(entryDate);
    if (amt == null || dt == null) return;
    await m.addEntry({ propertyId: pid, direction: dir, category: cat, amount: amt, date: dt, description: desc.trim() || undefined });
    setAmount("");
    setDesc("");
  };

  const SummaryCard = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"text-lg font-semibold " + (cls ?? "text-foreground")}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <Link to="/properties" className="inline-flex items-center gap-1 text-sm text-teal-glow hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to properties
      </Link>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Photo + facts */}
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.address} className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <Home className="h-10 w-10" />
                  <span className="text-xs">
                    {p.imageStatus === "pending" ? "Fetching photo…" : "No photo"}
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-2 p-3">
              <button
                onClick={() => void m.refreshImage({ id: pid })}
                className="flex items-center gap-1 text-xs text-teal-glow hover:underline"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh photo from Zillow
              </button>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="Paste a photo URL"
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                />
                <button
                  onClick={async () => {
                    if (!photoUrl.trim()) return;
                    await m.setPhotoUrl({ id: pid, imageUrl: photoUrl.trim() });
                    setPhotoUrl("");
                  }}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:border-teal"
                >
                  Set
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">{p.address}</h2>
            <span className="rounded-md border border-teal/40 px-2 py-0.5 text-xs capitalize text-teal-glow">
              {p.dealType}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">
                Status
                <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  {STATUS_OPTIONS[p.dealType].map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                Purchase price ($)
                <input className={inputCls} value={purchase} onChange={(e) => setPurchase(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Beds
                <input className={inputCls} value={beds} onChange={(e) => setBeds(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Baths
                <input className={inputCls} value={baths} onChange={(e) => setBaths(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Sqft
                <input className={inputCls} value={sqft} onChange={(e) => setSqft(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Acquired
                <input type="date" className={inputCls} value={acquired} onChange={(e) => setAcquired(e.target.value)} />
              </label>
            </div>
            <label className="block text-xs text-muted-foreground">
              Zillow URL (reference)
              <input className={inputCls} value={zillow} onChange={(e) => setZillow(e.target.value)} />
            </label>
            {p.zillowUrl && (
              <a
                href={p.zillowUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-teal-glow hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open on Zillow
              </a>
            )}
            <label className="block text-xs text-muted-foreground">
              Notes
              <textarea className={inputCls + " h-16"} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="flex items-center justify-between">
              <button onClick={saveFacts} className="btn-metal-yellow rounded-md px-4 py-1.5 text-sm font-semibold">
                {savedFacts ? "Saved" : "Save"}
              </button>
              <button
                onClick={() => {
                  if (confirm("Delete this property and all its ledger entries?")) void m.delProperty({ id: pid });
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </div>
        </div>

        {/* Summary + sale + ledger */}
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {p.dealType === "flip" ? (
              <>
                <SummaryCard label="Invested" value={fmtMoney(s.invested)} />
                <SummaryCard label="Expenses" value={fmtMoney(s.totalExpenses)} />
                <SummaryCard label="Sale price" value={fmtMoney(p.salePrice)} />
                <SummaryCard label="Realized profit" value={fmtMoney(s.realizedProfit)} cls={GRADE_COLOR[s.grade]} />
                <SummaryCard label="ROI" value={fmtPct(s.roi)} cls={GRADE_COLOR[s.grade]} />
              </>
            ) : (
              <>
                <SummaryCard label="Total income" value={fmtMoney(s.totalIncome)} />
                <SummaryCard label="Total expenses" value={fmtMoney(s.totalExpenses)} />
                <SummaryCard label="Net cash flow" value={fmtMoney(s.netCashFlow)} cls={GRADE_COLOR[s.grade]} />
              </>
            )}
          </div>

          {p.dealType === "flip" && p.status !== "sold" && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
              <span className="text-sm text-muted-foreground">Mark sold:</span>
              <label className="block text-xs text-muted-foreground">
                Sale price ($)
                <input className={inputCls} value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Sold date
                <input type="date" className={inputCls} value={soldDate} onChange={(e) => setSoldDate(e.target.value)} />
              </label>
              <button onClick={doMarkSold} className="btn-metal-yellow rounded-md px-4 py-1.5 text-sm font-semibold">
                Mark sold
              </button>
            </div>
          )}

          {/* Ledger */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
              <div className="flex overflow-hidden rounded-md border border-border">
                {(["expense", "income"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => onChangeDir(d)}
                    className={
                      "px-3 py-1 text-sm capitalize " +
                      (dir === d ? "bg-muted text-foreground" : "text-muted-foreground")
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
              <label className="block text-xs text-muted-foreground">
                Category
                <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}>
                  {cats.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted-foreground">
                Amount ($)
                <input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="block text-xs text-muted-foreground">
                Date
                <input type="date" className={inputCls} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </label>
              <label className="block flex-1 text-xs text-muted-foreground">
                Description
                <input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} />
              </label>
              <button onClick={addLedger} className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-sm hover:border-teal">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {p.ledger.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No entries yet. Add an expense or income above.
                    </td>
                  </tr>
                )}
                {p.ledger.map((e) => (
                  <tr key={e._id} className="border-b border-border/50">
                    <td className="px-3 py-2 text-muted-foreground">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-3 py-2 capitalize">{e.direction}</td>
                    <td className="px-3 py-2">{e.category}</td>
                    <td className={"px-3 py-2 text-right font-medium " + (e.direction === "income" ? "text-emerald-400" : "text-red-400")}>
                      {e.direction === "income" ? "+" : "−"}
                      {fmtMoney(e.amount)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{e.description ?? ""}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => void m.delEntry({ id: e._id })}
                        className="text-muted-foreground hover:text-red-400"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Note: `m.setPhotoUrl` (the mutation, a property of `m`) and the local state setter `setPhotoUrl` (from
`useState`) are distinct bindings — no name collision. The local photo-paste state is `[photoUrl, setPhotoUrl]`.

- [ ] **Step 2: Validate Convex + typecheck + build**

Run: `npx convex dev --once` then `npm run build`
Expected: `convex dev --once` pushes clean; `npm run build` (`tsc --noEmit && vite build`) succeeds with no type errors. Fix any type errors before continuing.

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: all existing tests + the new `portfolio` and `extractImageUrl` tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shared.tsx src/web/app.tsx src/web/Properties.tsx src/web/PropertyDetail.tsx
git commit -m "feat(properties): Properties list + detail pages, nav item, routes"
```

---

### Task 9: Manual smoke test + memory update

**Files:**
- Modify: `memory/todo.md`, `memory/memory.md` (record the shipped feature)

- [ ] **Step 1: Run dev and smoke-test the feature**

Run (two terminals): `npx convex dev` and `npm run dev` → open http://localhost:5173, sign in.
Verify:
1. "Properties" appears in the sidebar; `/properties` loads with an empty state.
2. Add property → manual rental (an address) → lands on the detail page; within ~30s the photo appears (or a placeholder if Zillow had no match — then paste a photo URL and confirm it renders).
3. Add an income entry and an expense entry → the ledger updates and the rental summary (income/expenses/net cash flow) recomputes live.
4. Add property → from a Sheriff listing as a flip → facts (address/beds/baths/sqft) carry over.
5. On the flip: add a couple of expenses, then Mark sold (sale price + date) → Realized profit + ROI appear, grade-colored.
6. Delete a property → it disappears and its ledger rows are gone.
7. Sheriff Sales, Legal Notices, and Flip Analyzer pages still render and behave unchanged.

- [ ] **Step 2: Update `memory/todo.md`** — add under a new "Shipped" entry:

```markdown
## ✅ Shipped — Properties / Portfolio (2026-06-03)
- [x] **Properties section** — `/properties` list (grid, filter Flips/Rentals, add manual or seed from
  Sheriff/Legal/Flip) + `/properties/$id` detail (Zillow photo, facts, status, financial summary, unified
  expense/income ledger, flip Mark-sold → realized profit/ROI). New `properties` + `propertyLedger` tables,
  pure `portfolio.ts` (tested), `extractImageUrl()` Zillow photo scrape via `propertyActions`. Additive — no
  changes to Sheriff/Legal/Flip pipelines. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-03-properties-portfolio*`.
```

- [ ] **Step 3: Update `memory/memory.md`** — add a short "Properties (Portfolio)" section under the code map describing the new tables, files, and the always-search-URL image-scrape rule.

- [ ] **Step 4: Commit**

```bash
git add memory/todo.md memory/memory.md
git commit -m "docs(properties): record Properties/Portfolio feature in memory"
```

---

## Notes on deployment (not part of this plan unless asked)
This plan builds + verifies on **dev** (`fearless-donkey-585`). Shipping to prod is a separate step the user
triggers: `git push origin main` (Cloudflare Workers build deploys backend+frontend, needs a valid prod
`CONVEX_DEPLOY_KEY` in Cloudflare) — see `memory/lessons.md` 2026-06-03. Do not push to prod without the user.
