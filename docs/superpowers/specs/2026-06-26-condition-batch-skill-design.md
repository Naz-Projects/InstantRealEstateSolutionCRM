# Vision Condition Scoring v2 — Claude-driven batch skill (Chrome + Street View)

**Date:** 2026-06-26
**Status:** Design approved (brainstorming) → pending spec review → plan
**Supersedes nothing** — strictly additive to P7 v1 (`/condition`, `parcelCondition`, the Gemini button all stay).
**Prior art:** `docs/superpowers/specs/2026-06-21-vision-condition-scoring-design.md` (v1, the live Gemini-per-click page).
**As-built (2026-06-27):** two refinements landed during implementation — (1) the page reuses the existing `leads` + `conditionForPrclids` queries (top-100, sorted by condition score) instead of a separate `scoredConditions` query; (2) the image transport is the Convex **upload-URL flow** (`conditionData.generateConditionUploadUrl` → POST bytes → `conditionData.recordConditionScore`, which runs the model JSON through the canonical `parseConditionResponse` sanitizer) — NOT the base64 `storeConditionBatch` action sketched in §7 (base64 can't fit a Windows CLI arg). References to `storeConditionBatch`/`scoredConditions` below are superseded.

## 1. Problem & goal

P7 v1 scores a lead's exterior condition by calling **Gemini 2.5 Flash** (OpenRouter) per click. That works, but
every score is a paid API call — at hundreds-to-thousands of houses that cost compounds. The user already pays for
**Claude**, and Claude Code can read images visually (the `Read` tool) and drive a real browser (claude-in-chrome).

**Goal:** an on-demand **skill** the user runs ~monthly that scores the **top 100 leads** by looking at each house in
**Google Maps Street View** (via the user's logged-in **Chrome**) and writes a careful, auditable condition
assessment into the existing `parcelCondition` table — **no marginal LLM API cost** (runs on the Claude subscription).
The `/condition` page becomes the read-out: all scored leads, worst-distress first.

**Non-negotiable per the user:** *do not give false information.* Scoring must be conservative, evidence-grounded,
and honest about uncertainty. The system must be **reliable, auditable, and easy to keep improving**.

## 2. Scope (locked in brainstorming)

| Decision | Choice |
|---|---|
| How many per run | **Top 100 leads by lead score** (re-scored fresh each run; count is a skill arg, default 100) |
| Image source | **Claude drives Chrome → Google Maps Street View** (not the Street View Static API) |
| Results view | `/condition` shows **all scored leads, sorted by condition-distress score (worst first)** |
| Existing Gemini button | **Kept** as an ad-hoc single-house fallback; both paths write the same table |
| Trigger | **Manual** skill invocation ("score conditions"). Scheduling is a future add-on, not built now. |
| Scoring engine | **Claude** (this session + per-house scoring subagents), detailed rubric, no API spend |

**Out of scope (YAGNI / future):** auto-scheduling/cron; `/leads` score integration (the page stays isolated for
accuracy evaluation); aerial/roof imagery; human-override UI; ML calibration; replacing the Street View Static API
path (it remains behind the Gemini button).

## 3. Architecture

Five units, each with one job:

1. **Pure scoring core** — `src/scraper/conditionScore.ts` (extended). Owns the canonical rubric text, the closed
   flag vocabulary, a `RUBRIC_VERSION` constant, and a tolerant parser that now also extracts `description` +
   `confidence`. No network, no Convex — unit-tested. Single source of truth for "how we score," so tuning the rubric
   is a one-file change.
2. **Data layer** — `parcelCondition` schema (+ 3 additive fields) and `convex/conditionData.ts` (a new internal
   query for the lead list, a write path for the skill, and a page query). V8 only.
3. **Write action** — `convex/conditionActions.ts` (extended). A new `internalAction` the skill calls via the CLI:
   image bytes → Convex `_storage` → upsert the row. `"use node"`.
4. **The skill** — a project skill (`condition-batch`) that orchestrates the run: fetch leads → drive Chrome →
   screenshot → score (subagent) → write → resume/summary. **This is the main deliverable.**
5. **Frontend** — `src/web/ConditionTest.tsx` expanded to the worst-first list of all scored leads.

### Data flow (one run)

```
skill invoked ("score conditions" [count])
  └─ npx convex run conditionData:topLeadsForScoring {count}  → [{prclid, address, leadScore}, …]   (internal; CLI-auth via deploy key)
  └─ for each lead, SERIAL (one Chrome):
       1. Chrome → Google Maps Street View for `address`
       2. screenshot front-of-house → scratchpad/<prclid>.jpg
       3. score the screenshot against the rubric → {description, flags, score, confidence}   (per-house subagent, or inline)
       4. npx convex run conditionActions:storeConditionBatch {prclid, score, flags, description, confidence, rubricVersion, model, imageBase64}
            → store image in _storage, upsert parcelCondition (model = "claude-opus-4-8 (chrome)")
       5. mark prclid done (resume log)
  └─ summary: scored / no-coverage / low-confidence / distressed(≥threshold)
/condition page  → conditionData:scoredConditions  → all rows, sorted by score desc, with image+flags+description+confidence
```

## 4. Reliability & accuracy (the heart of this design)

Because the user must not get false information, accuracy is engineered, not assumed:

- **Describe-then-score chain.** The rubric forces the scorer to FIRST describe what is visibly present, THEN assign
  flags only for items it explicitly described, THEN a 0–100 score justified by that description. Grounding the score
  in a written description (which we store) makes every score auditable and suppresses invented damage.
- **Conservative by construction.** "Score only what is clearly visible. If the view is obstructed, shadowed, the
  wrong building, under construction, or not a house — score LOW and say so. Shadows, parked cars, wet pavement, and
  seasonal bare trees are NOT distress." Mirrors v1's rules, stricter.
- **Explicit confidence.** Each result carries `confidence` (low|medium|high). Low-confidence rows are surfaced on the
  page (and counted in the summary) so a human reviews them instead of trusting a guess. This is the core
  "no false info" lever.
- **Wrong-house / no-coverage handling.** If Street View has no coverage, or the visible address/house clearly isn't
  the target, the house is recorded as `hasImagery:false` or `confidence:low` with a reason — never silently scored.
- **Audit trail.** Every row stores the exact **screenshot scored** (`_storage`), the **raw model output**
  (`rawResponse`), the **description**, the **rubricVersion**, and the **model** string. Anyone can later open the
  image next to the score and verify it.
- **Idempotent & resumable.** Upsert keyed on `prclid`; a per-run resume log lets a CAPTCHA/interruption continue
  without rescoring done houses. A run never leaves partial/duplicate rows.
- **Right-house confidence from Chrome.** Navigate via an address-precise Maps URL and capture the address banner;
  if it doesn't match the target, drop confidence. (Chrome on the user's logged-in profile minimizes CAPTCHA; the
  skill paces requests and pauses on friction.)

## 5. Supportability (built to keep improving)

- **`RUBRIC_VERSION`** stored per row. When we sharpen the rubric, bump the version; stale-version rows are easy to
  find and re-score. Continual improvement without ambiguity about which logic produced a score.
- **One canonical rubric** in `conditionScore.ts`; the skill references it rather than duplicating, so edits don't drift.
- **`model` records the scorer** (`"claude-opus-4-8 (chrome)"` vs `"google/gemini-2.5-flash"`), so the table always
  shows which engine produced each row.
- **Configurable selection** — the skill takes a `count` (default 100); easy to widen later or add a min-lead-score.
- **Clean seams for the roadmap** — swapping Chrome↔Street View API, adding flags, or adding aerial/roof imagery are
  localized changes (image-acquisition step, flag vocab, rubric) and don't ripple.
- **Calibration loop** — the page shows image+score+description+confidence side by side, so the user can eyeball
  accuracy and we tune the rubric from real misses (the stated "improve as we go" workflow).

## 6. Schema changes (additive)

`parcelCondition` gains three optional fields (existing rows still validate):
- `description: v.optional(v.string())` — the scorer's written, evidence-grounded narrative.
- `confidence: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high")))`.
- `rubricVersion: v.optional(v.number())` — which rubric produced this row.

No index changes. `score`, `flags`, `reason`, `model`, `imageStorageId`, `hasImagery`, `rawResponse`, `scoredAt`,
`lastError` are unchanged.

## 7. Backend additions

- `conditionData.topLeadsForScoring` (**internalQuery**, args `{count}`): the existing derived-leads logic, capped to
  the top `count` by lead score, returning `{prclid, address, leadScore}`. Internal so the CLI-run skill can fetch it
  (the public `leads` query is auth-gated and rejects the CLI).
- `conditionActions.storeConditionBatch` (**internalAction**, `"use node"`): args = prclid, score, flags,
  description, confidence, rubricVersion, model, and the screenshot as base64. Decodes → `ctx.storage.store` →
  upsert `parcelCondition` (reuse/extend `storeCondition`). **Open implementation detail (resolve in the plan):** the
  base64→action transport (inline CLI arg vs temp-file vs a generated upload URL) — pick the one that handles a
  ~640×640 JPEG (~100–160 KB base64) reliably on Windows.
- `conditionData.scoredConditions` (**query**, auth-gated, for the page): returns every `parcelCondition` row that has
  a score, joined to parcel facts (address, owner) + lead score, **sorted by `score` desc**, each with a resolved
  `_storage` image URL.

## 8. The skill (`condition-batch`) — main deliverable

A project skill the user invokes ("score conditions"). Contents:
- **Trigger & args:** default top 100; optional `count`.
- **The detailed rubric** (describe-then-score, the closed flag set, the conservative rules, confidence guidance) —
  the "very detailed" scoring instructions the user asked for, kept in sync with `conditionScore.ts`.
- **Chrome recipe:** how to open Street View for an address, confirm the right house, screenshot the front, detect
  no-coverage, and handle CAPTCHA/consent (pause & resume).
- **Serial loop with resume log** (skip prclids already written this run).
- **Per-house scoring** (subagent reads the screenshot file + rubric → JSON; falls back to inline if subagents can't
  reach the browser/file — confirmed in the plan).
- **Write step** (call `storeConditionBatch` via CLI with the prod deploy key).
- **Summary report** at the end.

## 9. Frontend

`src/web/ConditionTest.tsx`: replace the top-15 lead list with the `scoredConditions` list — **all scored leads,
worst-distress first** — each card showing the screenshot, the 0–100 score (colored), the flags, the **description**,
the **confidence** (with low-confidence visually flagged for review), the model, and scoredAt. The per-lead Gemini
"Score condition" button stays for ad-hoc single rescoring.

## 10. Testing & verification

- **Unit (pure):** extend `tests/conditionScore.test.ts` — parse `description` + `confidence`, clamp/round score,
  filter unknown flags, `RUBRIC_VERSION` present, tolerant of missing fields. Keep the existing 218 green.
- **Backend:** `npx convex dev --once` validates + regenerates `_generated`; `npm run build` clean.
- **Live smoke:** run the skill on **5–10 houses** first — verify right-house capture, sensible scores vs. eyeballing
  the image, rows written with image+description+confidence, the page renders worst-first — BEFORE a full 100.
- **Accuracy review:** the user spot-checks the page; misses feed a rubric tweak (bump `RUBRIC_VERSION`).

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Google CAPTCHA / bot friction mid-batch | Logged-in real Chrome profile; paced requests; pause + resume log |
| Wrong house captured | Address-precise navigation + verify the on-screen address; low confidence if mismatch |
| Hallucinated damage (false info) | Describe-then-score, conservative rules, confidence gating, stored image+rawResponse audit |
| Subscription usage limits over 100 vision passes | Resumable + chunkable (count arg); can run in waves |
| Street View stale/missing | Record imagery date when available; `hasImagery:false` on no coverage; never guess |
| base64 image transport on Windows CLI | Resolved in the plan (temp-file or upload-URL if inline arg is too large) |

## 12. Build flow

brainstorm (done) → this spec → **writing-plans** → subagent-driven TDD (per the standing directive: all
implementation via Opus 4.8 subagents) → finish-branch. Branch off `main`: `feat/condition-batch-skill`. Additive;
the schema add means the merge regenerates `convex/_generated` against the merged tree + `npm run build`.
