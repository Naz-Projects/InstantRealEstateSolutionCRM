# P7 Vision Condition Scoring (isolated test page) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated `/condition` page that scores the top ~15 leads' exterior condition from a Street View photo via a cheap vision LLM, for the user to evaluate accuracy before any `/leads` integration.

**Architecture:** Mirror the P4 equity-gate shape. A pure offline-tested module (`conditionScore.ts`) builds the Street View URLs + the vision prompt and parses the model's JSON. A funnel-only `parcelCondition` table + V8 data layer + one auth-gated `"use node"` action (`scoreCondition`) do: spine address → free Street View coverage check → fetch image → Convex `_storage` → OpenRouter vision call → store. A standalone React page reads the existing `signalData.leads` (read-only) + the condition rows and exposes a per-lead "Score condition" button. **Strictly additive** — zero edits to Sheriff/Legal/Flip/Properties/Leads/Equity/Offers/Contracts.

**Tech Stack:** Convex (V8 + `"use node"` actions), TanStack Router + React + Tailwind + shadcn, vitest, OpenRouter (`google/gemini-2.5-flash`), Google Street View Static + metadata.

**Spec:** `docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md`.

## Global Constraints

- **All implementation via Opus 4.8 subagents** (`model: "opus"`); main loop orchestrates/reviews only.
- **Strictly additive.** Do NOT edit `signalData.ts`, `leadScore.ts`, `SCORE_CONFIG`, `LeadsPage.tsx`, or any existing pipeline file. New files + an append to `convex/schema.ts` + 2 small inserts in `app.tsx`/`app-shared.tsx` only. Verify with `git diff` before each commit.
- **Funnel-only, per-lead only.** No batch, no cron, never the 203k spine.
- **lucide-react icons only — never emojis.**
- Every external `fetch` in an action sets `signal: AbortSignal.timeout(30_000)`.
- Convex: `"use node"` files contain ONLY actions; V8 queries/mutations in `*Data.ts`. Annotate every action handler's return type (`: Promise<...>`) to avoid TS7023.
- After changing `convex/`: regenerate types in isolation with the anonymous local backend (does NOT touch shared dev): PowerShell `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once` — THEN `npm run build`. (The Windows `UV_HANDLE_CLOSING` assertion at the end is cosmetic; trust the output.)
- Branch: `feat/p7-vision-condition` (already created; the spec is committed there).
- **Every commit message ends with the trailer** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (append via a second `-m`). Stage explicit paths — never `git add -A`.
- Model id strings are exact: `google/gemini-2.5-flash` (default), alts `z-ai/glm-4.6v`, `qwen/qwen3-vl-32b-instruct`.

---

### Task 1: Pure module `conditionScore.ts` (prompt + URLs + tolerant parser)

**Files:**
- Create: `src/scraper/conditionScore.ts`
- Test: `tests/conditionScore.test.ts`

