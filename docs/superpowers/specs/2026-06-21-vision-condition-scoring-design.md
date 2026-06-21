# P7 — Vision Condition Scoring (isolated test harness)

_Spec. Date: 2026-06-21. Status: APPROVED (design), pending spec review → plan → build._
_Roadmap: `docs/superpowers/specs/2026-06-11-wholesaling-pipeline-crm.md` → P7. Research: `memory/lead-engine-enrichment-and-vision.md` → "Satellite/aerial computer-vision condition signals" (T4)._

## 1. Goal

Score the **physical exterior condition** of a lead's house from a single **Google Street View** front-of-house photo, using a cheap vision LLM, producing a **0–100 condition-distress score** + a few flags. Surface it on a **new, isolated page** that lists the **top ~15 current leads** so the user can click a per-lead button, see what the model saw and what it judged, and **evaluate accuracy before any integration into lead scoring**.

The distress score is a real-estate-wholesaling signal: an overgrown, junk-strewn, tarped-roof house signals a motivated seller / value-add opportunity. v1 only *measures and displays* it — proving the signal is reliable comes first.

## 2. Non-goals (explicitly out of scope for v1)

This is deliberately isolated. v1 does **NOT**:
- Touch `/leads`, `LeadsPage.tsx`, `signalData.leads`, `computeLeadScore`, or `SCORE_CONFIG`. **No multiplier, no signal stacking, no score change anywhere.**
- Emit `signalEvents` rows.
- Run a batch / "score top N" button (per-lead button only).
- Run against the 203k parcel spine — **funnel-only**, only the top-N leads shown on the page, and only when the user clicks.
- Use aerial / roof / satellite imagery (Street View front-of-house only).
- Add a cron or any automatic scoring.

Everything is **strictly additive** — zero edits to existing pipeline files (Sheriff/Legal/Flip/Properties/Leads/Equity/Offers/Contracts). Verified by `git diff` at review, same discipline as P4/P6.

The wiring of a proven condition score into `/leads` (as a `signalEvents` source and/or a `SCORE_CONFIG` multiplier) is a **future phase**, designed after the user evaluates accuracy on this page.

## 3. Model decision (researched 2026-06-21)

**Default model: `google/gemini-2.5-flash` via OpenRouter.** Reuses the existing `OPENROUTER_API_KEY` + the `legalNotices.ts` OpenRouter call pattern — **no new credential**. Best calibration + instruction-following among cheap vision models, native + battle-tested image→JSON, ~$0.45 / 1,000 houses.

**Swappable** via an env override (`CONDITION_LLM_MODEL`, mirroring `LEGAL_LLM_MODEL`) with two documented alternatives the user can A/B on the test page:
- `z-ai/glm-4.6v` — the *actual* GLM vision model (S-tier real-world-scene benchmarks), ~$0.20–0.53 / 1k.
- `qwen/qwen3-vl-32b-instruct` — S-tier scene benchmarks, ~$0.20 / 1k.

The page **displays which model scored each house** so alternatives can be compared against real Delaware houses.

**Corrections captured from research:** the user's "GLM 5.2" (`z-ai/glm-5.2`) is **text-only** and cannot accept an image — the GLM vision model is **GLM-4.6V**. **DeepSeek has no usable vision model** today (V4 is text-only; DeepSeek-VL2 is old/weak/not on OpenRouter) — excluded. Full comparison in Appendix A.

At a few houses at a time, absolute cost is negligible (cents per thousand); the choice optimizes vision reliability, not price.

## 4. Architecture

Four additive units, mirroring the proven P4 equity-gate shape (`equityActions.ts` + `parcelEquity` + a panel), adapted to a standalone page:

```
src/scraper/conditionScore.ts   (PURE, TDD) — prompt + rubric + tolerant parser + URL builders + model config
convex/schema.ts                — + parcelCondition table (funnel-only, separate from the spine)
convex/conditionData.ts (V8)    — queries/mutations: top-N leads, condition rows, store result (requireUser)
convex/conditionActions.ts (node)— scoreCondition(prclid): Street View → vision LLM → store (auth-gated)
src/web/ConditionTest.tsx        — /condition page: top-15 leads, per-lead "Score condition" button + results
```

