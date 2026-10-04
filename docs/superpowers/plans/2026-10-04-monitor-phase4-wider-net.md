# Monitor Phase 4 — Wider Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Monitor from forgetting a listing after its first week. It should catch price cuts, back-on-market events and pending/sold/withdrawn status on tracked rows. It should discover older listings that have price cuts, re-alert on a new cut, and filter the nightly digest per recipient by a personal buy box.

**Architecture:** A new daily **re-check lane** has two parts. **Lane A** is a Zillow price-cut search sweep: every NCC listing at or under $500K that has a price reduction, at any days on market (about 6 pages). It runs through the existing `upsertListing`, so new zpids get discovered and stored-price drops get detected in one place. **Lane B** re-scrapes the detail page of the small set of rows in a rotation (active keepers every 3 days, PENDING-archived rows weekly) to read Zillow `homeStatus`. Every decision is a pure function in `src/scraper/monitorRecheck.ts` and `src/scraper/monitorBuyBox.ts`: status mapping, the sighting and re-check patch builders, the rotation schedule, the re-alert loop guard, buy-box matching and recipient planning. Convex mutations only read a row, call the pure function and patch. Re-alerts are decided inside `analyzeOne` after the new numbers exist. The digest becomes one Resend call per recipient, each filtered by that recipient's buy box.

**Tech Stack:** TypeScript, Convex (actions, mutations, schema, crons), Vitest, Firecrawl REST v2, React + shadcn/ui (Radix) + lucide-react.

**Spec:** the user-approved Phase 4 spec is the orchestrator brief for this plan (items S1 to S5 below, quoted in the next section). Domain context: `docs/superpowers/research/2026-07-04-flipper-criteria.md` §3 (cuts, back-on-market) and `memory/deep-dive-2026-08-08.md` (bounded reads, credit leaks). Predecessors: `docs/superpowers/plans/2026-10-04-monitor-phase1-2-deal-quality.md` (shipped on this branch) and `docs/superpowers/plans/2026-10-04-monitor-phase3-triage-ui.md`. Phase 3 executes BEFORE this plan and adds the triage inbox page (tabs New/Shortlist/Passed), per-user pass/shortlist/snooze/seen state and a redesigned digest.

Spec items:
- **S1** Re-check lane: tracked rows (non-archived, lastSeen within 45 days) are re-checked every few days for price cuts, back-on-market and pending/sold. Use the cheapest reliable mechanism, justified with credit math. It must catch listings older than the 7-day window (e.g. 60 days on market with 2+ cuts).
- **S2** Store Zillow homeStatus. When a tracked row goes PENDING/SOLD/off-market, archive it with `archivedReason` and drop it from the board and digest.
- **S3** A price cut on a tracked row re-analyzes it. If it becomes (or remains) digest-worthy after a NEW cut, clear `emailedAt` so it is emailed again, tagged "PRICE CUT $X" (store the cut amount and date). Tag back-on-market the same way. No re-email loops: re-email only on a new cut event.
- **S4** Per-user buy box: ZIPs (multi), price min/max, min beds, exits wanted (Flip/Rental), min flip profit, min cash flow. The digest is filtered PER RECIPIENT by their buy box (default = everything digest-worthy). A small settings UI on /monitor. Digest send becomes per-recipient, keeps XSS escaping and the existing `digestRecipients()` logic.
- **S5** Nightly cadence stays daily at 02:00 UTC. The re-check lane has its own cron. Every new cron respects `MONITOR_SCAN_ENABLED`.

## Global Constraints

- Work ONLY in the worktree `C:\Users\nazho\Desktop\ires-crm\.claude\worktrees\monitor-critique`. Run `git branch --show-current` before every commit and confirm `feat/monitor-critique`. Never touch the main checkout. Other agents commit to this branch too: run `git status` before each task and never stage files you did not change.
- Phase 3 (`docs/superpowers/plans/2026-10-04-monitor-phase3-triage-ui.md`) lands first and is a PREREQUISITE. This plan builds on its exact shapes:
  - `src/scraper/monitorDigest.ts` `buildDigest(rows: DigestRow[], o: DigestOpts)`; `sendDigest` makes a single send; the inline `keeperHtml`/`keeperText` are deleted.
  - `internal.monitorData.activeKeeperCount`.
  - The slim `board` query and `BoardRow` (`src/web/lib/monitorBoard.ts`).
  - `src/web/monitor/BoardTable.tsx` with `<ExitBadge exit={r.bestExit} />`.
  - The `MonitorPage` status strip ending in `{me?.role === "admin" && <RunNow />}`.
  - Tables `monitorTriage`/`monitorSeen`, keyed by the Clerk subject.

  **Re-read each file before editing.** Anchors are named functions and code snippets, not line numbers. If Phase 3 shipped a different shape than its plan, apply the same change at its new home.
- Pure logic lives in `src/scraper/*.ts` with vitest tests written first (TDD). Convex files stay thin wiring. Match the existing style: terse one-line math, `as const` MONITOR, comments that state the why.
- Every new tunable number goes in the `MONITOR` constant in `src/scraper/monitorListings.ts`.
- Convex limits: no unbounded `.collect()` on a growing table. New reads use an index range plus `take(N)`. The only `collect()` allowed is on `users`, the same small-table read `users.activeEmailsInternal` already does.
- Clearing a field from an ACTION is impossible: explicit `undefined` is stripped from action-to-mutation args. Removals happen inside a mutation, either via a boolean flag (e.g. `clearEmailed`, `clearRecheck`) or via a patch object built inside the mutation by a pure function. A key present with value `undefined` in `ctx.db.patch` deletes the field.
- Convex sorts `undefined` BEFORE every number in an index. Every range read on `by_recheck` must have a lower bound: `q.gt("recheckAt", 0).lte("recheckAt", now)`.
- Actions die at 10 minutes. Detail re-scrapes fan out as one scheduled `recheckOne` per row, staggered `STAGGER_MS`. Never loop detail scrapes inside one action.
- Auth: every public query and mutation calls `requireUser(ctx)` first. Internal functions have no auth (scheduled or cron callers have no identity).
- UI: lucide-react icons only. No emojis anywhere (code, comments, UI strings, commit messages, flags). Use `ConfirmDialog` (`src/web/ConfirmDialog.tsx`), never `window.confirm`. Surface caught errors with `describeError(e).message` (`src/web/lib/errorReporting.ts`), never `err.message`.
- Firecrawl (lessons 2026-07-01 and 2026-10-03): every Zillow scrape goes through `scrapeZillowJson` (it sets `maxAge` correctly). Any manual authed HTTP call to an external API must use PowerShell `curl.exe` with the JSON body in a file (`--data-binary "@file"`), because the Bash tool strips the `Authorization` header. Prod Convex holds a DIFFERENT Firecrawl key (monthly plan of about 17.8k credits) than `.env.local`. Budget math below is against prod's plan.
- Convex codegen and validation ONLY via the isolated local backend, in PowerShell: `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`. Never plain `npx convex dev` or `npx convex codegen`, which push to the shared deployment. On a FRESH anonymous backend the push fails with "CLERK_JWT_ISSUER_DOMAIN ... not set". Set a dummy once: `$env:CONVEX_AGENT_MODE='anonymous'; npx convex env set CLERK_JWT_ISSUER_DOMAIN https://example.clerk.accounts.dev`. Commit any resulting `convex/_generated/*` changes in the same task.
- Every task ends green on all four: `npx vitest run`, `npx tsc --noEmit`, `npx tsc --noEmit -p convex`, `npm run build`. Baseline on this branch before Phase 3: 491 tests in 33 files, all green. Record the post-Phase-3 count before Task 1, and treat it as the floor.
- Edit files with the editor tool, not shell heredocs or sed. The regex literals in this plan contain backslashes that shell quoting mangles.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
  ```

## Review Focus

1. **Zillow sold/off-market status strings were never observed live.** Verified live: `FOR_SALE` on search cards and the detail page, and the detail `listingSubType.isPending` boolean. `RECENTLY_SOLD`/`SOLD`/`OTHER` are assumptions. Expected behavior: an unrecognized or empty status takes NO action (the row stays in rotation and is retried tomorrow); it never archives. A shell page also takes no action. Pinned by Task 2 "unknown or empty is null" and "null detail retries tomorrow".
2. **A listing that sold and was relisted under the same zpid** (Zillow zpid is per property, so a flipper's resale reuses it). Expected: the next for-sale sighting revives it, tags it BACK ON MARKET and re-analyzes it from a fresh detail scrape. The renovated veto then decides the flip exit. Pinned by Task 2 "SOLD-archived row seen for sale is revived".
3. **ZIP input like `19805-1234`, extra commas or spaces, duplicates, or junk.** Expected: ZIP+4 trims to 5 digits, duplicates collapse, and junk is rejected with a readable message rather than silently dropped. Pinned by Task 6 `parseZipList` and the `normalizeBuyBox` error cases.
4. **Buy box where price min is above price max, or a listing with unknown beds against a min-beds box.** Expected: the save is refused with "Min price is above max price". Unknown beds PASS the box (a card data gap must not hide a deal). Pinned by Task 6.
5. **Price-cut sweep cut short** (a blocked page, or more results than `cutSearchMaxPages`). Expected: rows on the pages that did load are still processed, and an errorLogs entry reports "covered X of Y". The sweep is never silently partial. Pinned in Task 5 Step 3 (the coverage log) and Task 1's `cutSearchMaxPages` test.

## Resolved decisions (made by this plan)

**Re-check mechanism: (c) both, measured on live data and prod.**

- **Verified live 2026-10-04 (2 Firecrawl credits):**
  - Zillow's search filter id `onlyPriceReduction` (Boolean, label "Must have price reduction", no shortId) is honored in `searchQueryState.filterState` as `onlyPriceReduction: {value: true}`. The echoed queryState keeps it. NCC at or under $500K at any days on market returned **208 results (6 pages)**, and every card carried `hdpData.homeInfo.priceChange < 0`, `datePriceChanged`, `priceReduction` and `homeStatus`.
  - `sort: {value: "days"}` is honored together with it and paginates cleanly (page 2 = DOM 29-43).
  - `sort: "mostrecentchange"` is SILENTLY replaced by relevance sort, which would make pages unstable. Do not use it.
- **Verified live (1 credit) on a 90-day tracked row (zpid 72975668):** the detail `gdpClientCache` is present, `property.price` = 435000, `homeStatus` = FOR_SALE, and `listingSubType.isPending` is a boolean. The stored row still says $450,000 with no cut recorded. This is exactly the miss this phase fixes.
- **Prod snapshot (2026-10-04):** 1,232 rows, about 88/week; 570 rows have lastSeen within 45 days; 49 active keepers, of which 15 are digest-worthy.

Credit math (prod plan about 17.8k/month; today's nightly is about 70 per fresh night, about 2.1k/month):

| Option | Daily | Monthly | Gaps |
|---|---|---|---|
| (a) price-cut search only | 6 pages | about 180 | Blind to pending/sold/withdrawn and back-on-market (search shows FOR_SALE only) |
| (b) detail rotation of all 570 tracked rows every 3 days | about 190 | about 5.7k (32% of plan) | Still never discovers listings older than 7 days |
| **(c) chosen** | | | |
| - Lane A sweep | 6 pages | about 180 | |
| - Lane B: 49 keepers / 3 days | about 16 | about 490 (cap 25/day = max 750) | |
| - Lane B: PENDING-archived weekly | | under 40 | |
| - Re-analyses from cut events (about 5 county-wide/day x 1-2 credits) | | about 150-300 | |
| (c) total | | **about 0.85-1.3k/month** | |

Option (c) brings the plan to about 3-3.4k/month of 17.8k. A `recheckOne` that finds a change schedules `analyzeOne`, whose first attempt accepts a 1-hour Firecrawl cache. Firecrawl may still bill that as 1 credit, which is already counted in the re-analysis line.

**One-time first-sweep cost (measured, 0 credits).** The 73 unique cut cards from the 2 live pages were joined against the prod snapshot. 66 pass the scan gate. Only 6 are not in the DB. **58 are tracked rows whose stored price is ABOVE Zillow's current price**: cuts the monitor missed, which is this phase's motivating evidence. 3 of them are active keepers. Scaled by 208/73, the first sweep inserts about 17 new rows and detects about 165 missed cuts (about 9 on active keepers). That fires about 180 `analyzeOne` runs: about 250-300 Firecrawl credits plus about 180 DeepSeek calls, once. Rows that become or stay digest-worthy are re-emailed in the next nightly digest as a one-time catch-up burst. The burst is expected to be small, because few of these rows are keepers. Most catch-up re-alerts carry NO "PRICE CUT" tag: the cut is stamped with Zillow's own `datePriceChanged` (not "now"), and tags show only for cuts at most 7 days old.

**Other decisions:**

- **Where cuts are detected:** ONE place per entry path, both inside a mutation against the fresh stored price. `upsertListing` (search cards from the nightly scan and Lane A) and `applyRecheck` (Lane B detail) both build their patch with pure functions that share `cutFields`. A second detection of the same cut compares equal and fires nothing.
- **Re-alert timing:** `emailedAt` is cleared ONLY inside `analyzeOne`, after the new decision is computed. Detection never clears it, so a failed re-analysis cannot email stale numbers. Loop guard: `alertedEventAt` stores the event time (max of `lastPriceCutAt` and `backOnMarketAt`) already alerted. Re-open only when the latest event is newer AND the new `bestExit` is FLIP/RENTAL.
- **Re-check writes NO `monitorRuns` row.** `mostRecentCompleteRun` (the nightly cron's 20h guard) matches ANY complete run, so a re-check run row would suppress the nightly scan. The re-check reports through its return value and errorLogs.
- **Retire basis:** `archiveStaleKeepers` switches from `firstSeen` to `lastSeen` (still `keeperRetireDays` 30) and stamps `archivedReason: "stale"`. A keeper Lane A keeps seeing (it carries a live cut) stays on the board. An aged-out row is revived by a NEW cut (`sightingPatch`). Detail re-checks do NOT bump `lastSeen` (it means "seen in a Zillow search"), so the 45-day `trackDays` window still ends tracking.
- **Rotation membership** is `recheckAt` (next due time; unset = not in rotation), set by `nextRecheckAt`. Active keeper: +3 days. PENDING-archived: +7 days, watching for back-on-market. SOLD/OFF_MARKET/stale or a non-keeper: out. lastSeen older than 45 days: out. Existing keepers are seeded once by the operator (`seedRecheck`).
- **Scope vs S1's literal wording:** all tracked rows get cut and back-on-market detection, through Lane A (and the nightly scan). Only keepers, plus PENDING-archived keepers, get detail STATUS checks. Status only changes what users see for rows on the board or in the digest, and checking all 570 tracked rows would cost about 5.7k credits a month. A non-keeper that goes pending simply stops appearing in searches and ages out.
- **Status archive keeps `keeper`** (history). Status-archived rows drop off the board and digest because `listKeepers` and `partitionDigestRows` already exclude `archivedAt`. **Phase 3's inbox query must keep that `archivedAt === undefined` filter.**
- **Price increases** are not tracked (out of scope; `listPrice` only moves down, as today).
- **Buy box storage:** a NEW table `monitorBuyBoxes` (one row per `users._id`). It is deliberately separate from Phase 3's `monitorTriage`/`monitorSeen`. It is keyed by `users._id` rather than Phase 3's Clerk-subject `userId` because the digest maps box to email via the `users` table, and a `pending:` invite row has no subject yet. An all-empty box is deleted, which means "everything".
- **Buy box semantics:** an empty list or unset bound means "any". `minFlipProfit` applies only to FLIP rows and `minCashFlow` only to RENTAL rows. Unknown beds pass. A missing ZIP fails when the box names ZIPs. `minCashFlow` may be negative; every other number must be at least 0.
- **Per-recipient send and `emailedAt`** (global "digest processed"): stamp the whole set when at least one send succeeded OR no recipient's box matched anything. Stamp nothing when every attempted send failed (tomorrow retries). Accepted trade-off: on a partial failure the failed recipient misses those rows. The `RESEND_TO` fallback has no box and gets everything.
- **Re-alert vs a Phase 3 "pass":** Phase 3's digest does not filter by triage, so a re-alert reaches every recipient whose buy box matches, including someone who passed before the cut. A NEW cut or back-on-market is new information, and that is intended. If triage filtering is ever added to the digest, the rule is: a passed row comes back only when `row.alertedEventAt > passedAt` (Task 8 notes it). The board keeps Phase 3's tabs: a passed row stays under Passed, now showing the chip.
- **Re-check cadence:** cron `0 14 * * *` (14:00 UTC, 9-10 AM ET), far from the 02:00 UTC nightly. Due times are set `MONITOR.recheckGraceMs` (12h) early, because they are stamped minutes after the cron fires; without that, a 3-day check would drift to 4. Re-alerted rows go out in the next nightly digest (at most about 12 hours later). The re-check sends no email itself.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/scraper/monitorListings.ts` | Modify | MONITOR tunables. `buildSearchUrl({ priceCutOnly })`. Card fields `homeStatus`/`priceChange`/`datePriceChanged`. Detail `price`/`isPending`. `passesScanGate` (shared scan gate). |
| `src/scraper/monitorRecheck.ts` | Create | Pure tracking logic: `statusBucket`, `cardCutFields`, `sightingPatch`, `recheckPatch`, `nextRecheckAt`, `reAlertDecision`, `digestAlertTag`. |
| `src/scraper/monitorBuyBox.ts` | Create | Pure buy box: `parseZipList`, `normalizeBuyBox`, `isEmptyBuyBox`, `matchesBuyBox`, `planRecipientDigests`, `shouldStampDigest`. |
| `tests/monitorWiderNet.test.ts` | Create | Tests for the `monitorListings.ts` additions (Task 1). |
| `tests/monitorRecheck.test.ts` | Create | Tests for `monitorRecheck.ts` (Task 2). |
| `tests/monitorBuyBox.test.ts` | Create | Tests for `monitorBuyBox.ts` (Task 6). |
| `convex/schema.ts` | Modify | `monitorListings` tracking fields + `by_recheck` index; new `monitorBuyBoxes` table. |
| `convex/monitorData.ts` | Modify | `upsertListing` via `sightingPatch`; `archiveStaleKeepers` lastSeen basis; `patchAnalysis` `clearRecheck`; `dueForRecheck`, `applyRecheck`, `seedRecheck`; buy box `myBuyBox`/`saveMyBuyBox`/`clearMyBuyBox`; `digestAudienceInternal`. |
| `convex/monitorActions.ts` | Modify | Card args; nightly gate via `passesScanGate`; re-analyze back-on-market; `analyzeOne` re-alert + rotation; `runMonitorRecheck`, `recheckOne`; per-recipient `sendDigest`. |
| `src/scraper/monitorDigest.ts` + `tests/monitorDigest.test.ts` (Phase 3) | Modify | `DigestRow.alertTag`; tag on the card + subject suffix. |
| `convex/crons.ts` | Modify | `monitor recheck` daily cron. |
| `src/web/MonitorBuyBoxDialog.tsx` | Create | Buy box button + dialog (settings UI). |
| `src/web/monitor/AlertTagChip.tsx` | Create | Price cut / back on market chip. |
| `src/web/MonitorPage.tsx`, `src/web/monitor/BoardTable.tsx`, `src/web/lib/monitorBoard.ts` (Phase 3) | Modify | Button in the status strip; chip next to `ExitBadge`; `BoardRow` fields (plus the `board` projection in `monitorData.ts`). |

