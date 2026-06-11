# Phase 2 plan — signals → leads (execution order)

_Spec: `docs/superpowers/specs/2026-06-11-lead-engine-phase2-signals-leads.md`. TDD throughout;
build violations first, foreclosures second; verify each step before the next._

1. **Fixtures (live, dev cloud probe — local HTTP is sandbox-blocked).** Throwaway `convex/probePhase2.ts`
   internalAction: (a) fetch ONE CodeCases page (explicit fields, 5 rows) and (b) ONE CourtConnect party-search
   page (`last_name=bank`, trailing 30 days). Trim → `tests/fixtures/codeCases.page.json` +
   `tests/fixtures/courtconnect.search.html`. Delete the probe; `convex dev --once` to resync.
   → verify: fixtures committed, probe gone.
2. **Schema** — add `signalEvents` + `signalWatermarks` to `convex/schema.ts`.
   → verify: anonymous `convex dev --once` validates.
3. **`src/scraper/codeCases.ts`** (RED→GREEN: `tests/codeCases.test.ts` first) — URL builder + feature parser.
4. **`src/scraper/courtConnect.ts`** (RED→GREEN: `tests/courtConnect.test.ts`) — stems, URL builder,
   HTML parser (fixture), `^N\d{2}L-` filter, name normalize/match.
5. **`src/scraper/leadScore.ts`** (RED→GREEN: `tests/leadScore.test.ts`) — config + score math.
6. **`convex/signalData.ts` + `convex/signalActions.ts` + crons** — upserts, watermarks, `leads` query,
   `syncCodeCases`, `syncForeclosures`. Explicit return types; chunked writes.
   → verify: anonymous `convex dev --once` + `npm run build` + full vitest.
7. **UI** — `/leads` route + nav (app.tsx/app-shared.tsx), `src/web/LeadsPage.tsx` (table, filters,
   expandable signals, unmatched section, CSV export via pure `buildMailCsv` in `leadScore.ts` or
   `src/web/lib`). Dark shadcn; lucide only.
   → verify: build + tsc clean.
8. **Live-verify on dev** (paid plan now): push (`npx convex dev --once`), run `syncCodeCases`
   (full backfill), `npx convex data signalEvents --limit 5` + count vs layer (~2,852); run
   `syncForeclosures`, spot-check `N26L-*` events + match confidences; `/leads` query via CLI
   (auth-gated → use an internal stats helper or check via data). Update memory docs; commit.

Commit per step (explicit paths; never `git add -A`). Branch: `feat/lead-engine-phase1-spine`
(continues the unmerged lead-engine branch per user's keep-on-branch decision).