Data flow (one button click):
```
Score condition (prclid)
  → conditionActions.scoreCondition  [requireUser via getCallerInternal]
    1. read spine parcel (situs address)             [conditionData.getParcelInternal]
    2. Street View METADATA coverage check (free)     → no coverage ⇒ hasImagery:false, stop, store
    3. fetch Street View Static image bytes (30s timeout)
    4. ctx.storage.store(jpeg)                        → imageStorageId
    5. OpenRouter vision call (base64 image + rubric) → raw JSON   [30s timeout]
    6. parseConditionResponse(raw)                    → {score, flags, reason}
    7. storeCondition(...)                            [conditionData.storeCondition, upsert by prclid]
  on any failure: store lastError, never throw uncaught (mirror equityActions partial-success)
  → reactive page fills in the image + score + flags + reason + model
```

## 5. Data model — `parcelCondition` table

Funnel-only, separate from the spine (the CDC never touches it), mirroring `parcelEquity`:

```ts
parcelCondition: defineTable({
  prclid: v.string(),
  score: v.optional(v.number()),            // 0–100 distress score (higher = more distressed)
  flags: v.optional(v.array(v.string())),   // subset of the known flag vocabulary (see §7)
  reason: v.optional(v.string()),           // model's one-line justification
  model: v.optional(v.string()),            // e.g. "google/gemini-2.5-flash" (which model scored it)
  imageStorageId: v.optional(v.id("_storage")), // the exact Street View image the model saw
  hasImagery: v.optional(v.boolean()),      // false ⇒ no Street View coverage (not an error)
  rawResponse: v.optional(v.string()),      // raw model output, capped (debug/eval)
  scoredAt: v.optional(v.number()),         // ms epoch
  lastError: v.optional(v.string()),        // last failure, visible — never silent
  updatedAt: v.number(),
}).index("by_prclid", ["prclid"]),
```

## 6. Pure module — `src/scraper/conditionScore.ts` (TDD)

Pure, offline-testable, imported by the Convex action. No network, no Convex.

```ts
// Model config — env-overridable, mirrors legalNotices DEFAULT_MODEL
export const CONDITION_MODEL =
  process.env.CONDITION_LLM_MODEL || "google/gemini-2.5-flash";
export const CONDITION_MODEL_ALTERNATIVES = [
  "google/gemini-2.5-flash", "z-ai/glm-4.6v", "qwen/qwen3-vl-32b-instruct",
];

// Flag vocabulary (closed set the model must choose from)
export const CONDITION_FLAGS = [
  "overgrown_vegetation", "junk_debris", "boarded_or_broken_windows",
  "roof_damage_or_tarp", "distressed_exterior", "vacant_appearance",
] as const;

export const CONDITION_SYSTEM_PROMPT: string;       // role/rubric framing
export function buildConditionPrompt(): string;     // the anchored 0–100 rubric + flag defs + JSON contract

export interface ConditionScore {
  score: number;          // clamped 0–100
  flags: string[];        // ⊆ CONDITION_FLAGS
  reason: string;
}
// Tolerant parse: strip ```json fences (as legalNotices does), JSON.parse,
// clamp score to 0–100, keep only known flags, default reason "". Throws only on
// unrecoverable garbage (caller catches → lastError).
export function parseConditionResponse(raw: string): ConditionScore;