---

### Task 1: Price-cut search URL, card and detail fields, shared scan gate

**Files:**
- Modify: `src/scraper/monitorListings.ts` (`MONITOR`, `buildSearchUrl`, `SearchListing`, `listingsFromSearch`, `ListingDetail`, `detailFromCache`, new `passesScanGate`)
- Modify: `convex/monitorActions.ts` (`runMonitorScan` survivor loop uses `passesScanGate`)
- Test: `tests/monitorWiderNet.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `MONITOR.recheckEveryDays` (3), `MONITOR.pendingRecheckDays` (7), `MONITOR.trackDays` (45), `MONITOR.recheckDetailCap` (25), `MONITOR.cutSearchMaxPages` (8), `MONITOR.alertTagFreshDays` (7)
  - `buildSearchUrl(opts?: { page?: number; priceCutOnly?: boolean }): string`
  - `SearchListing` gains `homeStatus?: string; priceChange?: number; datePriceChanged?: number`
  - `ListingDetail` gains `price: number | null; isPending: boolean`
  - `passesScanGate(l: SearchListing): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/monitorWiderNet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSearchUrl, listingsFromSearch, detailFromCache, passesScanGate, MONITOR } from "../src/scraper/monitorListings";
import type { SearchListing } from "../src/scraper/monitorListings";

const sqsOf = (url: string) => JSON.parse(decodeURIComponent(url.split("searchQueryState=")[1]));

describe("buildSearchUrl price-cut mode", () => {
  it("nightly URL is byte-identical with or without priceCutOnly:false", () => {
    expect(buildSearchUrl({ priceCutOnly: false })).toBe(buildSearchUrl({}));
    expect(buildSearchUrl({ page: 2, priceCutOnly: false })).toBe(buildSearchUrl({ page: 2 }));
  });
  it("price-cut sweep: onlyPriceReduction, any days on Zillow, newest sort, ceiling", () => {
    const sqs = sqsOf(buildSearchUrl({ priceCutOnly: true, page: 3 }));
    expect(sqs.filterState.onlyPriceReduction).toEqual({ value: true });
    expect(sqs.filterState.doz).toBeUndefined();
    expect(sqs.filterState.sort).toEqual({ value: "days" });
    expect(sqs.filterState.price).toEqual({ max: 500000 });
    expect(sqs.pagination).toEqual({ currentPage: 3 });
    expect(sqs.regionSelection[0]).toEqual({ regionId: 2986, regionType: 4 });
  });
  it("page cap covers the verified 6-page sweep with headroom", () => {
    expect(MONITOR.cutSearchMaxPages).toBeGreaterThanOrEqual(6);
  });
});

// Shapes copied from the live 2026-10-04 price-cut sweep (zpids real, other fields trimmed).
const CUT_NEXT = { props: { pageProps: { searchPageState: { cat1: {
  searchList: { totalResultCount: 208 },
  searchResults: { listResults: [
    { zpid: "72940572", unformattedPrice: 330000, area: 1400, address: "1 A St, Wilmington, DE 19805", addressZipcode: "19805",
      detailUrl: "https://www.zillow.com/homedetails/1-A-St/72940572_zpid/",
      hdpData: { homeInfo: { homeType: "SINGLE_FAMILY", homeStatus: "FOR_SALE", daysOnZillow: 72, priceChange: -40000, datePriceChanged: 1790838000000 } } },
    { zpid: "73015515", unformattedPrice: 359900, address: "2 B St, Newark, DE 19711",
      detailUrl: "https://www.zillow.com/homedetails/2-B-St/73015515_zpid/",
      hdpData: { homeInfo: { homeType: "TOWNHOUSE", homeStatus: "FOR_SALE" } } },
  ] },
} } } } };

describe("listingsFromSearch tracking fields", () => {
  it("carries homeStatus, priceChange and datePriceChanged from homeInfo", () => {
    const [a, b] = listingsFromSearch(CUT_NEXT);
    expect(a.homeStatus).toBe("FOR_SALE");
    expect(a.priceChange).toBe(-40000);
    expect(a.datePriceChanged).toBe(1790838000000);
    expect(b.homeStatus).toBe("FOR_SALE");
    expect(b.priceChange).toBeUndefined();
    expect(b.datePriceChanged).toBeUndefined();
  });
});

const detailWith = (property: object) => ({ props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify({
  'ForSaleFullRenderQuery{"zpid":72975668}': { property },
}) } } } });

describe("detailFromCache tracking fields", () => {
  it("reads the current price and the isPending sub-type flag", () => {
    const d = detailFromCache(detailWith({ price: 435000, homeStatus: "FOR_SALE", listingSubType: { isPending: false } }))!;
    expect(d.price).toBe(435000);
    expect(d.homeStatus).toBe("FOR_SALE");
    expect(d.isPending).toBe(false);
    const p = detailFromCache(detailWith({ price: 435000, homeStatus: "FOR_SALE", listingSubType: { isPending: true } }))!;
    expect(p.isPending).toBe(true);
  });
  it("missing price -> null, missing sub-type -> not pending", () => {
    const d = detailFromCache(detailWith({ homeStatus: "OTHER" }))!;
    expect(d.price).toBeNull();
    expect(d.isPending).toBe(false);
  });
});

const card = (o: Partial<SearchListing> = {}): SearchListing => ({
  zpid: "1", price: 250000, beds: 3, baths: 1, sqft: 1200, ppsf: 208, status: "", homeType: "SINGLE_FAMILY",
  zestimate: null, zestSpreadPct: null, address: "x", isNewConstruction: false, isZillowOwned: false, url: "u", ...o,
});

