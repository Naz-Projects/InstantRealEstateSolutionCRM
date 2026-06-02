# IRES CRM — Todo & Ideas

What's built and what's still ahead. `[x]` done · `[ ]` planned · `[~]` blocked on the user.
(History lives in git; this is the current picture, not a session log.)

## ✅ Built & shipped
- [x] **Scraping core** (`src/scraper/*`, runtime-agnostic, unit-tested): Firecrawl client, sheriff PDF parse,
  address cleaning, NCC parcel lookup, Zillow extract, Legal Notices LLM extraction, per-listing enrich,
  `deal.ts` cushion math, `geocode.ts` (address → DE-validated `{lat,lng}`).
- [x] **Convex backend**: schema (`scrapeRuns`, `scrapeEvents`, `sheriffListings`, `legalNotices` + `dealStatus`,
  `lat`/`lng`/`geocodeStatus`); scrape + fan-out enrich actions; run lifecycle + live `scrapeEvents`; geocode
  backfill; weekday/weekly cron; Clerk auth config; `IRES_DEV` dev bypass. Live on dev `fearless-donkey-585`.
- [x] **Live scrape progress** — `ScrapeProgress` stepper (real phase drives steps, enrich n/total, errors red);
  run created first + always finalized (no silent skips / no permanent lock). Event log is **collapsible** (hidden by default).
- [x] **Sheriff deal screen** — cushion calc (sale-type-aware, risk-flagged "verify" rows demoted), color-coded
  table sorted best-first, monthly tabs, clickable column sort, Notes dropdown, retry-failed, split scrape button.
- [x] **Legal Notices parity** — weekly tabs, value-sorted table (Zestimate; no cushion), retry-failed, split
  scrape button. Shared `PeriodTabs`/`ScrapeMenu`.
- [x] **Bulletproofing** — `withRetry` in Firecrawl; `lookupParcel` retries the whole browser-action sequence on
  a Reblaze HTTP-200 block page; `scrapeZillow` retries; enrichment staggered.
- [x] **Google Maps + Street View** — collapsible map panel above the table (button, hidden by default);
  Zillow-style price-pill markers colored by deal; InfoWindow (Zestimate + Street View thumbnail + Zillow +
  inline deal-status); interactive Street View modal; table **Map column** → jump-to-property + auto Street View;
  geocoding stored + verified live (74/74). Spec/plan in `docs/superpowers/`.
- [x] **Frontend shell** — Vite + React + TanStack Router + Tailwind + Convex client, IRES branding, Dashboard
  (pipeline funnels + recent runs). lucide-react icons only (never emojis).
- [x] **Repo on GitHub + Cloudflare CI** builds the frontend from it (`convex/_generated` committed for CI typecheck).
- [x] 44 tests pass; tsc+vite build clean.

## ✅ Shipped this session (2026-06-02) — auth, admin, production
- [x] **Clerk auth (dev + prod)** — `<ClerkProvider>` + `ConvexProviderWithClerk` + sign-in gate + `/accept-invite`;
  `getAuthUser`/`requireAdmin`; `requireUser` upgraded to reject non-provisioned/deactivated users; `IRES_DEV` removed (dev secured).
- [x] **Admin user-management** — `users` table (admin/member, invite-only); Admin page (invite via Clerk email,
  role dropdown, activate/deactivate, remove) + Clerk Backend-API sync (create/lock/delete) with rollback.
  Built via spec → plan → subagent impl + 2-stage review; merged to `main`.
- [x] **Production cutover** — Convex prod `pastel-crocodile-994` (env + functions + seeded admin); Clerk prod
  instance (restricted/invite-only, `convex` JWT template w/ email claim); Cloudflare Workers + `wrangler.jsonc`
  → `crm.instantrealestatesolution.com`; sign-in verified live; 53 sheriff rows geocoded on prod.
- [x] **Cloudflare CI fix** — committed `convex/_generated`; added `wrangler.jsonc` (serves `./dist` SPA).

## [ ] Post-launch punch list (see next-session-prompt.md)
- [ ] **Finish the Google Maps key rotation** (in progress) — new key → Cloudflare `VITE_GOOGLE_MAPS_API_KEY`
  + Convex `GOOGLE_GEOCODING_API_KEY` (prod **and** dev) + redeploy Cloudflare. One domain-restricted key serves both.
- [ ] **Rotate the other chat-shared keys** — Firecrawl, OpenRouter, Anthropic, Convex dev/prod deploy keys, Clerk dev/prod secret.
- [ ] **Create a real `VITE_GOOGLE_MAPS_MAP_ID`** (vector Map ID) → Cloudflare → removes the `DEMO_MAP_ID` watermark.
- [ ] **Fix `backfillGeocodes` silent `catch{}`** — log/surface hard errors (REQUEST_DENIED / expired key) instead of no-op.
- [ ] **E2E-test the invite flow on prod** — invite a teammate → accept on `/accept-invite` → links as member.
- [ ] (Optional) **Backend-deploy-on-push** via `convex deploy --cmd 'npm run build'` + `NODE_VERSION=22` (BlueRock model). Today backend deploys are manual.

## [ ] Verify / near-term (carried over)
- [ ] **Prove the parcel/Zillow retries live** at full scale — cheapest proof is the in-app "Retry N blocked" on a month (non-destructive). Firecrawl "stealth" proxy mode is the next lever if retries leave failures.
- [ ] **Marker clustering** if a period ever exceeds ~100 pins.
- [ ] Confirm the **crons** (weekday sheriff / weekly legal) are active on prod.

## [ ] Future / bigger ideas
- [ ] **Kanban deal-pipeline board** (drag listings across new→reviewing→contacted→offer→dead).
- [ ] **Dashboard charts** — deals per stage per month, equity in pipeline, run-history trend.
- [ ] **AI "Deal Analyst"** — chat/agent over the listings (rank by equity vs. liens) via OpenRouter.
- [ ] Per-listing **notes + activity log** (calls, offers, status changes with timestamps).
- [ ] **Contacts & relations** — owners/defendants/personal-reps as records, skip-tracing, link to listings.
- [ ] **Notifications** — email/SMS when a new high-equity / low-lien deal lands.
- [ ] **CSV / sheet export** (parity with the old Google-Sheets output).
- [ ] **Cross-run dedup** — flag a property that recurs across months.
- [ ] **Multi-county / multi-source** expansion beyond New Castle County.

## Notes
- `memory/` is the source of truth for context; git history is the source of truth for changes.
- Twenty app source is archived in `docs/twenty-app-archived/` (UI reference only — do not re-propose Twenty/Docker).