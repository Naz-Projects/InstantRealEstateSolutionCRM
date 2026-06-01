# IRES CRM — Todo & Ideas

Track what's built and what's still ahead. `[x]` done · `[ ]` planned · `[~]` blocked on the user.

## ✅ Built & verified
- [x] Scraping core (`src/scraper/*`) — Firecrawl client, sheriff PDF parse, address cleaning, NCC parcel lookup, Zillow extract, Legal Notices LLM extraction, per-listing enrich. Runtime-agnostic TS.
- [x] Proven LIVE: Sheriff Sales (53 listings parsed; parcel + Zillow enrichment) and Legal Notices (21 estate listings via OpenRouter). 31 unit/integration tests pass.
- [x] Convex backend: schema (`scrapeRuns`, `sheriffListings`, `legalNotices` + dealStatus), scrape + fan-out enrich actions (reuse the core), run tracking, weekday/weekly cron, Clerk auth config, `IRES_DEV` dev bypass.
- [x] Deployed to the real Convex **dev** deployment `fearless-donkey-585`; **e2e tested there** — both pipelines: scrape → DB rows → enriched (owner/assessment/Zillow), 3/3 each.
- [x] Frontend: Vite + React + TanStack Router + Tailwind + Convex client, IRES branding. Dashboard (pipeline funnels + recent runs), Sheriff Sales + Legal Notices pages with scrape buttons, live tables, deal-status pipeline. Typechecks, builds, serves against live backend.

## ~ Blocked on user (the morning setup — see next-session-prompt.md)
- [~] Clerk: publishable key, `ConvexProviderWithClerk`, real `CLERK_JWT_ISSUER_DOMAIN`, sign-in gate, **remove `IRES_DEV`**.
- [~] Convex prod deploy (`npx convex deploy`, prod key) + prod env vars.
- [~] Cloudflare deploy of `dist/` + point `crm.instantrealestatesolution.com`.
- [~] Rotate all API/deploy keys shared in chat.