describe("passesScanGate (shared by the nightly scan and the price-cut sweep)", () => {
  it("keeps an ordinary priced house", () => {
    expect(passesScanGate(card())).toBe(true);
  });
  it("drops new construction, Zillow-owned, multi-family, condo, unpriced and out-of-band prices", () => {
    expect(passesScanGate(card({ isNewConstruction: true }))).toBe(false);
    expect(passesScanGate(card({ isZillowOwned: true }))).toBe(false);
    expect(passesScanGate(card({ homeType: "MULTI_FAMILY" }))).toBe(false);
    expect(passesScanGate(card({ homeType: "CONDO" }))).toBe(false);
    expect(passesScanGate(card({ price: null }))).toBe(false);
    expect(passesScanGate(card({ price: 500 }))).toBe(false);
    expect(passesScanGate(card({ price: 500001 }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/monitorWiderNet.test.ts`
Expected: FAIL. `passesScanGate` is not exported, `homeStatus` etc. are undefined on cards, and `d.price` is undefined.

- [ ] **Step 3: Implement**

In `src/scraper/monitorListings.ts`, add these lines inside `MONITOR` right after the `scrapeMaxAgeMs` line:

```ts
  // Phase 4 (wider net): re-check lane. Lane A = daily price-cut search sweep (verified
  // live 2026-10-04: 208 NCC results <= $500K = 6 pages); Lane B = detail re-scrape rotation.
  recheckEveryDays: 3,   // active keepers: detail re-check cadence (status / cut / back-on-market)
  pendingRecheckDays: 7, // PENDING-archived rows: slower cadence, watching for back-on-market
  trackDays: 45,         // a row not seen in any Zillow search for this long leaves the rotation
  recheckDetailCap: 25,  // max detail re-checks scheduled per re-check run (~1 credit each)
  cutSearchMaxPages: 8,  // price-cut sweep page cap (6 needed today; a short sweep logs coverage)
  alertTagFreshDays: 7,  // a PRICE CUT / BACK ON MARKET tag shows in the digest this long after the event
  recheckGraceMs: 12 * 60 * 60 * 1000, // due times are set minutes AFTER the 14:00 cron; without this grace a 3-day check drifts to 4
```

Change the `keeperRetireDays` comment to match the new basis (Task 3 changes the code):

```ts
  keeperRetireDays: 30, // keepers not seen in any Zillow search for this long age off the board (archivedAt)
```

Replace `buildSearchUrl`:

```ts
export function buildSearchUrl({ page, priceCutOnly }: { page?: number; priceCutOnly?: boolean } = {}): string {
  // priceCutOnly = the Phase 4 sweep: ANY days on Zillow + Zillow's "Must have price
  // reduction" filter (id onlyPriceReduction, no shortId). Verified live 2026-10-04: echoed in
  // queryState, every card priceChange < 0, sort "days" honored with it ("mostrecentchange"
  // is silently replaced by relevance = unstable pages). The nightly branch must stay
  // byte-identical (key order included): the remote Firecrawl monitor watches that URL.
  const filterState = priceCutOnly
    ? { sort: { value: MONITOR.sort }, price: { max: MONITOR.priceCeiling }, onlyPriceReduction: { value: true } }
    : { sort: { value: MONITOR.sort }, doz: { value: MONITOR.dozDays }, price: { max: MONITOR.priceCeiling } };
  const sqs = {
    pagination: page && page > 1 ? { currentPage: page } : {},
    isMapVisible: false,
    mapBounds: MONITOR.ncc_bounds,
    regionSelection: [{ regionId: MONITOR.regionId, regionType: MONITOR.regionType }],
    filterState,
    isListVisible: true,
  };
  return "https://www.zillow.com/new-castle-county-de/?searchQueryState=" + encodeURIComponent(JSON.stringify(sqs));
}
```

Extend `SearchListing` (add to the interface):

```ts
  homeStatus?: string;       // Zillow homeInfo.homeStatus, e.g. "FOR_SALE"
  priceChange?: number;      // Zillow's last price change in $ (negative = cut)
  datePriceChanged?: number; // epoch ms of that change
```

In `listingsFromSearch`, add to the returned object (after `isZillowOwned: !!c.isZillowOwned, url,`):

```ts
      homeStatus: typeof hi.homeStatus === "string" ? hi.homeStatus : undefined,
      priceChange: typeof hi.priceChange === "number" ? hi.priceChange : undefined,
      datePriceChanged: typeof hi.datePriceChanged === "number" ? hi.datePriceChanged : undefined,
```

Extend `ListingDetail` (add to the interface):

```ts
  price: number | null; // current list price on the detail page (re-check lane compares it)
  isPending: boolean;   // listingSubType.isPending (verified live 2026-10-04)
```

In `detailFromCache`'s returned object, add:

```ts
    price: typeof p.price === "number" && p.price > 0 ? p.price : null,
    isPending: p.listingSubType?.isPending === true,
```

Add `passesScanGate` directly after `isCondoType`:

```ts
// The discovery gate shared by the nightly new-listings scan and the price-cut sweep:
// no new construction / Zillow-owned / multi-family / condo, and a real purchase price
// inside the band ($0/placeholder foreclosure prices make mirage 100% spreads).
export function passesScanGate(l: SearchListing): boolean {
  return !(
    l.isNewConstruction ||
    l.isZillowOwned ||
    isMultiUnitType(l.homeType) ||
    isCondoType(l.homeType) ||
    l.price == null ||
    l.price < MONITOR.minListPrice ||
    l.price > MONITOR.priceCeiling
  );
}
```

In `convex/monitorActions.ts`, add `passesScanGate` to the `../src/scraper/monitorListings` import list. Replace the survivor loop body in `runMonitorScan`:

```ts
        for (const l of listings) {
          if (
            l.isNewConstruction ||
            ...
          ) {
            continue;
          }
          survivors.push(l);
        }
```

with:

```ts
        for (const l of listings) {
          if (passesScanGate(l)) survivors.push(l);
        }
```

If `isMultiUnitType`/`isCondoType` are now unused in `monitorActions.ts`, leave them: `analyzeOne`'s guard still uses both.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/monitorWiderNet.test.ts tests/monitorListings.test.ts`
Expected: PASS. The existing `buildSearchUrl` test still sees `doz` "7" and `pagination {}`.

- [ ] **Step 5: Full checks**

Run: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/monitorListings.ts convex/monitorActions.ts tests/monitorWiderNet.test.ts
git commit -F - <<'EOF'
feat(monitor): price-cut search URL, card/detail status + cut fields, shared scan gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 2: Pure tracking logic (`monitorRecheck.ts`)

**Files:**
- Create: `src/scraper/monitorRecheck.ts`
- Test: `tests/monitorRecheck.test.ts`

**Interfaces:**
- Consumes: `MONITOR` (Task 1 tunables).
- Produces (all exported from `src/scraper/monitorRecheck.ts`):
  - `type StatusBucket = "active" | "pending" | "sold" | "off_market"`
  - `type ArchivedReason = "stale" | "PENDING" | "SOLD" | "OFF_MARKET"`
  - `interface TrackedRow { listPrice?: number; keeper?: boolean; archivedAt?: number; archivedReason?: string; lastSeen: number; lastPriceCut?: number; lastPriceCutAt?: number; backOnMarketAt?: number; alertedEventAt?: number }`
  - `interface TrackingPatch` (the fields below; a key present with `undefined` = delete)
  - `statusBucket(homeStatus: string | null | undefined, isPending?: boolean): StatusBucket | null`
  - `cardCutFields(card: { priceChange?: number; datePriceChanged?: number }, now: number): { lastPriceCut?: number; lastPriceCutAt?: number }`
  - `sightingPatch(row: TrackedRow, card: { price: number | null; homeStatus?: string; datePriceChanged?: number }, now: number): { patch: TrackingPatch; priceDropped: boolean; backOnMarket: boolean }`
  - `interface RecheckDetail { homeStatus?: string; isPending: boolean; price: number | null }`
  - `recheckPatch(row: TrackedRow, d: RecheckDetail | null, now: number): { patch: TrackingPatch; reanalyze: boolean; outcome: "unknown" | "archive" | "backOnMarket" | "cut" | "unchanged" }`
  - `nextRecheckAt(row: Pick<TrackedRow, "keeper" | "archivedAt" | "archivedReason" | "lastSeen">, now: number): number | null`
  - `reAlertDecision(row: TrackedRow, digestWorthy: boolean): { reopen: boolean; alertedEventAt?: number; alertTag?: string }`
  - `digestAlertTag(row: { alertTag?: string; alertedEventAt?: number }, now: number): string | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/monitorRecheck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  statusBucket, cardCutFields, sightingPatch, recheckPatch, nextRecheckAt, reAlertDecision, digestAlertTag,
  type TrackedRow,
} from "../src/scraper/monitorRecheck";
import { MONITOR } from "../src/scraper/monitorListings";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-04T14:00:00Z");
const G = MONITOR.recheckGraceMs; // due times sit a grace period early (cron-drift guard)
const row = (o: Partial<TrackedRow> = {}): TrackedRow => ({ listPrice: 300000, keeper: true, lastSeen: NOW - 5 * DAY, ...o });
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

describe("statusBucket", () => {
  it("maps verified and tolerant Zillow statuses", () => {
    expect(statusBucket("FOR_SALE")).toBe("active");
    expect(statusBucket("COMING_SOON")).toBe("active");
    expect(statusBucket("FOR_SALE", true)).toBe("pending"); // detail listingSubType.isPending
    expect(statusBucket("PENDING")).toBe("pending");
    expect(statusBucket("Under contract")).toBe("pending");
    expect(statusBucket("RECENTLY_SOLD")).toBe("sold");
    expect(statusBucket("SOLD")).toBe("sold");
    expect(statusBucket("OTHER")).toBe("off_market");
    expect(statusBucket("OFF_MARKET")).toBe("off_market");
  });
  it("unknown or empty is null (take no action)", () => {
    expect(statusBucket("")).toBeNull();
    expect(statusBucket(undefined)).toBeNull();
    expect(statusBucket("SOMETHING_NEW")).toBeNull();
  });
});

describe("cardCutFields", () => {
  it("seeds the cut from Zillow's own priceChange on insert", () => {
    expect(cardCutFields({ priceChange: -23100, datePriceChanged: 1790924400000 }, NOW))
      .toEqual({ lastPriceCut: 23100, lastPriceCutAt: 1790924400000 });
    expect(cardCutFields({ priceChange: -5000 }, NOW)).toEqual({ lastPriceCut: 5000, lastPriceCutAt: NOW });
  });
  it("no cut for an increase or a missing change", () => {
    expect(cardCutFields({ priceChange: 5000 }, NOW)).toEqual({});
    expect(cardCutFields({}, NOW)).toEqual({});
  });
});

describe("sightingPatch (search card seen for an existing row)", () => {
  it("a lower card price is a cut: moves the price down and stamps the event", () => {
    const r = sightingPatch(row(), { price: 285000, homeStatus: "FOR_SALE" }, NOW);
    expect(r.priceDropped).toBe(true);
    expect(r.backOnMarket).toBe(false);
    expect(r.patch).toMatchObject({ lastSeen: NOW, prevListPrice: 300000, listPrice: 285000, lastPriceCut: 15000, lastPriceCutAt: NOW, homeStatus: "FOR_SALE" });
    expect(has(r.patch, "archivedAt")).toBe(false);
  });
  it("the cut date is Zillow's datePriceChanged when the card carries it", () => {
    const r = sightingPatch(row(), { price: 285000, homeStatus: "FOR_SALE", datePriceChanged: NOW - 20 * DAY }, NOW);
    expect(r.patch.lastPriceCutAt).toBe(NOW - 20 * DAY);
    expect(r.patch.lastSeen).toBe(NOW);
  });
  it("same price: only lastSeen/homeStatus move (a cut can never fire twice)", () => {
    const r = sightingPatch(row(), { price: 300000 }, NOW);
    expect(r.priceDropped).toBe(false);
    expect(has(r.patch, "lastPriceCut")).toBe(false);
    expect(has(r.patch, "listPrice")).toBe(false);
  });
  it("PENDING-archived row seen for sale = back on market, revived", () => {
    const r = sightingPatch(row({ archivedAt: NOW - DAY, archivedReason: "PENDING" }), { price: 300000, homeStatus: "FOR_SALE" }, NOW);
    expect(r.backOnMarket).toBe(true);
    expect(has(r.patch, "archivedAt")).toBe(true);
    expect(r.patch.archivedAt).toBeUndefined();
    expect(r.patch.archivedReason).toBeUndefined();
    expect(r.patch.backOnMarketAt).toBe(NOW);
  });
  it("a card that itself says PENDING is not back on market", () => {
    const r = sightingPatch(row({ archivedAt: NOW - DAY, archivedReason: "PENDING" }), { price: 300000, homeStatus: "PENDING" }, NOW);
    expect(r.backOnMarket).toBe(false);
    expect(has(r.patch, "archivedAt")).toBe(false);
  });
  it("SOLD-archived row seen for sale is revived (relist under the same zpid)", () => {
    const r = sightingPatch(row({ archivedAt: NOW - 20 * DAY, archivedReason: "SOLD" }), { price: 420000, homeStatus: "FOR_SALE" }, NOW);
    expect(r.backOnMarket).toBe(true);
    expect(has(r.patch, "archivedAt")).toBe(true);
  });
  it("aged-out (stale or legacy) row: revived only by a NEW cut, never by a plain sighting", () => {
    const stale = row({ archivedAt: NOW - DAY, archivedReason: "stale" });
    expect(has(sightingPatch(stale, { price: 300000 }, NOW).patch, "archivedAt")).toBe(false);
    const cut = sightingPatch(stale, { price: 280000 }, NOW);
    expect(cut.priceDropped).toBe(true);
    expect(cut.backOnMarket).toBe(false);
    expect(has(cut.patch, "archivedAt")).toBe(true);
    const legacy = sightingPatch(row({ archivedAt: NOW - DAY }), { price: 280000 }, NOW);
    expect(has(legacy.patch, "archivedAt")).toBe(true);
  });
});

describe("nextRecheckAt (rotation membership)", () => {
  it("active keeper every recheckEveryDays; non-keeper out", () => {
    expect(nextRecheckAt(row(), NOW)).toBe(NOW + 3 * DAY - G);
    expect(nextRecheckAt(row({ keeper: false }), NOW)).toBeNull();
  });
  it("PENDING-archived watched weekly; SOLD / OFF_MARKET / stale out", () => {
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "PENDING" }), NOW)).toBe(NOW + 7 * DAY - G);
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "SOLD" }), NOW)).toBeNull();
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "OFF_MARKET" }), NOW)).toBeNull();
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "stale" }), NOW)).toBeNull();
  });
  it("a row checked minutes after the cron is due again by the cron N days later (no drift)", () => {
    const checkedAt = NOW + 15 * 60_000; // 14:15, after the sweep
    expect(nextRecheckAt(row(), checkedAt)!).toBeLessThanOrEqual(NOW + 3 * DAY);
    expect(nextRecheckAt(row({ archivedAt: NOW, archivedReason: "PENDING" }), checkedAt)!).toBeLessThanOrEqual(NOW + 7 * DAY);
    expect(recheckPatch(row(), null, checkedAt).patch.recheckAt!).toBeLessThanOrEqual(NOW + DAY);
  });
  it("not seen in a search for more than trackDays -> out", () => {
    expect(nextRecheckAt(row({ lastSeen: NOW - 46 * DAY }), NOW)).toBeNull();
    expect(nextRecheckAt(row({ lastSeen: NOW - 44 * DAY }), NOW)).toBe(NOW + 3 * DAY - G);
  });
});

describe("recheckPatch (detail re-scrape outcome)", () => {
  it("null detail (shell page) retries tomorrow, touches nothing else", () => {
    const r = recheckPatch(row(), null, NOW);
    expect(r.outcome).toBe("unknown");
    expect(r.reanalyze).toBe(false);
    expect(r.patch.recheckAt).toBe(NOW + DAY - G);
    expect(has(r.patch, "archivedAt")).toBe(false);
  });
  it("unknown status past the tracking window leaves the rotation", () => {
    const r = recheckPatch(row({ lastSeen: NOW - 50 * DAY }), { homeStatus: "WHO_KNOWS", isPending: false, price: 300000 }, NOW);
    expect(r.outcome).toBe("unknown");
    expect(has(r.patch, "recheckAt")).toBe(true);
    expect(r.patch.recheckAt).toBeUndefined();
  });
  it("pending keeper is archived PENDING and watched weekly", () => {
    const r = recheckPatch(row(), { homeStatus: "FOR_SALE", isPending: true, price: 300000 }, NOW);
    expect(r.outcome).toBe("archive");
    expect(r.patch).toMatchObject({ archivedAt: NOW, archivedReason: "PENDING", recheckAt: NOW + 7 * DAY - G, lastRecheckAt: NOW });
    expect(r.reanalyze).toBe(false);
  });
  it("sold keeper is archived SOLD and leaves the rotation", () => {
    const r = recheckPatch(row(), { homeStatus: "RECENTLY_SOLD", isPending: false, price: null }, NOW);
    expect(r.patch).toMatchObject({ archivedAt: NOW, archivedReason: "SOLD", homeStatus: "RECENTLY_SOLD" });
    expect(has(r.patch, "recheckAt")).toBe(true);
    expect(r.patch.recheckAt).toBeUndefined();
  });
  it("already-PENDING row still pending: unchanged, keeps watching", () => {
    const r = recheckPatch(row({ archivedAt: NOW - 7 * DAY, archivedReason: "PENDING" }), { homeStatus: "PENDING", isPending: true, price: 300000 }, NOW);
    expect(r.outcome).toBe("unchanged");
    expect(has(r.patch, "archivedAt")).toBe(false);
    expect(r.patch.recheckAt).toBe(NOW + 7 * DAY - G);
  });
  it("PENDING row back for sale at a lower price: revived + cut + re-analyze", () => {
    const r = recheckPatch(row({ archivedAt: NOW - 7 * DAY, archivedReason: "PENDING" }), { homeStatus: "FOR_SALE", isPending: false, price: 280000 }, NOW);
    expect(r.outcome).toBe("backOnMarket");
    expect(r.reanalyze).toBe(true);
    expect(r.patch.archivedAt).toBeUndefined();
    expect(has(r.patch, "archivedAt")).toBe(true);
    expect(r.patch).toMatchObject({ backOnMarketAt: NOW, listPrice: 280000, prevListPrice: 300000, lastPriceCut: 20000, lastPriceCutAt: NOW });
  });
  it("active keeper with a lower detail price is a cut", () => {
    const r = recheckPatch(row(), { homeStatus: "FOR_SALE", isPending: false, price: 290000 }, NOW);
    expect(r.outcome).toBe("cut");
    expect(r.reanalyze).toBe(true);
    expect(r.patch).toMatchObject({ listPrice: 290000, lastPriceCut: 10000, recheckAt: NOW + 3 * DAY - G });
  });
  it("nothing changed: next check scheduled, non-keeper drops out", () => {
    const r = recheckPatch(row(), { homeStatus: "FOR_SALE", isPending: false, price: 300000 }, NOW);
    expect(r.outcome).toBe("unchanged");
    expect(r.patch).toMatchObject({ homeStatus: "FOR_SALE", recheckAt: NOW + 3 * DAY - G });
    const nk = recheckPatch(row({ keeper: false }), { homeStatus: "FOR_SALE", isPending: false, price: 300000 }, NOW);
    expect(has(nk.patch, "recheckAt")).toBe(true);
    expect(nk.patch.recheckAt).toBeUndefined();
  });
});

describe("reAlertDecision (loop guard)", () => {
  const cut = row({ lastPriceCut: 15000, lastPriceCutAt: NOW - DAY });
  it("a new cut on a digest-worthy row re-opens it, tagged with the amount", () => {
    expect(reAlertDecision(cut, true)).toEqual({ reopen: true, alertedEventAt: NOW - DAY, alertTag: "PRICE CUT $15,000" });
  });
  it("the same event never re-opens twice", () => {
    expect(reAlertDecision({ ...cut, alertedEventAt: NOW - DAY }, true)).toEqual({ reopen: false });
  });
  it("not digest-worthy after the cut: no re-open, event NOT consumed", () => {
    expect(reAlertDecision(cut, false)).toEqual({ reopen: false });
  });
  it("back on market newer than the last cut is tagged BACK ON MARKET", () => {
    expect(reAlertDecision({ ...cut, backOnMarketAt: NOW }, true)).toEqual({ reopen: true, alertedEventAt: NOW, alertTag: "BACK ON MARKET" });
  });
  it("no event at all: nothing", () => {
    expect(reAlertDecision(row(), true)).toEqual({ reopen: false });
  });
});

describe("digestAlertTag", () => {
  it("shows a fresh tag, hides a stale or missing one", () => {
    expect(digestAlertTag({ alertTag: "PRICE CUT $5,000", alertedEventAt: NOW - 2 * DAY }, NOW)).toBe("PRICE CUT $5,000");
    expect(digestAlertTag({ alertTag: "PRICE CUT $5,000", alertedEventAt: NOW - 8 * DAY }, NOW)).toBeNull();
    expect(digestAlertTag({}, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/monitorRecheck.test.ts`
Expected: FAIL with "Failed to resolve import ../src/scraper/monitorRecheck".

- [ ] **Step 3: Implement**

Create `src/scraper/monitorRecheck.ts`:

```ts
// Phase 4 (wider net) — pure tracking logic for the Monitor re-check lane. Convex
// mutations read a row, call these, and ctx.db.patch the result: a key present with
// value undefined DELETES that field (patch semantics), which is how archive/revive
// and leaving the rotation are expressed. No Date.now() in here — callers pass `now`.
import { MONITOR } from "./monitorListings";

const DAY_MS = 86_400_000;

export type StatusBucket = "active" | "pending" | "sold" | "off_market";
export type ArchivedReason = "stale" | "PENDING" | "SOLD" | "OFF_MARKET";

export interface TrackedRow {
  listPrice?: number;
  keeper?: boolean;
  archivedAt?: number;
  archivedReason?: string;
  lastSeen: number;
  lastPriceCut?: number;
  lastPriceCutAt?: number;
  backOnMarketAt?: number;
  alertedEventAt?: number;
}

export interface TrackingPatch {
  updatedAt: number;
  lastSeen?: number;
  lastRecheckAt?: number;
  homeStatus?: string;
  prevListPrice?: number;
  listPrice?: number;
  lastPriceCut?: number;
  lastPriceCutAt?: number;
  backOnMarketAt?: number;
  archivedAt?: number;
  archivedReason?: string;
  recheckAt?: number;
}

// Zillow homeStatus -> bucket. Verified live 2026-10-04: FOR_SALE (cards + detail) and
// the detail listingSubType.isPending boolean. The sold / off-market strings were NOT
// observed live, so matching is tolerant; anything unrecognized or empty is null =
// take no action (never archive on a guess).
export function statusBucket(homeStatus: string | null | undefined, isPending = false): StatusBucket | null {
  const s = (homeStatus || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (/SOLD/.test(s)) return "sold"; // SOLD, RECENTLY_SOLD
  if (isPending || /PENDING|UNDER_CONTRACT|CONTINGENT/.test(s)) return "pending";
  if (s === "OTHER" || /OFF_MARKET|FOR_RENT|REMOVED|WITHDRAWN/.test(s)) return "off_market";
  if (/FOR_SALE|COMING_SOON|AUCTION|ACTIVE/.test(s)) return "active";
  return null;
}

const STATUS_REASON: Record<Exclude<StatusBucket, "active">, ArchivedReason> = {
  pending: "PENDING", sold: "SOLD", off_market: "OFF_MARKET",
};
function isStatusArchive(reason: string | undefined): boolean {
  return reason === "PENDING" || reason === "SOLD" || reason === "OFF_MARKET";
}

// A strictly lower price vs the STORED one = a cut: move the price down (so the same
// cut can never fire twice) and stamp the event. Shared by both entry paths.
// `at` = when the cut happened: Zillow card datePriceChanged when known (the first sweep
// finds weeks-old cuts on tracked rows; stamping them "now" would tag them as fresh).
function cutFields(row: TrackedRow, price: number | null, at: number) {
  return price != null && row.listPrice != null && price < row.listPrice
    ? { prevListPrice: row.listPrice, listPrice: price, lastPriceCut: row.listPrice - price, lastPriceCutAt: at }
    : {};
}

// New row from a card that carries Zillow's own cut (the price-cut sweep): seed the
// event so the first digest can tag it (alertedEventAt then guards re-sends).
export function cardCutFields(card: { priceChange?: number; datePriceChanged?: number }, now: number): { lastPriceCut?: number; lastPriceCutAt?: number } {
  return card.priceChange != null && card.priceChange < 0
    ? { lastPriceCut: -card.priceChange, lastPriceCutAt: card.datePriceChanged ?? now }
    : {};
}

// An existing row seen on a FOR-SALE search card (nightly scan or price-cut sweep).
// Status-archived (PENDING/SOLD/OFF_MARKET) + an active card = back on market (deal fell
// through, or a relist under the same per-property zpid). An aged-out row ("stale" or a
// legacy reason-less archive) is revived only by a NEW cut.
export function sightingPatch(row: TrackedRow, card: { price: number | null; homeStatus?: string; datePriceChanged?: number }, now: number): { patch: TrackingPatch; priceDropped: boolean; backOnMarket: boolean } {
  const bucket = statusBucket(card.homeStatus);
  const cardActive = bucket == null || bucket === "active";
  const cut = cutFields(row, card.price, card.datePriceChanged ?? now);
  const priceDropped = "lastPriceCut" in cut;
  const archived = row.archivedAt != null;
  const backOnMarket = archived && cardActive && isStatusArchive(row.archivedReason);
  const revive = backOnMarket || (archived && !isStatusArchive(row.archivedReason) && priceDropped);
  const patch: TrackingPatch = {
    lastSeen: now,
    updatedAt: now,
    ...(card.homeStatus ? { homeStatus: card.homeStatus } : {}),
    ...cut,
    ...(backOnMarket ? { backOnMarketAt: now } : {}),
    ...(revive ? { archivedAt: undefined, archivedReason: undefined } : {}),
  };
  return { patch, priceDropped, backOnMarket };
}

// Rotation membership: the next detail re-check time, or null = leave the rotation.
export function nextRecheckAt(row: Pick<TrackedRow, "keeper" | "archivedAt" | "archivedReason" | "lastSeen">, now: number): number | null {
  if (now - row.lastSeen > MONITOR.trackDays * DAY_MS) return null;
  // Due times are stamped minutes after the daily cron fires; minus the grace so the
  // check lands on the cron N days later instead of drifting to N+1.
  const after = (days: number) => now + days * DAY_MS - MONITOR.recheckGraceMs;
  if (row.archivedAt != null) return row.archivedReason === "PENDING" ? after(MONITOR.pendingRecheckDays) : null;
  return row.keeper ? after(MONITOR.recheckEveryDays) : null;
}

export interface RecheckDetail { homeStatus?: string; isPending: boolean; price: number | null; }
export type RecheckOutcome = "unknown" | "archive" | "backOnMarket" | "cut" | "unchanged";

// One detail re-scrape -> the row patch. Never archives on an unknown status or a shell
// page (retry tomorrow; nextRecheckAt still ends it once the row leaves trackDays).
export function recheckPatch(row: TrackedRow, d: RecheckDetail | null, now: number): { patch: TrackingPatch; reanalyze: boolean; outcome: RecheckOutcome } {
  const base = { lastRecheckAt: now, updatedAt: now };
  const bucket = d ? statusBucket(d.homeStatus, d.isPending) : null;
  if (!d || bucket == null) {
    const stay = nextRecheckAt(row, now) != null;
    return { patch: { ...base, recheckAt: stay ? now + DAY_MS - MONITOR.recheckGraceMs : undefined }, reanalyze: false, outcome: "unknown" };
  }
  const homeStatus = d.homeStatus || (d.isPending ? "PENDING" : "");
  const hs = homeStatus ? { homeStatus } : {};
  if (bucket !== "active") {
    const reason = STATUS_REASON[bucket];
    if (row.archivedAt != null && row.archivedReason === reason) {
      return { patch: { ...base, ...hs, recheckAt: nextRecheckAt(row, now) ?? undefined }, reanalyze: false, outcome: "unchanged" };
    }
    const next = nextRecheckAt({ ...row, archivedAt: now, archivedReason: reason }, now);
    return { patch: { ...base, ...hs, archivedAt: now, archivedReason: reason, recheckAt: next ?? undefined }, reanalyze: false, outcome: "archive" };
  }
  if (row.archivedAt != null && isStatusArchive(row.archivedReason)) {
    const next = nextRecheckAt({ ...row, archivedAt: undefined, archivedReason: undefined }, now);
    return {
      patch: { ...base, ...hs, archivedAt: undefined, archivedReason: undefined, backOnMarketAt: now, ...cutFields(row, d.price, now), recheckAt: next ?? undefined },
      reanalyze: true,
      outcome: "backOnMarket",
    };
  }
  const cut = cutFields(row, d.price, now);
  const next = nextRecheckAt(row, now) ?? undefined;
  if ("lastPriceCut" in cut) return { patch: { ...base, ...hs, ...cut, recheckAt: next }, reanalyze: true, outcome: "cut" };
  return { patch: { ...base, ...hs, recheckAt: next }, reanalyze: false, outcome: "unchanged" };
}

// Re-alert loop guard (decided in analyzeOne AFTER the new numbers): re-open the digest
// only for an event newer than the last one alerted AND only when the row is
// digest-worthy now. A non-worthy result does not consume the event.
export function reAlertDecision(row: TrackedRow, digestWorthy: boolean): { reopen: boolean; alertedEventAt?: number; alertTag?: string } {
  const cutAt = row.lastPriceCutAt ?? 0;
  const bomAt = row.backOnMarketAt ?? 0;
  const eventAt = Math.max(cutAt, bomAt);
  if (!digestWorthy || eventAt === 0 || eventAt <= (row.alertedEventAt ?? 0)) return { reopen: false };
  const alertTag = bomAt >= cutAt
    ? "BACK ON MARKET"
    : `PRICE CUT $${Math.round(row.lastPriceCut ?? 0).toLocaleString("en-US")}`;
  return { reopen: true, alertedEventAt: eventAt, alertTag };
}

// The digest/board tag, only while the event is recent.
export function digestAlertTag(row: { alertTag?: string; alertedEventAt?: number }, now: number): string | null {
  if (!row.alertTag || row.alertedEventAt == null) return null;
  return now - row.alertedEventAt <= MONITOR.alertTagFreshDays * DAY_MS ? row.alertTag : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/monitorRecheck.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Full checks**

Run: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/monitorRecheck.ts tests/monitorRecheck.test.ts
git commit -F - <<'EOF'
feat(monitor): pure re-check logic - status buckets, sighting/re-check patches, rotation, re-alert guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 3: Schema tracking fields + `upsertListing` via `sightingPatch` + lastSeen retire basis

**Files:**
- Modify: `convex/schema.ts` (`monitorListings` fields + `by_recheck` index)
- Modify: `convex/monitorData.ts` (`listingUpsertArgs`, `upsertListing`, `archiveStaleKeepers`)
- Modify: `convex/monitorActions.ts` (`upsertArgsFromCard`, `runMonitorScan` analyze set)
- Generated: `convex/_generated/*`

**Interfaces:**
- Consumes: `sightingPatch`, `cardCutFields` (Task 2); `SearchListing.homeStatus/priceChange/datePriceChanged` (Task 1).
- Produces:
  - `monitorListings` fields `homeStatus`, `archivedReason`, `lastPriceCut`, `lastPriceCutAt`, `backOnMarketAt`, `alertTag`, `alertedEventAt`, `recheckAt`, `lastRecheckAt`; index `by_recheck` on `["recheckAt"]`
  - `internal.monitorData.upsertListing` returns `{ id, isNew: boolean, priceDropped: boolean, backOnMarket: boolean }`
  - `upsertArgsFromCard(l: SearchListing)` (module-local in monitorActions) now forwards `homeStatus`, `priceChange`, `datePriceChanged`

- [ ] **Step 1: Schema**

In `convex/schema.ts` `monitorListings`, add after the `archivedAt` field:

```ts
    // Phase 4 (wider net): status tracking + re-alerts (src/scraper/monitorRecheck.ts).
    homeStatus: v.optional(v.string()),     // Zillow homeStatus as last seen (card or detail)
    archivedReason: v.optional(v.string()), // "stale" | "PENDING" | "SOLD" | "OFF_MARKET"
    lastPriceCut: v.optional(v.number()),   // $ amount of the most recent detected cut
    lastPriceCutAt: v.optional(v.number()),
    backOnMarketAt: v.optional(v.number()),
    alertTag: v.optional(v.string()),       // "PRICE CUT $12,000" | "BACK ON MARKET"
    alertedEventAt: v.optional(v.number()), // event time already re-alerted (loop guard)
    recheckAt: v.optional(v.number()),      // next detail re-check due; unset = not in rotation
    lastRecheckAt: v.optional(v.number()),
```

Add to the index chain (after `.index("by_firstSeen", ["firstSeen"])`):

```ts
    .index("by_recheck", ["recheckAt"]),
```

(move the trailing `,` so the chain stays valid).

- [ ] **Step 2: `upsertListing`**

In `convex/monitorData.ts`, add to `listingUpsertArgs`:

```ts
  homeStatus: v.optional(v.string()),
  priceChange: v.optional(v.number()),      // card-only (not a column): seeds lastPriceCut on insert
  datePriceChanged: v.optional(v.number()), // card-only (not a column)
```

Add the import:

```ts
import { sightingPatch, cardCutFields } from "../src/scraper/monitorRecheck";
```

Replace the `upsertListing` handler body with:

```ts
  handler: async (ctx, args) => {
    const now = Date.now();
    const { priceChange, datePriceChanged, ...fields } = args;
    const existing = await ctx.db
      .query("monitorListings")
      .withIndex("by_zpid", (q) => q.eq("zpid", args.zpid))
      .first();

    if (!existing) {
      const id = await ctx.db.insert("monitorListings", {
        ...fields,
        ...cardCutFields({ priceChange, datePriceChanged }, now),
        status: "pending" as const,
        firstSeen: now,
        lastSeen: now,
        updatedAt: now,
      });
      return { id, isNew: true, priceDropped: false, backOnMarket: false };
    }

    // Cut detection (moves listPrice down so it can't re-fire), back-on-market, and
    // revive-on-new-cut all live in the pure sightingPatch (tests/monitorRecheck.test.ts).
    // We do NOT overwrite analyzed fields with card data.
    const s = sightingPatch(existing, { price: args.listPrice ?? null, homeStatus: args.homeStatus, datePriceChanged }, now);
    await ctx.db.patch(existing._id, s.patch);
    return { id: existing._id, isNew: false, priceDropped: s.priceDropped, backOnMarket: s.backOnMarket };
  },
```

Update the doc comment above `upsertListing` to say: "Repeat zpid: `sightingPatch` decides cut / back-on-market / revive."

- [ ] **Step 3: `archiveStaleKeepers` on lastSeen**

In `archiveStaleKeepers`, replace

```ts
      if (row.firstSeen < cutoff) {
        await ctx.db.patch(row._id, { archivedAt: now, updatedAt: now });
```

with

```ts
      // lastSeen (last appearance in ANY Zillow search) — a keeper the price-cut sweep
      // keeps seeing stays on the board; the rotation (recheckAt) ends with it.
      if (row.lastSeen < cutoff) {
        await ctx.db.patch(row._id, { archivedAt: now, archivedReason: "stale", recheckAt: undefined, updatedAt: now });
```

and change its doc comment "older than `days` (by firstSeen)" to "not seen in a Zillow search for `days` (by lastSeen)".

- [ ] **Step 4: Card args + nightly analyze set**

In `convex/monitorActions.ts` `upsertArgsFromCard`, add before the closing `};`:

```ts
    ...(l.homeStatus ? { homeStatus: l.homeStatus } : {}),
    ...(l.priceChange != null ? { priceChange: l.priceChange } : {}),
    ...(l.datePriceChanged != null ? { datePriceChanged: l.datePriceChanged } : {}),
```

In `runMonitorScan` step 2, change

```ts
        if (up.isNew || up.priceDropped) toAnalyze.push(up.id);
```

to

```ts
        if (up.isNew || up.priceDropped || up.backOnMarket) toAnalyze.push(up.id);
```

- [ ] **Step 5: Codegen + checks**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Expected: "Convex functions ready", with the schema and index pushed to the local anonymous backend.
Then: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green. `ctx.db.patch(existing._id, s.patch)` type-checks because `TrackingPatch` keys are all `monitorListings` columns.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/monitorData.ts convex/monitorActions.ts convex/_generated
git commit -F - <<'EOF'
feat(monitor): track homeStatus + cut/back-on-market events on upsert; retire keepers by lastSeen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 4: `analyzeOne` re-alert + rotation scheduling

**Files:**
- Modify: `convex/monitorData.ts` (`analysisFields`, `patchAnalysis`)
- Modify: `convex/monitorActions.ts` (`analyzeOne` final patch)

**Interfaces:**
- Consumes: `reAlertDecision`, `nextRecheckAt` (Task 2); `isDigestWorthy` (existing, `monitorListings.ts`); `ListingDetail.homeStatus` (existing); Task 3 schema fields.
- Produces: `internal.monitorData.patchAnalysis` accepts `clearRecheck?: boolean` and the fields `homeStatus`, `recheckAt`, `alertTag`, `alertedEventAt`. After every successful analysis, a digest-worthy row with a new event has `emailedAt` removed plus `alertTag`/`alertedEventAt` set, and a keeper has `recheckAt` set.

- [ ] **Step 1: `analysisFields` + `clearRecheck`**

In `convex/monitorData.ts` `analysisFields`, add before `// workflow`:

```ts
  // Phase 4 tracking (set by analyzeOne)
  homeStatus: v.optional(v.string()),
  recheckAt: v.optional(v.number()),
  alertTag: v.optional(v.string()),
  alertedEventAt: v.optional(v.number()),
```

In `patchAnalysis`, add the arg and apply it:

```ts
    clearRecheck: v.optional(v.boolean()), // no longer a keeper -> leave the detail re-check rotation
```

```ts
  handler: async (ctx, { id, fields, clearFlip, clearRental, clearEmailed, clearRecheck }) => {
    await ctx.db.patch(id, {
      ...fields,
      ...(clearEmailed ? { emailedAt: undefined } : {}),
      ...(clearRecheck ? { recheckAt: undefined } : {}),
```

(the rest of the handler is unchanged).

- [ ] **Step 2: Wire `analyzeOne`**

In `convex/monitorActions.ts`, add `isDigestWorthy` to the `../src/scraper/monitorListings` import and add:

```ts
import { reAlertDecision, nextRecheckAt } from "../src/scraper/monitorRecheck";
```

In `analyzeOne`, directly before `// 11) Patch everything`, insert:

```ts
      // 10b) Phase 4: re-alert on a NEW cut / back-on-market (decided here, after the new
      // numbers, so a failed re-analysis never emails stale ones) + detail re-check rotation.
      const now = Date.now();
      const reAlert = reAlertDecision(row, isDigestWorthy(deal.bestExit));
      const recheckAt = nextRecheckAt({ keeper, archivedAt: row.archivedAt, archivedReason: row.archivedReason, lastSeen: row.lastSeen }, now);
```

In the `patchAnalysis` call of step 11, replace

```ts
        ...(shouldReopenForDigest(row.bestExit, deal.bestExit) ? { clearEmailed: true } : {}),
```

with

```ts
        ...(shouldReopenForDigest(row.bestExit, deal.bestExit) || reAlert.reopen ? { clearEmailed: true } : {}),
        ...(recheckAt == null ? { clearRecheck: true } : {}),
```

and inside `fields: { ... }`, right after `aiModel: LLM_MODEL,`, add:

```ts
          ...(recheckAt != null ? { recheckAt } : {}),
          ...(reAlert.reopen ? { alertedEventAt: reAlert.alertedEventAt, alertTag: reAlert.alertTag } : {}),
          ...(detail?.homeStatus ? { homeStatus: detail.homeStatus } : {}),
```

Leave the LAND and multi-unit/condo early returns untouched. They are never keepers, and if they still carry a `recheckAt`, `recheckPatch` drops them on the next check (non-keeper -> `recheckAt` removed).

- [ ] **Step 3: Codegen + checks**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Then: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green. The loop-guard behavior is pinned by Task 2's `reAlertDecision` tests. This task is wiring only.

- [ ] **Step 4: Commit**

```bash
git add convex/monitorData.ts convex/monitorActions.ts convex/_generated
git commit -F - <<'EOF'
feat(monitor): re-alert digest-worthy rows on a new cut/back-on-market; keepers join the re-check rotation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 5: The re-check lane (price-cut sweep + detail rotation + cron)

**Files:**
- Modify: `convex/monitorData.ts` (`dueForRecheck`, `applyRecheck`, `seedRecheck`)
- Modify: `convex/monitorActions.ts` (`runMonitorRecheck`, `recheckOne`)
- Modify: `convex/crons.ts`
- Generated: `convex/_generated/*`

**Interfaces:**
- Consumes: `buildSearchUrl({ page, priceCutOnly: true })`, `passesScanGate`, `detailFromCache().price/isPending` (Task 1); `recheckPatch` (Task 2); `upsertListing` returning `backOnMarket` (Task 3); `by_recheck` index (Task 3).
- Produces:
  - `internal.monitorData.dueForRecheck({ now: number, limit: number }) -> Array<{ _id: Id<"monitorListings">; url: string }>`
  - `internal.monitorData.applyRecheck({ id, detail?: { homeStatus?: string; isPending: boolean; price?: number } }) -> { reanalyze: boolean; outcome: string }`
  - `internal.monitorData.seedRecheck({ dryRun?: boolean }) -> { dryRun: boolean; total: number; seeded: number }` (operator, one-time)
  - `internal.monitorActions.runMonitorRecheck({ trigger: "cron" | "manual" }) -> RecheckResult`
  - `internal.monitorActions.recheckOne({ id })`
  - cron `"monitor recheck"` `0 14 * * *`

- [ ] **Step 1: Data layer**

In `convex/monitorData.ts`, extend the monitorRecheck import to `import { sightingPatch, cardCutFields, recheckPatch } from "../src/scraper/monitorRecheck";`, add `MONITOR` to the `../src/scraper/monitorListings` import, and append after `sweepStalePending`:

```ts
/**
 * Rows due for a detail re-check (the rotation), oldest-due first, capped. The lower
 * bound is load-bearing: Convex sorts undefined BEFORE numbers, so lte(now) alone would
 * return every row outside the rotation.
 */
export const dueForRecheck = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_recheck", (q) => q.gt("recheckAt", 0).lte("recheckAt", now))
      .take(limit);
    return rows.map((r) => ({ _id: r._id, url: r.url }));
  },
});

/**
 * Apply one detail re-check against the FRESH stored row (pure recheckPatch: archive on
 * PENDING/SOLD/OFF_MARKET, revive on back-on-market, cut detection, next rotation slot).
 * detail omitted = the scrape failed (shell page) -> retry tomorrow, nothing archived.
 */
export const applyRecheck = internalMutation({
  args: {
    id: v.id("monitorListings"),
    detail: v.optional(v.object({ homeStatus: v.optional(v.string()), isPending: v.boolean(), price: v.optional(v.number()) })),
  },
  handler: async (ctx, { id, detail }): Promise<{ reanalyze: boolean; outcome: string }> => {
    const row = await ctx.db.get(id);
    if (!row) return { reanalyze: false, outcome: "missing" };
    const r = recheckPatch(row, detail ? { homeStatus: detail.homeStatus, isPending: detail.isPending, price: detail.price ?? null } : null, Date.now());
    await ctx.db.patch(id, r.patch);
    return { reanalyze: r.reanalyze, outcome: r.outcome };
  },
});

/**
 * One-time (operator) seeding: put the CURRENT active keepers into the re-check rotation,
 * spread over the cadence window so day one doesn't re-scrape all of them. New keepers
 * join automatically via analyzeOne. Run on prod after deploy:
 *   npx convex run monitorData:seedRecheck '{"dryRun":true}'
 */
export const seedRecheck = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .take(1000);
    const now = Date.now();
    let seeded = 0;
    for (const r of rows) {
      if (r.recheckAt != null) continue;
      const at = now + (seeded % MONITOR.recheckEveryDays) * 86_400_000 + 60_000;
      if (!dryRun) await ctx.db.patch(r._id, { recheckAt: at });
      seeded++;
    }
    return { dryRun: !!dryRun, total: rows.length, seeded };
  },
});
```

- [ ] **Step 2: Actions**

In `convex/monitorActions.ts`, add after `runMonitorScan`:

```ts
type RecheckResult = { cutPages: number; cutCards: number; newCount: number; cutEvents: number; backOnMarket: number; detailScheduled: number };

/**
 * Phase 4 re-check lane (daily cron, or manual via CLI). Lane A: Zillow's price-cut
 * search over ALL of NCC <= $500K at any days on market (~6 pages) through the SAME
 * upsertListing as the nightly scan, so older listings with cuts are discovered and
 * tracked rows' cuts / back-on-market are detected in one place. Lane B: schedule a
 * detail re-check for each row due in the rotation (staggered, one action each — the
 * 10-min limit). Deliberately writes NO monitorRuns row: the nightly cron's 20h guard
 * (mostRecentCompleteRun) would read it as tonight's scan and skip the nightly.
 * Re-alerted rows go out in the next nightly digest.
 */
export const runMonitorRecheck = internalAction({
  args: { trigger: v.union(v.literal("cron"), v.literal("manual")) },
  handler: async (ctx, { trigger }): Promise<RecheckResult> => {
    const res: RecheckResult = { cutPages: 0, cutCards: 0, newCount: 0, cutEvents: 0, backOnMarket: 0, detailScheduled: 0 };
    if (trigger === "cron" && !cronScanEnabled(process.env.MONITOR_SCAN_ENABLED)) return res;
    try {
      const apiKey = fcKey();

      // Lane A: price-cut sweep (sorted newest-listed, stable pages; a blocked page ends it).
      const toAnalyze: Array<Doc<"monitorListings">["_id"]> = [];
      let total: number | null = null;
      for (let page = 1; page <= MONITOR.cutSearchMaxPages; page++) {
        const nextData = await scrapeZillowJson(buildSearchUrl({ page, priceCutOnly: true }), apiKey, SEARCH_SCRAPE_BUDGET);
        if (!nextData) break;
        const listings = listingsFromSearch(nextData);
        if (listings.length === 0) break;
        res.cutPages++;
        res.cutCards += listings.length;
        if (total == null) total = totalResultCount(nextData);
        for (const l of listings) {
          if (!passesScanGate(l)) continue;
          const up = await ctx.runMutation(internal.monitorData.upsertListing, upsertArgsFromCard(l));
          if (up.isNew) res.newCount++;
          if (up.priceDropped) res.cutEvents++;
          if (up.backOnMarket) res.backOnMarket++;
          if (up.isNew || up.priceDropped || up.backOnMarket) toAnalyze.push(up.id);
        }
        if (total != null && res.cutCards >= total) break;
      }
      // A short sweep must be visible, never silently partial.
      if (total == null || res.cutCards < total) {
        await ctx.runMutation(internal.errors.logServerError, {
          message: `monitor recheck: price-cut sweep covered ${res.cutCards} of ${total ?? "unknown"} listings (${res.cutPages} page(s))`,
          context: "monitorActions.runMonitorRecheck",
        });
      }
      for (let i = 0; i < toAnalyze.length; i++) {
        await ctx.scheduler.runAfter(i * STAGGER_MS, internal.monitorActions.analyzeOne, { id: toAnalyze[i] });
      }

      // Lane B: detail re-checks for rows due in the rotation (after Lane A's analyses).
      const due = await ctx.runQuery(internal.monitorData.dueForRecheck, { now: Date.now(), limit: MONITOR.recheckDetailCap });
      const offset = toAnalyze.length * STAGGER_MS;
      for (let i = 0; i < due.length; i++) {
        await ctx.scheduler.runAfter(offset + i * STAGGER_MS, internal.monitorActions.recheckOne, { id: due[i]._id });
      }
      res.detailScheduled = due.length;
      return res;
    } catch (e) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: `runMonitorRecheck failed: ${e instanceof Error ? e.message : String(e)}`,
        context: "monitorActions.runMonitorRecheck",
      });
      return res;
    }
  },
});

