# Monitor Phase 1+2 — Deal Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nightly "Monitor the Web" deal finder surface only real deals (fresh pages, hard keeper floors, no fake ARVs) and make its numbers trustworthy (distance/type comps, as-is vs after-repair value, LLM-aware rehab, real rent/tax/DSCR).

**Architecture:** All decision math lives in pure, unit-tested functions in `src/scraper/monitorListings.ts` (plus one new parser in `src/scraper/comps.ts`). One function, `evaluateDeal`, is the only place keep/exit is decided; `analyzeOne` (Convex action), the new `regateKeepers` mutation and the backtest script all call it, with `dealInputFromStored` adapting stored rows. Convex files stay thin wiring.

**Tech Stack:** TypeScript, Convex (actions/mutations, schema), Vitest, Firecrawl REST v2, tsx.

**Spec:** the user-approved spec is the orchestrator brief for this plan (evidence: prod backtest of 1,225 rows), summarized in `memory/todo.md` section "Monitor critique 2026-10-03"; domain thresholds come from `docs/superpowers/research/2026-07-04-flipper-criteria.md`. Spec items are referenced below as S1..S13.

## Global Constraints

- Work ONLY in the worktree `C:\Users\nazho\Desktop\ires-crm\.claude\worktrees\monitor-critique`; run `git branch --show-current` before every commit and confirm `feat/monitor-critique`. Never touch the main checkout.
- Pure logic stays in `src/scraper/*.ts` with vitest tests written first (TDD); Convex files (`convex/*.ts`) stay thin. Match existing style (terse one-line math, `as const` MONITOR, comments that cite the research doc).
- Every new tunable number goes in the `MONITOR` constant in `src/scraper/monitorListings.ts`.
- FLIP keeper floor: projected flip profit >= $25,000 AND margin >= 12% (computed at list price).
- RENTAL keeper floor: cap rate >= 6% AND monthly cash flow >= 0; from Task 10 also DSCR >= 1.2.
- Below-market: when a Zestimate exists, list <= 0.85 x Zestimate; when none exists, the comps-value spread test (same 15% threshold).
- The distress-OR keep path is deleted; "distressed"/foreclosure are labels only. The LLM never decides keeping. LLM inputs may only make the economics WORSE (renovated veto removes a flip; conditionTier can only raise rehab scope).
- Do NOT change the shared helpers `selectComps`, `suggestArv`, `parseRedfinComps` or `REHAB_TIERS` (used by the Flip Analyzer, compsActions, equityActions). The `estimateRehab` sqft > 0 guard (Task 4) is the one intended global fix.
- Do not remove `convex/http.ts`'s webhook route or `createFirecrawlMonitor` (the remote monitor deletion is an orchestrator ops step).
- Convex codegen/validation ONLY via the isolated local backend, PowerShell: `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`. Never plain `npx convex dev` / `npx convex codegen` (they push to the shared deployment). Commit any resulting `convex/_generated/*` changes in the same task. On a FRESH anonymous backend the push fails with "CLERK_JWT_ISSUER_DOMAIN ... not set"; set a dummy once: `$env:CONVEX_AGENT_MODE='anonymous'; npx convex env set CLERK_JWT_ISSUER_DOMAIN https://example.clerk.accounts.dev` (verified 2026-10-04: the final-state schema + functions then push clean).
- Every task ends green on all three: `npx vitest run`, `npx tsc --noEmit` (src/scripts/tests), `npx tsc --noEmit -p convex` (Convex functions). Baseline before Task 1: 396 tests pass, both typechecks clean.
- No emojis anywhere (code, comments, commit messages, flags).
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
  ```
- Edit files with the editor tool, not shell heredocs/sed: regex literals in this plan contain backslashes that shell quoting silently mangles.

## Review Focus

1. **Redfin gis embed missing/changed, or the pre-deploy `zipComps` cache (12h TTL) holding untyped markdown comps** — selection must degrade to the old ZIP-wide behavior, never crash or mix types. Pinned by Task 7 "[] when the embed is missing" and Task 8 "legacy untyped comps pass type + distance unfiltered".
2. **Subject listing without lat/lng (search card lacked `latLong`)** — expect the same-type ZIP pool, nearest-first ordering skipped. Pinned by Task 8 "subject without coordinates".
3. **Lease regex reading a year, a hypothetical rent, or an annual total as a lease** — a wrong "LEASED at $X" flag misleads even though min() keeps the number safe. Pinned by Task 10 "ignores years, hypothetical rent, annual totals".
4. **Old prod rows in the re-gate: sqft 0 with a median-soldPrice ARV, `rehabEstimate` 0, fireplace rows stored as `gut`, no stored tax rate** — expect ARV = Zestimate/null, rehab unknown, tier re-derived, 1.6% tax flagged. Pinned by Task 6 "old sqft-0 row", Task 9 "re-derives the keyword tier", Task 11 `taxEstimated` count. NOTE for the operator: because old rows never stored a tax rate, the Phase-2 re-gate underwrites them at 1.6% (about 2.4x the 0.68% Zillow shows for NCC), so it is HARSHER on rentals than a fresh analysis would be; the backtest reports how many rows hit this.
5. **`MONITOR_SCAN_ENABLED` set to "false"/"off" on a deployment** — the literal spec disables only on exactly "0"; anything else stays enabled. Pinned by Task 2 "enabled when unset/empty/anything but 0".

## Resolved spec ambiguities (decisions this plan makes)

- **Firecrawl param:** verified at docs.firecrawl.dev: v2 `/scrape` takes `maxAge` in ms; default 172800000 (2 days); `0` always scrapes fresh. First attempt `3_600_000`, every retry `0`.
- **WHOLESALE label:** no current code emits WHOLESALE. A keeper that clears neither floor but is below market is labeled `WHOLESALE` (research §5 wholesale fallback; the UI already styles it); otherwise `PASS`. It changes neither keeping nor the digest (digest = FLIP/RENTAL only).
- **MAO:** there is no existing MAO keep gate; `flipMao`/`roomVsList` stay display-only. Flip profit/margin are at list price.
- **Unknown rehab (sqft null/0):** both flip AND rental underwriting are skipped (rental with $0 rehab would just move the bug).
- **Comps type data:** Redfin markdown rows carry no coordinates or type, but the same scrape's rawHtml embeds Redfin's stingray `gis` payload (verified live 2026-10-04 on ZIP 19805: 266 homes, all with `latLong`, `propertyType` 6=single-family / 13=townhouse / 4=multi-family / 8=land, `soldDate` epoch or a sash `lastSaleDate`; 163 of the 237 usable comps were townhouses). New parser uses it; markdown stays as fallback. No extra Firecrawl credits (rawHtml was already requested).
- **Thin comps:** fewer than 3 same-type comps after ring expansion means Zestimate (or null + VERIFY), never a cross-type pool (08-08 lesson). Typed comps + unknown subject type -> no comps.
- **1.15 x Zestimate cap:** KEPT, on ARV only. Zestimate approximates as-is value; research §1.1 puts the renovated premium at ~$25-35/sqft (about 10-20% on NCC stock), so 1.15x is a sane uplift ceiling that still catches size/type-skewed pools. `asIsValue` is not capped: with a Zestimate present the spread uses the Zestimate itself.
- **LLM conditionTier ordering:** the judge runs after the preliminary math (it needs the numbers), so `analyzeOne` re-runs rehab + `evaluateDeal` after the judge. The judge's GIVEN numbers are the preliminary (keyword-tier) ones; documented in code.
- **Property tax:** the Zillow detail cache has no tax history/bill (checked a live listing); it has `propertyTaxRate` (percent, e.g. 0.68). Use it, else 1.6% flagged "tax rate estimated".
- **BRRRR:** `brrrrCashLeftIn = all-in (list + rehab) - 0.75 x ARV`, stored when both a rental and an ARV exist; display/analysis only, not a gate.
- **Era add-ons:** lead paint pre-1978 +$3,000 (research §4 stabilize range $500-3K); pre-1950 rewire +$15,000 (research $12-25K), skipped for a gut (a gut includes it). Gut hold 9 months (vs 6).
- **flipScore/rentScore (S13):** stored from Task 3 (cheap, same task that introduces them).
- **Re-gate scope:** active (non-archived) keepers only; de-keep, never promote; refreshes decision fields on survivors. It uses stored fields only: ARV/asIs stay as stored (comps are not re-fetched); rehab, lease rent and tax are recomputed from stored description/conditionTier/yearBuilt/propertyTaxRatePct. Newly analyzed rows get the full new math.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/scraper/monitorListings.ts` | MONITOR constants; `cronScanEnabled`; valuation (`conservativeArv` v2, `selectMonitorComps`, `subjectCompType`, `distanceMi`); rehab (`monitorRehab`); exits (`analyzeFlip`, `analyzeRental`, `parseLeaseRent`, `rentForListing`); the decision (`scoreDeal`, `meetsFlipFloor`, `meetsRentalFloor`, `evaluateDeal`); re-gate adapter (`dealInputFromStored`, `decisionFields`); `isDigestWorthy`; `riskFlags`; `detailFromCache` | 1-6, 8-10 |
| `src/scraper/comps.ts` | `Comp` gains optional `lat/lng/propertyType/soldAt`; new `parseRedfinGisComps` | 7 |
| `src/scraper/flip.ts` | `estimateRehab` sqft > 0 guard | 4 |
| `convex/monitorScrape.ts` | `maxAge` per attempt; `scrapeRedfinSold` returns rawHtml + markdown | 1, 7 |
| `convex/monitorActions.ts` | cron off-switch; `analyzeOne` wiring; `compsForZip` prefers gis | 2-4, 7-10 |
| `convex/monitorData.ts` | `patchAnalysis` `clearRental`; new fields in `analysisFields`; digest filter in `keepersToEmail`; new `regateKeepers` mutation | 3, 5, 6, 8-10 |
| `convex/schema.ts` | optional `flipScore`, `rentScore`, `asIsValue`, `dscr`, `brrrrCashLeftIn`, `leaseRent`, `propertyTaxRatePct` | 3, 8, 10 |
| `scripts/monitor-backtest.ts` | old-vs-new keep-rate/exit-mix report over a jsonl export | 11 |
| tests: `tests/monitorScrape.test.ts` (new), `tests/redfinGis.test.ts` (new), `tests/monitorComps.test.ts` (new), `tests/monitorRental.test.ts` (new), `tests/monitorBacktest.test.ts` (new), `tests/monitorListings.test.ts`, `tests/flip.test.ts` | | all |

Task order: Phase 1 = Tasks 1-6 (shippable alone), Phase 2 = Tasks 7-10, then Task 11.

---

### Task 1: Firecrawl freshness (`maxAge`) — S1

**Files:**
- Modify: `src/scraper/monitorListings.ts:1-7` (MONITOR)
- Modify: `convex/monitorScrape.ts` (import, `firecrawlV2Scrape`, both retry loops)
- Test: `tests/monitorScrape.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MONITOR.scrapeMaxAgeMs: number` (3_600_000). `firecrawlV2Scrape(url, apiKey, proxy, formats, timeoutMs, maxAge: number)` (module-private). Public signatures of `scrapeZillowJson` / `scrapeRedfinMarkdown` unchanged.

- [ ] **Step 1: Write the failing test** — create `tests/monitorScrape.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { scrapeZillowJson, scrapeRedfinMarkdown } from "../convex/monitorScrape";
import { MONITOR } from "../src/scraper/monitorListings";

// Every attempt returns a short "shell" page, so the helper retries through the
// whole budget and we can inspect each request body's maxAge.
function stubShellFetch() {
  const bodies: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ success: true, data: { rawHtml: "<html></html>", markdown: "" } }) };
  }));
  return bodies;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("monitorScrape maxAge (Firecrawl v2 cache freshness)", () => {
  it("Zillow: 1h maxAge on the first attempt, maxAge 0 on every retry", async () => {
    const bodies = stubShellFetch();
    const out = await scrapeZillowJson("https://www.zillow.com/x", "fc-test", { gaps: [0, 0, 0], timeoutMs: 1000 });
    expect(out).toBeNull();
    expect(bodies.map((b) => b.maxAge)).toEqual([3_600_000, 0, 0]);
    expect(MONITOR.scrapeMaxAgeMs).toBe(3_600_000);
  });
  it("Redfin comps: same freshness rule", async () => {
    const bodies = stubShellFetch();
    const out = await scrapeRedfinMarkdown("19805", "fc-test", { gaps: [0, 0], timeoutMs: 1000 });
    expect(out).toBeNull();
    expect(bodies.map((b) => b.maxAge)).toEqual([3_600_000, 0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/monitorScrape.test.ts`
Expected: FAIL — `maxAge` is `undefined` in the bodies (and `MONITOR.scrapeMaxAgeMs` undefined).

- [ ] **Step 3: Add the constant** — in `src/scraper/monitorListings.ts`, inside `MONITOR`, after the `keeperRetireDays` line:

```ts
  keeperRetireDays: 30, // keepers older than this age off the /monitor board (archivedAt)
  // Firecrawl v2 cache: first attempt accepts a page cached <= 1h; retries force a live
  // scrape (maxAge 0). Unset, v2 defaults to a 2-day cache (lessons 2026-10-03).
  scrapeMaxAgeMs: 60 * 60 * 1000,
```

- [ ] **Step 4: Wire `maxAge` in `convex/monitorScrape.ts`**

Change the import:
```ts
import { extractNextData, MONITOR } from "../src/scraper/monitorListings";
```
Add above `function sleep`:
```ts
// First attempt may reuse a <=1h Firecrawl cache hit; every retry forces a live scrape
// (a cached bot-block shell would otherwise be served again).
function attemptMaxAge(attempt: number): number {
  return attempt === 0 ? MONITOR.scrapeMaxAgeMs : 0;
}
```
Add a `maxAge: number` parameter after `timeoutMs: number,` in `firecrawlV2Scrape` and send it in the body:
```ts
      body: JSON.stringify({
        url,
        formats,
        proxy,
        waitFor: 5000,
        maxAge,
      }),
```
In `scrapeZillowJson`, replace the loop head and call:
```ts
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > 0) await sleep(gaps[i] + Math.random() * 2000);
    const data = await firecrawlV2Scrape(url, apiKey, "enhanced", ["rawHtml"], timeoutMs, attemptMaxAge(i));
```
In `scrapeRedfinMarkdown`, the same:
```ts
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > 0) await sleep(gaps[i] + Math.random() * 2000);
    const data = await firecrawlV2Scrape(url, apiKey, "auto", ["rawHtml", "markdown"], timeoutMs, attemptMaxAge(i));
```

- [ ] **Step 5: Run tests + typechecks**

Run: `npx vitest run` then `npx tsc --noEmit` then `npx tsc --noEmit -p convex`
Expected: 398 passed; both typechecks print nothing.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # feat/monitor-critique
git add src/scraper/monitorListings.ts convex/monitorScrape.ts tests/monitorScrape.test.ts
git commit -m "fix(monitor): send Firecrawl v2 maxAge (1h first try, 0 on retries)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 2: Cron off-switch `MONITOR_SCAN_ENABLED` — S2

**Files:**
- Modify: `src/scraper/monitorListings.ts` (new export before `buildSearchUrl`)
- Modify: `convex/monitorActions.ts` (import list; top of `runMonitorScan` handler)
- Test: `tests/monitorListings.test.ts` (append; extend the `import { isLandType, ...` line)

**Interfaces:**
- Produces: `cronScanEnabled(flag: string | undefined): boolean`.