**Interfaces:**
- Consumes: nothing (pure; reads `process.env.CONDITION_LLM_MODEL` at module load).
- Produces (Task 3 relies on these exact names/types):
  - `CONDITION_MODEL: string`
  - `CONDITION_FLAGS: readonly string[]`
  - `CONDITION_SYSTEM_PROMPT: string`
  - `buildConditionPrompt(): string`
  - `buildStreetViewImageUrl(address: string, key: string): string`
  - `buildStreetViewMetadataUrl(address: string, key: string): string`
  - `parseConditionResponse(raw: string): { score: number; flags: string[]; reason: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/conditionScore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseConditionResponse,
  buildConditionPrompt,
  CONDITION_SYSTEM_PROMPT,
  buildStreetViewImageUrl,
  buildStreetViewMetadataUrl,
  CONDITION_MODEL,
  CONDITION_FLAGS,
} from "../src/scraper/conditionScore";

describe("parseConditionResponse", () => {
  it("parses clean JSON", () => {
    const r = parseConditionResponse(
      '{"score": 72, "flags": ["overgrown_vegetation","junk_debris"], "reason": "tall grass and debris"}',
    );
    expect(r.score).toBe(72);
    expect(r.flags).toEqual(["overgrown_vegetation", "junk_debris"]);
    expect(r.reason).toBe("tall grass and debris");
  });
  it("strips ```json fences", () => {
    const r = parseConditionResponse('```json\n{"score": 10, "flags": [], "reason": "tidy"}\n```');
    expect(r.score).toBe(10);
    expect(r.flags).toEqual([]);
  });
  it("recovers JSON from surrounding prose", () => {
    const r = parseConditionResponse(
      'Assessment: {"score": 55, "flags": ["distressed_exterior"], "reason": "worn siding"} done',
    );
    expect(r.score).toBe(55);
    expect(r.flags).toEqual(["distressed_exterior"]);
  });
  it("clamps out-of-range scores", () => {
    expect(parseConditionResponse('{"score": 150, "flags": [], "reason": ""}').score).toBe(100);
    expect(parseConditionResponse('{"score": -5, "flags": [], "reason": ""}').score).toBe(0);
  });
  it("rounds non-integer scores", () => {
    expect(parseConditionResponse('{"score": 63.7, "flags": [], "reason": ""}').score).toBe(64);
  });
  it("drops unknown flags and dedupes", () => {
    const r = parseConditionResponse(
      '{"score": 40, "flags": ["junk_debris","made_up","junk_debris"], "reason": "x"}',
    );
    expect(r.flags).toEqual(["junk_debris"]);
  });
  it("defaults missing reason to empty string", () => {
    expect(parseConditionResponse('{"score": 5, "flags": []}').reason).toBe("");
  });
  it("treats a non-numeric score as 0", () => {
    expect(parseConditionResponse('{"score": "n/a", "flags": [], "reason": "x"}').score).toBe(0);
  });
  it("throws when there is no JSON object", () => {
    expect(() => parseConditionResponse("the model refused")).toThrow();
  });
});

describe("prompts", () => {
  it("includes rubric anchors and the JSON contract", () => {
    const p = buildConditionPrompt();
    expect(p).toContain("0-20");
    expect(p).toContain("76-100");
    expect(p).toContain('"score"');
    expect(p).toContain('"flags"');
  });
  it("lists every known flag", () => {
    const p = buildConditionPrompt();
    for (const f of CONDITION_FLAGS) expect(p).toContain(f);
  });
  it("has a non-trivial system prompt", () => {
    expect(CONDITION_SYSTEM_PROMPT.length).toBeGreaterThan(20);
  });
});

describe("street view urls", () => {
  it("builds an image url with encoded address + key + outdoor source", () => {
    const u = buildStreetViewImageUrl("123 Main St, Newark, DE 19711", "KEY123");
    expect(u).toContain("https://maps.googleapis.com/maps/api/streetview?");
    expect(u).toContain("location=123+Main+St%2C+Newark%2C+DE+19711");
    expect(u).toContain("source=outdoor");
    expect(u).toContain("key=KEY123");
  });
  it("builds a metadata (coverage) url", () => {
    const u = buildStreetViewMetadataUrl("123 Main St", "KEY123");
    expect(u).toContain("/maps/api/streetview/metadata?");
    expect(u).toContain("key=KEY123");
  });
});