/**
 * One rotation row: detail re-scrape -> applyRecheck (pure recheckPatch) -> re-analyze on
 * a cut / back-on-market. analyzeOne's first scrape attempt accepts a <=1h Firecrawl
 * cache, so it normally re-reads this same page instead of a second live scrape.
 */
export const recheckOne = internalAction({
  args: { id: v.id("monitorListings") },
  handler: async (ctx, { id }): Promise<void> => {
    try {
      const row = await ctx.runQuery(internal.monitorData.getListingInternal, { id });
      if (!row) return;
      const data = await scrapeZillowJson(row.url, fcKey(), ANALYZE_SCRAPE_BUDGET);
      const d = data ? detailFromCache(data) : null;
      const r = await ctx.runMutation(internal.monitorData.applyRecheck, {
        id,
        ...(d
          ? { detail: { isPending: d.isPending, ...(d.homeStatus ? { homeStatus: d.homeStatus } : {}), ...(d.price != null ? { price: d.price } : {}) } }
          : {}),
      });
      if (r.reanalyze) await ctx.scheduler.runAfter(0, internal.monitorActions.analyzeOne, { id });
    } catch (e) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: `recheckOne failed: ${e instanceof Error ? e.message : String(e)}`,
        context: "monitorActions.recheckOne",
      });
    }
  },
});
```

- [ ] **Step 3: Cron**

In `convex/crons.ts`, add before `export default crons;`:

```ts
// Monitor re-check lane (Phase 4): daily price-cut search sweep (~6 credits) + detail
// re-checks of due rotation rows (status / cut / back-on-market). 14:00 UTC (9-10 AM ET),
// far from the 02:00 UTC nightly; it writes no monitorRuns row, so it never trips the
// nightly's 20h guard. Respects MONITOR_SCAN_ENABLED="0" like the nightly cron.
crons.cron(
  "monitor recheck",
  "0 14 * * *",
  internal.monitorActions.runMonitorRecheck,
  { trigger: "cron" },
);
```

- [ ] **Step 4: Codegen + checks**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Expected: functions ready. The cron is registered on the LOCAL anonymous backend only.
Then: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green. If TS reports TS7022 (circular inference) on `recheckOne` or `runMonitorRecheck`, the explicit `Promise<...>` return annotations above are the fix (lessons 2026-06-01). Keep them.

- [ ] **Step 5: Local smoke (no Firecrawl credits)**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex run monitorData:seedRecheck '{\"dryRun\":true}'`
Expected: `{ dryRun: true, total: 0, seeded: 0 }` on the empty local backend, which proves the function and index validate. Do NOT run `runMonitorRecheck` locally: it would spend live credits with `.env.local`'s key. Live verification is a Rollout step.

