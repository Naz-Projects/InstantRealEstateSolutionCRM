# Next Session — Start Here

_Handoff from the 2026-06-01 session. Read `memory/memory.md` + `memory/lessons.md` first._

## Where we are
The IRES CRM is built on the serverless stack (Convex + Clerk + TanStack + Cloudflare) and the backend is
**proven end-to-end on the real Convex dev deployment `fearless-donkey-585`**:
- Sheriff Sales + Legal Notices both scrape → write to Convex → fan-out enrich (parcel + Zillow) → live in the UI.
- Frontend (Dashboard, Sheriff Sales, Legal Notices, scrape buttons, deal pipeline) typechecks, builds, and
  serves locally against that live backend. 31 tests pass.

## Latest (session 3, 2026-06-01) — Deal "cushion" + bulletproofing
- **Cushion screen**: `src/scraper/deal.ts` (`computeDeal`, unit-tested) — sale-type-aware cost-to-clear + cushion + tier + risk flags. TAX: cost=principal (taxes inside it). MTG/JUDG: cost=principal+balances. Served by `sheriffData.monthListings` (rows+deal, sorted clean-deals-first; risk-flagged "verify" rows demoted so tiny-principal junior-foreclosure traps don't rank #1).
- **Visual Sheriff table**: color-coded Cushion · Type badge · Worth · Debt · Liens(hover breakdown) · flag icons · sorted best-first · monthly wording.
- **Bulletproofing**: `withRetry` in `firecrawl.ts`; `lookupParcel` retries the whole browser-action sequence on a Reblaze block page (HTTP-200 block bypasses HTTP retry); `scrapeZillow` retries; stagger 1500→2500ms. **Deployed + calc verified on real data, but retries NOT yet proven live** — a forced re-scrape costs ~100 Firecrawl calls AND `clearMonth` wipes the current 53 rows. Awaiting user's call on running the full re-scrape.
- **Retry-failed + sorting + columns + icons**: `sheriffData.retryFailed({saleMonth})` re-enriches only blocked rows (`enrichSheriffOne` now takes an explicit `runId`). Clickable column sort (Cushion/Worth/Debt/Liens). Added `#` index, Size (beds/baths/sqft), and a click-to-open **Notes dropdown**. Scrape control is now a **split button** (`SheriffScrapeMenu`): main "Scrape This Month's Sheriff Sales" + caret dropdown (Retry failed/blocked, Force re-scrape). **All emojis replaced with `lucide-react` icons — never use emojis (see `~/.claude` memory `never-use-emojis`).**
- build + 39 tests pass. Still NOT committed (working tree). Visual eyeball still pending (`npm run dev`).

## Latest (session 4, 2026-06-01) — Legal Notices brought to parity with Sheriff ✅
Done and verified live on dev `fearless-donkey-585`:
- **Weekly tabs**: `legalData.legalWeeks` (distinct `weekDate`, newest-first via ISO string sort, counts). Generalized `MonthTabs`→`PeriodTabs` ({value,label,count}); Legal labels via `fmtWeek` ("May 26, 2026").
- **Value-sorted table**: `legalData.weekNotices({weekDate})` → rows + parsed numeric `value` (reuses `parseMoney`) + `flags` (`needs-rescrape` only when `zestimate === "SCRAPE FAILED"`), sorted by value desc, nulls last. Columns `#` · Worth(Zest.) · Deceased · Personal Rep · Address · Size · Notes · Zillow · Deal; clickable Worth sort. **NO cushion** (legal has no foreclosure debt — value = Zestimate; off-market play = contact the personal rep).
- **Retry + runId**: `legalData.retryFailed({weekDate})` re-enriches only `SCRAPE FAILED` rows; `enrichLegalOne` now takes an explicit `runId` (fan-out + retry pass it).
- **Split scrape button**: generalized `SheriffScrapeMenu`→`ScrapeMenu` (added `label`). Removed orphaned `ScrapeControls` + `EnrichPill`.
- Verified: `legalWeeks`→[{2026-05-26,3}]; `weekNotices`→3 rows $2.30M/$745K/$156K (sorted), flags []. build (tsc+vite) + 39 tests pass. **Not committed.**

## ⭐ NEXT SESSION (do this first)
1. **Visual eyeball (only unverified item).** Session 4 refactored the still-uncommitted shared Sheriff components (`PeriodTabs`, `ScrapeMenu`) and rewrote the Legal page. tsc validates every call site, but pixels were not seen. Run `npm run dev` and confirm on BOTH pages: tabs render + switch, the split scrape button + dropdown work, the Legal table sorts by Worth, and the stepper looks right (inactive steps gray not brand-green, error step red). This also closes the long-standing "eyeball the stepper" todo.
2. **Then commit** the accumulated sessions 2–4 work (still all in the working tree).
3. **Then the user-blocked morning setup** — Clerk auth → Convex prod deploy → Cloudflare (see "The remaining work" below). After that, pick from `memory/todo.md` (Kanban board, dashboard charts).

## Earlier (session 2, 2026-06-01) — Live scrape progress shipped
- New **live progress stepper**: backend `scrapeEvents` + run `phase`/`failedCount`; actions create the run
  first, emit step-by-step events (fetch → parse/AI-extract → per-listing parcel/Zillow), always finalize.
- Integrated shadcn **`stepper.tsx`** (`src/components/ui/`, `@/` alias, `cn` via clsx+tailwind-merge, shadcn
  tokens in `index.css`). `src/web/ScrapeProgress.tsx` = one auto-animating step bar + live event log + error surfacing.
- **"Force re-scrape (replace)"** checkbox → `clearMonth`/`clearWeek` then clean re-insert.
- Fixed: the button silently no-op'd on an already-scraped month, and a crashed run could lock it forever.
- Verified LIVE: forced `limit:10` sheriff → cleared 3 stale → 10/10 enriched, events incl. real "blocked" errors.
- **Not committed yet** — changes are in the working tree. Two open follow-ups: (a) eyeball the stepper in
  `npm run dev` (pixel rendering only verified via build + logic); (b) do a full forced 53-row run (cost) to
  confirm fan-out at scale.

## Run it
```bash
cd C:\Users\nazho\Desktop\ires-crm
npm install
npx convex dev        # terminal 1 — syncs functions to the dev deployment
npm run dev           # terminal 2 — http://localhost:5173
```
The dev deployment already has enriched sheriff + legal rows to look at. Buttons pull fresh data.

Handy checks:
- `npm test` (31) · `npm run integration` / `npm run integration:legal` (scraper core vs live Firecrawl/OpenRouter)
- `npx convex run sheriffActions:devScrapeSheriff '{"limit":3}'` — cheap cloud e2e (limit keeps Firecrawl spend low)

## The remaining work (was blocked on user-provided accounts)
1. **Clerk auth**
   - Create the Clerk app; put `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`.
   - Set the real `CLERK_JWT_ISSUER_DOMAIN` as a Convex env var (`npx convex env set ...`).
   - In `src/web/main.tsx`, swap `ConvexProvider` → `ConvexProviderWithClerk` and add a `<SignIn>`/auth gate.
   - **Remove `IRES_DEV`** from the deployment (`npx convex env remove IRES_DEV`) — it bypasses auth.
2. **Convex prod** — `npx convex deploy` with the prod deploy key; set `FIRECRAWL_API_KEY`, `OPENROUTER_API_KEY`, `CLERK_JWT_ISSUER_DOMAIN` on prod.
3. **Cloudflare** — `npm run build` → deploy `dist/` to Cloudflare Pages/Workers; set `VITE_CONVEX_URL` (prod) + `VITE_CLERK_PUBLISHABLE_KEY`; point `crm.instantrealestatesolution.com`.
4. Confirm the **crons** (weekday sheriff / weekly legal, in `convex/crons.ts`) are active on prod.

## Security TODO (carry over until done)
- Rotate the keys shared in chat: Firecrawl, OpenRouter, Anthropic, and both Convex deploy keys.
- Keep `IRES_DEV` OFF in production.

## Good first moves next session (if accounts are ready)
1. Wire Clerk (step 1) → verify sign-in gates the app and `requireUser` enforces real auth → check: load a query while signed out fails, signed in works.
2. Then prod deploy + Cloudflare.
3. Then pick from `memory/todo.md` — likely the Kanban board and dashboard charts.

## Gotchas (also in lessons.md)
- Convex `"use node"` files = actions only; keep V8 mutations/queries in the `*Data.ts` files.
- Annotate Convex action handler return types (`: Promise<...>`) or you'll hit `TS7023` circular-inference errors.
- The Convex CLI's `UV_HANDLE_CLOSING` assertion on Windows is cosmetic — read the output, ignore the exit code.