// Street View Static image URL + free metadata (coverage) URL from a situs address.
export function buildStreetViewImageUrl(address: string, key: string): string;     // maps/api/streetview
export function buildStreetViewMetadataUrl(address: string, key: string): string;  // maps/api/streetview/metadata
```

**Prompt design (mitigations for known cheap-VLM failure modes):**
- Anchored 0–100 rubric (e.g. 0–20 well-kept; 21–50 minor wear; 51–75 visible distress; 76–100 severe/vacant), so scores aren't compressed to the mid-range.
- Flags restricted to the closed `CONDITION_FLAGS` set; the model returns only those it can *see*.
- "Judge ONLY what is visibly true; if the photo is unclear/obstructed/shadowed, say so and score conservatively" — to curb hallucinated damage and shadow/glare misreads.
- One-line `reason` grounded in the visible scene.
- `temperature: 0`, capped `max_tokens` (small JSON out).
- Output contract: `{"score": <int 0-100>, "flags": [...], "reason": "..."}`, **no markdown fences** (parser strips them anyway).

## 7. Convex backend

### `convex/conditionData.ts` (V8 queries/mutations, all `requireUser`)
- `getParcelInternal(prclid)` — internalQuery: the spine row's situs address fields (mirrors `equityData.getParcelInternal`). The action re-reads the address here (doesn't trust a client-passed address — same as `equityActions`).
- `storeCondition({prclid, ...})` — internalMutation: upsert `parcelCondition` by `prclid` (insert or patch), `updatedAt: now`. Written only by the action.
- `conditionForPrclids({prclids})` — query: the `parcelCondition` rows for those prclids, each with a resolved `imageUrl` via `ctx.storage.getUrl(imageStorageId)`, so the page shows the stored image.

The "top 15 leads" list is **not** a new query — the page reads the existing `signalData.leads({limit:15})` directly (read-only reuse; that query already returns each lead's `prclid` + situs address + owner + score sorted best-first). No edit to `signalData.ts`.

### `convex/conditionActions.ts` (`"use node"`, mirrors `equityActions.ts`)
- `scoreCondition({prclid})` — `action`, auth-gated (`internal.users.getCallerInternal`; throw `ConvexError UNAUTHENTICATED` if absent), returns `{status:"ok"|"no_imagery"|"error", score, flags, error?}`. Steps = §4 flow. Keys: `GOOGLE_GEOCODING_API_KEY` (Street View) + `OPENROUTER_API_KEY` (vision); throw a clear error if either is unset. Every external `fetch` carries `AbortSignal.timeout(30_000)`. The OpenRouter call mirrors `legalNotices.extractLegalListings` exactly, except the user message carries an image part:
  ```ts
  messages: [
    { role: "system", content: CONDITION_SYSTEM_PROMPT },
    { role: "user", content: [
      { type: "text", text: buildConditionPrompt() },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
    ]},
  ], temperature: 0, max_tokens: 600,
  ```
  Image sent as **base64** (the Maps key is in the Street View URL — base64 keeps it server-side; never hand the keyed URL to the browser or to OpenRouter).
- No `internalAction` worker, no batch (per-lead only). No cron.

**Coverage check** uses the Street View **metadata** REST endpoint (`maps/api/streetview/metadata?location=<address>&key=…` → `{status:"OK"|"ZERO_RESULTS"}`), which is free and quota-exempt — so a no-coverage address records `hasImagery:false` without spending a vision call. (The client-side `StreetViewService.getPanorama` used in `StreetViewModal.tsx` is unavailable in a Node action; the REST metadata endpoint is its server-side equivalent.)

## 8. Frontend — `src/web/ConditionTest.tsx` + `/condition` route + nav item

- New route in `app.tsx`; nav item "Condition" in `app-shared.tsx`/sidebar (role-gated like the others). lucide icons only, never emojis.
- Page lists the **top 15 leads** (read-only `signalData.leads({limit:15})`), each a card/row: address · owner · current lead score · a **"Score condition"** button.
- On click → `scoreCondition` action (busy state, branded errors via `describeError`/`ConfirmDialog` patterns already in the app). When done (reactive `conditionForPrclids`), the row shows: the **stored Street View image**, the **0–100 score** (color-banded), the **flags** as chips, the **reason**, the **model id**, and the **scoredAt** time. `hasImagery:false` → "No Street View coverage"; `lastError` → shown inline (never silent).
- A short, persistent **disclaimer**: "Condition scores are an estimate from a single, possibly-stale Street View photo — for triage only, not ground truth."
- Reuses the dark Industrial-Precision theme + shadcn components already in the app.

## 9. Security / correctness

- Both browser-callable Convex fns gate `requireUser`; the action re-checks the caller via `getCallerInternal` (same as `equityActions.enrichEquity`). The page is in the authed shell.
- API keys (`GOOGLE_GEOCODING_API_KEY`, `OPENROUTER_API_KEY`) read from Convex env, never sent to the browser. The Street View image is fetched server-side and re-served from Convex `_storage` (the keyed URL never reaches the client).
- Errors surfaced as `ConvexError` where user-facing; transient/external failures recorded in `lastError`, never a white screen (existing `ErrorBoundary`/`describeError`).
- Funnel-only by construction: the only entry point is a per-lead button over the 15 displayed leads.

## 10. Testing (TDD, pure logic offline)

`tests/conditionScore.test.ts`:
- `parseConditionResponse`: clean JSON; fenced ```json; extra prose around JSON; out-of-range score → clamped; unknown/garbage flags → dropped; missing reason → ""; unrecoverable input → throws.
- `buildConditionPrompt` / `CONDITION_SYSTEM_PROMPT`: contain the rubric anchors + the closed flag vocabulary + the JSON contract.
- `buildStreetViewImageUrl` / `buildStreetViewMetadataUrl`: correct host/path/params, address URL-encoded, key present, `source=outdoor`.
- `CONDITION_MODEL` default + env override.