- [ ] **Step 1: Write the failing test** — replace the `import { isLandType, isMultiUnitType, isCondoType, digestRecipients } ...` line of `tests/monitorListings.test.ts` with:
```ts
import { isLandType, isMultiUnitType, isCondoType, digestRecipients, cronScanEnabled } from "../src/scraper/monitorListings";
```
Append:
```ts
describe("cronScanEnabled (MONITOR_SCAN_ENABLED off-switch)", () => {
  it("enabled when unset/empty/anything but 0", () => {
    expect(cronScanEnabled(undefined)).toBe(true);
    expect(cronScanEnabled("")).toBe(true);
    expect(cronScanEnabled("1")).toBe(true);
    expect(cronScanEnabled("false")).toBe(true); // literal spec: only "0" disables
  });
  it("disabled only by 0 (whitespace-tolerant)", () => {
    expect(cronScanEnabled("0")).toBe(false);
    expect(cronScanEnabled(" 0 ")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/monitorListings.test.ts`
Expected: FAIL — `cronScanEnabled is not a function`.

- [ ] **Step 3: Implement** — in `src/scraper/monitorListings.ts`, directly above `export function buildSearchUrl(`:
```ts
// Dev-duplicate off-switch: the nightly CRON scan runs unless the deployment sets
// MONITOR_SCAN_ENABLED to exactly "0" (unset = enabled, so prod is unchanged).
// Webhook/manual runs ignore it.
export function cronScanEnabled(flag: string | undefined): boolean {
  return (flag ?? "").trim() !== "0";
}
```
In `convex/monitorActions.ts` add `cronScanEnabled,` to the `../src/scraper/monitorListings` import (after `isCondoType,`), and make these the first lines of the `runMonitorScan` handler body (before the "Cron 20h no-op guard" comment):
```ts
    // Off-switch for the cron path only (e.g. the dev deployment duplicating prod's
    // nightly scan): MONITOR_SCAN_ENABLED="0" skips with no run row and no scrape.
    if (trigger === "cron" && !cronScanEnabled(process.env.MONITOR_SCAN_ENABLED)) {
      return { scanned: 0, newCount: 0, keeperCount: 0 };
    }
```

- [ ] **Step 4: Run tests + typechecks**

Run: `npx vitest run`, `npx tsc --noEmit`, `npx tsc --noEmit -p convex`
Expected: 400 passed; typechecks clean.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorActions.ts tests/monitorListings.test.ts
git commit -m "feat(monitor): MONITOR_SCAN_ENABLED=0 skips the cron scan (dev off-switch)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```
(The orchestrator then sets `MONITOR_SCAN_ENABLED=0` on the DEV deployment only.)

---

### Task 3: The single keeper decision `evaluateDeal` — S4, S5, S13

**Files:**
- Modify: `src/scraper/monitorListings.ts` (MONITOR; replace `scoreDeal` + `decideKeeper`)
- Modify: `convex/monitorActions.ts` (imports; steps 5-6, judge args, 9b/10, patch)
- Modify: `convex/monitorData.ts` (`analysisFields`; `patchAnalysis` `clearRental`)
- Modify: `convex/schema.ts` (`monitorListings`: `flipScore`, `rentScore`)
- Test: `tests/monitorListings.test.ts` (replace the `describe("scoreDeal + decideKeeper"...)` block; replace the `import { analyzeFlip, analyzeRental, scoreDeal, decideKeeper, riskFlags } ...` line)

**Interfaces:**
- Consumes: `analyzeFlip(arv, list, rehab)`, `analyzeRental({rent, list, rehab})`, `RentalMetrics`.
- Produces (later tasks rely on these exact names):
  - `type FlipResult = NonNullable<ReturnType<typeof analyzeFlip>>` (`{ mao: number; profit: number | null; margin: number; roi: number | null; roomVsList: number }`)
  - `scoreDeal(flip: FlipResult | null, rental: RentalMetrics | null): { flipScore: number; rentScore: number; dealScore: number }` (no `bestExit` any more)
  - `meetsFlipFloor(flip: FlipResult | null): boolean`, `meetsRentalFloor(rental: RentalMetrics | null): boolean`
  - `type BestExit = "FLIP" | "RENTAL" | "WHOLESALE" | "PASS"`
  - `interface DealInput { listPrice: number | null; zestimate: number | null; valueBasis: number | null; arv: number | null; rehabTotal: number | null; rent: number | null; renovated: boolean }`
  - `interface DealDecision { belowMarket: boolean; spread: number | null; spreadPct: number | null; flip: FlipResult | null; rental: RentalMetrics | null; flipScore: number; rentScore: number; dealScore: number; bestExit: BestExit; keeper: boolean }`
  - `evaluateDeal(i: DealInput): DealDecision`
  - `MONITOR.flipProfitFloor = 25000`, `MONITOR.cashFlowFloor = 0`; `MONITOR.distressScoreFloor` is DELETED.
  - `patchAnalysis` accepts `clearRental?: boolean`.

- [ ] **Step 1: Write the failing tests** — in `tests/monitorListings.test.ts` replace the `import { analyzeFlip, analyzeRental, scoreDeal, decideKeeper, riskFlags } ...` line with:
```ts
import { analyzeFlip, analyzeRental, scoreDeal, evaluateDeal, meetsFlipFloor, meetsRentalFloor, riskFlags, MONITOR } from "../src/scraper/monitorListings";
import type { DealInput, FlipResult, RentalMetrics } from "../src/scraper/monitorListings";
```
Delete the whole `describe("scoreDeal + decideKeeper", () => { ... });` block (it pins the deleted distress path and the old "4% cap = RENTAL" labelling — both intentionally removed by the spec) and put this in its place:
```ts
// Base input for evaluateDeal tests: nothing known, rehab $0 known. Each case overrides.
const DEAL: DealInput = { listPrice: null, zestimate: null, valueBasis: null, arv: null, rehabTotal: 0, rent: null, renovated: false };
const flipOf = (profit: number, margin: number): FlipResult => ({ mao: 0, profit, margin, roi: null, roomVsList: 0 });
const rentalOf = (capRate: number, cashFlow: number): RentalMetrics => ({ rent: 0, onePct: 0, capRate, cashFlow, cashOnCash: 0, allIn: 0 });

describe("scoreDeal (scores only — exit/keep live in evaluateDeal)", () => {
  it("max of the band scores", () => {
    const f = analyzeFlip(247200, 125000, 23265); const r = analyzeRental({ rent: 1788, list: 125000, rehab: 23265 });
    const s = scoreDeal(f, r);
    expect(s.flipScore).toBe(90); // margin ~0.249
    expect(s.dealScore).toBe(Math.max(s.flipScore, s.rentScore));
  });
});

describe("keeper floors (user-approved 2026-10-03)", () => {
  it("FLIP floor = profit >= $25,000 AND margin >= 12% (both boundaries inclusive)", () => {
    expect(MONITOR.flipProfitFloor).toBe(25000);
    expect(meetsFlipFloor(flipOf(25000, 0.12))).toBe(true);
    expect(meetsFlipFloor(flipOf(24999, 0.3))).toBe(false);
    expect(meetsFlipFloor(flipOf(80000, 0.1199))).toBe(false);
    expect(meetsFlipFloor(null)).toBe(false);
  });
  it("RENTAL floor = cap >= 6% AND monthly cash flow >= 0 (both boundaries inclusive)", () => {
    expect(meetsRentalFloor(rentalOf(0.06, 0))).toBe(true);
    expect(meetsRentalFloor(rentalOf(0.0599, 500))).toBe(false);
    expect(meetsRentalFloor(rentalOf(0.09, -1))).toBe(false);
    expect(meetsRentalFloor(null)).toBe(false);
  });
});

describe("evaluateDeal (the single keep/exit decision)", () => {
  it("FLIP keeper: ARV 300k, list 180k, rehab 30k -> profit 42,000 / margin 14%", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 180000, arv: 300000, rehabTotal: 30000 });
    expect(d.flip!.profit).toBe(42000);
    expect(d.flip!.margin).toBeCloseTo(0.14, 10);
    expect(d).toMatchObject({ flipScore: 60, rentScore: 0, dealScore: 60, bestExit: "FLIP", keeper: true, belowMarket: false });
  });
  it("margin under 12% is not a keeper even with $30K profit (list 190k -> margin 10.3%)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 190000, arv: 300000, rehabTotal: 30000 });
    expect(d.flip!.profit).toBe(30925);
    expect(d).toMatchObject({ bestExit: "PASS", keeper: false, dealScore: 60 });
  });
  it("profit under $25K is not a keeper even at 13.5% margin (ARV 180k, list 108k, rehab 18k)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 108000, arv: 180000, rehabTotal: 18000 });
    expect(d.flip!.profit).toBe(24240);
    expect(d).toMatchObject({ bestExit: "PASS", keeper: false });
  });
  it("RENTAL keeper: rent 2000, list 150k, rehab 20k -> cap 8.5%, +$314/mo", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, rehabTotal: 20000, rent: 2000 });
    expect(d.rental!.cashFlow).toBe(314);
    expect(d).toMatchObject({ rentScore: 90, bestExit: "RENTAL", keeper: true });
  });
  it("cap >= 6% but negative cash flow is not a RENTAL (rent 1500, list 150k -> cap 6.2%, -$9/mo)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, rehabTotal: 10000, rent: 1500 });
    expect(d.rental!.cashFlow).toBe(-9);
    expect(d).toMatchObject({ rentScore: 72, bestExit: "PASS", keeper: false });
  });
  it("a 4% cap never labels RENTAL (old scoreDeal did)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 200000, rehabTotal: 20000, rent: 1500 });
    expect(d.rental!.capRate).toBeCloseTo(0.0416, 3);
    expect(d).toMatchObject({ rentScore: 40, bestExit: "PASS", keeper: false });
  });
  it("both floors met -> higher score wins, tie goes to FLIP", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 120000, arv: 250000, rehabTotal: 20000, rent: 1900 });
    expect(d).toMatchObject({ flipScore: 90, rentScore: 90, bestExit: "FLIP", keeper: true });
  });
  it("below market vs Zestimate: list <= 0.85 x Zestimate keeps (WHOLESALE label), 1 dollar over does not", () => {
    expect(evaluateDeal({ ...DEAL, listPrice: 170000, zestimate: 200000 })).toMatchObject({ belowMarket: true, spreadPct: 15, bestExit: "WHOLESALE", keeper: true });
    expect(evaluateDeal({ ...DEAL, listPrice: 170001, zestimate: 200000 })).toMatchObject({ belowMarket: false, bestExit: "PASS", keeper: false });
  });
  it("no Zestimate -> the comps value basis runs the same 15% test", () => {
    expect(evaluateDeal({ ...DEAL, listPrice: 170000, valueBasis: 200000 })).toMatchObject({ belowMarket: true, spread: 30000, keeper: true });
  });
  it("a Zestimate overrides an inflated comps basis (the 08-08 fake-spread lesson)", () => {
    expect(evaluateDeal({ ...DEAL, listPrice: 170000, zestimate: 190000, valueBasis: 300000 })).toMatchObject({ belowMarket: false, spreadPct: 10.5, keeper: false });
  });
  it("renovated -> no flip exit at all", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 180000, arv: 300000, rehabTotal: 30000, renovated: true });
    expect(d.flip).toBeNull();
    expect(d).toMatchObject({ bestExit: "PASS", keeper: false });
  });
  it("unknown rehab (no sqft) -> no flip and no rental underwriting (never a $0 rehab)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, arv: 300000, rehabTotal: null, rent: 2000 });
    expect(d.flip).toBeNull();
    expect(d.rental).toBeNull();
    expect(d.keeper).toBe(false);
  });
  it("distress is not an input — an above-market distressed listing cannot be kept", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 250000, zestimate: 220000, arv: 230000, rehabTotal: 30000 });
    expect(d.keeper).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/monitorListings.test.ts`
Expected: FAIL — `evaluateDeal`/`meetsFlipFloor`/`meetsRentalFloor` not exported (type errors are not reported by vitest; the runtime calls fail).

- [ ] **Step 3: Implement in `src/scraper/monitorListings.ts`**

In `MONITOR`, replace the line `spreadThreshold: 0.15, flipMarginBar: 0.12, capRateBar: 0.06, distressScoreFloor: 30,` with:
```ts
  spreadThreshold: 0.15, flipMarginBar: 0.12, capRateBar: 0.06,
  flipProfitFloor: 25000, // FLIP keeper floor: profit >= $25K AND margin >= flipMarginBar (research §1.3)
  cashFlowFloor: 0, // RENTAL keeper floor: cap >= capRateBar AND monthly cash flow >= this
```
Replace everything from `export function scoreDeal(` up to (not including) `export function riskFlags(` — i.e. the old `scoreDeal` and `decideKeeper` — with:
```ts
export type FlipResult = NonNullable<ReturnType<typeof analyzeFlip>>;
export function scoreDeal(flip: FlipResult | null, rental: RentalMetrics | null) {
  const flipScore = !flip || flip.margin == null ? 0 : flip.margin >= 0.2 ? 90 : flip.margin >= 0.15 ? 75 : flip.margin >= 0.1 ? 60 : flip.margin >= 0.05 ? 40 : flip.margin > 0 ? 20 : 0;
  const rentScore = !rental ? 0 : rental.capRate >= 0.08 ? 90 : rental.capRate >= 0.06 ? 72 : rental.capRate >= 0.05 ? 55 : rental.capRate >= 0.04 ? 40 : 20;
  return { flipScore, rentScore, dealScore: Math.max(flipScore, rentScore) } as const;
}
// Keeper floors (user-approved 2026-10-03). Profit is computed AT LIST PRICE.
export function meetsFlipFloor(flip: FlipResult | null): boolean {
  return !!flip && flip.profit != null && flip.profit >= MONITOR.flipProfitFloor && flip.margin >= MONITOR.flipMarginBar;
}
export function meetsRentalFloor(rental: RentalMetrics | null): boolean {
  return !!rental && rental.capRate >= MONITOR.capRateBar && rental.cashFlow >= MONITOR.cashFlowFloor;
}

export type BestExit = "FLIP" | "RENTAL" | "WHOLESALE" | "PASS";
export interface DealInput {
  listPrice: number | null;
  zestimate: number | null;
  valueBasis: number | null; // as-is value for the spread test when there is no Zestimate
  arv: number | null;        // after-repair value for the flip math
  rehabTotal: number | null; // null = unknown (no sqft) -> no flip/rental underwriting
  rent: number | null;
  renovated: boolean;        // already flipped by someone else -> no flip exit
}
export interface DealDecision {
  belowMarket: boolean;
  spread: number | null;
  spreadPct: number | null;
  flip: FlipResult | null;
  rental: RentalMetrics | null;
  flipScore: number;
  rentScore: number;
  dealScore: number;
  bestExit: BestExit;
  keeper: boolean;
}
// THE keeper decision — the only place keep/exit is decided (analyzeOne, the re-gate
// mutation and the backtest script all call it). Deterministic: the LLM never keeps.
// belowMarket basis = Zestimate when present (list <= 0.85 x Zestimate), else the
// comps value. Distress is score/label only — it never keeps a listing.
export function evaluateDeal(i: DealInput): DealDecision {
  const basis = i.zestimate ?? i.valueBasis;
  const spread = basis != null && i.listPrice != null ? basis - i.listPrice : null;
  const spreadPct = spread != null && basis ? +((spread / basis) * 100).toFixed(1) : null;
  const belowMarket = basis != null && basis > 0 && i.listPrice != null && i.listPrice <= basis * (1 - MONITOR.spreadThreshold);
  const flip = i.renovated || i.rehabTotal == null ? null : analyzeFlip(i.arv, i.listPrice, i.rehabTotal);
  const rental = i.rehabTotal == null || i.listPrice == null ? null : analyzeRental({ rent: i.rent, list: i.listPrice, rehab: i.rehabTotal });
  const s = scoreDeal(flip, rental);
  const flipOk = meetsFlipFloor(flip);
  const rentalOk = meetsRentalFloor(rental);
  const bestExit: BestExit =
    flipOk && rentalOk ? (s.flipScore >= s.rentScore ? "FLIP" : "RENTAL")
    : flipOk ? "FLIP"
    : rentalOk ? "RENTAL"
    : belowMarket ? "WHOLESALE"
    : "PASS";
  return { belowMarket, spread, spreadPct, flip, rental, ...s, bestExit, keeper: flipOk || rentalOk || belowMarket };
}
```

