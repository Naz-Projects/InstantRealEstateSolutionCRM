# Vision Condition Scoring v2 — Claude/Chrome Batch Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An on-demand skill that scores the top 100 leads' exterior condition by looking at each house in Google Maps Street View via Chrome (Claude vision, no paid API), writing an auditable score + flags + description + confidence + screenshot into `parcelCondition`; the `/condition` page shows all of them worst-distress-first.

**Architecture:** Additive to P7 v1. A canonical rubric in the pure module (`conditionScore.ts`) is shared by BOTH the existing Gemini button and the new skill. The skill (markdown runbook) orchestrates Chrome → screenshot → Claude scoring → a CLI-called `internalAction` that stores the image in Convex `_storage` and upserts the row. The page reuses the existing auth-gated `leads` + `conditionForPrclids` queries (bumped to 100, sorted by condition distress).

**Tech Stack:** Convex (V8 queries/mutations + `"use node"` actions), TanStack Router + React + Tailwind, vitest, claude-in-chrome (browser automation), Claude Code skills.

## Global Constraints

- **Standing directive:** ALL implementation via **Opus 4.8 subagents** (`model: "opus"`); the main loop orchestrates + reviews. Each task = a fresh subagent + two-stage review.
- **Strictly additive** — do NOT change `/leads` scoring, the spine, or any other feature. The existing Gemini per-click button STAYS as an ad-hoc fallback.
- **Isolated worktree** — all work happens in `.claude/worktrees/condition-batch` on branch `feat/condition-batch-skill`. Convex codegen/validation uses `CONVEX_AGENT_MODE=anonymous npx convex dev --once` (a SEPARATE local backend) so it never pushes this branch's schema to the SHARED dev deployment (a concurrent `command-center` session is live on it).
- **No false information** is the product requirement: scoring is describe-then-score, conservative, confidence-tagged, and fully auditable (image + raw output + rubricVersion stored).
- **Convex rules:** `"use node"` files contain ONLY actions; V8 queries/mutations live in `*Data.ts`. Every action handler that calls sibling functions needs an explicit `: Promise<...>` return annotation (TS7022/7023). On Windows the Convex CLI prints a cosmetic `UV_HANDLE_CLOSING` assertion AFTER real output — trust the output, not the exit code.
- **`RUBRIC_VERSION = 2`** stamped on every row the new rubric produces (v1 rows are implicitly version 1 / unset).
- **`model` string** records the scorer: `"claude-opus-4-8 (chrome)"` for skill rows, `"google/gemini-2.5-flash"` for button rows.

---

## Task 0: Worktree prerequisites (one-time setup)

**Files:** none committed — environment setup only.

- [ ] **Step 1: Link node_modules + env into the worktree** (the worktree is a fresh checkout with neither)

Run (from the worktree root `C:\Users\nazho\Desktop\ires-crm\.claude\worktrees\condition-batch`):
```bash
# Windows junction so we don't reinstall ~hundreds of MB:
cmd //c "mklink /J node_modules ..\\..\\..\\node_modules"
cp ../../../.env.local .env.local
```
Expected: `node_modules` junction created; `.env.local` present.

- [ ] **Step 2: Verify the toolchain works in the worktree**

