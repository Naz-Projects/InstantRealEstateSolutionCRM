# Plan: Monitor Deep-Analysis Layer (A: flipper math · B: analyst breakdown) — 2026-07-04

**Spec inputs (binding):** `docs/superpowers/research/2026-07-04-flipper-criteria.md` (the checklist/lexicon/playbook — §ref'd below) + `docs/superpowers/research/2026-07-04-zillow-vs-redfin.md` (Layer C, NOT this build). User decisions: build A+B now; apply the NCC transfer-tax correction (monitor math only); vision deferred; Redfin (C) is a separate follow-up.

## Global constraints
- Deterministic math decides keeps/scores; the LLM judge annotates/analyzes and may only ever SUPPRESS (existing renovated-veto rule stands). The new breakdown is ANALYST OUTPUT — it never changes `keeper`.
- Strictly additive to non-monitor features. `src/scraper/flip.ts` + the `/flip` page must be BEHAVIORALLY UNTOUCHED (the transfer-tax correction applies only via the assumptions the monitor passes).
- All new listing fields optional in schema (`monitorListings`) — old rows must stay valid.
- Pure logic in `src/scraper/` with TDD; Convex split rules; explicit-path commits; worktree `feat/monitor-web-zillow`; revert `_generated` churn; anonymous codegen only.
- Lexicons/thresholds come from the research doc — implement as data (exported consts) so they're tunable, with research-doc §refs in comments.

## Task 1: Pure derived-metrics module — `dealSignals` (flipper math)
**File:** new `src/scraper/dealSignals.ts` + `tests/dealSignals.test.ts` (TDD).
Export `deriveDealSignals(input) : DealSignals` where input = `{ listPrice, sqft, priceHistory: {date,event,price,ppsf}[], lastSoldPrice, dateSold, daysOnZillow, yearBuilt, photoCount, compsPpsf, now: number }` (caller passes `now` — no Date.now() inside; testable).
Computed per research §3 (thresholds as exported `SIGNAL_CONFIG` const):
- `cutDepthPct` (orig list from earliest listed-price event vs current), `cutCount` (downward PriceChange events), `cutVelocity` (cuts/30d), `largeLateCut` (largest cut ≥5% after day 90), thresholds/points per §3 rows 1–4.
- `domDays` + `domBucket` (fresh <14 / normal / aging 30–60 / stale 60–90 / outlier 90+ — absolute backstops; area-median DOM is a later refinement).
- `tenureYears` (now − dateSold), `tenureSignal` ("long_tenure_equity" >15y / "recent_purchase_flag" <2y / null).
- `listToLastSoldRatio` + `vsAppreciation` (expected = lastSoldPrice × 1.03^tenureYears; flags "priced_below_appreciation", "underwater" <1.0, "thin_margin_resale" when <2y tenure and ratio <1.25).
- `backOnMarket` (any Pending/ContingentToActive pattern in events — detect from event names tolerant: /pending|contingent/i followed by /listed|active|price/i later), `relisted` (Listed event after a Sold/Removed gap).
- `photoSignal` ("sparse_photos" ≤8 / "retail_staging" ≥35 / null).
- `ppsfDiscountPct` (1 − subjectPpsf/compsPpsf, null-safe) — the §1.1 headline screen.
- `eraHazards: string[]` from yearBuilt (§4 table, year-only confidence): `lead_paint_pre1978`, `asbestos_era_pre1980`, `knob_tube_era_pre1940`, `aluminum_wiring_era_1965_75`, `polybutylene_era_1978_95`, `oil_tank_risk_pre1975` (verify-gate wording).
- `zipTier` from a `NCC_ZIP_TIERS` const (§1.12: 19801/02/05/06 city-high-risk · 19702/11/13/01/20/03 + Elsmere suburb-standard · 19709/19707/19808 suburb-premium; unknown → null).
- `motivationPoints` composite (sum per §3, cap 10) + `motivationSignals: string[]` (human-readable, e.g. "3 price cuts (-12%)", "22-yr owner", "back on market").
Tests: real-shaped fixtures for each metric + composite; edge cases (empty history, null lastSold, single event, zero sqft).

## Task 2: NCC transfer-tax correction — monitor flip math only
**Files:** `src/scraper/monitorListings.ts` (+tests). Read `src/scraper/flip.ts` first: `analyzeFlip` (monitorListings.ts:119) passes `FLIP_DEFAULTS.assumptions` into `computeFlip`. Build a monitor-local `MONITOR_FLIP_ASSUMPTIONS` derived from `FLIP_DEFAULTS.assumptions` with DE/NCC transfer tax added: +2% of purchase on the buy side and +2% of ARV on the sell side, mapped onto whichever existing assumption knobs `computeFlip` supports (likely closingPct/sellingPct — verify against flip.ts's actual shape and document the mapping in a comment with research §1.15 ref). `analyzeFlip` uses the new const. **`flip.ts` and `FLIP_DEFAULTS` themselves unchanged** (the /flip page keeps its generic math). Tests: an ARV/list/rehab fixture where the corrected math produces a LOWER MAO than the old assumptions (assert both old-vs-new relationship and an exact new value); existing tests updated only where they asserted monitor-flip numbers.

## Task 3: Schema + deep-analysis judge upgrade
**Files:** `convex/schema.ts` (optional fields on `monitorListings`), `convex/monitorData.ts` (`analysisFields` additions), `src/scraper/monitorListings.ts` (judge prompt/parse), `convex/monitorActions.ts` (wiring), tests.
- New optional fields: `motivationPoints` (number), `motivationSignals` (string[]), `conditionTier` (string: cosmetic|moderate|systems|structural), `valueAddScope` (string ≤300), `redFlags` (string[]), `verifyGates` (string[]), `exitTriage` (string: FLIP|WHOLETAIL|RENTAL|WHOLESALE|PASS), `exitFallbacks` (string[]), `breakdown` (string ≤900 — the analyst narrative), `ppsfDiscountPct` (number), `tenureYears` (number), `eraHazards` (string[]), `zipTier` (string).
- `buildJudgePrompt` v2: inputs now include the Task-1 `DealSignals` summary, priceHistory events (compact), lastSold/tenure, yearBuilt + eraHazards, zipTier, ppsfDiscountPct, DOM, photoCount, plus existing math. Prompt embeds the RUBRIC (condensed from research §2's lexicon tiers + §5 triage rules + the euphemism decoder) and demands strict JSON: `{keep, matchedRequirements[], renovated, conditionTier, valueAddScope, redFlags[], verifyGates[], exitTriage, exitFallbacks[], breakdown, confidence}`. Explicit instruction: numbers are GIVEN — never recompute; exitTriage per §5 routing (wholetail = livable/financeable-as-is + meaningful spread).
- `parseJudgeResponse` v2: tolerant; closed vocab for conditionTier/exitTriage; length-clamp strings; arrays filtered to strings; missing → nulls (never fabricate). Keep/renovated semantics unchanged.
- `analyzeOne`: compute `deriveDealSignals` (step ~6.5, after facts+comps), pass to judge, patch all new fields (deterministic ones ALWAYS stored even if judge fails: motivationPoints/signals, ppsfDiscountPct, tenureYears, eraHazards, zipTier). `keeper`/`decideKeeper`/`scoreDeal` semantics UNCHANGED (exitTriage is display-layer). Land guard unchanged (skips all of it).
- DeepSeek max_tokens: raise to fit the breakdown (~900) — set 1200.

## Task 4: /monitor card Details — the breakdown section
**File:** `src/web/MonitorPage.tsx` only. In the expanded Details area add an "Analyst breakdown" block (dark-theme, lucide icons only): motivation points + signals chips · condition tier + value-add scope · price-history line (cuts/tenure/ppsf discount) · era-hazard + zip-tier chips · red flags (red) and VERIFY-before-bid checklist (amber, distinct) · exitTriage badge with fallbacks ("Analyst: WHOLETAIL → fallback RENTAL") clearly labeled as the analyst's read vs the deterministic score badge · breakdown narrative. Null-safe throughout (old rows render as today). No changes to card grid/actions/tabs.

## Task 5: Email — analyst essentials
**File:** `convex/monitorActions.ts` presentation helpers only. Per keeper card add (when present): one compact "history" line (e.g. "3 cuts −12% · 22-yr owner · $/sqft 28% under comps"), the exitTriage note when it differs from bestExit ("Analyst: wholetail candidate"), and up to 2 red flags as chips. Keep the R2 design language; plaintext mirrored; null-safe; no layout rework.

## Acceptance (controller, post-deploy)
Re-run `analyzeOne` on 3 diverse live rows (a distressed keeper, a renovated RENTAL keeper, a below-market PASS) → verify new fields populate, breakdown reads investor-grade, keeper/bestExit unchanged by the upgrade; card Details + digest render; then a fresh digest send.