- [ ] **Step 4: Run the pure tests**

Run: `npx vitest run tests/monitorListings.test.ts`
Expected: PASS.

- [ ] **Step 5: Schema + data layer**

`convex/schema.ts`, `monitorListings` table, replace the two decision lines:
```ts
    // decision
    dealScore: v.optional(v.number()), // max(flipScore, rentScore) — sort key
    flipScore: v.optional(v.number()),
    rentScore: v.optional(v.number()),
    bestExit: v.optional(v.string()), // FLIP | RENTAL (floors met) | WHOLESALE (below market only) | PASS
```
`convex/monitorData.ts` `analysisFields`, after `dealScore: v.optional(v.number()),` add:
```ts
  flipScore: v.optional(v.number()),
  rentScore: v.optional(v.number()),
```
Replace `patchAnalysis` with (adds `clearRental`, keeps `clearFlip`):
```ts
export const patchAnalysis = internalMutation({
  args: {
    id: v.id("monitorListings"),
    fields: analysisFields,
    clearFlip: v.optional(v.boolean()),
    clearRental: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, fields, clearFlip, clearRental }) => {
    await ctx.db.patch(id, {
      ...fields,
      ...(clearFlip
        ? { flipMao: undefined, flipProfit: undefined, flipMargin: undefined, flipRoi: undefined, roomVsList: undefined }
        : {}),
      ...(clearRental
        ? { capRate: undefined, cashFlow: undefined, onePctRule: undefined, cashOnCash: undefined }
        : {}),
      updatedAt: Date.now(),
    });
  },
});
```
Also update its doc comment's first sentence to mention `clearRental` ("`clearFlip`/`clearRental` REMOVE the flip/rental fields ...").

- [ ] **Step 6: Wire `analyzeOne` (`convex/monitorActions.ts`)**

Import list: replace `analyzeFlip,` `analyzeRental,` `scoreDeal,` `decideKeeper,` with `evaluateDeal,` (keep `estimateRehab`). Replace the block from `const rehabTotal = rehab.total ?? 0;` through the `const rental = analyzeRental(...)` line with:
```ts

      // 5-6) Preliminary deal math (spread + flip + rental) — the judge's GIVEN numbers.
      // The final decision is re-run at 9b with the judge's renovated veto applied.
      const dealInput = {
        listPrice,
        zestimate,
        valueBasis: arv,
        arv,
        rehabTotal: rehab.total,
        rent: rentZestimate,
      };
      const pre = evaluateDeal({ ...dealInput, renovated: detectRenovated(description) });
```
In the `judgeWithDeepSeek({...})` argument replace the `spreadPct,` / `flipMarginPct:` / `capRatePct:` lines with:
```ts
        spreadPct: pre.spreadPct,
        rehabTier,
        flipMarginPct: pre.flip ? +(pre.flip.margin * 100).toFixed(1) : null,
        capRatePct: pre.rental ? +(pre.rental.capRate * 100).toFixed(1) : null,
```
Replace the block from `const flipFinal = renovated ? null : flip;` through `const keeper = decideKeeper(...);` with:
```ts
      if (renovated) flags.push("RENOVATED (no flip)");

      // 10) Keeper decision — deterministic floors only (distress is a label, never a keep).
      const deal = evaluateDeal({ ...dealInput, renovated });
      const { keeper, belowMarket, spread, spreadPct, rental } = deal;
      const flipFinal = deal.flip;
```
(the `const renovated = ...` line above it stays; the old `if (renovated) flags.push(...)` and the `distress` computation are removed.) Replace the `patchAnalysis` call head and the score fields:
```ts
      // clearFlip/clearRental: patchAnalysis merges, so a re-analyzed row whose exit
      // is now null (renovated veto / unknown rehab) must have it REMOVED, not omitted.
      await ctx.runMutation(internal.monitorData.patchAnalysis, {
        id,
        ...(flipFinal ? {} : { clearFlip: true }),
        ...(rental ? {} : { clearRental: true }),
```
```ts
          dealScore: deal.dealScore,
          flipScore: deal.flipScore,
          rentScore: deal.rentScore,
          bestExit: deal.bestExit,
```
Every other reference (`belowMarket`, `spread`, `spreadPct`, `flipFinal.*`, `rental.*`, `rehab.total`) keeps its name via the destructuring above. `MONITOR` stays imported (still used by the scan).

- [ ] **Step 7: Validate + full suite**

Run: `npx vitest run` -> Expected 413 passed. `npx tsc --noEmit` and `npx tsc --noEmit -p convex` -> clean.
Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once` -> Expected: schema + functions push to the LOCAL anonymous backend without validator errors. `git status` — stage any `convex/_generated` change.

- [ ] **Step 8: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorActions.ts convex/monitorData.ts convex/schema.ts tests/monitorListings.test.ts convex/_generated
git commit -m "feat(monitor): evaluateDeal keeper floors (flip 25K profit + 12% margin, rental cap 6% + CF >= 0), drop distress keep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 4: sqft-unknown and GUT-regex bugs — S6

**Files:**
- Modify: `src/scraper/flip.ts` (`estimateRehab`)
- Modify: `src/scraper/monitorListings.ts` (`conservativeArv` guard, `GUT`, `riskFlags`)
- Modify: `convex/monitorActions.ts` (`riskFlags` call)
- Test: `tests/flip.test.ts`, `tests/monitorListings.test.ts` (append)

**Interfaces:**
- Produces: `estimateRehab(perSqft, sqft, contingencyPct, override?)` returns all-null when `sqft <= 0` and no override. `conservativeArv` returns `{ arv: zestimate | null, source: "zestimate" | "none", compsPpsf: null, compsCount: 0 }` when sqft is null/<=0. `riskFlags(r)` accepts `sqftKnown?: boolean` and emits `"sqft-missing (VERIFY)"` when it is `false`.

- [ ] **Step 1: Write the failing tests** — append to `tests/flip.test.ts`:
```ts
describe("estimateRehab sqft guard", () => {
  it("sqft 0 is unknown -> nulls (never a $0 rehab)", () => {
    expect(estimateRehab(42, 0, 0.10)).toEqual({ base: null, contingency: null, total: null });
  });
  it("an explicit override still wins with sqft 0", () => {
    expect(estimateRehab(42, 0, 0.10, 20000).total).toBe(22000);
  });
});
```
Append to `tests/monitorListings.test.ts`:
```ts
describe("sqft unknown (null/0) is never priced (08-08 lesson)", () => {
  const comps = [mkComp(230000, 1100), mkComp(220000, 1100), mkComp(226000, 1100)];
  it("conservativeArv: sqft 0 -> Zestimate, not the median-soldPrice fallback", () => {
    const r = conservativeArv({ comps, sqft: 0, beds: 3, zestimate: 180000, homeType: "SINGLE_FAMILY" });
    expect(r).toMatchObject({ arv: 180000, source: "zestimate", compsPpsf: null, compsCount: 0 });
  });
  it("conservativeArv: sqft null and no Zestimate -> ARV null", () => {
    const r = conservativeArv({ comps, sqft: null, beds: 3, zestimate: null, homeType: "SINGLE_FAMILY" });
    expect(r).toMatchObject({ arv: null, source: "none", compsPpsf: null, compsCount: 0 });
  });
  it("riskFlags: sqftKnown false -> VERIFY flag; true/omitted -> none", () => {
    expect(riskFlags({ sqftKnown: false })).toContain("sqft-missing (VERIFY)");
    expect(riskFlags({ sqftKnown: true })).not.toContain("sqft-missing (VERIFY)");
    expect(riskFlags({})).not.toContain("sqft-missing (VERIFY)");
  });
});