## ✅ Built & verified (2026-06-01, session 2)
- [x] **Live scrape progress** — backend `scrapeEvents` table + run `phase`/`failedCount`; actions create the run first, emit step-by-step events (fetch → parse/AI-extract → per-listing parcel/Zillow sub-steps), always finalize. Fixed the silent-skip + permanent-lock bug.
- [x] **Unified stepper UI** — integrated shadcn `stepper.tsx` (`src/components/ui/`, `@/` alias, `cn`, shadcn tokens). `src/web/ScrapeProgress.tsx` = one auto-animating step bar (real phase drives steps; time-easing animates within a step; enrich uses real n/total) + live color-coded event log + error surfacing. Mounted on Sheriff + Legal pages.
- [x] **"Force re-scrape (replace)"** checkbox (with a confirm dialog — it deletes the period's rows incl. deal status/notes) → `startScrape({force})` → `clearMonth`/`clearWeek` then clean re-insert.
- [x] **Monthly tabs (Sheriff)** — `sheriffData.sheriffMonths` query (distinct months, newest-first, with counts) + tab UI in `SheriffSales`; each tab filters the table to one `saleMonth` (via `listListings({saleMonth})`). Default = newest month. NOTE: the county only posts the CURRENT month's PDF (fixed `SHERIFF_PDF_URL`), so we can't scrape a chosen past month — months accumulate as we scrape. Verified `sheriffMonths` live → `[{June 2026, 10}]`.
- [x] Verified LIVE on dev: forced `limit:10` sheriff run → cleared 3 stale → 10/10 enriched, 0 failed, events streamed incl. real "blocked" errors; real `startScrape` button path → skip warn event. Source has **53** June listings (not 30–40). build + 31 tests pass.

## ✅ Built (2026-06-01, session 3) — deal "cushion" + bulletproofing
- [x] **Cushion calc** (`src/scraper/deal.ts`, unit-tested): sale-type-aware cost-to-clear + cushion + tier (good/ok/thin/bad/unknown) + flags (tax-redemption, senior-lien-risk, judg-risk, needs-rescrape). Computed server-side in `sheriffData.monthListings` (returns rows+deal, sorted biggest-cushion-first, unknowns last). Verified on real June data (413 Georgiana JUDG → $809,843; 31 Phoenix TAX → $353,473).
- [x] **Visual decision table** (Sheriff): columns Cushion (color-coded by tier) · Property(+owner) · Type badge · Worth(Zest) · Debt(Principal) · Liens(tax+sewer, breakdown on hover) · Notes(flag icons) · Zillow · Deal. Legend + monthly wording ("Scrape This Month's Sheriff Sales").
- [x] **Bulletproofing — retries**: `withRetry` in `firecrawl.ts`; `lookupParcel` retries the whole browser-action sequence on a Reblaze block page (HTTP 200 block bypasses HTTP retry); `scrapeZillow` retries empty/short; enrichment stagger 1500→2500ms to cut peak concurrency. build + 38 tests pass.

## ✅ Built (2026-06-01, session 3 cont.)
- [x] **"Retry failed" button** — `sheriffData.retryFailed({saleMonth})` mutation: finds rows whose parcel OR Zillow scrape was BLOCKED (`SCRAPE FAILED`; skips legit `NOT FOUND`), creates a retry run, re-enriches only those (cheap, non-destructive, no `clearMonth`). `enrichSheriffOne` now takes an explicit `runId` so the retry gets its own progress in the stepper. UI shows "🔄 Retry N blocked" when failures exist.
- [x] **Clickable column sorting** — Cushion / Worth / Debt / Liens headers toggle asc/desc (client-side); "↺ Best-deal order" resets to the smart tier-aware default. Nulls always sink.
- [x] **Notes dropdown** — `DealNotes` (native `<details>`) shows full caveat text on click instead of icon+tooltip.
- [x] **Size column** — beds/baths/sqft (already scraped + stored) shown as "4 bd · 2 ba · 1,800 sf"; muted when Zillow didn't list them.
- [x] **Index (#) column** — 1-based row position in the current sort order, far left.
- [x] **Split-button scrape control** (`SheriffScrapeMenu`) — main "Scrape This Month's Sheriff Sales" + caret dropdown (Retry failed/blocked, Force re-scrape). Removed the standalone Force checkbox.
- [x] **lucide-react icons everywhere** — replaced ALL emojis/glyphs (carets, sort arrows, retry/force, flags) with real icons. Standing rule: never use emojis (`~/.claude/.../memory/never-use-emojis.md`).

## ✅ Built & verified (2026-06-01, session 4) — Legal Notices parity with Sheriff
- [x] **Weekly tabs** — `legalData.legalWeeks` query (distinct `weekDate`, newest-first via lexicographic ISO sort, with counts). Generalized `MonthTabs`→`PeriodTabs` ({value,label,count}); Sheriff maps month, Legal maps `fmtWeek(weekDate)` → "May 26, 2026".
- [x] **Value-sorted visual table** — `legalData.weekNotices({weekDate})` returns rows + parsed numeric `value` (reuses `parseMoney` from `deal.ts`) + `flags` (`needs-rescrape` only when `zestimate === "SCRAPE FAILED"`), sorted by value desc (nulls last). Columns: `#` · Worth(Zest.) · Deceased/Owner · Personal Rep · Address · Size · Notes(dropdown) · Zillow · Deal. Clickable Worth sort + "Highest value first" reset. **NO cushion** (legal has no foreclosure debt — value signal is the Zestimate; off-market play = contact the personal rep).
- [x] **Retry failed** — `legalData.retryFailed({weekDate})` re-enriches only `zestimate === "SCRAPE FAILED"` rows via a new retry run (mirror sheriff). `enrichLegalOne` now takes an explicit `runId`; fan-out + retry both pass it.
- [x] **Split scrape button** — generalized `SheriffScrapeMenu`→`ScrapeMenu` (added `label` prop). Legal: "Scrape This Week's Legal Notices" + dropdown (Retry failed/blocked, Force re-scrape→`clearWeek`). Removed the orphaned `ScrapeControls` + `EnrichPill`.
- [x] All lucide icons, no emojis. Verified LIVE on dev `fearless-donkey-585`: `legalWeeks`→[{2026-05-26, 3}], `weekNotices`→3 rows value-desc ($2.30M/$745K/$156K), flags []. build (tsc+vite) + 39 tests pass.
- [ ] **Visual eyeball pending** — refactored the (still-uncommitted) shared Sheriff `PeriodTabs`/`ScrapeMenu`; tsc validates all call sites but pixels not eyeballed. Run `npm run dev` and check BOTH Sheriff + Legal tabs/menus render + the stepper (inactive steps gray, error red).

## [ ] Verify / near-term
- [~] **Prove bulletproofing live** — retries + Retry-failed deployed but not yet run live (any re-scrape costs Firecrawl). Cheapest proof = click "Retry N blocked" on June (only the ~failed rows, non-destructive) and see how many clear. Decision with user.
- [ ] **Firecrawl "stealth" proxy mode** — premium proxy/anti-bot lever for the parcel lookup (more credits/call) if retries alone leave failures. Verify exact `proxy` param before wiring.
- [x] **Weekly tabs for Legal Notices** — done (session 4). No cushion (legal has no foreclosure debt); value = Zestimate.
- [ ] **"Re-enrich failed rows" action** — targeted retry of only `needs-rescrape` rows without a full force re-scrape (needs enrichSheriffOne to accept an explicit runId for progress tracking).
- [ ] **Bounded-concurrency workpool** — true throttle (N at a time) instead of stagger, if retries+stagger still leave failures at full scale.
- [ ] **Visual eyeball of the stepper** — pipeline data is verified; the stepper's pixel rendering was confirmed via build + tailwind-merge logic only. Run `npm run dev` and check inactive steps are gray (not brand-green) and the error step is red.
- [ ] **Kanban deal-pipeline board** (drag listings across new→reviewing→contacted→offer→dead).
- [ ] **Dashboard charts** — deals per stage per month, total equity in pipeline, run history trend. (Could reuse the new `scrapeEvents`/run data.)
- [ ] **AI "Deal Analyst"** — chat/agent over the listings (rank by equity vs. liens). LLM via OpenRouter; surface in-app and/or via an MCP-style endpoint.
- [ ] Per-listing **notes + activity log** (calls, offers, status changes with timestamps).
- [ ] **Fan-out throttling** at scale — bound concurrent enrichment (Convex workpool/scheduler stagger) so ~50+ listings don't trip Firecrawl/NCC rate limits.

## [ ] Future / bigger ideas
- [ ] **Contacts & relations** — owners/defendants as records, skip-tracing, link to listings; full CRM relations.
- [ ] **Notifications** — email/SMS when a new high-equity or low-lien deal lands.
- [ ] **CSV / sheet export** (parity with the old Google-Sheets output; optional dual-write during cutover).
- [ ] **Map view** of listings (Mapbox/Leaflet).
- [ ] **Cross-run dedup** — flag a property that recurs across months.
- [ ] **Multi-county / multi-source** expansion beyond New Castle County.
- [ ] **Email parsing** of the old workflow's report emails, if still needed.

## Notes
- A legacy `tasks/` dir and `docs/` design files exist from earlier phases; `memory/` is the source of truth going forward.
- Twenty app source is archived in `docs/twenty-app-archived/` (UI reference only — not used).