Live verification (after merge, dev): one `scoreCondition` on a real lead with known Street View coverage → image stored + a sane score/flags; one address with no coverage → `hasImagery:false`. The build stays green; existing test count only grows.

## 11. Build process & branch

- Branch `feat/p7-vision-condition` off `main`. Built via **Opus 4.8 subagents** (standing directive), TDD, per-task spec+quality review, then `finishing-a-development-branch`.
- **Merge hazard:** this adds `parcelCondition` to `schema.ts`. P5 (`feat/p5-contacts-skiptrace`) is also unmerged. Whichever merges after the first **regenerates `convex/_generated` against the merged tree + `npm run build`** — never hand-merge `api.*`. Reconcile the divergent memory docs at merge.

## 12. Future (after evaluation — separate spec)

Once the score proves reliable on this page, wire it into `/leads`: emit a `type:"condition", category:"physical"` `signalEvents` row keyed to `prclid` (so it stacks in the existing recency×stack scoring and shows in the signal timeline) and/or add a `conditionMultiplier` bucket to `SCORE_CONFIG` (mirroring the equity multiplier, `unknown ×1.0`). Optional later: aerial/roof imagery; capped staggered batch; upgrade to enterprise CV (Cape Analytics/Nearmap) if volume/accuracy demand.

---

## Appendix A — Vision model research (2026-06-21, via firecrawl + web search)

Workload modeled: 1× ~640×640 Street View JPEG + ~300-token prompt → ~150-token JSON out, on-demand, low volume, via OpenRouter.

| Model (OpenRouter slug) | Real-world-scene vision | $/1k houses | Notes |
|---|---|---|---|
| **Gemini 2.5 Flash** `google/gemini-2.5-flash` ⭐ | A-tier; best calibration + instruction-following (MMMU 79.7) | ~$0.45 | Default. Native, well-tested image→JSON. |
| GLM-4.6V `z-ai/glm-4.6v` | S-tier scene benchmarks (MMStar ~75, RealWorldQA ~75.7) | ~$0.20–0.53 | The real GLM vision model (Dec 2025). A/B alt. |
| Qwen3-VL-32B `qwen/qwen3-vl-32b-instruct` | S-tier scene benchmarks (RealWorldQA ~79) | ~$0.20 | A/B alt. |
| Gemini 2.5 Flash-Lite `google/gemini-2.5-flash-lite` | B/C-tier (MMMU 72.9) — measurable step down | ~$0.17 | Cheapest; only if cost ever matters. |
| Claude Haiku 4.5 `anthropic/claude-haiku-4.5` | lowest perception of the modern set (MMMU 73.2) | ~$1.40 | Reliable/low-hallucination but priciest. |
| ~~GLM "5.2"~~ `z-ai/glm-5.2` | **text-only — cannot see images** | n/a | The user's named model; wrong one. Use GLM-4.6V. |
| ~~DeepSeek V4~~ | **text-only — no vision** | n/a | No usable DeepSeek vision model exists today. |

OpenRouter bills images as input tokens (no per-request surcharge; ~5.5% credit-purchase fee). All options are trivially cheap at this volume → choose on reliability. Cheap-VLM failure modes to mitigate in the prompt: hallucinated damage, mid-score compression, shadow/glare misreads, run-to-run variance.

Sources (accessed 2026-06-21): ai.google.dev/gemini-api/docs/pricing; platform.claude.com/docs (pricing + vision); openrouter.ai/models (slugs/pricing); blog.google (Gemini 3 Flash); arxiv 2511.21631 (Qwen3-VL); venturebeat/marktechpost + github.com/zai-org/GLM-V (GLM-4.6V); api-docs.deepseek.com (DeepSeek V4 text-only); llm-stats.com RealWorldQA leaderboard.