describe("GUT regex is word-bounded (fireplace is not fire damage)", () => {
  it("fireplace / firepit / flooring do not read as gut", () => {
    expect(inferRehabTier("Cozy brick fireplace and a backyard firepit")).toBe("moderate");
    expect(inferRehabTier("New flooring, updated kitchen, move-in ready")).toBe("cosmetic");
    expect(inferRehabTier("Structurally sound, needs TLC")).toBe("moderate");
  });
  it("real damage / gut language still reads as gut", () => {
    expect(inferRehabTier("Fire damage in rear bedroom")).toBe("gut");
    expect(inferRehabTier("fire and water damage throughout")).toBe("gut");
    expect(inferRehabTier("Water-damaged basement")).toBe("gut");
    expect(inferRehabTier("Gutted to the studs")).toBe("gut");
    expect(inferRehabTier("Needs a gut rehab")).toBe("gut");
    expect(inferRehabTier("Structural issues, sold as-is")).toBe("gut");
  });
  it("side effect: a renovated listing with a fireplace is now detected as renovated", () => {
    // detectRenovated requires !GUT; "fireplace" used to match GUT and hide the renovation.
    expect(detectRenovated("Fully renovated colonial with a wood-burning fireplace")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/flip.test.ts tests/monitorListings.test.ts`
Expected: FAIL — sqft-0 rehab returns 0s; conservativeArv uses comps; fireplace reads gut; no VERIFY flag.

- [ ] **Step 3: Implement**

`src/scraper/flip.ts` — replace the `estimateRehab` doc line and `base` line:
```ts
/** Tiered rehab estimate: override wins; else perSqft * sqft; + contingency.
 *  sqft 0/negative is UNKNOWN (null), never a $0 rehab. */
```
```ts
  const base = override != null ? override : sqft != null && sqft > 0 ? perSqft * sqft : null;
```
`src/scraper/monitorListings.ts` — in `conservativeArv`, replace the `if (manufactured) return ...` line with:
```ts
  // sqft unknown (null/0) -> comps $/sqft can't price it and the median-soldPrice
  // fallback crosses sizes/types (08-08 lesson): Zestimate or nothing (VERIFY flag).
  if (manufactured || !(opts.sqft != null && opts.sqft > 0)) return { arv: opts.zestimate ?? null, source: opts.zestimate ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
```
Replace the `GUT` line with:
```ts
// Word-bounded: bare "fire" matched fireplace/firepit and forced a $95/sqft gut tier.
const GUT = /\b(fire|flood|water|smoke|storm)(\s+and\s+(fire|flood|water|smoke))?[\s-]+damaged?\b|\bgut(ted)?\b|\bshell\b|\bstructural\b|\bsevere\b|\bfull (rehab|renovation)\b|\bcomplete renovation\b|\btear[\s-]?down\b|\bneeds everything\b/i;
```
`riskFlags`: add `sqftKnown?: boolean` to its parameter type (after `detailOk?: boolean`) and after the `detail-missing` line:
```ts
  if (r.sqftKnown === false) f.push("sqft-missing (VERIFY)");
```
`convex/monitorActions.ts` — in the `riskFlags({...})` call, after `detailOk,` add:
```ts
        sqftKnown: sqft != null && sqft > 0,
```
(With Task 3's `evaluateDeal`, `rehab.total` is now null for sqft 0, so flip and rental are skipped — no further wiring.)

- [ ] **Step 4: Run tests + typechecks**

Run: `npx vitest run` -> 421 passed; `npx tsc --noEmit`; `npx tsc --noEmit -p convex` -> clean.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/flip.ts src/scraper/monitorListings.ts convex/monitorActions.ts tests/flip.test.ts tests/monitorListings.test.ts
git commit -m "fix(monitor): sqft 0 is unknown (no median-price ARV, no zero-dollar rehab); word-bounded GUT regex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 5: Digest = FLIP/RENTAL keepers only — S7

**Files:**
- Modify: `src/scraper/monitorListings.ts` (new export above `riskFlags`)
- Modify: `convex/monitorData.ts` (import; `keepersToEmail` filter)
- Test: `tests/monitorListings.test.ts` (append; extend the `import { isLandType, ...` line)

**Interfaces:**
- Produces: `isDigestWorthy(bestExit: string | null | undefined): boolean`.

- [ ] **Step 1: Write the failing test** — the `import { isLandType, ...` line becomes:
```ts
import { isLandType, isMultiUnitType, isCondoType, digestRecipients, cronScanEnabled, isDigestWorthy } from "../src/scraper/monitorListings";
```
Append:
```ts
describe("isDigestWorthy (digest = FLIP/RENTAL keepers only)", () => {
  it("FLIP and RENTAL are emailed", () => {
    expect(isDigestWorthy("FLIP")).toBe(true);
    expect(isDigestWorthy("RENTAL")).toBe(true);
  });
  it("WHOLESALE / PASS / unset are board-only", () => {
    expect(isDigestWorthy("WHOLESALE")).toBe(false);
    expect(isDigestWorthy("PASS")).toBe(false);
    expect(isDigestWorthy(undefined)).toBe(false);
    expect(isDigestWorthy(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/monitorListings.test.ts` -> FAIL (`isDigestWorthy is not a function`).

- [ ] **Step 3: Implement** — `src/scraper/monitorListings.ts`, directly above `export function riskFlags(`:
```ts
// Digest = actionable exits only: a keeper whose bestExit is WHOLESALE/PASS (or unset)
// stays on the /monitor board but never reaches the email.
export function isDigestWorthy(bestExit: string | null | undefined): boolean {
  return bestExit === "FLIP" || bestExit === "RENTAL";
}
```
`convex/monitorData.ts` — add under the `normalizeAddress` import:
```ts
import { isDigestWorthy } from "../src/scraper/monitorListings";
```
In `keepersToEmail` replace `const active = rows.filter((r) => r.archivedAt === undefined);` with:
```ts
    // Filter BEFORE the cap so board-only keepers (WHOLESALE/PASS) can't crowd it.
    const active = rows.filter((r) => r.archivedAt === undefined && isDigestWorthy(r.bestExit));
```
Zero-candidate nights are unchanged: `sendDigest` already returns `{sent:false}` when the list is empty.

- [ ] **Step 4: Run tests + typechecks** — 423 passed; both typechecks clean.

- [ ] **Step 5: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorData.ts tests/monitorListings.test.ts
git commit -m "feat(monitor): digest emails only FLIP/RENTAL keepers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 6: Re-gate existing keepers (`regateKeepers`, dry-run) — S8

**Files:**
- Modify: `src/scraper/monitorListings.ts` (new exports above `isDigestWorthy`)
- Modify: `convex/monitorData.ts` (import; new `regateKeepers` internalMutation above `sweepStalePending`)
- Test: `tests/monitorListings.test.ts` (append; extend the `import { analyzeFlip, ...` line)

**Interfaces:**
- Consumes: `evaluateDeal`, `DealInput`, `DealDecision`, `detectRenovated`.
- Produces:
  - `interface StoredListing { listPrice?: number; zestimate?: number; conservativeArv?: number; sqft?: number; rehabEstimate?: number; rentZestimate?: number; description?: string; riskFlags?: string[] }` (a structural subset of `Doc<"monitorListings">`; later tasks change its fields)
  - `dealInputFromStored(r: StoredListing): DealInput`
  - `decisionFields(d: DealDecision)` -> `{ keeper, belowMarket, bestExit, dealScore, flipScore, rentScore, spread?, spreadPct?, flipMao?, flipProfit?, flipMargin?, flipRoi?, roomVsList?, capRate?, cashFlow?, onePctRule?, cashOnCash? }` where absent exits are explicit `undefined` (= remove on `ctx.db.patch`).
  - Convex: `internal.monitorData.regateKeepers({ dryRun?: boolean }) -> { dryRun, total, kept, dekept, exitMix, dekeptSample }`.

- [ ] **Step 1: Write the failing tests** — the `import { analyzeFlip, ...` line becomes:
```ts
import { analyzeFlip, analyzeRental, scoreDeal, evaluateDeal, meetsFlipFloor, meetsRentalFloor, riskFlags, MONITOR, dealInputFromStored, decisionFields } from "../src/scraper/monitorListings";
```
Append:
```ts
describe("dealInputFromStored (re-gate adapter)", () => {
  it("maps a normal stored row", () => {
    expect(dealInputFromStored({ listPrice: 180000, zestimate: 250000, conservativeArv: 300000, sqft: 1500, rehabEstimate: 30000, rentZestimate: 1900, description: "needs TLC", riskFlags: [] }))
      .toEqual({ listPrice: 180000, zestimate: 250000, valueBasis: 300000, arv: 300000, rehabTotal: 30000, rent: 1900, renovated: false });
  });
  it("old sqft-0 row: discards the median-soldPrice ARV and the $0 rehab", () => {
    const i = dealInputFromStored({ listPrice: 265000, conservativeArv: 697500, sqft: 0, rehabEstimate: 0, zestimate: 270000 });
    expect(i.arv).toBe(270000);
    expect(i.valueBasis).toBe(270000);
    expect(i.rehabTotal).toBeNull();
  });
  it("renovated from the stored flag OR the description", () => {
    expect(dealInputFromStored({ riskFlags: ["RENOVATED (no flip)"] }).renovated).toBe(true);
    expect(dealInputFromStored({ description: "Fully remodeled, turnkey" }).renovated).toBe(true);
    expect(dealInputFromStored({}).renovated).toBe(false);
  });
  it("an old distress-only keeper (above market, thin flip) is de-kept", () => {
    const d = evaluateDeal(dealInputFromStored({ listPrice: 240000, zestimate: 230000, conservativeArv: 260000, sqft: 1400, rehabEstimate: 64680, rentZestimate: 1700, description: "Estate sale, sold as-is" }));
    expect(d.keeper).toBe(false);
  });
});

describe("decisionFields", () => {
  it("null exits become undefined (patch removes them)", () => {
    const f = decisionFields(evaluateDeal({ ...DEAL, listPrice: 170000, zestimate: 200000, rehabTotal: null }));
    expect(f).toMatchObject({ keeper: true, bestExit: "WHOLESALE", belowMarket: true, spreadPct: 15 });
    expect(f.flipMao).toBeUndefined();
    expect(f.capRate).toBeUndefined();
    expect("flipMao" in f).toBe(true); // key present -> ctx.db.patch clears it
  });
  it("carries rounded flip profit and rental numbers", () => {
    const f = decisionFields(evaluateDeal({ ...DEAL, listPrice: 120000, arv: 250000, rehabTotal: 20000, rent: 1900 }));
    expect(f.flipProfit).toBe(73200);
    expect(f.cashFlow).toBe(436);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/monitorListings.test.ts` -> FAIL (not exported).

- [ ] **Step 3: Implement the pure adapter** — `src/scraper/monitorListings.ts`, directly above the `// Digest = actionable exits only` comment:
```ts
// Re-gate adapter: rebuild a DealInput from a STORED monitorListings row (no scraping).
// Old-row rules: sqft unknown -> rehab unknown and ARV = Zestimate-or-null (the old
// median-soldPrice ARV and $0 rehab are discarded); renovated = stored RENOVATED flag
// OR the current detector on the stored description.
export interface StoredListing {
  listPrice?: number;
  zestimate?: number;
  conservativeArv?: number;
  sqft?: number;
  rehabEstimate?: number;
  rentZestimate?: number;
  description?: string;
  riskFlags?: string[];
}
export function dealInputFromStored(r: StoredListing): DealInput {
  const sqftKnown = r.sqft != null && r.sqft > 0;
  const arv = sqftKnown ? (r.conservativeArv ?? null) : (r.zestimate ?? null);
  return {
    listPrice: r.listPrice ?? null,
    zestimate: r.zestimate ?? null,
    valueBasis: arv,
    arv,
    rehabTotal: sqftKnown ? (r.rehabEstimate ?? null) : null,
    rent: r.rentZestimate ?? null,
    renovated: (r.riskFlags ?? []).some((f) => f.startsWith("RENOVATED")) || detectRenovated(r.description),
  };
}
// Row fields for a decision. `undefined` = REMOVE the field (ctx.db.patch semantics),
// so a now-null exit can't leave stale numbers on the card (07-04 patch-merge lesson).
export function decisionFields(d: DealDecision) {
  return {
    keeper: d.keeper,
    belowMarket: d.belowMarket,
    bestExit: d.bestExit,
    dealScore: d.dealScore,
    flipScore: d.flipScore,
    rentScore: d.rentScore,
    spread: d.spread ?? undefined,
    spreadPct: d.spreadPct ?? undefined,
    flipMao: d.flip ? d.flip.mao : undefined,
    flipProfit: d.flip?.profit != null ? Math.round(d.flip.profit) : undefined,
    flipMargin: d.flip ? d.flip.margin : undefined,
    flipRoi: d.flip?.roi ?? undefined,
    roomVsList: d.flip ? d.flip.roomVsList : undefined,
    capRate: d.rental ? d.rental.capRate : undefined,
    cashFlow: d.rental ? d.rental.cashFlow : undefined,
    onePctRule: d.rental ? d.rental.onePct : undefined,
    cashOnCash: d.rental ? d.rental.cashOnCash : undefined,
  };
}
```

- [ ] **Step 4: Run the pure tests** — `npx vitest run tests/monitorListings.test.ts` -> PASS.

- [ ] **Step 5: Add the mutation** — `convex/monitorData.ts`: change the Task-5 import to
```ts
import { isDigestWorthy, evaluateDeal, dealInputFromStored, decisionFields } from "../src/scraper/monitorListings";
```
and insert directly above the `sweepStalePending` doc comment:
```ts
/**
 * Re-gate the active (non-archived) keepers under the CURRENT keeper rules using
 * only stored fields (no scraping, zero Firecrawl credits). De-keeps rows that now
 * fail; never promotes a non-keeper (the scan's analyzeOne is the only promoter).
 * Rows that stay keepers get their decision fields refreshed. `dryRun` returns the
 * same counts without writing. Operator-run on prod after deploy:
 *   npx convex run monitorData:regateKeepers '{"dryRun":true}'
 */
export const regateKeepers = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .collect();
    const exitMix: Record<string, number> = {};
    const dekept: string[] = [];
    const now = Date.now();
    for (const row of rows) {
      const d = evaluateDeal(dealInputFromStored(row));
      if (d.keeper) exitMix[d.bestExit] = (exitMix[d.bestExit] ?? 0) + 1;
      else dekept.push(row.address);
      if (dryRun) continue;
      const tags = (row.matchedRequirements ?? []).filter((t) => t !== "below_market");
      await ctx.db.patch(row._id, {
        ...decisionFields(d),
        matchedRequirements: d.belowMarket ? [...tags, "below_market"] : tags,
        updatedAt: now,
      });
    }
    return {
      dryRun: !!dryRun,
      total: rows.length,
      kept: rows.length - dekept.length,
      dekept: dekept.length,
      exitMix,
      dekeptSample: dekept.slice(0, 25),
    };
  },
});
```

- [ ] **Step 6: Validate locally** — `npx vitest run` -> 429 passed; `npx tsc --noEmit`; `npx tsc --noEmit -p convex` -> clean. PowerShell: `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once` (regenerates `convex/_generated/api.d.ts` with `regateKeepers`), then from the **Bash** tool (avoids PowerShell 5.1 JSON-argument mangling): `CONVEX_AGENT_MODE=anonymous npx convex run monitorData:regateKeepers '{"dryRun":true}'` -> Expected on the empty local backend: `{ "dekept": 0, "dekeptSample": [], "dryRun": true, "exitMix": {}, "kept": 0, "total": 0 }` (a trailing Windows `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` line is harmless node exit noise). This dry-run is a smoke check; codegen + both `tsc` passes are the gate.

- [ ] **Step 7: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorData.ts tests/monitorListings.test.ts convex/_generated
git commit -m "feat(monitor): regateKeepers mutation (stored-fields re-gate, dry-run counts)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```
Phase 1 is now shippable. Orchestrator ops after deploy (not implementer steps): set `MONITOR_SCAN_ENABLED=0` on dev; delete the remote Firecrawl monitor; run `regateKeepers` dry-run, review, then for real on prod IMMEDIATELY after deploy and before that night's scan (02:00 UTC) — until it runs, `keepersToEmail` still sees un-emailed old keepers carrying old `bestExit` labels, so the next digest would go out under the old rules. Repeat the re-gate after the Phase 2 deploy (Tasks 9-10 change the stored-row math).

---

### Task 7: Redfin gis comps (coords + type + sold date) — S9 data source

**Files:**
- Modify: `src/scraper/comps.ts` (`Comp` optional fields; `CompType`; `parseRedfinGisComps` above `selectComps`)
- Modify: `convex/monitorScrape.ts` (export `V2ScrapeData`; rename `scrapeRedfinMarkdown` -> `scrapeRedfinSold` returning both formats)
- Modify: `convex/monitorActions.ts` (imports; `compsForZip`)
- Test: `tests/redfinGis.test.ts` (create), `tests/monitorScrape.test.ts` (rename + one new test)

**Interfaces:**
- Produces:
  - `type CompType = "sfr" | "townhouse"`; `Comp` gains `lat?: number; lng?: number; propertyType?: CompType; soldAt?: number` (ms epoch).
  - `parseRedfinGisComps(rawHtml: string): Comp[]`
  - `export interface V2ScrapeData { rawHtml: string; markdown: string }`; `scrapeRedfinSold(zip, apiKey, budget?): Promise<V2ScrapeData | null>` (replaces `scrapeRedfinMarkdown`).

- [ ] **Step 1: Write the failing tests** — create `tests/redfinGis.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseRedfinGisComps } from "../src/scraper/comps";

// Mirrors the real Redfin sold-search rawHtml (captured 2026-10-04, ZIP 19805):
// InitialContext is a JSON object literal; the gis response body is a JSON STRING
// ("{}&&{...}") nested inside it, so the homes are double-encoded. Field shapes copied
// from real homes (propertyType 6 = single-family, 13 = townhouse, 4 = multi, 8 = land).
const home = (o: Record<string, unknown>) => ({
  mlsStatus: "Closed",
  price: { value: 255000, level: 1 },
  sqFt: { value: 1300, level: 1 },
  beds: 3,
  baths: 2,
  latLong: { value: { latitude: 39.7318939, longitude: -75.5720145 }, level: 1 },
  streetLine: { value: "1604 Coleman St", level: 1 },
  city: "Wilmington",
  state: "DE",
  zip: "19805",
  soldDate: 1778137200000,
  propertyType: 13,
  sashes: [{ sashTypeName: "Sold", lastSaleDate: "MAY 7, 2026", lastSalePrice: "" }],
  ...o,
});
function redfinHtml(homes: unknown[]): string {
  const gisText = "{}&&" + JSON.stringify({ version: 661, errorMessage: "Success", resultCode: 0, payload: { homes } });
  const ctx = {
    "ReactServerAgent.cache": {
      dataCache: {
        "/stingray/api/gis-aggregates?al=1&region_id=7680": { res: { text: "{}&&{}" } },
        "/stingray/api/gis?al=1&include_nearby_homes=true&region_id=7680&sold_within_days=180": { res: { text: gisText } },
      },
    },
  };
  return [
    "<html><body><script>_tLAB.wait(function(){",
    "(function (root) {",
    "/* -- Data -- */",
    "root.__reactServerState || (root.__reactServerState = {});",
    `root.__reactServerState.InitialContext = ${JSON.stringify(ctx)};`,
    'root.__reactServerState.Config = {"environmentName":"prod"};',
    "})(window);",
    "});</script></body></html>",
  ].join("\n");
}

describe("parseRedfinGisComps", () => {
  it("parses a townhouse home with coords, type and sold epoch", () => {
    const [c] = parseRedfinGisComps(redfinHtml([home({})]));
    expect(c).toEqual({
      address: "1604 Coleman St, Wilmington, DE 19805",
      soldDate: "MAY 7, 2026",
      soldPrice: 255000,
      beds: 3,
      baths: 2,
      sqft: 1300,
      pricePerSqft: 255000 / 1300,
      lat: 39.7318939,
      lng: -75.5720145,
      propertyType: "townhouse",
      soldAt: 1778137200000,
    });
  });
  it("keeps single-family (6) and townhouse (13); drops multi-family (4), land (8), non-DE", () => {
    const out = parseRedfinGisComps(redfinHtml([
      home({ propertyType: 6 }),
      home({ propertyType: 13 }),
      home({ propertyType: 4 }),
      home({ propertyType: 8 }),
      home({ propertyType: 6, state: "PA" }),
    ]));
    expect(out.map((c) => c.propertyType)).toEqual(["sfr", "townhouse"]);
  });
  it("nearby homes without soldDate fall back to the sash lastSaleDate", () => {
    const [c] = parseRedfinGisComps(redfinHtml([home({ soldDate: undefined, sashes: [{ lastSaleDate: "SEP 9, 2026" }] })]));
    expect(c.soldAt).toBe(Date.parse("SEP 9, 2026"));
    expect(c.soldDate).toBe("SEP 9, 2026");
  });
  it("missing sqft -> sqft and $/sqft null (never priced by size)", () => {
    const [c] = parseRedfinGisComps(redfinHtml([home({ sqFt: { level: 1 } })]));
    expect(c.sqft).toBeNull();
    expect(c.pricePerSqft).toBeNull();
  });
  it("[] when the embed is missing or malformed (caller falls back to markdown)", () => {
    expect(parseRedfinGisComps("<html>no data</html>")).toEqual([]);
    expect(parseRedfinGisComps("root.__reactServerState.InitialContext = {not json};\n")).toEqual([]);
    expect(parseRedfinGisComps("")).toEqual([]);
  });
});
```
In `tests/monitorScrape.test.ts` replace every `scrapeRedfinMarkdown` with `scrapeRedfinSold` (import + the Redfin test) and append:
```ts
describe("scrapeRedfinSold", () => {
  it("returns both rawHtml and markdown from the first non-shell page", async () => {
    const big = "x".repeat(60_000);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { rawHtml: big, markdown: "md" } }) })));
    const out = await scrapeRedfinSold("19805", "fc-test", { gaps: [0], timeoutMs: 1000 });
    expect(out).toEqual({ rawHtml: big, markdown: "md" });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/redfinGis.test.ts tests/monitorScrape.test.ts` -> FAIL (not exported).

- [ ] **Step 3: Implement the parser** — `src/scraper/comps.ts`: replace the `Comp` interface with
```ts
export type CompType = "sfr" | "townhouse";

export interface Comp {
  address: string;
  soldDate: string; // as scraped, e.g. "MAY 18, 2026"
  soldPrice: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pricePerSqft: number | null;
  // Only from the Redfin gis payload (parseRedfinGisComps); markdown rows lack them.
  lat?: number;
  lng?: number;
  propertyType?: CompType;
  soldAt?: number; // ms epoch
}
```
and insert directly above the `/** Pick the most comparable comps` comment:
```ts
// Redfin propertyType codes seen in NCC sold data: 6 = single-family, 13 = townhouse
// (rowhome/twin), 4 = multi-family, 8 = land. Only 6/13 are comps for our targets.
const REDFIN_COMP_TYPES: Record<number, CompType> = { 6: "sfr", 13: "townhouse" };

/**
 * Parse the stingray `gis` payload Redfin embeds in its sold-search rawHtml
 * (`root.__reactServerState.InitialContext` -> dataCache["/stingray/api/gis?..."]
 * .res.text = "{}&&{...payload:{homes:[...]}}"). Unlike the markdown rows, each home
 * carries lat/lng, a property type and a sold epoch. DE single-family/townhouse
 * only. [] on any shape change (callers fall back to parseRedfinComps).
 */
export function parseRedfinGisComps(rawHtml: string): Comp[] {
  const m = rawHtml.match(/root\.__reactServerState\.InitialContext = (\{[\s\S]*?\});\s*\n/);
  if (!m) return [];
  let homes: any[];
  try {
    const cache = JSON.parse(m[1])?.["ReactServerAgent.cache"]?.dataCache ?? {};
    const key = Object.keys(cache).find((k) => k.startsWith("/stingray/api/gis?"));
    const text: string = key ? (cache[key]?.res?.text ?? "") : "";
    homes = JSON.parse(text.replace(/^\{\}&&/, ""))?.payload?.homes ?? [];
  } catch {
    return [];
  }
  const comps: Comp[] = [];
  for (const h of Array.isArray(homes) ? homes : []) {
    const propertyType = REDFIN_COMP_TYPES[h?.propertyType];
    const soldPrice = h?.price?.value;
    if (!propertyType || h?.state !== "DE" || typeof soldPrice !== "number" || soldPrice <= 0) continue;
    const saleLabel: string = (h.sashes ?? []).find((s: any) => s?.lastSaleDate)?.lastSaleDate ?? "";
    const soldAt = typeof h.soldDate === "number" ? h.soldDate : Date.parse(saleLabel) || undefined;
    const sqft = typeof h.sqFt?.value === "number" && h.sqFt.value > 0 ? h.sqFt.value : null;
    const ll = h.latLong?.value;
    comps.push({
      address: `${h.streetLine?.value ?? ""}, ${h.city ?? ""}, DE ${h.zip ?? ""}`,
      soldDate: saleLabel,
      soldPrice,
      beds: typeof h.beds === "number" ? h.beds : null,
      baths: typeof h.baths === "number" ? h.baths : null,
      sqft,
      pricePerSqft: sqft ? soldPrice / sqft : null,
      ...(typeof ll?.latitude === "number" && typeof ll?.longitude === "number" ? { lat: ll.latitude, lng: ll.longitude } : {}),
      propertyType,
      ...(soldAt ? { soldAt } : {}),
    });
  }
  return comps;
}
```
(Verified against a live 1.7 MB page: 237 comps in ~8 ms, all with coords + sold date.)

- [ ] **Step 4: Scrape helper** — `convex/monitorScrape.ts`: `interface V2ScrapeData {` -> `export interface V2ScrapeData {`. Replace the Redfin doc comment + signature with:
```ts
/**
 * Scrape a ZIP's Redfin "recently sold" page (`buildRedfinSoldUrl`) and return BOTH
 * formats: rawHtml carries the embedded gis payload (`parseRedfinGisComps` — coords,
 * home type, sold date) and markdown is the `parseRedfinComps` fallback. Same spaced
 * shell/transient retry as `scrapeZillowJson` (Firecrawl `proxy:"auto"`,
 * `waitFor:5000`). null after the budget's retries are exhausted.
 */
export async function scrapeRedfinSold(
  zip: string,
  apiKey: string,
  budget?: ScrapeBudget,
): Promise<V2ScrapeData | null> {
```
and inside its loop `return data.markdown;` -> `return data;`.

- [ ] **Step 5: Wire `compsForZip`** — `convex/monitorActions.ts`: imports become
```ts
import { scrapeZillowJson, scrapeRedfinSold } from "./monitorScrape";
```
```ts
import { parseZip, parseRedfinComps, parseRedfinGisComps, type Comp } from "../src/scraper/comps";
```
In `compsForZip` replace the two lines `const md = await scrapeRedfinMarkdown(...)` / `const comps = md ? parseRedfinComps(md) : [];` with:
```ts
  const page = await scrapeRedfinSold(zip, apiKey, ANALYZE_SCRAPE_BUDGET);
  // Prefer the embedded gis payload (coords + home type + sold epoch, ~5x the rows);
  // the markdown rows are the fallback if Redfin changes the embed.
  const gis = page ? parseRedfinGisComps(page.rawHtml) : [];
  const comps = gis.length > 0 ? gis : page ? parseRedfinComps(page.markdown) : [];
```
(`storeZipComps` takes `v.array(v.any())`, so the extra fields store without a schema change. Selection is unchanged until Task 8.)

- [ ] **Step 6: Run tests + typechecks** — `npx vitest run` -> 435 passed; both typechecks clean. Confirm no other caller: `git grep -n scrapeRedfinMarkdown -- convex src tests scripts` -> no output.

- [ ] **Step 7: Commit**

```bash
git add src/scraper/comps.ts convex/monitorScrape.ts convex/monitorActions.ts tests/redfinGis.test.ts tests/monitorScrape.test.ts
git commit -m "feat(monitor): parse Redfin gis payload for comps (coords, home type, sold date)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 8: Comps by distance + type; as-is value vs ARV — S9, S10

**Files:**
- Modify: `src/scraper/monitorListings.ts` (MONITOR; comps import; replace `conservativeArv`; `StoredListing` + `dealInputFromStored`)
- Modify: `convex/monitorActions.ts` (`conservativeArv` call; `valueBasis`; patch `asIsValue`)
- Modify: `convex/monitorData.ts` (`analysisFields.asIsValue`), `convex/schema.ts` (`asIsValue`)
- Test: `tests/monitorComps.test.ts` (create); `tests/monitorListings.test.ts` (existing `conservativeArv` calls gain `now`)

**Interfaces:**
- Consumes: `Comp`, `CompType` (Task 7).
- Produces:
  - `MONITOR.compRadiiMi = [0.5, 1]`, `compMinCount = 3`, `compMaxCount = 10`, `compMaxAgeDays = 183`, `arvPercentile = 0.75`
  - `subjectCompType(homeType): CompType | null`; `distanceMi(aLat, aLng, bLat, bLng): number`
  - `interface CompSubject { lat: number | null; lng: number | null; sqft: number; beds: number | null; compType: CompType | null }`
  - `selectMonitorComps(comps: Comp[], s: CompSubject, now: number): Comp[]`
  - `interface Valuation { arv: number | null; asIsValue: number | null; source: "comps" | "zestimate" | "none"; compsPpsf: number | null; compsCount: number }`
  - `conservativeArv(opts: { comps; sqft; beds; zestimate; homeType?; lat?: number | null; lng?: number | null; now: number }): Valuation` (`now` is now REQUIRED)
  - `StoredListing` gains `asIsValue?: number`.

- [ ] **Step 1: Write the failing tests** — create `tests/monitorComps.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { selectMonitorComps, conservativeArv, subjectCompType, distanceMi, MONITOR } from "../src/scraper/monitorListings";
import type { Comp, CompType } from "../src/scraper/comps";

const NOW = Date.parse("2026-10-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const S_LAT = 39.75, S_LNG = -75.55;
// ~0.0145 deg latitude per mile at this latitude.
const MI = 1 / 69.05;
let n = 0;
const comp = (o: { mi?: number; type?: CompType; ppsf?: number; sqft?: number; beds?: number; daysAgo?: number; legacy?: boolean }): Comp => {
  const sqft = o.sqft ?? 1200, ppsf = o.ppsf ?? 200;
  const base: Comp = { address: `${++n} Test St`, soldDate: "SEP 1, 2026", soldPrice: ppsf * sqft, beds: o.beds ?? 3, baths: 1.5, sqft, pricePerSqft: ppsf };
  if (o.legacy) return base;
  return { ...base, lat: S_LAT + (o.mi ?? 0.2) * MI, lng: S_LNG, propertyType: o.type ?? "townhouse", soldAt: NOW - (o.daysAgo ?? 30) * DAY };
};
const SUBJ = { lat: S_LAT, lng: S_LNG, sqft: 1200, beds: 3, compType: "townhouse" as CompType };

describe("subjectCompType / distanceMi", () => {
  it("maps Zillow homeType to the Redfin comp class", () => {
    expect(subjectCompType("TOWNHOUSE")).toBe("townhouse");
    expect(subjectCompType("SINGLE_FAMILY")).toBe("sfr");
    expect(subjectCompType("MANUFACTURED")).toBeNull();
    expect(subjectCompType(undefined)).toBeNull();
  });
  it("haversine miles", () => {
    expect(distanceMi(S_LAT, S_LNG, S_LAT + MI, S_LNG)).toBeCloseTo(1, 2);
  });
});

describe("selectMonitorComps", () => {
  it("same type only — a rowhome is never priced off detached sales", () => {
    const out = selectMonitorComps([comp({ type: "sfr" }), comp({ type: "sfr" }), comp({ type: "sfr" }), comp({}), comp({}), comp({})], SUBJ, NOW);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.propertyType === "townhouse")).toBe(true);
  });
  it("0.5 mi ring when it has >= 3", () => {
    const out = selectMonitorComps([comp({ mi: 0.1 }), comp({ mi: 0.3 }), comp({ mi: 0.45 }), comp({ mi: 0.9 }), comp({ mi: 3 })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("expands to 1 mi when 0.5 mi has < 3", () => {
    const out = selectMonitorComps([comp({ mi: 0.1 }), comp({ mi: 0.7 }), comp({ mi: 0.9 }), comp({ mi: 3 })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("falls back to the whole same-type ZIP pool, nearest first", () => {
    const far = comp({ mi: 3 }), farther = comp({ mi: 4 }), near = comp({ mi: 0.2 });
    const out = selectMonitorComps([farther, far, near], SUBJ, NOW);
    expect(out.map((c) => c.address)).toEqual([near.address, far.address, farther.address]);
  });
  it("drops sales older than compMaxAgeDays", () => {
    expect(MONITOR.compMaxAgeDays).toBe(183);
    const out = selectMonitorComps([comp({}), comp({}), comp({}), comp({ daysAgo: 200 })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("typed comps + unknown subject type -> none (no cross-type fallback)", () => {
    expect(selectMonitorComps([comp({}), comp({}), comp({})], { ...SUBJ, compType: null }, NOW)).toEqual([]);
  });
  it("subject without coordinates -> same-type ZIP pool", () => {
    const out = selectMonitorComps([comp({ mi: 0.1 }), comp({ mi: 5 }), comp({ mi: 9 })], { ...SUBJ, lat: null, lng: null }, NOW);
    expect(out).toHaveLength(3);
  });
  it("legacy untyped comps (markdown / old cache) pass type + distance unfiltered", () => {
    const out = selectMonitorComps([comp({ legacy: true }), comp({ legacy: true }), comp({ legacy: true })], SUBJ, NOW);
    expect(out).toHaveLength(3);
  });
  it("applies the sqft +-30% band when it leaves >= 3", () => {
    const out = selectMonitorComps([comp({}), comp({}), comp({}), comp({ sqft: 3000 })], SUBJ, NOW);
    expect(out.map((c) => c.sqft)).toEqual([1200, 1200, 1200]);
  });
  it("caps at compMaxCount", () => {
    const many = Array.from({ length: 15 }, () => comp({}));
    expect(selectMonitorComps(many, SUBJ, NOW)).toHaveLength(MONITOR.compMaxCount);
  });
});

describe("conservativeArv v2 (as-is = median, ARV = 75th pct)", () => {
  const four = [comp({ ppsf: 100 }), comp({ ppsf: 150 }), comp({ ppsf: 200 }), comp({ ppsf: 250 })];
  const base = { comps: four, sqft: 1200, beds: 3, homeType: "TOWNHOUSE", lat: S_LAT, lng: S_LNG, now: NOW };
  it("median 175 -> as-is 210,000; p75 212.5 -> ARV 255,000", () => {
    expect(conservativeArv({ ...base, zestimate: null })).toEqual({ arv: 255000, asIsValue: 210000, source: "comps", compsPpsf: 175, compsCount: 4 });
  });
  it("ARV capped at 1.15 x Zestimate; as-is is not capped", () => {
    const r = conservativeArv({ ...base, zestimate: 200000 });
    expect(r.arv).toBe(230000);
    expect(r.asIsValue).toBe(210000);
  });
  it("fewer than compMinCount comps -> Zestimate for both values", () => {
    expect(conservativeArv({ ...base, comps: four.slice(0, 2), zestimate: 190000 })).toEqual({ arv: 190000, asIsValue: 190000, source: "zestimate", compsPpsf: null, compsCount: 0 });
  });
});
```
In `tests/monitorListings.test.ts`: directly above `const mkComp = ...` add `const NOW = Date.parse("2026-10-01T00:00:00Z");`, and add `, now: NOW` to all five existing `conservativeArv({...})` calls (three in `describe("conservativeArv")`, two in the Task-4 block), e.g. `homeType: "SINGLE_FAMILY", now: NOW })`. Their expectations do not change (the `mkComp` comps are untyped legacy comps).

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/monitorComps.test.ts` -> FAIL (not exported).

- [ ] **Step 3: Implement** — `src/scraper/monitorListings.ts`:

MONITOR, after the `cashFlowFloor` line:
```ts
  // Comps (Phase 2): same type, sold <= compMaxAgeDays, nearest ring with >= compMinCount.
  compRadiiMi: [0.5, 1], compMinCount: 3, compMaxCount: 10, compMaxAgeDays: 183,
  arvPercentile: 0.75, // ARV = 75th-pct comps $/sqft (renovated proxy); as-is = median
```
Replace `import { selectComps, suggestArv, type Comp } from "./comps";` with:
```ts
import type { Comp, CompType } from "./comps";
```
Replace the whole `export function conservativeArv(...) { ... }` with:
```ts
// Subject -> Redfin comp class. null = type unknown (never priced off typed comps).
export function subjectCompType(homeType: string | null | undefined): CompType | null {
  const t = (homeType || "").trim().toUpperCase();
  return t === "TOWNHOUSE" ? "townhouse" : t === "SINGLE_FAMILY" ? "sfr" : null;
}

// Great-circle distance in miles (haversine).
export function distanceMi(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

export interface CompSubject { lat: number | null; lng: number | null; sqft: number; beds: number | null; compType: CompType | null; }
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Monitor comp selection (replaces the ZIP-wide "first 8"): same home type ->
 * sold within compMaxAgeDays -> nearest ring with >= compMinCount (0.5 mi, then 1 mi,
 * else the whole same-type ZIP pool) -> sqft +-30% / beds +-1 band when it still
 * leaves enough -> nearest first, capped. Typed comps never widen across types
 * (08-08 lesson); untyped legacy rows (markdown fallback / pre-deploy zipComps
 * cache) carry no type or coords and pass those two steps unfiltered.
 */
export function selectMonitorComps(comps: Comp[], s: CompSubject, now: number): Comp[] {
  let pool = comps.filter((c) => c.pricePerSqft != null);
  if (pool.some((c) => c.propertyType)) {
    if (!s.compType) return [];
    pool = pool.filter((c) => c.propertyType === s.compType);
  }
  pool = pool.filter((c) => c.soldAt == null || now - c.soldAt <= MONITOR.compMaxAgeDays * DAY_MS);
  const dist = (c: Comp): number | null =>
    s.lat != null && s.lng != null && c.lat != null && c.lng != null ? distanceMi(s.lat, s.lng, c.lat, c.lng) : null;
  for (const r of MONITOR.compRadiiMi) {
    const ring = pool.filter((c) => { const d = dist(c); return d != null && d <= r; });
    if (ring.length >= MONITOR.compMinCount) { pool = ring; break; }
  }
  const band = pool.filter((c) =>
    c.sqft != null && c.sqft >= s.sqft * 0.7 && c.sqft <= s.sqft * 1.3 &&
    (s.beds == null || c.beds == null || Math.abs(c.beds - s.beds) <= 1));
  if (band.length >= MONITOR.compMinCount) pool = band;
  const key = (c: Comp) => dist(c) ?? Number.MAX_VALUE;
  return [...pool].sort((a, b) => key(a) - key(b)).slice(0, MONITOR.compMaxCount);
}

// Linear-interpolated percentile of an ASCENDING array (p in 0..1).
function percentile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface Valuation {
  arv: number | null;       // after-repair: 75th-pct comps $/sqft x sqft (renovated proxy), capped 1.15 x Zestimate
  asIsValue: number | null; // as-is: median comps $/sqft x sqft (the no-Zestimate spread basis)
  source: "comps" | "zestimate" | "none";
  compsPpsf: number | null; // median $/sqft (dealSignals' ppsf discount)
  compsCount: number;
}
export function conservativeArv(opts: { comps: Comp[]; sqft: number | null; beds: number | null; zestimate: number | null; homeType?: string; lat?: number | null; lng?: number | null; now: number }): Valuation {
  const z = opts.zestimate ?? null;
  const fallback: Valuation = { arv: z, asIsValue: z, source: z ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
  const manufactured = (opts.homeType || "").toUpperCase() === "MANUFACTURED";
  // sqft unknown (null/0) -> comps $/sqft can't price it and the median-soldPrice
  // fallback crosses sizes/types (08-08 lesson): Zestimate or nothing (VERIFY flag).
  if (manufactured || opts.sqft == null || !(opts.sqft > 0)) return fallback;
  const sel = selectMonitorComps(opts.comps, {
    lat: opts.lat ?? null, lng: opts.lng ?? null, sqft: opts.sqft, beds: opts.beds, compType: subjectCompType(opts.homeType),
  }, opts.now);
  if (sel.length < MONITOR.compMinCount) return fallback;
  const ppsf = sel.map((c) => c.pricePerSqft as number).sort((a, b) => a - b);
  const med = percentile(ppsf, 0.5);
  let arv = Math.round(percentile(ppsf, MONITOR.arvPercentile) * opts.sqft);
  // Sanity cap kept: Zestimate ~ as-is value, so 1.15x bounds the renovation uplift
  // (research §1.1: renovated premium ~$25-35/sqft) and still catches type/size-skewed pools.
  if (z && arv > z * 1.15) arv = Math.round(z * 1.15);
  return { arv, asIsValue: Math.round(med * opts.sqft), source: "comps", compsPpsf: Math.round(med), compsCount: sel.length };
}
```
Re-gate adapter: add `asIsValue?: number;` to `StoredListing` (after `conservativeArv?: number;`) and in `dealInputFromStored` replace `valueBasis: arv,` with:
```ts
    // Old rows have no asIsValue; their median-based conservativeArv is as-is-like.
    valueBasis: sqftKnown ? (r.asIsValue ?? arv) : arv,
```

- [ ] **Step 4: Run the pure tests** — `npx vitest run` -> 450 passed.

- [ ] **Step 5: Schema + wiring**

`convex/schema.ts` (`monitorListings`) replace `conservativeArv: v.optional(v.number()),` with:
```ts
    conservativeArv: v.optional(v.number()), // after-repair value (75th-pct comps $/sqft since Phase 2)
    asIsValue: v.optional(v.number()), // as-is value (median comps $/sqft) — no-Zestimate spread basis
```
`convex/monitorData.ts` `analysisFields`, after `conservativeArv: v.optional(v.number()),` add `asIsValue: v.optional(v.number()),`.

`convex/monitorActions.ts` `analyzeOne`:
```ts
      const arvRes = conservativeArv({ comps, sqft, beds: bedsNum, zestimate, homeType, lat: row.lat ?? null, lng: row.lng ?? null, now: Date.now() });
```
In `dealInput`, `valueBasis: arv,` -> `valueBasis: arvRes.asIsValue,`. In the patch, after `...(arv != null ? { conservativeArv: arv } : {}),` add:
```ts
          ...(arvRes.asIsValue != null ? { asIsValue: arvRes.asIsValue } : {}),
```

- [ ] **Step 6: Validate** — `npx tsc --noEmit`, `npx tsc --noEmit -p convex` clean; PowerShell `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once` succeeds; `npx vitest run` -> 450 passed.

- [ ] **Step 7: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorActions.ts convex/monitorData.ts convex/schema.ts tests/monitorComps.test.ts tests/monitorListings.test.ts convex/_generated
git commit -m "feat(monitor): comps by distance + home type; as-is (median) vs ARV (p75) values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 9: Rehab = max(keyword, LLM conditionTier) + systems tier + era add-ons — S11

**Files:**
- Modify: `src/scraper/monitorListings.ts` (MONITOR; flip import; new `monitorRehab` above `RentalMetrics`; `analyzeFlip` hold param; `DealInput.holdingMonths`; `evaluateDeal`; `StoredListing` + `dealInputFromStored`)
- Modify: `convex/monitorActions.ts` (imports; step 4; pre/final `evaluateDeal`; flags; patch)
- Modify: `convex/monitorData.ts` (`regateKeepers` patches the recomputed `rehabEstimate`)
- Test: `tests/monitorListings.test.ts` (append; update three Task-6 adapter tests; extend the `import { analyzeFlip, ...` line)

**Interfaces:**
- Consumes: `REHAB_TIERS`, `FLIP_DEFAULTS`, `estimateRehab` (flip.ts); `JudgeVerdict.conditionTier` (`"cosmetic" | "moderate" | "systems" | "structural" | null`).
- Produces:
  - `MONITOR.systemsPerSqft = 55`, `leadPaintBeforeYear = 1978`, `leadPaintAddOn = 3000`, `rewireBeforeYear = 1950`, `rewireAddOn = 15000`, `gutHoldingMonths = 9`
  - `type MonitorRehabTier = "cosmetic" | "moderate" | "systems" | "gut"`
  - `interface MonitorRehab { tier: MonitorRehabTier; total: number | null; holdingMonths: number; addOns: string[] }`
  - `monitorRehab(o: { sqft: number | null | undefined; keywordTier: string | null | undefined; conditionTier: string | null | undefined; yearBuilt: number | null | undefined }): MonitorRehab`
  - `analyzeFlip(arv, list, rehab, holdingMonths = 6)`
  - `DealInput.holdingMonths?: number`
  - `StoredListing`: REMOVES `rehabEstimate`; ADDS `rehabTier?: string; conditionTier?: string; yearBuilt?: number`. `dealInputFromStored` now returns `holdingMonths` too.

- [ ] **Step 1: Write the failing tests** — add `monitorRehab` to the `import { analyzeFlip, ...` line. Append:
```ts
describe("monitorRehab (max of keyword tier and LLM conditionTier + era add-ons)", () => {
  it("LLM systems over keyword moderate: 55 x 1000 x 1.10 + lead paint 3,000", () => {
    expect(monitorRehab({ sqft: 1000, keywordTier: "moderate", conditionTier: "systems", yearBuilt: 1960 }))
      .toEqual({ tier: "systems", total: 63500, holdingMonths: 6, addOns: ["pre-1978 lead paint +$3,000"] });
  });
  it("structural = gut: 95 x 1000 x 1.10 + lead, no rewire add-on (gut includes it), 9-month hold", () => {
    expect(monitorRehab({ sqft: 1000, keywordTier: "cosmetic", conditionTier: "structural", yearBuilt: 1940 }))
      .toEqual({ tier: "gut", total: 107500, holdingMonths: 9, addOns: ["pre-1978 lead paint +$3,000"] });
  });
  it("the LLM can never LOWER the scope", () => {
    expect(monitorRehab({ sqft: 1000, keywordTier: "gut", conditionTier: "cosmetic", yearBuilt: 2000 }).tier).toBe("gut");
  });
  it("pre-1950 non-gut: lead + rewire add-ons", () => {
    expect(monitorRehab({ sqft: 1000, keywordTier: "moderate", conditionTier: null, yearBuilt: 1940 }).total).toBe(46200 + 3000 + 15000);
  });
  it("no yearBuilt -> no add-ons; unknown keyword tier -> moderate", () => {
    expect(monitorRehab({ sqft: 1000, keywordTier: undefined, conditionTier: undefined, yearBuilt: null }))
      .toEqual({ tier: "moderate", total: 46200, holdingMonths: 6, addOns: [] });
  });
  it("sqft unknown -> total null (add-ons never price an unknown house)", () => {
    expect(monitorRehab({ sqft: 0, keywordTier: "moderate", conditionTier: null, yearBuilt: 1940 }).total).toBeNull();
  });
});

describe("analyzeFlip holding months", () => {
  it("a 9-month gut hold costs 3 more months of interest + holding (ARV 300k / list 180k / rehab 30k)", () => {
    expect(analyzeFlip(300000, 180000, 30000)!.profit).toBe(42000);
    expect(analyzeFlip(300000, 180000, 30000, 9)!.profit).toBe(35520);
  });
});
```
Update the Task-6 `dealInputFromStored` tests (the adapter now RECOMPUTES rehab, so `rehabEstimate` is no longer an input):
- Replace the `it("maps a normal stored row", ...)` test with:
```ts
  it("maps a normal stored row; rehab recomputed (moderate 42/sqft x 1500 x 1.10)", () => {
    expect(dealInputFromStored({ listPrice: 180000, zestimate: 250000, conservativeArv: 300000, sqft: 1500, rentZestimate: 1900, description: "needs TLC", riskFlags: [] }))
      .toEqual({ listPrice: 180000, zestimate: 250000, valueBasis: 300000, arv: 300000, rehabTotal: 69300, rent: 1900, renovated: false, holdingMonths: 6 });
  });
  it("re-derives the keyword tier from the stored description (old fireplace rows were 'gut')", () => {
    const i = dealInputFromStored({ sqft: 1000, rehabTier: "gut", description: "Brick fireplace, needs TLC", yearBuilt: 1985 });
    expect(i.rehabTotal).toBe(46200); // moderate, not gut
    expect(i.holdingMonths).toBe(6);
  });
  it("LLM conditionTier raises the recomputed scope", () => {
    const i = dealInputFromStored({ sqft: 1000, description: "needs TLC", conditionTier: "structural", yearBuilt: 1985 });
    expect(i.rehabTotal).toBe(104500);
    expect(i.holdingMonths).toBe(9);
  });
```
- In the "old sqft-0 row" test remove `rehabEstimate: 0, ` from the input; in the "old distress-only keeper" test remove `rehabEstimate: 64680, ` (expectations unchanged).

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/monitorListings.test.ts` -> FAIL (`monitorRehab` missing; `holdingMonths` absent; 9-month profit equals 42000).

- [ ] **Step 3: Implement** — `src/scraper/monitorListings.ts`:

MONITOR, after the `arvPercentile` line:
```ts
  // Rehab (Phase 2): systems tier + era add-ons (research §4) + longer gut hold.
  systemsPerSqft: 55, leadPaintBeforeYear: 1978, leadPaintAddOn: 3000,
  rewireBeforeYear: 1950, rewireAddOn: 15000, gutHoldingMonths: 9,
```
Flip import: `import { estimateRehab, computeFlip, FLIP_DEFAULTS, REHAB_TIERS, type FlipAssumptions } from "./flip";`

Directly above `export interface RentalMetrics`:
```ts
// Monitor rehab scope: max(description keyword tier, LLM conditionTier) — the judge
// can only RAISE the scope (costs up, margins down), so it can never create a keep.
// "systems" (mechanicals/roof/electrical) sits between moderate and gut. Era add-ons
// (research §4) are flat, outside the contingency; a gut already includes the rewire.
export type MonitorRehabTier = "cosmetic" | "moderate" | "systems" | "gut";
const TIER_RANK: Record<MonitorRehabTier, number> = { cosmetic: 0, moderate: 1, systems: 2, gut: 3 };
function toMonitorTier(t: string | null | undefined): MonitorRehabTier | null {
  if (t === "cosmetic" || t === "moderate" || t === "systems" || t === "gut") return t;
  return t === "structural" ? "gut" : null; // judge conditionTier "structural" = gut scope
}
export interface MonitorRehab { tier: MonitorRehabTier; total: number | null; holdingMonths: number; addOns: string[]; }
export function monitorRehab(o: { sqft: number | null | undefined; keywordTier: string | null | undefined; conditionTier: string | null | undefined; yearBuilt: number | null | undefined }): MonitorRehab {
  const k = toMonitorTier(o.keywordTier) ?? "moderate";
  const c = toMonitorTier(o.conditionTier);
  const tier = c && TIER_RANK[c] > TIER_RANK[k] ? c : k;
  const perSqft = tier === "systems" ? MONITOR.systemsPerSqft : REHAB_TIERS[tier].perSqft;
  const base = estimateRehab(perSqft, o.sqft ?? null, FLIP_DEFAULTS.contingencyPct).total;
  const addOns: string[] = [];
  let extra = 0;
  const yb = o.yearBuilt ?? 0;
  if (yb > 0 && yb < MONITOR.leadPaintBeforeYear) { extra += MONITOR.leadPaintAddOn; addOns.push(`pre-${MONITOR.leadPaintBeforeYear} lead paint +$${MONITOR.leadPaintAddOn.toLocaleString("en-US")}`); }
  if (yb > 0 && yb < MONITOR.rewireBeforeYear && tier !== "gut") { extra += MONITOR.rewireAddOn; addOns.push(`pre-${MONITOR.rewireBeforeYear} wiring +$${MONITOR.rewireAddOn.toLocaleString("en-US")}`); }
  return {
    tier,
    total: base == null ? null : Math.round(base + extra),
    holdingMonths: tier === "gut" ? MONITOR.gutHoldingMonths : MONITOR_FLIP_ASSUMPTIONS.holdingMonths,
    addOns,
  };
}
```
`analyzeFlip` head:
```ts
export function analyzeFlip(arv: number | null, list: number | null, rehab: number, holdingMonths: number = MONITOR_FLIP_ASSUMPTIONS.holdingMonths) {
  if (arv == null || list == null) return null;
  const m = computeFlip({ arv, purchasePrice: list, rehabTotal: rehab, assumptions: { ...MONITOR_FLIP_ASSUMPTIONS, holdingMonths } });
```
`DealInput`, after `renovated: boolean; ...`:
```ts
  holdingMonths?: number;    // flip hold (monitorRehab: 9 for a gut, else the 6-month default)
```
`evaluateDeal`: `analyzeFlip(i.arv, i.listPrice, i.rehabTotal)` -> `analyzeFlip(i.arv, i.listPrice, i.rehabTotal, i.holdingMonths)`.

Replace the re-gate adapter block (from the `// Re-gate adapter:` comment through the end of `dealInputFromStored`) with:
```ts
// Re-gate adapter: rebuild a DealInput from a STORED monitorListings row (no scraping).
// Old-row rules: sqft unknown -> rehab unknown and ARV = Zestimate-or-null (the old
// median-soldPrice ARV and $0 rehab are discarded); rehab is RECOMPUTED with the
// current tiers/add-ons from the stored description + conditionTier + yearBuilt;
// renovated = stored RENOVATED flag OR the current detector on the stored description.
export interface StoredListing {
  listPrice?: number;
  zestimate?: number;
  conservativeArv?: number;
  asIsValue?: number;
  sqft?: number;
  rehabTier?: string;
  conditionTier?: string;
  yearBuilt?: number;
  rentZestimate?: number;
  description?: string;
  riskFlags?: string[];
}
export function dealInputFromStored(r: StoredListing): DealInput {
  const sqftKnown = r.sqft != null && r.sqft > 0;
  const arv = sqftKnown ? (r.conservativeArv ?? null) : (r.zestimate ?? null);
  const rehab = monitorRehab({
    sqft: r.sqft,
    keywordTier: r.description != null ? inferRehabTier(r.description) : r.rehabTier,
    conditionTier: r.conditionTier,
    yearBuilt: r.yearBuilt,
  });
  return {
    listPrice: r.listPrice ?? null,
    zestimate: r.zestimate ?? null,
    // Old rows have no asIsValue; their median-based conservativeArv is as-is-like.
    valueBasis: sqftKnown ? (r.asIsValue ?? arv) : arv,
    arv,
    rehabTotal: rehab.total,
    rent: r.rentZestimate ?? null,
    renovated: (r.riskFlags ?? []).some((f) => f.startsWith("RENOVATED")) || detectRenovated(r.description),
    holdingMonths: rehab.holdingMonths,
  };
}
```

- [ ] **Step 4: Run the pure tests** — `npx vitest run` -> 459 passed.

- [ ] **Step 5: Wire `analyzeOne`** — `convex/monitorActions.ts`:
Imports: add `monitorRehab,` after `inferRehabTier,`; remove `estimateRehab,`; delete the line `import { REHAB_TIERS, FLIP_DEFAULTS } from "../src/scraper/flip";` (both now unused).
Replace step 4:
```ts
      // 4) Rehab: description keyword tier now; re-scoped after the judge (step 9b)
      // with max(keyword, LLM conditionTier) — the LLM can only raise costs.
      const rehabTier = inferRehabTier(description);
      const yearBuilt = detail?.yearBuilt ?? row.yearBuilt ?? null;
      const preRehab = monitorRehab({ sqft, keywordTier: rehabTier, conditionTier: null, yearBuilt });
```
In `dealInput` delete the `rehabTotal: rehab.total,` line, and replace the `pre` line with:
```ts
      const pre = evaluateDeal({
        ...dealInput,
        rehabTotal: preRehab.total,
        holdingMonths: preRehab.holdingMonths,
        renovated: detectRenovated(description),
      });
```
After `if (renovated) flags.push("RENOVATED (no flip)");` insert:
```ts
      const rehab = monitorRehab({ sqft, keywordTier: rehabTier, conditionTier: verdict?.conditionTier ?? null, yearBuilt });
      if (rehab.tier === "gut" && !flags.includes("heavy-rehab")) flags.push("heavy-rehab");
      flags.push(...rehab.addOns);
```
and change the final decision line to:
```ts
      const deal = evaluateDeal({ ...dealInput, rehabTotal: rehab.total, holdingMonths: rehab.holdingMonths, renovated });
```
In the patch: `rehabTier,` -> `rehabTier: rehab.tier,` and `...(rehab.total != null ? { rehabEstimate: Math.round(rehab.total) } : {}),` -> `...(rehab.total != null ? { rehabEstimate: rehab.total } : {}),`. (The judge prompt keeps the keyword `rehabTier` — it is the preliminary view.)

`convex/monitorData.ts` `regateKeepers` loop: replace `const d = evaluateDeal(dealInputFromStored(row));` with
```ts
      const input = dealInputFromStored(row);
      const d = evaluateDeal(input);
```
and in the patch object add after `...decisionFields(d),`:
```ts
        rehabEstimate: input.rehabTotal ?? undefined, // re-scoped with the current tiers/add-ons
```

- [ ] **Step 6: Validate** — `npx vitest run` -> 459 passed; `npx tsc --noEmit`; `npx tsc --noEmit -p convex` -> clean.

- [ ] **Step 7: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorActions.ts convex/monitorData.ts tests/monitorListings.test.ts
git commit -m "feat(monitor): rehab = max(keyword, LLM conditionTier), systems tier, era add-ons, gut hold

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 10: Rental realism — lease rent, real tax rate, 35% opex, DSCR, BRRRR — S12

**Files:**
- Modify: `src/scraper/monitorListings.ts` (MONITOR; `ListingDetail` + `detailFromCache`; `RentalMetrics`; `analyzeRental`; new `parseLeaseRent`, `rentForListing`; `meetsRentalFloor`; `DealInput.taxRatePct`; `DealDecision.brrrrCashLeftIn`; `evaluateDeal`; `StoredListing`/`dealInputFromStored`; `decisionFields`)
- Modify: `convex/monitorActions.ts`, `convex/monitorData.ts` (`analysisFields`, `clearRental`), `convex/schema.ts`
- Test: `tests/monitorRental.test.ts` (create); `tests/monitorListings.test.ts` (update rental expectations)

**Interfaces:**
- Produces:
  - `MONITOR.rentalOpexPct = 0.35`, `rentalTaxFallbackPct = 1.6`, `dscrBar = 1.2`, `brrrrRefiLtv = 0.75`
  - `ListingDetail.propertyTaxRate: number | null` (percent)
  - `RentalMetrics` adds `dscr: number; taxEstimated: boolean`
  - `analyzeRental({ rent, list, rehab, taxRatePct?: number | null })`
  - `parseLeaseRent(description: string | null | undefined): number | null`
  - `rentForListing(description, rentZestimate): { rent: number | null; leaseRent: number | null }`
  - `meetsRentalFloor` also requires `dscr >= MONITOR.dscrBar`
  - `DealInput.taxRatePct?: number | null`; `DealDecision.brrrrCashLeftIn: number | null`
  - `StoredListing.propertyTaxRatePct?: number`; `decisionFields` adds `dscr`, `brrrrCashLeftIn`
  - Row fields: `dscr`, `brrrrCashLeftIn`, `leaseRent`, `propertyTaxRatePct`

- [ ] **Step 1: Write the failing tests** — create `tests/monitorRental.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { analyzeRental, parseLeaseRent, rentForListing, detailFromCache, evaluateDeal, dealInputFromStored, MONITOR } from "../src/scraper/monitorListings";

describe("analyzeRental v2 (35% opex, real tax rate, DSCR)", () => {
  it("constants", () => {
    expect(MONITOR.rentalOpexPct).toBe(0.35);
    expect(MONITOR.rentalTaxFallbackPct).toBe(1.6);
    expect(MONITOR.dscrBar).toBe(1.2);
  });
  it("no rate -> 1.6% fallback, flagged estimated", () => {
    const r = analyzeRental({ rent: 2000, list: 150000, rehab: 20000 })!;
    expect(r.taxEstimated).toBe(true);
    expect(r.cashFlow).toBe(114);
    expect(r.capRate).toBeCloseTo(0.07094, 5);
  });
  it("listing rate 0.68% -> lower tax, not estimated", () => {
    const r = analyzeRental({ rent: 2000, list: 150000, rehab: 20000, taxRatePct: 0.68 })!;
    expect(r.taxEstimated).toBe(false);
    expect(r.cashFlow).toBe(229);
    expect(r.dscr).toBeCloseTo(1.256, 3);
  });
  it("a 0 / negative rate is treated as missing", () => {
    expect(analyzeRental({ rent: 2000, list: 150000, rehab: 20000, taxRatePct: 0 })!.taxEstimated).toBe(true);
  });
});

describe("parseLeaseRent", () => {
  it("reads stated leases", () => {
    expect(parseLeaseRent("Tenant occupied, rents for $1,450/mo through June")).toBe(1450);
    expect(parseLeaseRent("Current rent is $1,250. Great investment")).toBe(1250);
    expect(parseLeaseRent("Currently rented at $1,300 per month")).toBe(1300);
    expect(parseLeaseRent("Leased at $1500 until 2027")).toBe(1500);
    expect(parseLeaseRent("Tenant pays $1,200 monthly")).toBe(1200);
    expect(parseLeaseRent("Rented for 1100/mo, tenant wants to stay")).toBe(1100);
    expect(parseLeaseRent("Rent: $950")).toBe(950);
  });
  it("ignores years, hypothetical rent, annual totals and no-$ amounts", () => {
    expect(parseLeaseRent("Rented 2024, tenant in place")).toBeNull();
    expect(parseLeaseRent("Market rent $2,100 per Zillow")).toBeNull();
    expect(parseLeaseRent("Could rent for $1,800 after rehab")).toBeNull();
    expect(parseLeaseRent("Potential rent of $2,000")).toBeNull();
    expect(parseLeaseRent("Gross rents $24,000 annually")).toBeNull();
    expect(parseLeaseRent("Rental property near the park")).toBeNull();
    expect(parseLeaseRent("")).toBeNull();
    expect(parseLeaseRent(undefined)).toBeNull();
  });
});

describe("rentForListing", () => {
  it("a stated lease caps the rentZestimate (min of both)", () => {
    expect(rentForListing("rents for $1,450/mo", 1900)).toEqual({ rent: 1450, leaseRent: 1450 });
    expect(rentForListing("rents for $2,450/mo", 1900)).toEqual({ rent: 1900, leaseRent: 2450 });
  });
  it("lease only / Zestimate only / neither", () => {
    expect(rentForListing("rents for $1,450/mo", null)).toEqual({ rent: 1450, leaseRent: 1450 });
    expect(rentForListing("no lease info", 1900)).toEqual({ rent: 1900, leaseRent: null });
    expect(rentForListing(null, undefined)).toEqual({ rent: null, leaseRent: null });
  });
});

describe("detailFromCache propertyTaxRate", () => {
  const nd = (property: Record<string, unknown>) => ({
    props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify({ 'ForSaleFullRenderQuery{"zpid":1}': { property } }) } } },
  });
  it("reads Zillow's per-property rate (percent)", () => {
    expect(detailFromCache(nd({ propertyTaxRate: 0.68 }))!.propertyTaxRate).toBe(0.68);
  });
  it("null when absent or non-positive", () => {
    expect(detailFromCache(nd({}))!.propertyTaxRate).toBeNull();
    expect(detailFromCache(nd({ propertyTaxRate: 0 }))!.propertyTaxRate).toBeNull();
  });
});

describe("BRRRR + re-gate rental inputs", () => {
  it("brrrrCashLeftIn = all-in - 75% of ARV (null without ARV or rental)", () => {
    const base = { zestimate: null, valueBasis: null, renovated: false, listPrice: 120000, rehabTotal: 20000, rent: 1900 };
    expect(evaluateDeal({ ...base, arv: 250000 }).brrrrCashLeftIn).toBe(-47500);
    expect(evaluateDeal({ ...base, arv: null }).brrrrCashLeftIn).toBeNull();
    expect(evaluateDeal({ ...base, arv: 250000, rent: null }).brrrrCashLeftIn).toBeNull();
  });
  it("re-gate reads the stored lease + tax rate", () => {
    const i = dealInputFromStored({ rentZestimate: 1900, description: "rents for $1,450/mo", propertyTaxRatePct: 0.68 });
    expect(i.rent).toBe(1450);
    expect(i.taxRatePct).toBe(0.68);
  });
});
```
Update `tests/monitorListings.test.ts` (35% opex + DSCR change these numbers on purpose):
- `rentalOf` helper becomes:
```ts
const rentalOf = (capRate: number, cashFlow: number, dscr = 1.5): RentalMetrics => ({ rent: 0, onePct: 0, capRate, cashFlow, cashOnCash: 0, allIn: 0, dscr, taxEstimated: false });
```
- The RENTAL-floor test title becomes "RENTAL floor = cap >= 6% AND cash flow >= 0 AND DSCR >= 1.2 (all boundaries inclusive)" and its first assertion is replaced by:
```ts
    expect(meetsRentalFloor(rentalOf(0.06, 0, 1.2))).toBe(true);
    expect(meetsRentalFloor(rentalOf(0.09, 300, 1.19))).toBe(false);
```
- Replace the three evaluateDeal rental tests ("RENTAL keeper: rent 2000...", "cap >= 6% but negative cash flow...", "a 4% cap never labels RENTAL...") with:
```ts
  it("RENTAL keeper: rent 2400, list 150k, rehab 20k -> cap 8.9%, +$374/mo, DSCR 1.42", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, rehabTotal: 20000, rent: 2400 });
    expect(d.rental!.cashFlow).toBe(374);
    expect(d.rental!.dscr).toBeCloseTo(1.419, 3);
    expect(d).toMatchObject({ rentScore: 90, bestExit: "RENTAL", keeper: true });
  });
  it("cap 7.1% and +$114/mo but DSCR 1.13 < 1.2 is not a RENTAL (rent 2000, est. 1.6% tax)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, rehabTotal: 20000, rent: 2000 });
    expect(d.rental!.cashFlow).toBe(114);
    expect(d.rental!.dscr).toBeCloseTo(1.127, 3);
    expect(d).toMatchObject({ bestExit: "PASS", keeper: false });
  });
  it("the listing's real tax rate (0.68%) flips that same deal to RENTAL (+$229/mo, DSCR 1.26)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, rehabTotal: 20000, rent: 2000, taxRatePct: 0.68 });
    expect(d.rental!.cashFlow).toBe(229);
    expect(d.rental!.taxEstimated).toBe(false);
    expect(d).toMatchObject({ bestExit: "RENTAL", keeper: true });
  });
  it("cap >= 6% but negative cash flow is not a RENTAL (rent 1780, list 150k -> cap 6.08%, -$29/mo)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 150000, rehabTotal: 20000, rent: 1780 });
    expect(d.rental!.cashFlow).toBe(-29);
    expect(d).toMatchObject({ rentScore: 72, bestExit: "PASS", keeper: false });
  });
  it("a 4.5% cap never labels RENTAL (old scoreDeal did)", () => {
    const d = evaluateDeal({ ...DEAL, listPrice: 200000, rehabTotal: 20000, rent: 1830 });
    expect(d.rental!.capRate).toBeCloseTo(0.0452, 3);
    expect(d).toMatchObject({ rentScore: 40, bestExit: "PASS", keeper: false });
  });
```
- In the Task-9 "maps a normal stored row" expectation add `taxRatePct: null, ` after `rent: 1900, `.
- In `decisionFields` "carries rounded flip profit and rental numbers": replace `expect(f.cashFlow).toBe(436);` with:
```ts
    expect(f.cashFlow).toBe(246);
    expect(f.dscr).toBeCloseTo(1.335, 3);
    expect(f.brrrrCashLeftIn).toBe(-47500); // all-in 140,000 - 0.75 x 250,000 refi
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/monitorRental.test.ts tests/monitorListings.test.ts` -> FAIL.

- [ ] **Step 3: Implement** — `src/scraper/monitorListings.ts`:

MONITOR, after the `gutHoldingMonths` line:
```ts
  // Rental (Phase 2): opex reserve, tax fallback when the listing has no rate, DSCR bar,
  // BRRRR refi LTV (research §5: post-refi DSCR >= ~1.15 at <= 75% LTV).
  rentalOpexPct: 0.35, rentalTaxFallbackPct: 1.6, dscrBar: 1.2, brrrrRefiLtv: 0.75,
```
`ListingDetail`: after the `priceHistory ...; photoUrls: string[];` line add
```ts
  propertyTaxRate: number | null; // percent (e.g. 0.68); Zillow's rate for this property
```
`detailFromCache` return object, after `photoUrls: photos,`:
```ts
    propertyTaxRate: typeof p.propertyTaxRate === "number" && p.propertyTaxRate > 0 ? p.propertyTaxRate : null,
```
`RentalMetrics`:
```ts
export interface RentalMetrics { rent: number; onePct: number; capRate: number; cashFlow: number; cashOnCash: number; allIn: number; dscr: number; taxEstimated: boolean; }
```
Replace `analyzeRental` and add the lease helpers right after it:
```ts
// Opex reserve = rentalOpexPct of rent (vacancy + management + repairs + capex). Tax =
// the listing's own rate (Zillow propertyTaxRate, a percent) else the 1.6% fallback,
// flagged taxEstimated. DSCR = NOI / debt service on the existing loan assumptions
// (75% LTV of all-in, 7.5%, 30 yr).
export function analyzeRental({ rent, list, rehab, taxRatePct }: { rent: number | null; list: number; rehab: number; taxRatePct?: number | null }): RentalMetrics | null {
  if (!rent || !list) return null;
  const allIn = list + (rehab || 0);
  const taxEstimated = taxRatePct == null || !(taxRatePct > 0);
  const ratePct = taxEstimated ? MONITOR.rentalTaxFallbackPct : (taxRatePct as number);
  const taxMo = (list * (ratePct / 100)) / 12, ins = 95, opVar = MONITOR.rentalOpexPct * rent;
  const noiMo = rent - taxMo - ins - opVar;
  const r = 0.075 / 12, loan = 0.75 * allIn, pi = loan * r / (1 - (1 + r) ** -360);
  const cashFlow = noiMo - pi, capRate = (noiMo * 12) / allIn;
  const invested = 0.25 * allIn + 0.03 * list;
  return { rent, onePct: rent / list, capRate, cashFlow: Math.round(cashFlow), cashOnCash: (cashFlow * 12) / invested, allIn, dscr: noiMo / pi, taxEstimated };
}

// Stated lease/current rent in the description ("rents for $1,450/mo", "current rent
// is $1,250", "tenant pays $1,200"). Needs a $ sign or a per-month suffix (so years
// like "rented 2024" never match), skips hypothetical rent ("market/potential/could
// rent"), and only accepts $300-$6,000. null when none.
const LEASE_DOLLAR = /(?<!(?:potential|market|projected|estimated|could|can|would|should|fair)\s)\b(?:current(?:ly)?\s+)?(?:rent(?:s|ed)?|leased?|tenant\s+pays)(?:\s+(?:for|at|is|of))?[\s:]*\$\s?(\d{1,2},?\d{3}|\d{3})(?![\d,])/i;
const LEASE_PER_MONTH = /(?<!(?:potential|market|projected|estimated|could|can|would|should|fair)\s)\b(?:rent(?:s|ed)?|leased?)\s+(?:for|at)\s+(\d{1,2},?\d{3}|\d{3})\s*(?:\/\s*mo(?:nth)?\b|per\s+month|a\s+month|monthly)/i;
export function parseLeaseRent(description: string | null | undefined): number | null {
  const d = description || "";
  const m = d.match(LEASE_DOLLAR) ?? d.match(LEASE_PER_MONTH);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return n >= 300 && n <= 6000 ? n : null;
}
// Rent used for underwriting: a stated lease caps the rentZestimate (min of both).
export function rentForListing(description: string | null | undefined, rentZestimate: number | null | undefined): { rent: number | null; leaseRent: number | null } {
  const leaseRent = parseLeaseRent(description);
  const z = rentZestimate ?? null;
  return { rent: leaseRent != null ? (z != null ? Math.min(leaseRent, z) : leaseRent) : z, leaseRent };
}
```
`meetsRentalFloor` body:
```ts
  return !!rental && rental.capRate >= MONITOR.capRateBar && rental.cashFlow >= MONITOR.cashFlowFloor && rental.dscr >= MONITOR.dscrBar;
```
`DealInput`, after `holdingMonths?: number; ...`:
```ts
  taxRatePct?: number | null; // listing's property-tax rate (percent); null -> 1.6% estimate
```
`DealDecision`, after `keeper: boolean;`:
```ts
  brrrrCashLeftIn: number | null; // all-in minus a 75%-of-ARV refi (negative = cash out)
```
`evaluateDeal`: the rental line passes the rate, and the return adds BRRRR:
```ts
  const rental = i.rehabTotal == null || i.listPrice == null ? null : analyzeRental({ rent: i.rent, list: i.listPrice, rehab: i.rehabTotal, taxRatePct: i.taxRatePct });
```
```ts
  const brrrrCashLeftIn = rental && i.arv != null ? Math.round(rental.allIn - MONITOR.brrrrRefiLtv * i.arv) : null;
  return { belowMarket, spread, spreadPct, flip, rental, ...s, bestExit, keeper: flipOk || rentalOk || belowMarket, brrrrCashLeftIn };
```
`StoredListing`: add `propertyTaxRatePct?: number;` (after `riskFlags`). `dealInputFromStored`: replace `rent: r.rentZestimate ?? null,` with
```ts
    rent: rentForListing(r.description, r.rentZestimate).rent,
    taxRatePct: r.propertyTaxRatePct ?? null,
```
`decisionFields`: after the `cashOnCash` line add
```ts
    dscr: d.rental ? d.rental.dscr : undefined,
    brrrrCashLeftIn: d.brrrrCashLeftIn ?? undefined,
```

- [ ] **Step 4: Run the pure tests** — `npx vitest run` -> 473 passed.

- [ ] **Step 5: Schema + wiring**

`convex/schema.ts` (`monitorListings`), after `cashOnCash: v.optional(v.number()),`:
```ts
    dscr: v.optional(v.number()), // NOI / debt service (RENTAL keeper needs >= 1.2)
    brrrrCashLeftIn: v.optional(v.number()), // all-in minus a 75%-of-ARV refi
    leaseRent: v.optional(v.number()), // stated lease/current rent parsed from the description
    propertyTaxRatePct: v.optional(v.number()), // Zillow per-property tax rate (percent)
```
`convex/monitorData.ts` `analysisFields`, after `cashOnCash: v.optional(v.number()),`:
```ts
  dscr: v.optional(v.number()),
  brrrrCashLeftIn: v.optional(v.number()),
  leaseRent: v.optional(v.number()),
  propertyTaxRatePct: v.optional(v.number()),
```
and the `clearRental` object becomes
```ts
        ? { capRate: undefined, cashFlow: undefined, onePctRule: undefined, cashOnCash: undefined, dscr: undefined, brrrrCashLeftIn: undefined }
```
`convex/monitorActions.ts`: import `rentForListing,` (after `evaluateDeal,`). After the `const rentZestimate = ...` line:
```ts
      // Rent = min(stated lease, rentZestimate); tax = the listing's own rate when Zillow has one.
      const { rent, leaseRent } = rentForListing(description, rentZestimate);
      const taxRatePct = detail?.propertyTaxRate ?? row.propertyTaxRatePct ?? null;
```
In `dealInput` replace `rent: rentZestimate,` with
```ts
        rent,
        taxRatePct,
```
After `const flipFinal = deal.flip;`:
```ts
      if (leaseRent != null) flags.push(`LEASED at $${leaseRent.toLocaleString("en-US")}/mo`);
      if (rental?.taxEstimated) flags.push(`tax rate estimated ${MONITOR.rentalTaxFallbackPct}% (VERIFY)`);
```
In the patch, the rental block gains two fields and two row facts follow it:
```ts
          ...(rental
            ? {
                capRate: rental.capRate,
                cashFlow: rental.cashFlow,
                onePctRule: rental.onePct,
                cashOnCash: rental.cashOnCash,
                dscr: rental.dscr,
                ...(deal.brrrrCashLeftIn != null ? { brrrrCashLeftIn: deal.brrrrCashLeftIn } : {}),
              }
            : {}),
          ...(leaseRent != null ? { leaseRent } : {}),
          ...(taxRatePct != null ? { propertyTaxRatePct: taxRatePct } : {}),
```

- [ ] **Step 6: Validate** — `npx vitest run` -> 473 passed; `npx tsc --noEmit`; `npx tsc --noEmit -p convex`; PowerShell `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorActions.ts convex/monitorData.ts convex/schema.ts tests/monitorRental.test.ts tests/monitorListings.test.ts convex/_generated
git commit -m "feat(monitor): rental realism - lease rent, listing tax rate, 35% opex, DSCR>=1.2, BRRRR view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 11: Backtest script (old vs new keep-rate / exit mix)

**Files:**
- Create: `scripts/monitor-backtest.ts`
- Test: `tests/monitorBacktest.test.ts` (create)

**Interfaces:**
- Consumes: `evaluateDeal`, `dealInputFromStored`, `StoredListing`, `isDigestWorthy`, `isLandType`, `isMultiUnitType`, `isCondoType`, `MONITOR`.
- Produces: `interface BacktestRow extends StoredListing { status?; keeper?; bestExit?; homeType? }`, `interface BacktestSummary`, `summarizeBacktest(rows: BacktestRow[]): BacktestSummary`; CLI `npx tsx scripts/monitor-backtest.ts <documents.jsonl>`.

- [ ] **Step 1: Write the failing test** — create `tests/monitorBacktest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { summarizeBacktest, type BacktestRow } from "../scripts/monitor-backtest";

const ROWS: BacktestRow[] = [
  // old distress keeper, above Zestimate -> de-kept
  { status: "analyzed", keeper: true, bestExit: "PASS", homeType: "SINGLE_FAMILY", listPrice: 240000, zestimate: 230000, conservativeArv: 260000, sqft: 1400, yearBuilt: 1990, description: "Estate sale, sold as-is" },
  // old keeper, 20% under Zestimate -> stays (WHOLESALE, board-only)
  { status: "analyzed", keeper: true, bestExit: "FLIP", homeType: "SINGLE_FAMILY", listPrice: 160000, zestimate: 200000, sqft: 1200, yearBuilt: 1990, description: "needs TLC" },
  // old non-keeper that now clears the RENTAL floor -> newly kept (fresh analysis only)
  { status: "analyzed", keeper: false, bestExit: "PASS", homeType: "TOWNHOUSE", listPrice: 150000, sqft: 1000, yearBuilt: 1990, rentZestimate: 2600, description: "Updated kitchen, move-in ready", riskFlags: [] },
  // condo / pending rows are ignored
  { status: "analyzed", keeper: false, homeType: "CONDO", listPrice: 100000, zestimate: 200000 },
  { status: "pending", keeper: false, listPrice: 100000, zestimate: 200000 },
];

describe("summarizeBacktest", () => {
  it("counts old vs new keepers, re-gate survivors, newly kept and exit mixes", () => {
    const s = summarizeBacktest(ROWS);
    expect(s).toMatchObject({ analyzed: 3, oldKeepers: 2, regateKept: 1, dekept: 1, newlyKept: 1, newKeepers: 2, newDigest: 1 });
    expect(s.oldExitMix).toEqual({ PASS: 1, FLIP: 1 });
    expect(s.newExitMix).toEqual({ WHOLESALE: 1, RENTAL: 1 });
    expect(s.taxEstimated).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/monitorBacktest.test.ts` -> FAIL (cannot resolve `../scripts/monitor-backtest`).

- [ ] **Step 3: Implement** — create `scripts/monitor-backtest.ts`:
```ts
/**
 * Backtest the CURRENT monitor keeper rules against a prod export of monitorListings
 * (stored fields only, the same path as monitorData:regateKeepers). Reports the
 * old-vs-new keep rate and exit mix.
 *
 * Get the data (prod deploy key, see lessons 2026-10-03):
 *   npx convex export --path monitor-export.zip   ->  unzip  ->  monitorListings/documents.jsonl
 * Run:
 *   npx tsx scripts/monitor-backtest.ts monitorListings/documents.jsonl
 */
import { readFileSync } from "node:fs";
import {
  evaluateDeal,
  dealInputFromStored,
  isDigestWorthy,
  isLandType,
  isMultiUnitType,
  isCondoType,
  MONITOR,
  type StoredListing,
} from "../src/scraper/monitorListings";

export interface BacktestRow extends StoredListing {
  status?: string;
  keeper?: boolean;
  bestExit?: string;
  homeType?: string;
}
export interface BacktestSummary {
  analyzed: number;
  oldKeepers: number;
  newKeepers: number;
  regateKept: number;   // old keepers that survive (what regateKeepers would keep)
  dekept: number;       // old keepers the new rules drop
  newlyKept: number;    // old non-keepers the new rules would keep (re-gate never promotes)
  newDigest: number;    // new keepers that reach the email (FLIP/RENTAL)
  oldExitMix: Record<string, number>;
  newExitMix: Record<string, number>;
  taxEstimated: number; // rows underwritten on the 1.6% fallback (no stored tax rate)
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export function summarizeBacktest(rows: BacktestRow[]): BacktestSummary {
  const s: BacktestSummary = {
    analyzed: 0, oldKeepers: 0, newKeepers: 0, regateKept: 0, dekept: 0, newlyKept: 0, newDigest: 0,
    oldExitMix: {}, newExitMix: {}, taxEstimated: 0,
  };
  for (const r of rows) {
    if (r.status !== "analyzed") continue;
    // analyzeOne vetoes these before any underwriting; they are never keepers.
    if (isLandType(r.homeType) || isMultiUnitType(r.homeType) || isCondoType(r.homeType)) continue;
    s.analyzed++;
    const d = evaluateDeal(dealInputFromStored(r));
    const wasKeeper = r.keeper === true;
    if (wasKeeper) {
      s.oldKeepers++;
      bump(s.oldExitMix, r.bestExit ?? "UNSET");
      if (d.keeper) s.regateKept++;
      else s.dekept++;
    }
    if (d.keeper) {
      s.newKeepers++;
      bump(s.newExitMix, d.bestExit);
      if (!wasKeeper) s.newlyKept++;
      if (isDigestWorthy(d.bestExit)) s.newDigest++;
    }
    if (d.rental?.taxEstimated) s.taxEstimated++;
  }
  return s;
}

function main(path: string): void {
  const rows = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as BacktestRow);
  const s = summarizeBacktest(rows);
  const rate = (n: number) => (s.analyzed ? `${((n / s.analyzed) * 100).toFixed(1)}%` : "n/a");
  console.log(`analyzed rows:   ${s.analyzed}`);
  console.log(`old keepers:     ${s.oldKeepers} (${rate(s.oldKeepers)})  exits ${JSON.stringify(s.oldExitMix)}`);
  console.log(`new keepers:     ${s.newKeepers} (${rate(s.newKeepers)})  exits ${JSON.stringify(s.newExitMix)}`);
  console.log(`  digest-worthy: ${s.newDigest}`);
  console.log(`re-gate:         ${s.regateKept} kept / ${s.dekept} de-kept (of ${s.oldKeepers})`);
  console.log(`newly kept:      ${s.newlyKept} (fresh analysis only; re-gate never promotes)`);
  console.log(`tax estimated:   ${s.taxEstimated} rows on the ${MONITOR.rentalTaxFallbackPct}% fallback (old rows store no tax rate)`);
}

if (process.argv[1] && /monitor-backtest\.ts$/.test(process.argv[1])) {
  if (!process.argv[2]) {
    console.error("usage: npx tsx scripts/monitor-backtest.ts <monitorListings/documents.jsonl>");
    process.exit(1);
  }
  main(process.argv[2]);
}
```

- [ ] **Step 4: Run tests + typechecks + a CLI smoke** — `npx vitest run` -> 474 passed; `npx tsc --noEmit` clean. Smoke (scratch file, not committed): write two lines to `%TEMP%\bt.jsonl`:
```
{"status":"analyzed","keeper":true,"bestExit":"FLIP","homeType":"SINGLE_FAMILY","listPrice":160000,"zestimate":200000,"sqft":1200}
{"status":"analyzed","keeper":true,"bestExit":"PASS","listPrice":240000,"zestimate":230000,"sqft":1400}
```
Run `npx tsx scripts/monitor-backtest.ts <that path>` -> Expected: `old keepers: 2 (100.0%)`, `new keepers: 1 (50.0%)  exits {"WHOLESALE":1}`, `re-gate: 1 kept / 1 de-kept (of 2)`.

- [ ] **Step 5: Commit**

```bash
git add scripts/monitor-backtest.ts tests/monitorBacktest.test.ts
git commit -m "feat(monitor): backtest script - old vs new keep rate and exit mix from a jsonl export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

## Spec coverage map

| Spec item | Task |
|---|---|
| S1 Firecrawl maxAge (Zillow + Redfin, retries 0) | 1 |
| S2 `MONITOR_SCAN_ENABLED` cron-only off-switch | 2 |
| S3 Firecrawl Monitor deletion — ops step, no code; http.ts untouched | (orchestrator) |
| S4 keeper floors, distress-OR deleted, Zestimate 0.85 / comps fallback, LLM never keeps | 3 |
| S5 bestExit RENTAL/FLIP only when floors met; 4% cap not RENTAL | 3 (+10 adds DSCR) |
| S6 sqft 0/null unknown (no median-price ARV, no $0 rehab, VERIFY); GUT regex | 4 |
| S7 digest FLIP/RENTAL only; zero-candidate unchanged | 5 |
| S8 re-gate existing keepers + dry-run | 6 (upgraded by 8, 9, 10) |
| S9 comps by distance + type + recency, fallback documented | 7, 8 |
| S10 asIsValue (median) vs arv (p75), cap decision, stored | 8 |
| S11 rehab max(keyword, conditionTier), systems tier, lead/wiring add-ons, gut hold, post-judge recompute | 9 |
| S12 lease rent, real tax else 1.6% flagged, 35% opex, DSCR >= 1.2, BRRRR stored | 10 |
| S13 flipScore/rentScore stored, dealScore = max | 3 |
| Re-gate uses new math after Phase 2 (stored fields; comps not re-fetched) | 6 -> 9, 10 |
| Backtest simulation script | 11 |