Run:
```bash
npx vitest run tests/conditionScore.test.ts
CONVEX_AGENT_MODE=anonymous npx convex dev --once
```
Expected: existing condition tests pass (the hardening's 21 in that file); anonymous backend reports "Convex functions ready!" (validates + regenerates `_generated` locally, pushes nothing to shared dev).

No commit (environment only).

---

## Task 1: Schema — 3 additive fields on `parcelCondition`

**Files:**
- Modify: `convex/schema.ts` (the `parcelCondition` table, ~lines 425-437)

**Interfaces:**
- Produces: `parcelCondition` rows may now carry `description: string`, `confidence: "low"|"medium"|"high"`, `rubricVersion: number`.

- [ ] **Step 1: Add the three optional fields**

In `convex/schema.ts`, inside `parcelCondition: defineTable({ ... })`, after the `reason: v.optional(v.string()),` line add:
```ts
    description: v.optional(v.string()), // longer evidence-grounded narrative (v2 rubric)
    confidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    rubricVersion: v.optional(v.number()), // which rubric produced this row (v2 = 2)
```
Leave all existing fields and the `by_prclid` index unchanged.

- [ ] **Step 2: Regenerate + validate (anonymous backend)**

Run:
```bash
CONVEX_AGENT_MODE=anonymous npx convex dev --once
```
Expected: "Convex functions ready!" with no schema errors (all fields optional → existing rows still validate).

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(p7v2): parcelCondition gains description/confidence/rubricVersion"
```

---

## Task 2: Pure module — describe-then-score rubric + parse `description`/`confidence` (TDD)

**Files:**
- Modify: `src/scraper/conditionScore.ts`
- Test: `tests/conditionScore.test.ts`

**Interfaces:**
- Produces:
  - `RUBRIC_VERSION: number` (= 2)
  - `CONFIDENCE_LEVELS: readonly ["low","medium","high"]`
  - `ConditionScore` interface extended: `{ score: number; flags: string[]; reason: string; description: string; confidence: "" | "low" | "medium" | "high" }`
  - `parseConditionResponse(raw: string): ConditionScore` now also extracts `description` (string, capped 1000) and `confidence` (validated against `CONFIDENCE_LEVELS`, else `""`).
  - `buildConditionPrompt(): string` rewritten to describe-then-score, requesting JSON `{description, flags, score, confidence}`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/conditionScore.test.ts` (it already imports from `../src/scraper/conditionScore` and uses `describe/it/expect`):
```ts
import { RUBRIC_VERSION, CONFIDENCE_LEVELS } from "../src/scraper/conditionScore";

describe("rubric v2 parse", () => {
  it("RUBRIC_VERSION is 2 and confidence levels are the closed set", () => {
    expect(RUBRIC_VERSION).toBe(2);
    expect([...CONFIDENCE_LEVELS]).toEqual(["low", "medium", "high"]);
  });
  it("parses description and confidence", () => {
    const r = parseConditionResponse(
      '{"description":"Two-story home, peeling paint on trim, lawn overgrown.","flags":["overgrown_vegetation"],"score":58,"confidence":"high"}',
    );
    expect(r.score).toBe(58);
    expect(r.flags).toEqual(["overgrown_vegetation"]);
    expect(r.description).toBe("Two-story home, peeling paint on trim, lawn overgrown.");
    expect(r.confidence).toBe("high");
  });
  it("drops an out-of-set confidence to empty string", () => {
    const r = parseConditionResponse('{"description":"x","flags":[],"score":10,"confidence":"maybe"}');
    expect(r.confidence).toBe("");
  });
  it("defaults missing description/confidence", () => {
    const r = parseConditionResponse('{"flags":[],"score":10}');
    expect(r.description).toBe("");
    expect(r.confidence).toBe("");
  });
  it("the prompt asks for describe-then-score with description + confidence", () => {
    const p = buildConditionPrompt();
    expect(p).toMatch(/describe/i);
    expect(p).toContain('"description"');
    expect(p).toContain('"confidence"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/conditionScore.test.ts`
Expected: FAIL — `RUBRIC_VERSION`/`CONFIDENCE_LEVELS` undefined; `description`/`confidence` missing on the parsed object.

- [ ] **Step 3: Implement the additions**

In `src/scraper/conditionScore.ts`:

(a) Near the top, after `CONDITION_MODEL_ALTERNATIVES`, add:
```ts
// Bump when the rubric materially changes so stale-version rows can be re-scored.
export const RUBRIC_VERSION = 2;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
const KNOWN_CONFIDENCE = new Set<string>(CONFIDENCE_LEVELS);
```

(b) Extend the `ConditionScore` interface:
```ts
export interface ConditionScore {
  score: number; // 0–100, clamped (higher = more distressed)
  flags: string[]; // subset of CONDITION_FLAGS
  reason: string; // kept for back-compat with v1 rows
  description: string; // evidence-grounded narrative (v2)
  confidence: "" | Confidence; // "" = model gave none / invalid
}
```

(c) Replace `buildConditionPrompt` with the describe-then-score rubric:
```ts
export function buildConditionPrompt(): string {
  return `You are assessing the EXTERIOR physical condition / distress of the house in this Street View photo for a real-estate wholesaling team. Accuracy matters more than completeness — DO NOT invent damage.

Work in this order, then return ONLY a JSON object (no markdown fences, no extra text) with exactly these fields:

1. "description": 1-3 sentences describing what is CLEARLY VISIBLE on the house and lot (structure type, roof, siding/paint, windows, yard, debris). Cite only what you can actually see. If the view is obstructed, shadowed, the wrong building, under construction, or not a house, SAY SO here.
2. "flags": an array containing ONLY clearly-visible items you described above, from this exact set:
   "overgrown_vegetation", "junk_debris", "boarded_or_broken_windows",
   "roof_damage_or_tarp", "distressed_exterior", "vacant_appearance"
   Use [] if none clearly apply. Never add a flag you did not describe.
3. "score": an integer 0-100 distress score justified by the description:
     0-20  = well-kept (tidy yard, sound roof/siding/windows, no distress)
     21-50 = minor wear (some peeling paint / worn but maintained)
     51-75 = visible distress (overgrown yard, debris, damaged siding/roof, disrepair)
     76-100 = severe distress / likely vacant (boarded windows, tarped/collapsing roof, heavy junk, derelict)
4. "confidence": "low", "medium", or "high" — your confidence the photo clearly shows the target house's current condition. Use "low" if the view is obstructed, shadowed, ambiguous, possibly the wrong house, or stale-looking.

Rules:
- Judge ONLY what is clearly visible. When unsure, score conservatively (low) and set confidence "low".
- Shadows, wet pavement, parked cars, and seasonal bare trees are NOT distress.`;
}
```

(d) In `parseConditionResponse`, after computing `reason`, add description + confidence and include them in the return:
```ts
  const description = typeof obj.description === "string" ? obj.description.slice(0, 1000) : "";
  const confRaw = typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "";
  const confidence = KNOWN_CONFIDENCE.has(confRaw) ? (confRaw as Confidence) : "";
  return { score: clampScore(obj.score), flags: [...new Set(flags)], reason, description, confidence };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/conditionScore.test.ts`
Expected: PASS (all, including the existing 21).

- [ ] **Step 5: Commit**

```bash
git add src/scraper/conditionScore.ts tests/conditionScore.test.ts
git commit -m "feat(p7v2): describe-then-score rubric + parse description/confidence (RUBRIC_VERSION 2)"
```

---

## Task 3: Data layer — extend `storeCondition` + `conditionForPrclids`

**Files:**
- Modify: `convex/conditionData.ts`

**Interfaces:**
- Consumes: schema fields from Task 1.
- Produces:
  - `storeCondition` accepts `description?`, `confidence?` (`"low"|"medium"|"high"`), `rubricVersion?`.
  - `conditionForPrclids` rows now include `description: string` and `confidence: string`.

- [ ] **Step 1: Extend `storeCondition` args + patch**

In `convex/conditionData.ts`, in `storeCondition`'s `args`, after `reason: v.optional(v.string()),` add:
```ts
    description: v.optional(v.string()),
    confidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    rubricVersion: v.optional(v.number()),
```
The handler already spreads `...rest` into the patch, so the new fields flow through with no further change.

- [ ] **Step 2: Extend `conditionForPrclids` return shape**

In the `out` array's element type add `description: string;` and `confidence: string;`. In the `out.push({...})` add:
```ts
        description: row.description ?? "",
        confidence: row.confidence ?? "",
```

- [ ] **Step 3: Regenerate + typecheck**

Run:
```bash
CONVEX_AGENT_MODE=anonymous npx convex dev --once
npm run build
```
Expected: codegen clean; build clean.

- [ ] **Step 4: Commit**

```bash
git add convex/conditionData.ts convex/_generated
git commit -m "feat(p7v2): storeCondition + conditionForPrclids carry description/confidence/rubricVersion"
```

---

## Task 4: Internal lead query for the skill — `topLeadsForScoring`

**Files:**
- Modify: `convex/signalData.ts`

**Interfaces:**
- Produces: `internal.signalData.topLeadsForScoring(args: { count?: number }): Promise<Array<{ prclid: string; address: string; leadScore: number; ownerName: string }>>` — the top `count` (default 100) leads by lead score, for the CLI-run skill (the public `leads` query is auth-gated and rejects the CLI).
- Internal refactor: a module-level `deriveLeads(ctx, args)` helper holds the existing derivation so `leads` and `topLeadsForScoring` share ONE scoring path (the skill's "top 100" then matches `/leads` exactly).

- [ ] **Step 1: Extract the derivation into a helper (no behavior change)**

In `convex/signalData.ts`, define a module-level async function `deriveLeads` holding the current body of the `leads` handler **from `const cutoff = ...` through `return out.slice(0, limit ?? 200);`** (i.e. everything AFTER `await requireUser(ctx)`). Signature:
```ts
async function deriveLeads(
  ctx: QueryCtx,
  { type, absenteeOnly, minStack, stage, windowDays, limit, minEquityRatio }: {
    type?: string; absenteeOnly?: boolean; minStack?: number; stage?: string;
    windowDays?: number; limit?: number; minEquityRatio?: number;
  },
) {
  // …moved body…
}
```
Import `QueryCtx`: `import { query, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";`.
Add `propState: parcel.propState,` to the `out.push({...})` object (and add `propState: string;` to the `out` element type) so the address can include the state.
Rewrite `leads` to delegate:
```ts
export const leads = query({
  args: { /* unchanged */ },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return deriveLeads(ctx, args);
  },
});
```

- [ ] **Step 2: Add `topLeadsForScoring`**

Append to `convex/signalData.ts`:
```ts
// Top-N leads by lead score for the condition-batch skill (CLI-run via deploy key).
// Internal because the public `leads` query is auth-gated and rejects the CLI.
export const topLeadsForScoring = internalQuery({
  args: { count: v.optional(v.number()) },
  handler: async (ctx, { count }) => {
    const leads = await deriveLeads(ctx, { limit: count ?? 100 });
    return leads.map((l) => ({
      prclid: l.prclid,
      address: `${l.situsStreet}, ${l.propCity} ${l.propState} ${l.propZip}`,
      leadScore: l.score,
      ownerName: l.ownerName,
    }));
  },
});
```

- [ ] **Step 3: Regenerate + typecheck + confirm `/leads` unaffected**

Run:
```bash
CONVEX_AGENT_MODE=anonymous npx convex dev --once
npm run build
```
Expected: clean. The `leads` query is a pure delegation (identical logic moved into `deriveLeads`); its public signature/return is unchanged except the additive `propState` field. (Behavioral live-verification of `topLeadsForScoring` against real data happens in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add convex/signalData.ts convex/_generated
git commit -m "feat(p7v2): topLeadsForScoring internalQuery (shared deriveLeads helper)"
```

---

## Task 5: Write path — upload-URL transport + Gemini path carries the new fields

> **⚠ TRANSPORT CORRECTION (2026-06-26, resolved by spike):** `npx convex run` only takes inline JSON args (no file/stdin) and the Windows arg limit is ~32 KB, so base64-image-in-CLI-arg is impossible (even a 400px downscale ~73 KB exceeds it). BUT the sandbox CAN HTTP-POST to convex.cloud (verified `HTTP 200`), and `ctx.storage.generateUploadUrl()` is already used in the repo (`contractData.ts:185`). **New transport = the standard Convex upload-URL flow:** add `conditionData.generateConditionUploadUrl` (internalMutation → `ctx.storage.generateUploadUrl()`); the skill POSTs the screenshot bytes to that URL → gets a `storageId` → calls the EXISTING `conditionData.storeCondition` (Task 3) with `imageStorageId` + the metadata (all small, fits the CLI). The base64 node action `storeConditionBatch` is NOT built. The only `conditionActions.ts` change in this task is the Gemini-path field wiring.

**Files:**
- Modify: `convex/conditionActions.ts`

**Interfaces:**
- Consumes: `internal.conditionData.storeCondition` (Task 3); `RUBRIC_VERSION` (Task 2).
- Produces: `internal.conditionActions.storeConditionBatch(args: { prclid, score, flags, description, confidence, rubricVersion, model, imageBase64 }): Promise<{ ok: true }>` — decodes the screenshot, stores it in `_storage`, upserts the row.

- [ ] **Step 1: Verify the base64→action transport works (spike)**

Convex actions receive args as JSON; a 640px JPEG is ~100-160 KB base64. Confirm the transport before building on it.
Run (a real test from the worktree):
```bash
# make a small test image, base64 it, call a throwaway echo of the size — or directly test the real action once written.
node -e "const b=require('fs').readFileSync(process.argv[1]).toString('base64'); console.log('b64len', b.length); require('fs').writeFileSync('payload.json', JSON.stringify({prclid:'TEST', score:0, flags:[], description:'t', confidence:'low', rubricVersion:2, model:'test', imageBase64:b}))" some-test.jpg
```
Primary transport = inline arg: `npx convex run conditionActions:storeConditionBatch "$(cat payload.json)"`.
- If that succeeds on Windows → use it (the skill writes a temp `payload.json` and runs `npx convex run … "$(cat payload.json)"`).
- If the arg is rejected as too long → FALLBACK: downscale the screenshot to 400px before scoring/storing (the skill captures at 400-480px), which keeps base64 < ~70 KB. Document whichever is used in the SKILL (Task 6).
Run against a REAL deployment is deferred to Task 7; here, confirm the action TYPE-checks and that the inline-arg length is within limits with a representative image.

- [ ] **Step 2: Add the action**

In `convex/conditionActions.ts` add (it already imports from `../src/scraper/conditionScore` and has `OPENROUTER_URL`, `ActionCtx`, `Id`, `internal`):
```ts
import { RUBRIC_VERSION } from "../src/scraper/conditionScore"; // add to the existing import

export const storeConditionBatch = internalAction({
  args: {
    prclid: v.string(),
    score: v.number(),
    flags: v.array(v.string()),
    description: v.string(),
    confidence: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    rubricVersion: v.optional(v.number()),
    model: v.string(),
    imageBase64: v.string(),
  },
  handler: async (ctx, a): Promise<{ ok: true }> => {
    const bytes = Buffer.from(a.imageBase64, "base64");
    const imageStorageId = await ctx.storage.store(new Blob([bytes], { type: "image/jpeg" }));
    await ctx.runMutation(internal.conditionData.storeCondition, {
      prclid: a.prclid,
      score: a.score,
      flags: a.flags,
      description: a.description,
      confidence: a.confidence,
      rubricVersion: a.rubricVersion ?? RUBRIC_VERSION,
      model: a.model,
      imageStorageId,
      hasImagery: true,
      scoredAt: Date.now(),
      lastError: null,
    });
    return { ok: true };
  },
});
```
Note: `internalAction` import — add `internalAction` to the existing `import { action } from "./_generated/server";` line.

- [ ] **Step 3: Make the Gemini button path also store description/confidence (keep ONE rubric consistent)**

In the existing `doScore` (vision step), the parse already returns `description` + `confidence` after Task 2. In its `storeCondition` call (the success path), add:
```ts
      description: parsed.description,
      confidence: parsed.confidence || undefined,
      rubricVersion: RUBRIC_VERSION,
```
(Leave `reason: parsed.reason` as-is. `confidence` is `""`→`undefined` so it satisfies the optional union validator.)

- [ ] **Step 4: Regenerate + typecheck + build**

Run:
```bash
CONVEX_AGENT_MODE=anonymous npx convex dev --once
npm run build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add convex/conditionActions.ts convex/_generated
git commit -m "feat(p7v2): storeConditionBatch action (image→_storage→upsert); Gemini path stores description/confidence"
```

---

## Task 6: The skill — `condition-batch` runbook

**Files:**
- Create: `.claude/skills/condition-batch/SKILL.md`

**Interfaces:**
- Consumes (at run time, via CLI with the prod deploy key from `.env.local` `CONVEX_DEPLOY_KEY_PROD`): `internal.signalData.topLeadsForScoring`, `internal.conditionActions.storeConditionBatch`.
- Consumes (browser): claude-in-chrome tools (the running session's Chrome).

- [ ] **Step 1: Write the skill file**

Create `.claude/skills/condition-batch/SKILL.md` with YAML frontmatter + the runbook. It MUST contain:
```markdown
---
name: condition-batch
description: Score the top N leads' exterior condition by looking at each house in Google Maps Street View via Chrome (Claude vision, no paid API) and writing score + flags + description + confidence + screenshot into Convex. Use when the user says "score conditions", "run condition scoring", "condition batch", or wants the monthly house-condition pass.
---

# Condition Batch Scoring

Run this monthly. It scores the **top N leads** (default 100) by driving the user's logged-in Chrome to each house's Google Maps Street View, looking at it with the SAME rubric the code uses, and writing the result to Convex. No paid LLM API — Claude does the vision.

## 0. Preconditions
- Confirm the backend is deployed (the `description`/`confidence`/`rubricVersion` fields + `topLeadsForScoring` + `storeConditionBatch` must be live on the target deployment).
- Target = PROD by default: `export CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)"`.
- Load claude-in-chrome tools and call `tabs_context_mcp` first; create a fresh tab for the run.

## 1. Pull the work list
`npx convex run signalData:topLeadsForScoring '{"count":100}'` → a JSON array of `{prclid, address, leadScore, ownerName}`. Keep a resume log of prclids completed this run (a scratch file) so a mid-run interruption resumes without rescoring.

## 2. For each lead, SERIALLY (one Chrome, one focus):
1. Navigate Chrome to Google Maps Street View for `address` (e.g. `https://www.google.com/maps/place/<url-encoded address>`, then enter Street View / pegman). Confirm the on-screen address/area matches the target; if it clearly doesn't, set confidence "low".
2. If Maps shows NO Street View coverage → call `storeConditionBatch` is SKIPPED; instead record it as no-coverage (mark hasImagery:false via a `storeCondition` run, or just note it in the summary) and move on. Never guess a score with no image.
3. Screenshot the front of the house to `scratch/<prclid>.jpg` (capture at ~480px to keep the upload small).
4. SCORE the screenshot with THIS rubric (kept in sync with `src/scraper/conditionScore.ts` `buildConditionPrompt`, RUBRIC_VERSION 2) — describe what is clearly visible FIRST, then flags (only what you described, from the closed set), then a 0-100 score, then confidence. DO NOT invent damage; when unsure, score low + confidence low. (Paste the full rubric text here verbatim from buildConditionPrompt so the skill is self-contained.)
   - To keep the main context lean, dispatch a per-house scoring subagent that READS `scratch/<prclid>.jpg` and returns the JSON; if subagents cannot reach the screenshot file, score inline.
5. Write it via the upload-URL flow (base64 can't fit a CLI arg; convex.cloud HTTP works):
   a. `url=$(npx convex run conditionData:generateConditionUploadUrl '{}')` — the CLI prints the upload URL string (strip surrounding quotes/whitespace).
   b. `resp=$(curl -sS -X POST "$url" -H "Content-Type: image/jpeg" --data-binary @scratch/<prclid>.jpg)` → JSON `{"storageId":"<id>"}`; extract `<id>` (e.g. `node -e "process.stdout.write(JSON.parse(process.argv[1]).storageId)" "$resp"`).
   c. `npx convex run conditionData:storeCondition '{"prclid":"<prclid>","score":<n>,"flags":[...],"description":"...","confidence":"<low|medium|high>","rubricVersion":2,"model":"claude-opus-4-8 (chrome)","imageStorageId":"<id>","hasImagery":true,"scoredAt":<ms>,"lastError":null}'` — small payload, fits the CLI. (`scoredAt` = current epoch ms, e.g. `$(($(date +%s)*1000))`.)
   For a no-coverage house, skip the upload and call `storeCondition` with `{"prclid","hasImagery":false,"model":"claude-opus-4-8 (chrome)","scoredAt":<ms>,"lastError":null}` (no score) so it's recorded, not silently dropped.
6. Append prclid to the resume log.

## 3. Handle friction
- If Google shows a CAPTCHA/consent wall, PAUSE and ask the user to clear it, then resume from the log. Pace requests (a short wait between houses).

## 4. Summary
Report: scored / no-coverage / low-confidence / distressed (score ≥ 60) counts, and a list of the worst few. Remind the user to eyeball the `/condition` page and flag any wrong scores (we tune the rubric + bump RUBRIC_VERSION).
```
Fill in the `(Paste the full rubric text…)` placeholder with the EXACT string `buildConditionPrompt()` returns (copy it verbatim from `conditionScore.ts`) so the skill is self-contained and stays consistent with the code path.

- [ ] **Step 2: Sanity-check the skill is discoverable + well-formed**

Run: `npx convex run signalData:topLeadsForScoring '{"count":2}'` is DEFERRED to Task 7 (needs a deployed backend). Here, just verify the file exists and the frontmatter parses (no code execution).
Run: `ls .claude/skills/condition-batch/SKILL.md`
Expected: the file exists.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/condition-batch/SKILL.md
git commit -m "feat(p7v2): condition-batch skill (Chrome + Claude vision runbook)"
```

---

## Task 7: Frontend — `/condition` shows all top-100, worst-distress-first

**Files:**
- Modify: `src/web/ConditionTest.tsx`

**Interfaces:**
- Consumes: `api.signalData.leads({ limit: 100 })`, `api.conditionData.conditionForPrclids({ prclids })` (now returning `description`/`confidence`), `api.conditionActions.scoreCondition` (the kept Gemini button).

- [ ] **Step 1: Fetch 100 leads + merge condition rows + sort by distress**

In `ConditionTest.tsx`: change `useQuery(api.signalData.leads, { limit: 15 })` to `{ limit: 100 }`. Build `condByPrclid` as today. Compute the render list sorted so SCORED leads come first by condition score desc, then unscored by lead score:
```ts
const rows = [...(leads ?? [])].sort((a, b) => {
  const ca = condByPrclid.get(a.prclid)?.score ?? null;
  const cb = condByPrclid.get(b.prclid)?.score ?? null;
  if (ca != null && cb != null) return cb - ca;       // both scored: worst distress first
  if (ca != null) return -1;                           // scored before unscored
  if (cb != null) return 1;
  return b.score - a.score;                             // both unscored: by lead score
});
```
Render `rows` instead of `leads`.

- [ ] **Step 2: Show description + confidence; keep the Gemini button**

In each card, below the flags, render the description and a confidence chip:
```tsx
{c?.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
{c?.confidence && (
  <span className={cn(
    "rounded-md border px-2 py-0.5 text-[11px] font-medium",
    c.confidence === "low" ? "border-red-500/40 bg-red-500/10 text-red-400"
      : c.confidence === "high" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : "border-border bg-muted/40 text-muted-foreground",
  )}>
    confidence: {c.confidence}
  </span>
)}
```
(Keep `c?.reason` as a fallback display when `description` is empty — old v1 rows.) Leave the existing "Score condition" / "Re-score condition" Gemini button exactly as-is. Update the header copy from "Top 15" to "Top 100" and note scores may come from the monthly Chrome batch or the per-lead button.

- [ ] **Step 3: Typecheck + build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/web/ConditionTest.tsx
git commit -m "feat(p7v2): /condition shows top-100 worst-distress-first with description + confidence"
```

---

## Task 8: Live smoke (with the user — post-deploy)

> This task needs a DEPLOYED backend + the user's Chrome; it is the finish-branch step, run WITH the user, not by a subagent.

- [ ] **Step 1: Merge + deploy decision (user).** Merge `feat/condition-batch-skill` → `main` (regenerate `convex/_generated` against the merged tree — it adds schema fields — + `npm run build`), push (CF deploys), and/or manually deploy the prod backend (`CONVEX_DEPLOY_KEY=$prod npx convex deploy`) so the new fields + functions are live.
- [ ] **Step 2: Read-only verify the lead query on real data:** `npx convex run signalData:topLeadsForScoring '{"count":5}'` (prod key) → 5 `{prclid, address, leadScore}` rows; sanity-check the addresses.
- [ ] **Step 3: Run the skill on 5-10 houses** (invoke `condition-batch` with a small count): confirm Chrome captures the right houses, scores are sensible vs. eyeballing the image, rows land with image + description + confidence, and the `/condition` page renders them worst-first. Spot-check accuracy; if a score is off, note it (it feeds a rubric tweak + `RUBRIC_VERSION` bump).
- [ ] **Step 4: Full run (100)** once the smoke looks good.

---

## Self-Review (completed)

**Spec coverage:** §3 architecture units → Tasks 1-7. §4 reliability (describe-then-score, confidence, audit trail incl. image+rawResponse+rubricVersion, idempotent upsert, no-coverage/wrong-house) → Tasks 2 (rubric), 3/5 (storage of description/confidence/rubricVersion; rawResponse already stored by the Gemini path; the skill stores the screenshot), 6 (skill: wrong-house/no-coverage/resume). §5 supportability (RUBRIC_VERSION, one canonical rubric, model string, configurable count) → Tasks 2, 4, 6. §6 schema → Task 1. §7 backend (topLeadsForScoring, storeConditionBatch; the page reuses `leads`+`conditionForPrclids` instead of a separate `scoredConditions` query — a DRY refinement of the spec, noted) → Tasks 3-5. §8 skill → Task 6. §9 frontend → Task 7. §10 testing → Tasks 2 (unit), 0/3/5 (codegen+build), 8 (live smoke). §11 risks → addressed in Tasks 5 (transport), 6 (CAPTCHA/wrong-house/no-coverage).

**Placeholder scan:** the only intentional deferral is the Task 5 transport spike (primary + concrete fallback given) and the Task 6 verbatim-rubric paste (the source string is `buildConditionPrompt()` from Task 2) — both have concrete instructions, not vague TODOs.

**Type consistency:** `ConditionScore` (Task 2) ⊇ what `parseConditionResponse` returns and what `doScore` reads (Task 5). `storeCondition` args (Task 3) ⊇ what `storeConditionBatch` and `doScore` pass (Task 5). `topLeadsForScoring` return (Task 4) = what the skill consumes (Task 6). `conditionForPrclids` adds `description`/`confidence` (Task 3) = what the page reads (Task 7).