- [ ] **Step 6: Commit**

```bash
git add convex/monitorData.ts convex/monitorActions.ts convex/crons.ts convex/_generated
git commit -F - <<'EOF'
feat(monitor): re-check lane - daily price-cut sweep + detail rotation for keepers (status, cuts, back on market)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 6: Pure buy box logic (`monitorBuyBox.ts`)

**Files:**
- Create: `src/scraper/monitorBuyBox.ts`
- Test: `tests/monitorBuyBox.test.ts`

**Interfaces:**
- Consumes: `digestRecipients` (existing, `monitorListings.ts`).
- Produces (exported from `src/scraper/monitorBuyBox.ts`):
  - `type BuyBoxExit = "FLIP" | "RENTAL"`
  - `interface BuyBox { zips: string[]; priceMin?: number; priceMax?: number; minBeds?: number; exits: BuyBoxExit[]; minFlipProfit?: number; minCashFlow?: number }`
  - `interface BuyBoxInput { zips: string[]; priceMin?: number; priceMax?: number; minBeds?: number; exits: string[]; minFlipProfit?: number; minCashFlow?: number }`
  - `parseZipList(text: string): { zips: string[]; invalid: string[] }`
  - `normalizeBuyBox(i: BuyBoxInput): { ok: true; box: BuyBox } | { ok: false; error: string }`
  - `isEmptyBuyBox(b: BuyBox): boolean`
  - `interface BuyBoxRow { propZip?: string; address: string; listPrice?: number; beds?: number | string; bestExit?: string; flipProfit?: number; cashFlow?: number }`
  - `matchesBuyBox(r: BuyBoxRow, box: BuyBox | null | undefined): boolean`
  - `interface AudienceMember { email: string; box: BuyBox | null }`
  - `planRecipientDigests<T extends BuyBoxRow>(rows: T[], members: AudienceMember[], fallback?: string): { to: string; rows: T[] }[]`
  - `shouldStampDigest(attempted: number, succeeded: number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/monitorBuyBox.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseZipList, normalizeBuyBox, isEmptyBuyBox, matchesBuyBox, planRecipientDigests, shouldStampDigest,
  type BuyBox, type BuyBoxRow,
} from "../src/scraper/monitorBuyBox";

