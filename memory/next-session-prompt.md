# Next Session — Start Here

_Read `memory/memory.md` + `memory/lessons.md` first, then this. `memory/todo.md` is the open-items list._

## START HERE — 2026-10-04 — Monitor the Web rebuilt (all 4 critique phases SHIPPED, prod live, `origin/main a051e9c`)

**What happened (2026-10-03 → 10-04):** the user asked for a critique of the Zillow deal monitor. Prod evidence showed the
pipeline never failed but was noisy and stale: Firecrawl's 2-day default cache meant fresh data only every 3rd night; 33% of
listings were "kept" (distress-OR loophole, a 2.3%-under-Zestimate "below market", RENTAL at a 4% cap); ARV came from the first
8 ZIP-wide comps; the 7-day window never saw price cuts on older listings; the email led with PASS and -$600/mo "rentals"; the
page had only Promote. Critique doc: https://claude.ai/code/artifact/2e98e25e-8c30-4f05-b30e-6b7981216cce.
User approved all 4 phases with floors **flip $25K profit + 12% margin; rental cap 6% + cash flow >= 0 (+ DSCR 1.2)**. Built
subagent-driven (Opus implementers, per-task reviews, Opus final review per phase, every final review found and fixed a real bug
before ship). Plans: `docs/superpowers/plans/2026-10-04-monitor-phase1-2-deal-quality.md`, `...-phase3-triage-ui.md`, `...-phase4-wider-net.md`.
Current architecture + prod numbers: `memory.md` → "Monitor the Web — current state". 647 tests, build clean.

**Shipped:** P1 floors + fresh scrapes + bug fixes + `regateKeepers` · P2 Redfin gis comps by distance/type, as-is vs ARV, LLM-aware
rehab, lease rent / real tax / 35% opex / DSCR · P3 `/monitor` triage inbox (per-user state, sheet, `?id=` deep links, keys, admin
Run now) + 5-second per-card digest · P4 price-cut sweep + 3-day detail re-check rotation + PENDING/SOLD retire + PRICE CUT /
BACK ON MARKET re-alerts + per-user buy box + per-recipient digest. Prod rollout done: seedRecheck (42), first sweep (121 missed
cuts, 45 new older listings), first Lane B pass retired 4 dead deals. Dev deployment's nightly scan is off (`MONITOR_SCAN_ENABLED=0`).

## FIRST THING NEXT SESSION
1. **Verify the first nightly on the new code** (ran 2026-10-05 02:00 UTC) and the 14:00 UTC re-check run. Prod reads need the
   PROD key (bash): `export CONVEX_DEPLOY_KEY=$(grep '^CONVEX_DEPLOY_KEY_PROD=' .env.local | cut -d= -f2-); unset CONVEX_DEPLOYMENT`
   then `npx convex data monitorRuns --limit 3 --format jsonLines` (scanned should differ from the prior night; failed 0;
   emailedCount > 0 if any FLIP/RENTAL), `npx convex data errorLogs --limit 10`, and spot-check the digest the user received
   (3 PRICE CUT alerts were queued: 9 E 44th, 307 W 5th, 23 Maple Dr).
2. Watch for a row whose `backOnMarketAt` re-stamps within days (the repeat-email-loop signature fixed pre-ship).
3. Then pick from `todo.md` → "Monitor the Web — open items" (manufactured-home lot-rent blind spot is the most user-visible).

## Needs the user
- Unanswered product Qs: "0 worth a look" emails on empty nights (silent now)? 2-4 unit buildings in the rental lane? no-list-price
  foreclosures / land sections? Manufactured homes: exclude from rental or require lot rent?
- Each user should set a Buy box on `/monitor` (none set → everyone gets every FLIP/RENTAL).

## Other workstreams (unchanged this session)
- Lead engine: P7 v2 condition-batch skill shipped 2026-06-27 (reusable monthly: "score conditions"); next per `todo.md` is P8
  disposition / buyer-match. Architecture deep dive with open P0 `leadScores` projection: `memory/deep-dive-2026-08-08.md`.
- Security pair still open (S25-1 email_verified link fallback; S25-2 Google key split).

## Working style (from the user, still in force)
- Ask once up front, then execute without interrupting; report when each phase ships.
- All implementation via **Opus** subagents; reviewers can be Sonnet; final whole-branch review on Opus.
- Never emojis in UI; lucide icons. Project Brain sync via `/brain-sync` (last full sweep 2026-10-04).

## Run / deploy
- Local: `npx convex dev` (dev = fearless-donkey-585) + `npm run dev`. Isolated agent work: git worktree + `CONVEX_AGENT_MODE=anonymous npx convex dev --once` (never push to the shared dev deployment).
- **Deploy = `git push origin main`** (Cloudflare build runs `npx convex deploy --cmd 'npm run build'`). Manual prod backend deploy:
  `CONVEX_DEPLOY_KEY="$(grep ^CONVEX_DEPLOY_KEY_PROD= .env.local | cut -d= -f2-)" npx convex deploy`. Deploy backend BEFORE the
  frontend when new public functions are added.
- Prod Firecrawl key = 100k ANNUAL plan (92k left 2026-10-04). Authed external HTTP: PowerShell `curl.exe` (bash strips Authorization).
- After `npx shadcn add`: revert package.json/lockfile and fix imports to `@/lib/utils` (CLI rewrites to bare `cn`).
- `convex/_generated` + `wrangler.jsonc` are committed on purpose; `M convex/_generated/api.d.ts` in the main checkout is LF/CRLF drift.