describe("model config", () => {
  it("defaults to gemini 2.5 flash when CONDITION_LLM_MODEL is unset", () => {
    expect(CONDITION_MODEL).toBe("google/gemini-2.5-flash");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/conditionScore.test.ts`
Expected: FAIL — `Cannot find module '../src/scraper/conditionScore'`.

- [ ] **Step 3: Implement `src/scraper/conditionScore.ts`**

```ts
// P7 vision condition scoring — pure, offline-testable core for the /condition
// test page. Builds the Street View URLs + the vision-LLM prompt and parses the
// model's JSON reply into a clamped score. No network, no Convex. Mirrors
// legalNotices.ts (OpenRouter, prompt-instructed JSON, fence-stripping parse).
// Spec: docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md.

export const CONDITION_MODEL =
  process.env.CONDITION_LLM_MODEL || "google/gemini-2.5-flash";

// A/B alternatives the user can flip via CONDITION_LLM_MODEL on the test page.
export const CONDITION_MODEL_ALTERNATIVES = [
  "google/gemini-2.5-flash",
  "z-ai/glm-4.6v",
  "qwen/qwen3-vl-32b-instruct",
] as const;

// Closed flag vocabulary — the model may only return flags from this set.
export const CONDITION_FLAGS = [
  "overgrown_vegetation",
  "junk_debris",
  "boarded_or_broken_windows",
  "roof_damage_or_tarp",
  "distressed_exterior",
  "vacant_appearance",
] as const;
export type ConditionFlag = (typeof CONDITION_FLAGS)[number];

export interface ConditionScore {
  score: number; // 0–100, clamped (higher = more distressed)
  flags: string[]; // subset of CONDITION_FLAGS
  reason: string;
}

export const CONDITION_SYSTEM_PROMPT =
  "You are a property-condition assessor for a real-estate wholesaling team. You judge " +
  "the visible EXTERIOR condition/distress of a house from a single street-level photo, " +
  "objectively and conservatively. You report only what is clearly visible.";

export function buildConditionPrompt(): string {
  return `Assess the EXTERIOR physical condition / distress of the house in this Street View photo.

Return ONLY a JSON object (no markdown fences, no extra text) with exactly these fields:
- "score": an integer 0-100 distress score using this rubric:
    0-20  = well-kept (tidy yard, sound roof/siding/windows, no distress)
    21-50 = minor wear (some peeling paint / worn but maintained)
    51-75 = visible distress (overgrown yard, debris, damaged siding/roof, disrepair)
    76-100 = severe distress / likely vacant (boarded windows, tarped/collapsing roof, heavy junk, derelict)
- "flags": an array containing ONLY clearly-visible items, from this exact set:
    "overgrown_vegetation", "junk_debris", "boarded_or_broken_windows",
    "roof_damage_or_tarp", "distressed_exterior", "vacant_appearance"
  Use [] if none clearly apply.
- "reason": one short sentence (<= 200 chars) citing what you see.

Rules:
- Judge ONLY what is clearly visible. Do NOT invent damage.
- If the photo is unclear, obstructed, shadowed, or not a house, score conservatively (low) and say so in "reason".
- Shadows, wet pavement, parked cars, and seasonal bare trees are NOT distress.`;
}

const KNOWN_FLAGS = new Set<string>(CONDITION_FLAGS);

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Tolerant parse of the model's reply. Strips ```json fences, grabs the first
 *  {...} block, JSON.parses, clamps the score, keeps only known flags. Throws only
 *  when no JSON object can be recovered (the caller catches → lastError). */
export function parseConditionResponse(raw: string): ConditionScore {
  const cleaned = (raw ?? "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object in condition response: ${cleaned.slice(0, 200)}`);
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Failed to parse condition JSON: ${(e as Error).message}`);
  }
  const flags = Array.isArray(obj.flags)
    ? obj.flags.map(String).filter((f) => KNOWN_FLAGS.has(f))
    : [];
  const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 300) : "";
  return { score: clampScore(obj.score), flags: [...new Set(flags)], reason };
}

/** Google Street View Static image URL for a situs address. */
export function buildStreetViewImageUrl(address: string, key: string): string {
  const params = new URLSearchParams({
    location: address,
    size: "640x640",
    fov: "80",
    source: "outdoor",
    return_error_code: "true",
    key,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

/** Free Street View metadata URL (coverage check; quota-exempt). */
export function buildStreetViewMetadataUrl(address: string, key: string): string {
  const params = new URLSearchParams({ location: address, source: "outdoor", key });
  return `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/conditionScore.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Run the full suite + commit**

Run: `npm test` — Expected: all existing tests still pass, +~14 new.
```bash
git add src/scraper/conditionScore.ts tests/conditionScore.test.ts
git commit -m "feat(p7): pure conditionScore module (prompt, street-view urls, tolerant parser) + tests" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Schema `parcelCondition` + data layer `conditionData.ts`

**Files:**
- Modify: `convex/schema.ts` (append a table near `parcelEquity`)
- Create: `convex/conditionData.ts`

**Interfaces:**
- Consumes: the existing `parcels` table (`by_prclid` index; fields `prclid`, `situsStreet`, `propCity`, `propState`, `propZip`, `ownerName`) and `requireUser` from `./helpers`.
- Produces (Task 3 + Task 4 rely on these):
  - `internal.conditionData.getParcelInternal({ prclid }) → parcels doc | null`
  - `internal.conditionData.storeCondition({ prclid, score?, flags?, reason?, model?, imageStorageId?, hasImagery?, rawResponse?, scoredAt?, lastError? }) → void`
  - `api.conditionData.conditionForPrclids({ prclids: string[] }) → Array<{ prclid, score, flags, reason, model, hasImagery, scoredAt, lastError, imageUrl }>`

- [ ] **Step 1: Append the `parcelCondition` table to `convex/schema.ts`**

Add immediately after the `parcelEquity` table definition (keep all existing tables unchanged):

```ts
  // P7 vision condition scoring — funnel-only, separate from the spine (the CDC never
  // touches it), mirrors parcelEquity. Written ONLY by conditionActions.scoreCondition.
  // ISOLATED: not read by /leads or scoring. Spec: 2026-06-21-vision-condition-scoring-design.md.
  parcelCondition: defineTable({
    prclid: v.string(),
    score: v.optional(v.number()), // 0–100 distress (higher = worse)
    flags: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
    model: v.optional(v.string()), // which model scored it
    imageStorageId: v.optional(v.id("_storage")), // the exact Street View image scored
    hasImagery: v.optional(v.boolean()), // false ⇒ no Street View coverage (not an error)
    rawResponse: v.optional(v.string()), // capped raw model output (debug/eval)
    scoredAt: v.optional(v.number()),
    lastError: v.optional(v.string()), // last failure, visible — never silent
    updatedAt: v.number(),
  }).index("by_prclid", ["prclid"]),
```

- [ ] **Step 2: Create `convex/conditionData.ts`**

```ts
import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "./_generated/server";
import { requireUser } from "./helpers";

// P7 vision condition scoring — V8 data layer for the /condition test page.
// Funnel-only; ISOLATED from /leads scoring.
// Spec: docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md.

// The spine parcel for one prclid — the action re-reads the address here rather
// than trusting a client-passed one (same discipline as equityData.getParcelInternal).
export const getParcelInternal = internalQuery({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }) => {
    return await ctx.db
      .query("parcels")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
  },
});

// Upsert the condition result (written only by the action). Passing lastError:null
// CLEARS a stale error on success (patch removes the field via undefined).
export const storeCondition = internalMutation({
  args: {
    prclid: v.string(),
    score: v.optional(v.number()),
    flags: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
    model: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    hasImagery: v.optional(v.boolean()),
    rawResponse: v.optional(v.string()),
    scoredAt: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { prclid, lastError, ...rest } = args;
    const now = Date.now();
    const patch = { ...rest, lastError: lastError ?? undefined, updatedAt: now };
    const existing = await ctx.db
      .query("parcelCondition")
      .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("parcelCondition", { prclid, ...patch });
    }
  },
});

// Condition rows for a set of prclids, each with a resolved image URL for display.
export const conditionForPrclids = query({
  args: { prclids: v.array(v.string()) },
  handler: async (ctx, { prclids }) => {
    await requireUser(ctx);
    const out: Array<{
      prclid: string;
      score: number | null;
      flags: string[];
      reason: string;
      model: string | null;
      hasImagery: boolean | null;
      scoredAt: number | null;
      lastError: string | null;
      imageUrl: string | null;
    }> = [];
    for (const prclid of prclids) {
      const row = await ctx.db
        .query("parcelCondition")
        .withIndex("by_prclid", (q) => q.eq("prclid", prclid))
        .first();
      if (!row) continue;
      const imageUrl = row.imageStorageId ? await ctx.storage.getUrl(row.imageStorageId) : null;
      out.push({
        prclid: row.prclid,
        score: row.score ?? null,
        flags: row.flags ?? [],
        reason: row.reason ?? "",
        model: row.model ?? null,
        hasImagery: row.hasImagery ?? null,
        scoredAt: row.scoredAt ?? null,
        lastError: row.lastError ?? null,
        imageUrl,
      });
    }
    return out;
  },
});
```

- [ ] **Step 3: Regenerate types + typecheck**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Expected: pushes to the local anonymous backend, validates the schema (incl. `parcelCondition`), regenerates `convex/_generated`. (Trailing `UV_HANDLE_CLOSING` assertion is cosmetic.)

Then run: `npm run build`
Expected: tsc + vite build clean (the new `conditionData` symbols resolve in `_generated`).

- [ ] **Step 4: Verify additivity + commit**

Run: `git diff --stat` — Expected: only `convex/schema.ts` (+~14 lines), `convex/conditionData.ts` (new), and regenerated `convex/_generated/*`. No other source files touched.
```bash
git add convex/schema.ts convex/conditionData.ts convex/_generated
git commit -m "feat(p7): parcelCondition table + conditionData layer (funnel-only, isolated)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Action `conditionActions.ts` (`scoreCondition`)

**Files:**
- Create: `convex/conditionActions.ts`

**Interfaces:**
- Consumes: `conditionScore.ts` (Task 1), `internal.conditionData.{getParcelInternal,storeCondition}` (Task 2), `internal.users.getCallerInternal` (existing), env `GOOGLE_GEOCODING_API_KEY` + `OPENROUTER_API_KEY`.
- Produces: `api.conditionActions.scoreCondition({ prclid: string }) → { status: "ok"; score; flags } | { status: "no_imagery" } | { status: "error"; error }` (Task 4 calls this).

- [ ] **Step 1: Create `convex/conditionActions.ts`**

```ts
"use node";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  CONDITION_MODEL,
  CONDITION_SYSTEM_PROMPT,
  buildConditionPrompt,
  buildStreetViewImageUrl,
  buildStreetViewMetadataUrl,
  parseConditionResponse,
} from "../src/scraper/conditionScore";

// P7 vision condition scoring — funnel-only action for the /condition test page.
// Per-lead only (NO batch, NO cron). ISOLATED from /leads scoring.
// Flow: spine address → Street View coverage (free) → image → _storage → vision LLM → store.
// Spec: docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type ScoreResult =
  | { status: "ok"; score: number; flags: string[] }
  | { status: "no_imagery" }
  | { status: "error"; error: string };

async function doScore(ctx: ActionCtx, prclid: string): Promise<ScoreResult> {
  const mapsKey = (process.env.GOOGLE_GEOCODING_API_KEY ?? "").trim();
  const orKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!mapsKey) throw new Error("GOOGLE_GEOCODING_API_KEY is not set");
  if (!orKey) throw new Error("OPENROUTER_API_KEY is not set");

  const parcel = await ctx.runQuery(internal.conditionData.getParcelInternal, { prclid });
  if (!parcel) throw new Error(`No spine parcel for prclid ${prclid}`);
  const address = `${parcel.situsStreet}, ${parcel.propCity} ${parcel.propState} ${parcel.propZip}`;

  // 1) Free coverage check (metadata endpoint is quota-exempt).
  try {
    const metaRes = await fetch(buildStreetViewMetadataUrl(address, mapsKey), {
      signal: AbortSignal.timeout(30_000),
    });
    const meta = (await metaRes.json()) as { status?: string };
    if (meta.status !== "OK") {
      await ctx.runMutation(internal.conditionData.storeCondition, {
        prclid,
        hasImagery: false,
        model: CONDITION_MODEL,
        scoredAt: Date.now(),
        lastError: null,
      });
      return { status: "no_imagery" };
    }
  } catch (e) {
    const msg = `Street View metadata: ${(e as Error).message}`;
    await ctx.runMutation(internal.conditionData.storeCondition, { prclid, lastError: msg });
    return { status: "error", error: msg };
  }

  // 2) Fetch the image, store it in _storage, keep base64 for the model.
  let imageStorageId: Id<"_storage"> | undefined;
  let b64 = "";
  try {
    const imgRes = await fetch(buildStreetViewImageUrl(address, mapsKey), {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imgRes.ok) throw new Error(`Street View HTTP ${imgRes.status}`);
    const bytes = await imgRes.arrayBuffer();
    imageStorageId = await ctx.storage.store(new Blob([bytes], { type: "image/jpeg" }));
    b64 = Buffer.from(bytes).toString("base64");
  } catch (e) {
    const msg = `Street View image: ${(e as Error).message}`;
    await ctx.runMutation(internal.conditionData.storeCondition, {
      prclid,
      hasImagery: true,
      lastError: msg,
    });
    return { status: "error", error: msg };
  }

  // 3) Vision LLM via OpenRouter (mirrors legalNotices; user message carries the image).
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: CONDITION_MODEL,
        messages: [
          { role: "system", content: CONDITION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: buildConditionPrompt() },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 600,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseConditionResponse(raw);
    await ctx.runMutation(internal.conditionData.storeCondition, {
      prclid,
      score: parsed.score,
      flags: parsed.flags,
      reason: parsed.reason,
      model: CONDITION_MODEL,
      imageStorageId,
      hasImagery: true,
      rawResponse: raw.slice(0, 2000),
      scoredAt: Date.now(),
      lastError: null,
    });
    return { status: "ok", score: parsed.score, flags: parsed.flags };
  } catch (e) {
    const msg = `Vision LLM: ${(e as Error).message}`;
    await ctx.runMutation(internal.conditionData.storeCondition, {
      prclid,
      imageStorageId,
      hasImagery: true,
      lastError: msg,
    });
    return { status: "error", error: msg };
  }
}

// Per-lead button: score one parcel now (auth-gated). NO batch.
export const scoreCondition = action({
  args: { prclid: v.string() },
  handler: async (ctx, { prclid }): Promise<ScoreResult> => {
    const me = await ctx.runQuery(internal.users.getCallerInternal, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Not authenticated" });
    return await doScore(ctx, prclid);
  },
});
```

- [ ] **Step 2: Regenerate types + typecheck**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Expected: validates the `"use node"` action (only an action in the file), regenerates `_generated`. No errors.

Then: `npm run build`
Expected: clean. (If TS7023 appears, confirm the `scoreCondition` handler has the `: Promise<ScoreResult>` annotation.)

- [ ] **Step 3: Verify additivity + commit**

Run: `git diff --stat` — Expected: only `convex/conditionActions.ts` (new) + regenerated `convex/_generated/*`.
```bash
git add convex/conditionActions.ts convex/_generated
git commit -m "feat(p7): scoreCondition action — street view + OpenRouter vision, funnel-only" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Live smoke (deferred to integration, needs real keys + shared dev):** `npx convex run conditionActions:scoreCondition '{"prclid":"<a real lead prclid>"}'` → expect `{status:"ok", score, flags}`; `npx convex data parcelCondition` shows the row with `imageStorageId`. Try a rural address with no coverage → `{status:"no_imagery"}`, `hasImagery:false`. Not a CI gate.

---

### Task 4: Page `ConditionTest.tsx` + route + nav

**Files:**
- Create: `src/web/ConditionTest.tsx`
- Modify: `src/web/app.tsx` (import + one `createRoute` + add to `routeTree.addChildren`)
- Modify: `src/components/app-shared.tsx` (one `navItems` entry + icon import)

**Interfaces:**
- Consumes: `api.signalData.leads` (read-only, existing), `api.conditionData.conditionForPrclids` (Task 2), `api.conditionActions.scoreCondition` (Task 3), `describeError` from `./lib/errorReporting`.
- Produces: the `/condition` route + a "Condition" nav item.

- [ ] **Step 1: Create `src/web/ConditionTest.tsx`**

```tsx
import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { ScanEye, Loader2, AlertTriangle, MapPinOff } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { describeError } from "./lib/errorReporting";

const FLAG_LABELS: Record<string, string> = {
  overgrown_vegetation: "Overgrown",
  junk_debris: "Junk / debris",
  boarded_or_broken_windows: "Boarded / broken windows",
  roof_damage_or_tarp: "Roof damage / tarp",
  distressed_exterior: "Distressed exterior",
  vacant_appearance: "Vacant-looking",
};

function conditionColor(score: number): string {
  if (score >= 76) return "text-red-400";
  if (score >= 51) return "text-amber-400";
  if (score <= 20) return "text-emerald-400";
  return "text-foreground";
}

function fmtTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

export function ConditionTest() {
  const leads = useQuery(api.signalData.leads, { limit: 15 });
  const prclids = (leads ?? []).map((l) => l.prclid);
  const conditions = useQuery(
    api.conditionData.conditionForPrclids,
    prclids.length ? { prclids } : "skip",
  );
  const scoreCondition = useAction(api.conditionActions.scoreCondition);

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const condByPrclid = new Map((conditions ?? []).map((c) => [c.prclid, c]));

  async function handleScore(prclid: string) {
    setBusy((b) => ({ ...b, [prclid]: true }));
    setErrors((e) => ({ ...e, [prclid]: "" }));
    try {
      const r = await scoreCondition({ prclid });
      if (r.status === "error") setErrors((e) => ({ ...e, [prclid]: r.error }));
    } catch (err) {
      setErrors((e) => ({ ...e, [prclid]: describeError(err) }));
    } finally {
      setBusy((b) => ({ ...b, [prclid]: false }));
    }
  }

  return (
    <div className="space-y-6 p-1">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <ScanEye className="h-6 w-6 text-teal-glow" />
          Vision Condition (test)
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Top {prclids.length || 15} leads by score. Click "Score condition" to pull the Street View
          front-of-house photo and run a vision model on it. Condition scores are an estimate from a
          single, possibly-stale photo — for triage only, not ground truth. (This page is isolated;
          scores do not yet affect lead ranking.)
        </p>
      </div>

      {leads === undefined && <p className="text-sm text-muted-foreground">Loading leads…</p>}
      {leads && leads.length === 0 && (
        <p className="text-sm text-muted-foreground">No leads yet.</p>
      )}

      <div className="space-y-4">
        {(leads ?? []).map((lead) => {
          const c = condByPrclid.get(lead.prclid);
          const isBusy = busy[lead.prclid];
          const err = errors[lead.prclid] || c?.lastError;
          return (
            <div
              key={lead.prclid}
              className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row"
              data-slot="card"
            >
              {/* Image / placeholder */}
              <div className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40 sm:w-56">
                {c?.imageUrl ? (
                  <img src={c.imageUrl} alt="Street View" className="h-full w-full object-cover" />
                ) : c?.hasImagery === false ? (
                  <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                    <MapPinOff className="h-5 w-5" /> No Street View coverage
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Not scored yet</span>
                )}
              </div>

              {/* Details */}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {lead.situsStreet}, {lead.propCity} {lead.propZip}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {lead.ownerName} · lead score {lead.score}
                    </div>
                  </div>
                  {c && c.score != null && (
                    <div className="text-right">
                      <div className={cn("text-2xl font-semibold tabular-nums", conditionColor(c.score))}>
                        {c.score}
                        <span className="text-sm text-muted-foreground">/100</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">condition distress</div>
                    </div>
                  )}
                </div>

                {c?.flags && c.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.flags.map((f) => (
                      <span
                        key={f}
                        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400"
                      >
                        {FLAG_LABELS[f] ?? f}
                      </span>
                    ))}
                  </div>
                )}

                {c?.reason && <p className="text-sm text-muted-foreground">{c.reason}</p>}

                {err && (
                  <p className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> {err}
                  </p>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleScore(lead.prclid)}
                    className="inline-flex items-center gap-2 rounded-md border border-teal/40 bg-teal/10 px-3 py-1.5 text-sm font-medium text-teal-glow hover:bg-teal/20 disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanEye className="h-4 w-4" />}
                    {c?.scoredAt ? "Re-score condition" : "Score condition"}
                  </button>
                  {c?.model && (
                    <span className="text-[11px] text-muted-foreground">
                      {c.model}
                      {c.scoredAt ? ` · ${fmtTime(c.scoredAt)}` : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `src/web/app.tsx`**

Add the import (with the other page imports):
```ts
import { ConditionTest } from "./ConditionTest";
```
Add the route (after `buyersRoute`):
```ts
const conditionRoute = createRoute({ getParentRoute: () => rootRoute, path: "/condition", component: ConditionTest });
```
Add it to the children array:
```ts
export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, flipRoute, propertiesRoute, propertyDetailRoute, parcelsRoute, leadsRoute, buyersRoute, conditionRoute, adminRoute]);
```

- [ ] **Step 3: Add the nav item in `src/components/app-shared.tsx`**

Add `ScanEye` to the lucide import on line 2:
```ts
import { LayoutDashboard, Gavel, Scale, ShieldCheck, Calculator, Building2, MapPin, Target, HandCoins, ScanEye } from "lucide-react";
```
Add a nav entry to `navItems` (after the "Buyers" entry):
```ts
	{ title: "Condition", path: "/condition", icon: ScanEye },
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: tsc + vite clean. (No `_generated` change in this task — only frontend.)

- [ ] **Step 5: Verify additivity + commit**

Run: `git diff --stat` — Expected: `src/web/ConditionTest.tsx` (new), `src/web/app.tsx` (+3 lines), `src/components/app-shared.tsx` (+2 edits). Nothing else.
```bash
git add src/web/ConditionTest.tsx src/web/app.tsx src/components/app-shared.tsx
git commit -m "feat(p7): /condition test page (top-15 leads, per-lead vision scoring) + nav/route" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Visual verify (deferred, authed SPA):** after the dev backend has the functions + keys, sign in → `/condition` → top-15 leads render → click "Score condition" on one with coverage → image + score + flags + reason + model appear; one with no coverage → "No Street View coverage". Headless preview per the lessons if needed.

---

## Post-build (finish-branch, not a build task)

- Final whole-feature review (additive-only `git diff` vs `main`; auth gates present; no edits to existing pipeline files).
- Update `memory/` (memory.md / todo.md / next-session-prompt.md / lessons.md) with P7-built status + the merge-order note (P5 + P7 both add tables; second to merge regenerates `_generated`).
- `finishing-a-development-branch`: present merge options. On merge, if P5 merged first, regenerate `convex/_generated` against the merged tree + `npm run build`. Then deploy + run the live smoke (Task 3) + the user click-through.

## Self-review (done)

- **Spec coverage:** pure module §6 → Task 1; table §5 → Task 2; data layer §7 → Task 2; action §7 → Task 3; page §8 → Task 4; security §9 (auth gate, server-side keys, base64) → Tasks 2–4; testing §10 → Task 1 (pure) + deferred live smokes; non-goals §2 honored (no `/leads`/`SCORE_CONFIG`/signalEvents/batch/cron). ✓
- **Placeholders:** none — full code in every code step. ✓
- **Type consistency:** `parseConditionResponse`/`buildConditionPrompt`/`buildStreetView*Url`/`CONDITION_MODEL`/`CONDITION_SYSTEM_PROMPT` names match across Tasks 1↔3; `storeCondition`/`getParcelInternal`/`conditionForPrclids` signatures match across Tasks 2↔3↔4; `scoreCondition` return type matches Task 3↔4; parcel fields (`situsStreet/propCity/propState/propZip/ownerName`) match the existing `parcels` table used by `equityActions`/`signalData`. ✓