const box = (o: Partial<BuyBox> = {}): BuyBox => ({ zips: [], exits: [], ...o });
const flip = (o: Partial<BuyBoxRow> = {}): BuyBoxRow =>
  ({ address: "1 A St, Wilmington, DE 19805", propZip: "19805", listPrice: 250000, beds: 3, bestExit: "FLIP", flipProfit: 40000, ...o });
const rental = (o: Partial<BuyBoxRow> = {}): BuyBoxRow =>
  ({ address: "2 B St, Newark, DE 19711", propZip: "19711", listPrice: 180000, beds: 2, bestExit: "RENTAL", cashFlow: 150, ...o });

describe("parseZipList", () => {
  it("splits on commas/spaces, trims ZIP+4, dedupes, reports junk", () => {
    expect(parseZipList(" 19805, 19806 19711-1234 ,19805 abc 1980 ")).toEqual({ zips: ["19805", "19806", "19711"], invalid: ["abc", "1980"] });
    expect(parseZipList("")).toEqual({ zips: [], invalid: [] });
  });
});

describe("normalizeBuyBox", () => {
  it("accepts a full box and normalizes ZIPs", () => {
    const r = normalizeBuyBox({ zips: ["19805-1234", "19806"], priceMin: 100000, priceMax: 300000, minBeds: 3, exits: ["FLIP"], minFlipProfit: 30000, minCashFlow: -50 });
    expect(r).toEqual({ ok: true, box: { zips: ["19805", "19806"], priceMin: 100000, priceMax: 300000, minBeds: 3, exits: ["FLIP"], minFlipProfit: 30000, minCashFlow: -50 } });
  });
  it("rejects min price above max price", () => {
    expect(normalizeBuyBox({ zips: [], priceMin: 300000, priceMax: 200000, exits: [] })).toEqual({ ok: false, error: "Min price is above max price" });
  });
  it("rejects a bad ZIP, a bad exit, a negative price and a non-finite number", () => {
    expect(normalizeBuyBox({ zips: ["abc"], exits: [] })).toEqual({ ok: false, error: "Not a 5-digit ZIP: abc" });
    expect(normalizeBuyBox({ zips: [], exits: ["WHOLESALE"] })).toEqual({ ok: false, error: "Exits must be FLIP or RENTAL" });
    expect(normalizeBuyBox({ zips: [], exits: [], priceMin: -1 })).toEqual({ ok: false, error: "Numbers must be 0 or more (except min cash flow)" });
    expect(normalizeBuyBox({ zips: [], exits: [], minBeds: Number.NaN })).toEqual({ ok: false, error: "Numbers must be 0 or more (except min cash flow)" });
  });
  it("an all-empty box is empty (= everything)", () => {
    const r = normalizeBuyBox({ zips: [], exits: [] });
    expect(r.ok && isEmptyBuyBox(r.box)).toBe(true);
    expect(isEmptyBuyBox(box({ zips: ["19805"] }))).toBe(false);
  });
});

describe("matchesBuyBox", () => {
  it("no box = everything", () => {
    expect(matchesBuyBox(flip(), null)).toBe(true);
    expect(matchesBuyBox(flip(), undefined)).toBe(true);
  });
  it("ZIPs: propZip, else the address ZIP; a missing ZIP fails a ZIP box", () => {
    expect(matchesBuyBox(flip(), box({ zips: ["19805"] }))).toBe(true);
    expect(matchesBuyBox(flip({ propZip: undefined }), box({ zips: ["19805"] }))).toBe(true);
    expect(matchesBuyBox(rental(), box({ zips: ["19805"] }))).toBe(false);
    expect(matchesBuyBox(flip({ propZip: undefined, address: "no zip here" }), box({ zips: ["19805"] }))).toBe(false);
  });
  it("price band", () => {
    expect(matchesBuyBox(flip(), box({ priceMin: 200000, priceMax: 250000 }))).toBe(true);
    expect(matchesBuyBox(flip(), box({ priceMax: 249999 }))).toBe(false);
    expect(matchesBuyBox(flip(), box({ priceMin: 250001 }))).toBe(false);
  });
  it("min beds: numeric or string beds compared, unknown beds pass", () => {
    expect(matchesBuyBox(flip({ beds: "3" }), box({ minBeds: 3 }))).toBe(true);
    expect(matchesBuyBox(flip({ beds: 2 }), box({ minBeds: 3 }))).toBe(false);
    expect(matchesBuyBox(flip({ beds: undefined }), box({ minBeds: 3 }))).toBe(true);
  });
  it("exits wanted", () => {
    expect(matchesBuyBox(rental(), box({ exits: ["FLIP"] }))).toBe(false);
    expect(matchesBuyBox(rental(), box({ exits: ["FLIP", "RENTAL"] }))).toBe(true);
  });
  it("min flip profit applies to FLIP rows only; min cash flow to RENTAL rows only", () => {
    const b = box({ minFlipProfit: 50000, minCashFlow: 200 });
    expect(matchesBuyBox(flip(), b)).toBe(false);
    expect(matchesBuyBox(flip({ flipProfit: 60000 }), b)).toBe(true);
    expect(matchesBuyBox(rental(), b)).toBe(false);
    expect(matchesBuyBox(rental({ cashFlow: 250 }), b)).toBe(true);
    expect(matchesBuyBox(flip({ flipProfit: undefined }), box({ minFlipProfit: 1 }))).toBe(false);
  });
});

describe("planRecipientDigests", () => {
  const rows = [flip(), rental()];
  it("filters per recipient by their box; fallback has no box; duplicate fallback ignored", () => {
    const plan = planRecipientDigests(rows, [
      { email: "Ann@x.com", box: box({ exits: ["RENTAL"] }) },
      { email: "bob@x.com", box: null },
    ], "ann@x.com");
    expect(plan).toEqual([
      { to: "Ann@x.com", rows: [rows[1]] },
      { to: "bob@x.com", rows },
    ]);
  });
  it("the RESEND_TO fallback alone gets everything", () => {
    expect(planRecipientDigests(rows, [], "ops@x.com")).toEqual([{ to: "ops@x.com", rows }]);
  });
  it("a recipient whose box matches nothing is omitted", () => {
    expect(planRecipientDigests(rows, [{ email: "c@x.com", box: box({ zips: ["19999"] }) }])).toEqual([]);
  });
});

describe("shouldStampDigest", () => {
  it("stamp when nothing to send or any send succeeded; not when every send failed", () => {
    expect(shouldStampDigest(0, 0)).toBe(true);
    expect(shouldStampDigest(3, 1)).toBe(true);
    expect(shouldStampDigest(2, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/monitorBuyBox.test.ts`
Expected: FAIL with "Failed to resolve import ../src/scraper/monitorBuyBox".

- [ ] **Step 3: Implement**

Create `src/scraper/monitorBuyBox.ts`:

```ts
// Phase 4 — per-user Monitor buy box: validation, matching, and per-recipient digest
// planning. Pure (no Convex): the mutation validates with normalizeBuyBox, sendDigest
// plans with planRecipientDigests. Empty list / unset bound = "any".
import { digestRecipients } from "./monitorListings";

export type BuyBoxExit = "FLIP" | "RENTAL";
export interface BuyBox {
  zips: string[];
  priceMin?: number;
  priceMax?: number;
  minBeds?: number;
  exits: BuyBoxExit[];
  minFlipProfit?: number;
  minCashFlow?: number;
}
export interface BuyBoxInput {
  zips: string[];
  priceMin?: number;
  priceMax?: number;
  minBeds?: number;
  exits: string[];
  minFlipProfit?: number;
  minCashFlow?: number;
}

// "19805, 19806 19711-1234" -> ["19805","19806","19711"]; ZIP+4 trimmed, dupes dropped,
// anything else reported (never silently dropped).
export function parseZipList(text: string): { zips: string[]; invalid: string[] } {
  const zips: string[] = [];
  const invalid: string[] = [];
  for (const tok of (text || "").split(/[\s,;]+/).filter(Boolean)) {
    const m = tok.match(/^(\d{5})(?:-\d{4})?$/);
    if (!m) { invalid.push(tok); continue; }
    if (!zips.includes(m[1])) zips.push(m[1]);
  }
  return { zips, invalid };
}

const NON_NEG = ["priceMin", "priceMax", "minBeds", "minFlipProfit"] as const;

export function normalizeBuyBox(i: BuyBoxInput): { ok: true; box: BuyBox } | { ok: false; error: string } {
  const zips: string[] = [];
  for (const z of i.zips) {
    const p = parseZipList(z);
    if (p.invalid.length) return { ok: false, error: `Not a 5-digit ZIP: ${p.invalid[0]}` };
    for (const x of p.zips) if (!zips.includes(x)) zips.push(x);
  }
  if (zips.length > 40) return { ok: false, error: "At most 40 ZIPs" };
  for (const k of NON_NEG) {
    const n = i[k];
    if (n != null && !(Number.isFinite(n) && n >= 0)) return { ok: false, error: "Numbers must be 0 or more (except min cash flow)" };
  }
  if (i.minCashFlow != null && !Number.isFinite(i.minCashFlow)) return { ok: false, error: "Min cash flow must be a number" };
  if (i.priceMin != null && i.priceMax != null && i.priceMin > i.priceMax) return { ok: false, error: "Min price is above max price" };
  const exits: BuyBoxExit[] = [];
  for (const e of i.exits) {
    if (e !== "FLIP" && e !== "RENTAL") return { ok: false, error: "Exits must be FLIP or RENTAL" };
    if (!exits.includes(e)) exits.push(e);
  }
  return {
    ok: true,
    box: {
      zips,
      ...(i.priceMin != null ? { priceMin: i.priceMin } : {}),
      ...(i.priceMax != null ? { priceMax: i.priceMax } : {}),
      ...(i.minBeds != null ? { minBeds: i.minBeds } : {}),
      exits,
      ...(i.minFlipProfit != null ? { minFlipProfit: i.minFlipProfit } : {}),
      ...(i.minCashFlow != null ? { minCashFlow: i.minCashFlow } : {}),
    },
  };
}

export function isEmptyBuyBox(b: BuyBox): boolean {
  return b.zips.length === 0 && b.exits.length === 0 && b.priceMin == null && b.priceMax == null &&
    b.minBeds == null && b.minFlipProfit == null && b.minCashFlow == null;
}

export interface BuyBoxRow {
  propZip?: string;
  address: string;
  listPrice?: number;
  beds?: number | string;
  bestExit?: string;
  flipProfit?: number;
  cashFlow?: number;
}
function rowZip(r: BuyBoxRow): string | null {
  return r.propZip ?? r.address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
}
function bedsNum(b: number | string | undefined): number | null {
  const n = typeof b === "number" ? b : parseFloat(b ?? "");
  return Number.isFinite(n) ? n : null;
}

export function matchesBuyBox(r: BuyBoxRow, box: BuyBox | null | undefined): boolean {
  if (!box) return true;
  if (box.zips.length) {
    const z = rowZip(r);
    if (!z || !box.zips.includes(z)) return false;
  }
  if (box.priceMin != null && !(r.listPrice != null && r.listPrice >= box.priceMin)) return false;
  if (box.priceMax != null && !(r.listPrice != null && r.listPrice <= box.priceMax)) return false;
  // Unknown beds pass: a card data gap must not hide a deal (the email shows what it has).
  if (box.minBeds != null) {
    const b = bedsNum(r.beds);
    if (b != null && b < box.minBeds) return false;
  }
  if (box.exits.length && !box.exits.includes(r.bestExit as BuyBoxExit)) return false;
  if (r.bestExit === "FLIP" && box.minFlipProfit != null && !(r.flipProfit != null && r.flipProfit >= box.minFlipProfit)) return false;
  if (r.bestExit === "RENTAL" && box.minCashFlow != null && !(r.cashFlow != null && r.cashFlow >= box.minCashFlow)) return false;
  return true;
}

export interface AudienceMember { email: string; box: BuyBox | null; }

// Who gets what: digestRecipients() keeps the existing who-is-active + dedupe rules; each
// recipient's rows = the digest set filtered by their own box (RESEND_TO fallback = no
// box = everything). Recipients with nothing matching are omitted (no empty email).
export function planRecipientDigests<T extends BuyBoxRow>(rows: T[], members: AudienceMember[], fallback?: string): { to: string; rows: T[] }[] {
  const boxByEmail = new Map(members.map((m) => [m.email.trim().toLowerCase(), m.box] as const));
  const out: { to: string; rows: T[] }[] = [];
  for (const to of digestRecipients(members.map((m) => m.email), fallback)) {
    const mine = rows.filter((r) => matchesBuyBox(r, boxByEmail.get(to.toLowerCase()) ?? null));
    if (mine.length) out.push({ to, rows: mine });
  }
  return out;
}

// emailedAt is GLOBAL ("digest processed"): stamp the set when at least one send
// succeeded or nobody's box matched anything (else unmatched rows are re-read nightly);
// stamp nothing when every attempted send failed, so tomorrow retries.
export function shouldStampDigest(attempted: number, succeeded: number): boolean {
  return attempted === 0 || succeeded > 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/monitorBuyBox.test.ts`
Expected: PASS.

- [ ] **Step 5: Full checks**

Run: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/scraper/monitorBuyBox.ts tests/monitorBuyBox.test.ts
git commit -F - <<'EOF'
feat(monitor): pure per-user buy box - validation, matching, per-recipient digest plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 7: Buy box storage + API (`monitorBuyBoxes`)

**Files:**
- Modify: `convex/schema.ts` (new table)
- Modify: `convex/monitorData.ts` (`myBuyBox`, `saveMyBuyBox`, `clearMyBuyBox`, `digestAudienceInternal`)
- Generated: `convex/_generated/*`

**Interfaces:**
- Consumes: `normalizeBuyBox`, `isEmptyBuyBox`, `BuyBox`, `AudienceMember` (Task 6); `getAuthUser` (`convex/lib/getAuthUser.ts`), `requireUser` (`convex/helpers.ts`).
- Produces:
  - table `monitorBuyBoxes` with index `by_user`
  - `api.monitorData.myBuyBox` (query, no args) `-> BuyBox | null`
  - `api.monitorData.saveMyBuyBox` (mutation, args = `BuyBoxInput` fields) `-> null`
  - `api.monitorData.clearMyBuyBox` (mutation, no args) `-> null`
  - `internal.monitorData.digestAudienceInternal` (no args) `-> AudienceMember[]` (active users only)

- [ ] **Step 1: Schema**

In `convex/schema.ts`, add after the `zipComps` table:

```ts
  // Per-user Monitor buy box (Phase 4). One row per CRM user; no row = "everything
  // digest-worthy". Kept separate from any per-user triage state (Phase 3) on purpose.
  monitorBuyBoxes: defineTable({
    userId: v.id("users"),
    zips: v.array(v.string()),
    priceMin: v.optional(v.number()),
    priceMax: v.optional(v.number()),
    minBeds: v.optional(v.number()),
    exits: v.array(v.union(v.literal("FLIP"), v.literal("RENTAL"))),
    minFlipProfit: v.optional(v.number()),
    minCashFlow: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
```

- [ ] **Step 2: Functions**

In `convex/monitorData.ts`, add imports:

```ts
import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUser } from "./lib/getAuthUser";
import { normalizeBuyBox, isEmptyBuyBox, type BuyBox, type AudienceMember } from "../src/scraper/monitorBuyBox";
```

(merge `ConvexError` into the existing `convex/values` import and the types into existing type imports, so nothing is imported twice). Then append:

```ts
// ---- Phase 4: per-user buy box ----

// requireUser first (auth + active), then the users row for its _id.
async function callerUserId(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  await requireUser(ctx);
  return (await getAuthUser(ctx))!._id;
}

function buyBoxFromDoc(d: Doc<"monitorBuyBoxes">): BuyBox {
  return {
    zips: d.zips,
    exits: d.exits,
    ...(d.priceMin != null ? { priceMin: d.priceMin } : {}),
    ...(d.priceMax != null ? { priceMax: d.priceMax } : {}),
    ...(d.minBeds != null ? { minBeds: d.minBeds } : {}),
    ...(d.minFlipProfit != null ? { minFlipProfit: d.minFlipProfit } : {}),
    ...(d.minCashFlow != null ? { minCashFlow: d.minCashFlow } : {}),
  };
}

/** The caller's buy box, or null = everything digest-worthy. */
export const myBuyBox = query({
  args: {},
  handler: async (ctx): Promise<BuyBox | null> => {
    const userId = await callerUserId(ctx);
    const d = await ctx.db.query("monitorBuyBoxes").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    return d ? buyBoxFromDoc(d) : null;
  },
});

/** Save (replace) the caller's buy box. An all-empty box deletes it (= everything). */
export const saveMyBuyBox = mutation({
  args: {
    zips: v.array(v.string()),
    priceMin: v.optional(v.number()),
    priceMax: v.optional(v.number()),
    minBeds: v.optional(v.number()),
    exits: v.array(v.string()),
    minFlipProfit: v.optional(v.number()),
    minCashFlow: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await callerUserId(ctx);
    const n = normalizeBuyBox(args);
    if (!n.ok) throw new ConvexError({ code: "INVALID", message: n.error });
    const existing = await ctx.db.query("monitorBuyBoxes").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (isEmptyBuyBox(n.box)) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const doc = { userId, ...n.box, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, doc); // replace drops cleared optional bounds
    else await ctx.db.insert("monitorBuyBoxes", doc);
    return null;
  },
});

/** Reset the caller's buy box (back to everything). */
export const clearMyBuyBox = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await callerUserId(ctx);
    const existing = await ctx.db.query("monitorBuyBoxes").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/**
 * Digest audience for the scheduled sendDigest (no identity): every ACTIVE user's email +
 * their buy box (null = everything). users is a small table (the same read
 * users.activeEmailsInternal does); buy boxes are one row per user, capped.
 */
export const digestAudienceInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<AudienceMember[]> => {
    const users = (await ctx.db.query("users").collect()).filter((u) => u.isActive);
    const boxes = await ctx.db.query("monitorBuyBoxes").take(500);
    const byUser = new Map(boxes.map((b) => [b.userId, b] as const));
    return users.map((u) => {
      const b = byUser.get(u._id);
      return { email: u.email, box: b ? buyBoxFromDoc(b) : null };
    });
  },
});
```

- [ ] **Step 3: Codegen + checks**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Then: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green.

- [ ] **Step 4: Auth smoke (local)**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex run monitorData:myBuyBox '{}'`
Expected: an error containing `UNAUTHENTICATED` (no identity on the CLI), which proves the `requireUser` gate.
Run: `$env:CONVEX_AGENT_MODE='anonymous'; npx convex run monitorData:digestAudienceInternal '{}'`
Expected: `[]` on the empty local backend.

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/monitorData.ts convex/_generated
git commit -F - <<'EOF'
feat(monitor): per-user buy box table + auth-gated get/save/clear + digest audience query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 8: Per-recipient digest send + PRICE CUT / BACK ON MARKET tag

**Files:**
- Modify: `src/scraper/monitorDigest.ts` (created by Phase 3 Task 6: `DigestRow` gains `alertTag`; card + subject render it)
- Test: `tests/monitorDigest.test.ts` (Phase 3's file; append a describe block)
- Modify: `convex/monitorActions.ts` (`sendDigest`)

**Interfaces:**
- Consumes:
  - `planRecipientDigests`, `shouldStampDigest` (Task 6); `digestAlertTag` (Task 2); `internal.monitorData.digestAudienceInternal` (Task 7)
  - From Phase 3: `buildDigest(rows: DigestRow[], o: DigestOpts)` with `DigestOpts { baseUrl; moreOnBoard; date }`, `esc`, and `internal.monitorData.activeKeeperCount`
  - `digestRecipients` (existing)
- Produces:
  - `DigestRow.alertTag?: string | null`, an already-fresh tag (sendDigest computes it with `digestAlertTag`; `buildDigest` only renders it)
  - `sendDigest` sends one email per recipient containing only the rows that match that recipient's buy box

Phase 3 state this task builds on (verify before editing):
- `sendDigest` sends ONE email to all recipients via `buildDigest(keepers, { baseUrl: base, moreOnBoard, date })`.
- The digest does NOT filter by Phase 3 triage (pass/snooze).

So per-recipient sending is new here, and a re-alert reaches every recipient whose box matches, including someone who passed before the cut (Resolved decisions). If Phase 3 shipped differently (e.g. it already loops per recipient), keep its loop. Inside it, intersect its row selection with `matchesBuyBox(row, box)`, apply its pass exclusion only when `!(row.alertedEventAt != null && row.alertedEventAt > passedAt)`, and keep Step 4's stamping rule.

- [ ] **Step 1: Write the failing test**

Append to `tests/monitorDigest.test.ts` (it already defines `FLIP`, `RENTAL`, `OPTS` and imports `buildDigest`):

```ts
describe("Phase 4 alert tag", () => {
  const cut = { ...FLIP, alertTag: "PRICE CUT $15,000" };
  it("renders the tag on the card (html + text), escaped", () => {
    const d = buildDigest([cut, RENTAL], OPTS);
    expect(d.html).toContain(">PRICE CUT $15,000<");
    expect(d.text).toContain("PRICE CUT $15,000");
    expect(buildDigest([{ ...FLIP, alertTag: `<b>x</b>` }], OPTS).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("subject counts re-alerts; untagged digests keep Phase 3's exact subject", () => {
    expect(buildDigest([cut, RENTAL], OPTS).subject).toBe("IRES Monitor: 2 worth a look · 1 price cut / back on market");
    expect(buildDigest([FLIP, RENTAL], OPTS).subject).toBe("IRES Monitor: 2 worth a look");
    expect(buildDigest([{ ...FLIP, alertTag: null }], OPTS).subject).toBe("IRES Monitor: 1 worth a look");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/monitorDigest.test.ts`
Expected: FAIL. The tag is not in the html/text and the subject has no suffix (and TS may flag `alertTag` as unknown on `DigestRow`).

- [ ] **Step 3: Implement in `src/scraper/monitorDigest.ts`**

Extend `DigestRow`:

```ts
export interface DigestRow extends PresentRow {
  _id: string; address: string; photoUrls?: string[] | null;
  alertTag?: string | null; // Phase 4: an already-FRESH "PRICE CUT $X" / "BACK ON MARKET" (sendDigest computes it)
}
```

In `cardHtml`, add a tag span to the pill line. Replace the pill `<div style="margin:0 0 6px;">...${score}</div>` line's `${score}</div>` ending with `${score}${tag}</div>`, and define `tag` next to `score`:

```ts
  const tag = r.alertTag
    ? `<span style="display:inline-block;background:${C.flagBg};color:${C.flagFg};font-size:11px;font-weight:700;letter-spacing:0.5px;padding:3px 8px;border-radius:10px;margin-left:6px;">${esc(r.alertTag)}</span>`
    : "";
```

In `cardText`, change the first line to carry the tag:

```ts
    `${normalizeExit(r.bestExit) ?? "FLIP"}${r.dealScore != null ? ` ${r.dealScore}` : ""}${r.alertTag ? ` · ${r.alertTag}` : ""} · ${r.address}`,
```

In `buildDigest`, replace `const subject = \`IRES Monitor: ${title}\`;` with:

```ts
  const alerts = rows.filter((r) => r.alertTag).length;
  const subject = `IRES Monitor: ${title}${alerts > 0 ? ` · ${alerts} price cut / back on market` : ""}`;
```

- [ ] **Step 4: Per-recipient send in `sendDigest`**

In `convex/monitorActions.ts` add:

```ts
import { planRecipientDigests, shouldStampDigest } from "../src/scraper/monitorBuyBox";
```

and extend the monitorRecheck import to `import { reAlertDecision, nextRecheckAt, digestAlertTag } from "../src/scraper/monitorRecheck";`.

In `sendDigest`, replace everything from `const from = (process.env.RESEND_FROM ?? "").trim();` down to the end of its `try { ... } catch { ... }` block. That span covers recipients, `base`, Phase 3's `boardTotal`/`moreOnBoard`/`date`/`buildDigest`, the single Resend POST, and the `markEmailed`/`noteEmailed` loop. Replace it with:

```ts
    const from = (process.env.RESEND_FROM ?? "").trim();
    // Who: every active CRM user + the RESEND_TO fallback (digestRecipients rules);
    // what: each recipient's own buy box filters the set (no box = everything).
    const audience = await ctx.runQuery(internal.monitorData.digestAudienceInternal, {});
    if (digestRecipients(audience.map((a) => a.email), process.env.RESEND_TO).length === 0) {
      await ctx.runMutation(internal.errors.logServerError, {
        message: "monitor digest: no active-user emails and no RESEND_TO, skipped",
        context: "monitorActions.sendDigest",
      });
      return { sent: false };
    }
    const base =
      (process.env.PORTAL_BASE_URL ?? "").trim() || "https://crm.instantrealestatesolution.com";
    const now = Date.now();
    // Fresh PRICE CUT / BACK ON MARKET tags only (stale tags render nothing).
    const rows = keepers.map((k) => ({ ...k, alertTag: digestAlertTag(k, now) }));
    const boardTotal = await ctx.runQuery(internal.monitorData.activeKeeperCount, {});
    const date = new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    const plan = planRecipientDigests(rows, audience, process.env.RESEND_TO);

    let succeeded = 0;
    for (const p of plan) {
      // Resend default rate limit is ~2 requests/s; a 429 here would still get the rows
      // stamped (another recipient succeeded) and this user would silently miss them.
      if (p !== plan[0]) await new Promise((r) => setTimeout(r, 600));
      const { subject, text, html } = buildDigest(p.rows, {
        baseUrl: base,
        moreOnBoard: Math.max(0, boardTotal - p.rows.length),
        date,
      });
      try {
        const res = await fetch(RESEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [p.to], subject, text, html }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
        }
        succeeded++;
      } catch (e) {
        await ctx.runMutation(internal.errors.logServerError, {
          message: `sendDigest to ${p.to} failed: ${(e as Error).message}`,
          context: "monitorActions.sendDigest",
        });
      }
    }
    // emailedAt is global "processed": see shouldStampDigest (tests/monitorBuyBox.test.ts).
    if (!shouldStampDigest(plan.length, succeeded)) return { sent: false };
    for (const k of keepers) {
      await ctx.runMutation(internal.monitorData.markEmailed, { id: k._id });
    }
    if (succeeded > 0) await ctx.runMutation(internal.monitorData.noteEmailed, { runId, count: keepers.length });
    return { sent: succeeded > 0 };
```

`rows` are `Doc<"monitorListings">` plus `alertTag`. They satisfy both `BuyBoxRow` and Phase 3's `DigestRow` (`_id` is an `Id` string). If TS objects to `null` fields on `DigestRow`, it is because Phase 3 declared `PresentRow` fields as `T | null` optional, which accepts both, so no cast is needed.

Then run `git grep -n "activeEmailsInternal"`. If `sendDigest` was its last caller, do NOT delete `users.activeEmailsInternal` (this phase didn't create it); mention it in the task report as now-unused.

- [ ] **Step 5: Run the tests + full checks**

Run: `npx vitest run tests/monitorDigest.test.ts`
Expected: PASS, with Phase 3's existing digest tests still passing.
Then: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green. Per-recipient and stamping behavior is pinned by Task 6 (`planRecipientDigests`, `shouldStampDigest`). Tag freshness is pinned by Task 2 (`digestAlertTag`).

- [ ] **Step 6: Commit**

```bash
git add src/scraper/monitorDigest.ts tests/monitorDigest.test.ts convex/monitorActions.ts
git commit -F - <<'EOF'
feat(monitor): digest per recipient filtered by buy box; PRICE CUT / BACK ON MARKET tag in email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

### Task 9: UI - buy box dialog + alert chip

**Files:**
- Create: `src/web/MonitorBuyBoxDialog.tsx`
- Create: `src/web/monitor/AlertTagChip.tsx`
- Modify: `convex/monitorData.ts` (Phase 3's `board` query: project `alertTag` + `alertedEventAt`)
- Modify: `src/web/lib/monitorBoard.ts` (Phase 3's `BoardRow`: two optional fields)
- Modify: `src/web/MonitorPage.tsx` (Phase 3's status strip: mount the button)
- Modify: `src/web/monitor/BoardTable.tsx` (Phase 3's desktop table + phone list: the chip next to `ExitBadge`)

**Interfaces:**
- Consumes: `api.monitorData.myBuyBox`, `api.monitorData.saveMyBuyBox`, `api.monitorData.clearMyBuyBox` (Task 7); `parseZipList` (Task 6); `digestAlertTag` (Task 2); `alertTag`/`alertedEventAt` columns (Tasks 3-4).
- Produces: `export function MonitorBuyBoxButton(): JSX.Element` (a button that owns its dialog) and `export function AlertTagChip(p: { alertTag?: string; alertedEventAt?: number }): JSX.Element | null`.

- [ ] **Step 1: Dialog component**

Create `src/web/MonitorBuyBoxDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { SlidersHorizontal, Loader2, RotateCcw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { describeError } from "./lib/errorReporting";
import { parseZipList } from "../scraper/monitorBuyBox";

// Per-user buy box (Phase 4): filters ONLY this user's nightly digest. Server-side
// normalizeBuyBox is authoritative; the form only parses text into numbers/ZIPs.
type Exit = "FLIP" | "RENTAL";
const EMPTY = { zips: "", priceMin: "", priceMax: "", minBeds: "", minFlipProfit: "", minCashFlow: "" };

// "" -> undefined, "$250,000" -> 250000, junk -> NaN (rejected before sending).
const num = (s: string): number | undefined => {
  const t = s.replace(/[$,\s]/g, "");
  return t === "" ? undefined : Number(t);
};

export function MonitorBuyBoxButton() {
  const box = useQuery(api.monitorData.myBuyBox);
  const save = useMutation(api.monitorData.saveMyBuyBox);
  const clear = useMutation(api.monitorData.clearMyBuyBox);
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [exits, setExits] = useState<Exit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load the saved box into the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    const s = (n: number | undefined) => (n == null ? "" : String(n));
    setForm(box ? {
      zips: box.zips.join(", "), priceMin: s(box.priceMin), priceMax: s(box.priceMax), minBeds: s(box.minBeds),
      minFlipProfit: s(box.minFlipProfit), minCashFlow: s(box.minCashFlow),
    } : EMPTY);
    setExits(box ? box.exits : []);
  }, [open, box]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleExit = (x: Exit) => setExits((xs) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]));

  const onSave = async () => {
    const z = parseZipList(form.zips);
    if (z.invalid.length) return setErr(`Not a 5-digit ZIP: ${z.invalid[0]}`);
    const nums = {
      priceMin: num(form.priceMin), priceMax: num(form.priceMax), minBeds: num(form.minBeds),
      minFlipProfit: num(form.minFlipProfit), minCashFlow: num(form.minCashFlow),
    };
    if (Object.values(nums).some((n) => n != null && !Number.isFinite(n))) return setErr("Enter numbers only.");
    setBusy(true);
    setErr(null);
    try {
      // Only defined numbers are sent (a cleared field = "any" = omitted).
      await save({
        zips: z.zips,
        exits,
        ...(nums.priceMin != null ? { priceMin: nums.priceMin } : {}),
        ...(nums.priceMax != null ? { priceMax: nums.priceMax } : {}),
        ...(nums.minBeds != null ? { minBeds: nums.minBeds } : {}),
        ...(nums.minFlipProfit != null ? { minFlipProfit: nums.minFlipProfit } : {}),
        ...(nums.minCashFlow != null ? { minCashFlow: nums.minCashFlow } : {}),
      });
      setOpen(false);
    } catch (e) {
      setErr(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const active = box != null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal />
        {active ? "Buy box (on)" : "Buy box"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>My buy box</DialogTitle>
            <DialogDescription>
              Filters only your nightly digest email. Leave a field blank for "any". The board still shows every deal.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              ZIP codes
              <Input value={form.zips} onChange={set("zips")} placeholder="19805, 19806, 19711" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">Min price<Input inputMode="numeric" value={form.priceMin} onChange={set("priceMin")} placeholder="any" /></label>
              <label className="grid gap-1 text-sm">Max price<Input inputMode="numeric" value={form.priceMax} onChange={set("priceMax")} placeholder="any" /></label>
              <label className="grid gap-1 text-sm">Min beds<Input inputMode="numeric" value={form.minBeds} onChange={set("minBeds")} placeholder="any" /></label>
              <div className="grid gap-1 text-sm">
                Exits
                <div className="flex gap-2">
                  {(["FLIP", "RENTAL"] as const).map((x) => (
                    <button
                      key={x}
                      type="button"
                      onClick={() => toggleExit(x)}
                      aria-pressed={exits.includes(x)}
                      className={cn(
                        "rounded-md border border-border px-3 py-1.5 text-xs transition-colors",
                        exits.includes(x) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      {x === "FLIP" ? "Flip" : "Rental"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="grid gap-1 text-sm">Min flip profit<Input inputMode="numeric" value={form.minFlipProfit} onChange={set("minFlipProfit")} placeholder="any" /></label>
              <label className="grid gap-1 text-sm">Min cash flow /mo<Input inputMode="numeric" value={form.minCashFlow} onChange={set("minCashFlow")} placeholder="any" /></label>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" disabled={!active || busy} onClick={() => setConfirmReset(true)}>
              <RotateCcw /> Reset to everything
            </Button>
            <Button size="sm" disabled={busy} onClick={onSave}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset your buy box?"
        description="Your digest will include every flip and rental deal again."
        confirmLabel="Reset"
        onConfirm={async () => {
          await clear({});
          setOpen(false);
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Mount the button in Phase 3's status strip**

In `src/web/MonitorPage.tsx` (Phase 3 version), the status strip's right side today is the single anchor line:

```tsx
        {me?.role === "admin" && <RunNow />}
```

Replace it with:

```tsx
        <div className="flex items-center gap-2">
          <MonitorBuyBoxButton />
          {me?.role === "admin" && <RunNow />}
        </div>
```

and add `import { MonitorBuyBoxButton } from "./MonitorBuyBoxDialog";` to the imports. (If Phase 3 dropped `RunNow`, its Task 5 is droppable, so the anchor is the strip's closing `</div>`. Insert `<MonitorBuyBoxButton />` as its last child.)

- [ ] **Step 3: Alert chip on the board rows**

3a. Project the fields. In `convex/monitorData.ts`, Phase 3's `board` query maps each keeper to a slim row. Add after `zestimate: r.zestimate,`:

```ts
        alertTag: r.alertTag,             // Phase 4: PRICE CUT $X / BACK ON MARKET
        alertedEventAt: r.alertedEventAt, // the client shows the tag only while fresh
```

3b. In `src/web/lib/monitorBoard.ts`, add to the `BoardRow` interface:

```ts
  alertTag?: string;
  alertedEventAt?: number;
```

3c. Create `src/web/monitor/AlertTagChip.tsx`:

```tsx
import { RotateCcw, TrendingDown } from "lucide-react";
import { digestAlertTag } from "../../scraper/monitorRecheck";

// Phase 4: a fresh PRICE CUT / BACK ON MARKET event on this listing (same freshness
// rule as the digest, src/scraper/monitorRecheck.ts digestAlertTag).
export function AlertTagChip({ alertTag, alertedEventAt }: { alertTag?: string; alertedEventAt?: number }) {
  const tag = digestAlertTag({ alertTag, alertedEventAt }, Date.now());
  if (!tag) return null;
  const back = tag === "BACK ON MARKET";
  const Icon = back ? RotateCcw : TrendingDown;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
      <Icon className="h-3 w-3" aria-hidden />
      {back ? "Back on market" : tag.replace("PRICE CUT", "Price cut")}
    </span>
  );
}
```

3d. In `src/web/monitor/BoardTable.tsx`, add `import { AlertTagChip } from "./AlertTagChip";`. There are two anchors, both `<ExitBadge exit={r.bestExit} />`: one in the desktop table's score cell and one in the phone list's meta line. Directly after EACH, add:

```tsx
                      <AlertTagChip alertTag={r.alertTag} alertedEventAt={r.alertedEventAt} />
```

(Match the surrounding indentation. The deal sheet reads the full doc, so it can show the same chip next to its `ExitBadge` with `alertTag={l.alertTag} alertedEventAt={l.alertedEventAt}`, which is optional and one line.)

- [ ] **Step 4: Checks + visual check**

Run (PowerShell, because `board` changed): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Then: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build`
Expected: all green.
Then run the app (`run` skill or `npm run dev` against the anonymous backend) and confirm at 1440px and 390px:
- The "Buy box" button sits in the status strip, left of "Run now" for admins, without wrapping badly at 390px.
- A row patched (local backend, via the dashboard or `npx convex run`) with `alertTag: "PRICE CUT $10,000"` and `alertedEventAt` = now shows the amber chip in both the table and the phone list.
- The dialog opens and closes, and Escape closes it.
- Saving `abc` in ZIPs shows "Not a 5-digit ZIP: abc".
- Min price 300000 with max 200000 shows the server message "Min price is above max price".
- "Reset to everything" opens the ConfirmDialog, not a native confirm.
- No emoji glyphs appear anywhere.

- [ ] **Step 5: Commit**

```bash
git add src/web/MonitorBuyBoxDialog.tsx src/web/monitor/AlertTagChip.tsx src/web/monitor/BoardTable.tsx src/web/lib/monitorBoard.ts src/web/MonitorPage.tsx convex/monitorData.ts convex/_generated
git commit -F - <<'EOF'
feat(monitor): buy box settings dialog in the status strip + price cut / back on market chip on board rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
EOF
```

---

## Rollout (orchestrator / operator, after merge; not an implementer task)

1. Deploy the backend to prod (`CONVEX_DEPLOY_KEY=<prod> npx convex deploy -y` from the worktree, per lessons 2026-07-01). This adds the schema fields, `by_recheck`, `monitorBuyBoxes` and the `monitor recheck` cron.
2. `npx convex run monitorData:seedRecheck '{"dryRun":true}'`, check that `seeded` is about the active keeper count (49 on 2026-10-04), then run it without `dryRun`.
3. Run one manual pass so a full price-cut sweep happens before the cron: `npx convex run monitorActions:runMonitorRecheck '{"trigger":"manual"}'`. Expect about 6 `cutPages`, `cutCards` about 200, `newCount` about 15-20 and `cutEvents` about 150-170 on the first run (missed cuts on tracked rows, see Resolved decisions), and no "covered X of Y" error. The ~180 scheduled analyses take about 9 minutes to fan out. Spot-check a known cut: zpid 72975668 should now show `listPrice` 435000, `lastPriceCut` 15000.
4. Check the first-month credit burn on prod's account (`/v2/team/credit-usage` via PowerShell `curl.exe`) against the about 0.85-1.3k/month estimate.
5. A dev deployment that sets `MONITOR_SCAN_ENABLED=0` skips both crons, which is expected.

## Self-Review

- **Spec coverage:**
  - S1 is covered by Tasks 1, 3, 4 and 5 (price-cut sweep catches older listings; rotation re-checks status; credit math in Resolved decisions).
  - S2 is covered by Tasks 1, 2, 3 and 5 (homeStatus stored from card and detail; `recheckPatch` archives with `archivedReason`; existing archived filters drop it from board and digest).
  - S3 is covered by Tasks 2, 3, 4 and 8 (`lastPriceCut`/`lastPriceCutAt` and `backOnMarketAt` events; `reAlertDecision` loop guard; tag in the email).
  - S4 is covered by Tasks 6, 7, 8 and 9.
  - S5 is covered by Task 5 (own cron at 14:00 UTC with `cronScanEnabled`; nightly untouched).
- **Placeholder scan:** every code step carries the code. Phase 3 insertion points are described by anchor with a concrete fallback.
- **Type consistency:** names are used identically across tasks:
  - `TrackedRow`, `TrackingPatch`, `sightingPatch`, `recheckPatch`, `nextRecheckAt`, `reAlertDecision`, `digestAlertTag`, `cardCutFields`
  - `BuyBox`, `AudienceMember`, `planRecipientDigests`, `shouldStampDigest`, `normalizeBuyBox`, `isEmptyBuyBox`, `parseZipList`, `matchesBuyBox`
  - `passesScanGate`, `buildSearchUrl({ priceCutOnly })`
  - `dueForRecheck`, `applyRecheck`, `seedRecheck`, `runMonitorRecheck`, `recheckOne`, `digestAudienceInternal`, `myBuyBox`, `saveMyBuyBox`, `clearMyBuyBox`
  - `AlertTagChip`, `MonitorBuyBoxButton`, `DigestRow.alertTag`
  - `upsertListing` returns `backOnMarket` (Task 3), which is consumed in Tasks 3 and 5.
- **Review Focus:** each of the 5 lines has a pinned test or log in its owning task (Tasks 2, 6, 5 and 1).
