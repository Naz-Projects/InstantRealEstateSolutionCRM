# IRES CRM — Todo & Ideas

What's built and what's still ahead. `[x]` done · `[ ]` planned · `[~]` blocked on the user.
(History lives in git; this is the current picture, not a session log.)

## ★ SHIPPED — "Monitor the Web" (Zillow NCC deal finder) — LIVE ON PROD + PEN-TESTED (2026-07-01)
- [x] **Design + live test + 15-task plan** — `docs/superpowers/{specs,plans,research}/2026-06-30-monitor-web-*` (committed on the branch).
- [x] **BUILT (all 15 tasks, subagent-driven)** on branch `feat/monitor-web-zillow`. Pure `monitorListings.ts` (parsers +
  multi-exit math + DeepSeek judge, 23 tests) · `monitorListings`/`monitorRuns` schema · `monitorData` (requireUser reads +
  off-market cross-ref) · `monitorScrape` (Firecrawl v2 direct) · `monitorActions` (scan/enrich/judge/digest/createMonitor) ·
  `http.ts` HMAC webhook · daily cron · `/monitor` page · `monitor-web` op skill. **312 tests, build clean.**
- [x] **Final whole-branch review + fixes (`72eed27`):** #1 keeper gate no longer takes the LLM's soft `keep` (deterministic
  math decides) · #2 off-market **house-number guard** in `crossRefOffMarket` (was the old #1 fast-follow — DONE) · #3 missing-Firecrawl-key fail-safe.
- [x] **MERGED → `origin/main` `72eed27` + DEPLOYED TO PROD** `pastel-crocodile-994` (tables+indexes/functions/http-route/cron;
  `FIRECRAWL_WEBHOOK_SECRET` set); frontend via CF. **LIVE PROD PEN-TEST:** 1-page scan 41→24→24 analyzed/0 failed; 16 keepers,
  real insights (rentals cap 6.3–6.8%, flip -ve, comps-capped ARV, agent/price-history/DeepSeek reason); `/monitor` UI + Promote-to-Potential
  (test-promoted 309 Cedar) + Flip handoff all work; auth gates + webhook HMAC fail closed (401/404).
- [x] **(a) Keeper-precision tuning — SHIPPED + PROD-VERIFIED (2026-07-01 later, `b72f951`).** `decideKeeper` distress-only
  keeps now require spread≥0 OR dealScore≥30 (`MONITOR.distressScoreFloor`; null spread ≠ free pass). 313 tests, reviews clean.
  Live: 513 W 37th / 508 Lake Dr / 1805 W 8th re-analyzed → keeper=false; keepers 16→13 (survivors legitimately kept).
- [x] **(c) Firecrawl Monitor — REGISTERED + ACTIVE (2026-07-01 later, `76197c8`).** `createFirecrawlMonitor` first aligned w/
  current v2 docs (account-level signing — NO webhook `secret` body field; id at `data.id`; events `check.completed` only), then
  run on prod: monitor `019f1f6e-de66-759e-ad19-7364acf49fd3`, cron `0 20 * * *` ET, first run 2026-07-02. Daily Convex cron stays as safety net.
  - [x] **Webhook secret SYNCED + VERIFIED END-TO-END (2026-07-02).** User supplied the account webhook secret + a fresh API
    key (`fc-76ff…`) from their personal account — SAME team as the old `fc-286…` key (verified: identical billing period +
    the monitor is visible under it → no re-registration). Both set on prod. Proof: self-signed HMAC POST to
    `/firecrawl-monitor` → **HTTP 200** → real webhook-triggered scan **166 scanned / 63 new / 87 analyzed / 0 failed** on the
    new key; **42 keepers, 0 violate the tuned gate**; top finds 18 S Pennewell (90 FLIP, 43% spread) + 212 Bohemia Mill Pond
    (90 FLIP, 51%). Last night's unsynced first check 401'd + cron 20h-guard skipped = fail-safe chain proven organically.
  - [x] **Account decision RESOLVED (user, 2026-07-02): personal account (~17.8k credits, monthly) for now.** The ANNUAL 100k
    key (`fc-3f8…`) stays local-only in `.env.local`. Old chat-shared `fc-286…` key can be revoked in the dashboard (new key
    `fc-76ff…` + secret were also chat-shared → fold into the standing key-rotation punch list).
- [ ] **Product Q (user):** surface no-list-price foreclosures as a separate "distress, price TBD" section, or keep them dropped (current mirage fix)?
- [ ] **Minor visual:** one card (218 W 23rd) rendered a broken-image placeholder (missing/404 photo URL). Deferred Minors — see ledger `.superpowers/sdd/progress.md`.

## ★ ACTIVE — Wholesaling Lead Engine (Phase 0 DONE → Phase 1 NEXT)
- [x] **Spec written + committed** (`ce11b62`) — `docs/superpowers/specs/2026-06-06-wholesaling-lead-engine-design.md`.
- [x] **Distress-signal catalog** — `memory/distress-signals.md` (full menu of "why would they sell?" signals: 4 motivation
  categories + niche lists + LIST STACKING method + NCC availability map). Feeds the scoring layer.
- [x] **Enrichment sourcing + product vision + imagery/CV roadmap** — `memory/lead-engine-enrichment-and-vision.md`
  (free-first→paid strategy; how to source every remaining flag incl. CourtConnect/Recorder-of-Deeds free, DE divorce
  =confidential, bankruptcy=PACER; satellite/aerial CV via Cape Analytics/Nearmap vs cheap DIY Street View+LLM-vision;
  saleable-product design constraints). Enrichment is **tiered + funnel-only**.
- [x] **Phase 0 research COMPLETE** — `memory/source-matrix.md` (+ plan `docs/superpowers/plans/2026-06-06-wholesaling-lead-engine-phase0.md`).
  Verified live (throwaway cloud-dev Convex probe, removed): spine = 203,752 parcels (`PRCLID` CDC, `orderByFields` required);
  **NCC `CustomMaps` = a free, `PRCLID`-keyed distress-feed suite** (code cases 2,852 dated · vacant 859 · vacant-monition
  candidates 76 · structured sheriff sales 53 · rentals 39,424 · permits/new-construction · owners w/ full name). Assessed
  value + tax/sewer balances = funnel-only browser/paid; upstream lis-pendens = CourtConnect scrape (verify ToS).
- [x] **Phase 1 — parcel spine + absentee + search page BUILT** (branch `feat/lead-engine-phase1-spine`, NOT merged/deployed).
  Plan: `docs/superpowers/plans/2026-06-07-lead-engine-phase1-spine-search.md`. Pure `src/scraper/arcgisParcels.ts` (keyset +
  field-list + absentee + hash + diff; 13 tests), `parcels`/`parcelSync` schema, `convex/parcelData.ts` + `parcelActions.ts`
  (`seedSpine` resumable, `syncSpine` cheap CDC key-diff), weekly cron, `/parcels` search page (owner/address/parcel# +
  absentee flags + owner-portfolio view). **Live-verified on DEV: seeded 203,739 distinct parcels (203,752 source), 53,293
  absentee (26%), spot-checked; CDC sync ran clean (0 new/vanished).** 111 tests, build clean.
  - [x] **Quota RESOLVED (2026-06-11):** user upgraded Convex to a paid plan. Plus quota-safety code: `seedSpine` `maxPages`
    cap (`d7aae65`) + **differential upsert** (unchanged rows = NO write, `8af7cbc`) + **30s `AbortSignal.timeout` on all
    external fetches** (hung-fetch chain-kill fix). A full re-seed now costs ~$0.05–0.15 and is resumable via `{syncId, afterPrclid}`.
  - [x] **Merged to `main` + DEPLOYED TO PROD + ONE-TIME prod seed done (2026-06-11): 203,740 parcels / 53,299 absentee.**
  - [ ] **Attribute-change refresh:** weekly cron does new/vanished only; periodically re-run full `seedSpine` to catch
    owner/address changes (now cheap — differential). Also: vanished top-tail edge (PRCLID > max source) not marked — rare, documented.
- [x] **Phase 2 — signals + leads + scoring BUILT + LIVE-VERIFIED on dev (2026-06-11).** Code violations (1,886 distinct
  case+parcel events) + CourtConnect pre-foreclosure sweep (32 stems, 50 cases, 33 matched / 17 unmatched review list,
  4–7 mo lead time, serverless). `signalEvents`/`signalWatermarks`, weekly crons, derived scored `/leads` + mail-CSV export.
  151 tests. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-11-lead-engine-phase2-signals-leads.md`.
- [x] **Wholesaling pipeline v1 BUILT (2026-06-11):** `leadStatus` stages + notes + buyer assignment + fee on /leads;
  `/buyers` CRM page; lead→Flip handoff (`/flip?address=`). Gap analysis + P1–P8 roadmap:
  `docs/superpowers/specs/2026-06-11-wholesaling-pipeline-crm.md`.
- [x] **PROD CUTOVER (2026-06-11):** merged → `main`, pushed (CF deploys), backend deployed manually, ONE-TIME prod
  parcel seed + prod signal syncs run. **P1 Kanban board + FunnelWidget KPIs** and **P2 followUps (overdue badges)** built (152 tests).
  - [ ] **Click-through on PROD (user):** /leads table+board (stages, notes, follow-ups, CSV, timeline), /buyers, flip
    handoff, dashboard funnel card; confirm CF Workers build green (stale CONVEX_DEPLOY_KEY = silent stale bundle).
  - [ ] **Pipeline roadmap next (P3 re-ordered 2026-06-11):** ~~P4 equity gate~~ **DONE 2026-06-12** · P5
    contacts/skip-trace (DNC/TCPA module first) · P6 offers/contracts · P7 vision scoring (~$1/1k) · P8 buyer-match
    (the blast-email half moves to the end bucket). (Spec has details.)
- [x] **P4 EQUITY GATE — SHIPPED TO PROD (2026-06-12).** Funnel-only enrichment: `parcelEquity` table (separate from
  the spine ON PURPOSE — CDC never touches it) · `equityActions.enrichEquity/enrichBatch` (Zillow zestimate → comps
  fallback → NCC balances via existing `lookupParcel`; cap 50/click, 2.5s stagger; partial success OK, `lastError`
  visible) · pure `src/scraper/equity.ts` + `equityBucket`/multipliers in `SCORE_CONFIG` (unknown ×1.0 = un-enriched
  scores unchanged) · `/leads` equity column + LeadEquity panel (pull button, manual liens) + min-equity filter +
  "Enrich top N" + CSV value/equity columns + legend rows. Built subagent-driven (Opus 4.8 per user directive),
  TDD, two-stage review per task + final review (READY TO MERGE). 170 tests. **Live-verified on dev** (2 parcels:
  zestimate $495k/$631k + balances $0 legit + assessed). Merged ff → `main` `85f4a12`, pushed (CF deploys frontend),
  prod backend deployed manually (`parcelEquity.by_prclid` added). Spec/plan:
  `docs/superpowers/{specs,plans}/2026-06-11-equity-gate*`.
  - [ ] **Prod click-through (user):** /leads → expand a lead → "Pull value & balances" → equity badge + score shift;
    min-equity filter; "Enrich top N" confirm dialog; manual liens save; legend equity rows; CSV has value/equity.
  - [ ] **Comps-fallback path never exercised live** (both dev test parcels had zestimates) — verify when a
    no-zestimate lead shows up.
  - [ ] Backlog (from review): CSV formula-injection hardening (leading `=`/`+`/`-`/`@` cells) if mail CSVs are
    ever opened in Excel directly · normalize the liens input on blur (cosmetic Save re-enable on "150,000").
  - [~] **P3 outreach log + email alerts — DEFERRED to the END-OF-PIPELINE bucket (user, 2026-06-11):** finish the
    pipeline shape first, then build notifications. Design is fully brainstormed + scope-locked (Resend gated on env,
    manual response marking, free-text templates, hot = score ≥70 OR new pre-foreclosure):
    `docs/superpowers/specs/2026-06-11-outreach-log-design.md`. The log half (batches/responses/non-responder
    re-export) has no external dep and can be pulled forward when real mail starts going out.
  - [ ] **END-OF-PIPELINE bucket (build once the pipeline is stable):** email notifications/alerts (P3 alerts +
    P8 buyer blast, Resend) · mobile UI pass · other polish.
- [~] **P5 contacts + skip-trace (Tracerfy) — BUILT OFFLINE on branch `feat/p5-contacts-skiptrace` (not merged).** READY TO
  MERGE; blocked only on the user loading the Tracerfy key + ~$10. (Full details in that branch's `memory/todo.md`.) Do NOT
  merge before the key (user decision). Spec `2026-06-12-contacts-skiptrace-design.md`.
- [x] **P6 offers + contracts e-sign — SHIPPED TO PROD (2026-06-21).** Merged ff → `main` `ba03150`, pushed (CF deploys
  backend+frontend on push). 197 tests, build clean, strictly additive. Spec `docs/superpowers/specs/2026-06-14-offers-contracts-esign-design.md`;
  plan `docs/superpowers/plans/2026-06-14-offers-contracts-esign.md`. Offer-negotiation thread per lead + e-sign for BOTH the
  seller PSA and the buyer Assignment (template-generated `@react-pdf/renderer`), a fully serverless public token-gated
  `/sign/$token` portal (`signature_pad`, typed+drawn, Convex `_storage`), `LeadOffers` + `LeadContracts` panels. Copy-link
  delivery (no external dep); optional key-gated Resend email. Legal: templates are attorney-review starting points.
  - [ ] **CONFIRM the Cloudflare Workers build went GREEN** after the push (stale prod `CONVEX_DEPLOY_KEY` in CF env = silent
    401 = old bundle). If P6 features missing on prod, fix the CF key + re-run the build.
  - [ ] **Manual click-through (user, never clicked live):** offer→accept→Generate PSA→Send→copy `/sign/<token>`→open
    logged-out→review→sign typed+drawn→signed PDF downloads + status flips; Assignment from an assigned buyer; decline/void/expiry.
  - [ ] **OPTIONAL email:** set `RESEND_API_KEY`/`RESEND_FROM`/`PORTAL_BASE_URL` (+`RESEND_TO`) on Convex to enable auto-email
    (signing request + signed copy). Without them the actions no-op; copy-link is unaffected.
  - [ ] **Backlog nits (cosmetic, from the final review — ship-as-is OK):** set assignment `terms.underlyingContractRef` (the
    assignment doc doesn't name its PSA) · drop the no-op `typedName` ternary in SignPortal · remove the stale "P6 Task C3 adds…"
    comment in LeadsPage · `acceptContract` orphans the uploaded blob on a duplicate (two-tab) submit (benign Convex storage leak).
  - [ ] **MERGE-ORDER hazard (P5 + P6 both add tables to schema.ts):** the SECOND branch to merge MUST regenerate
    `convex/_generated` against the merged tree + `npm run build` (never hand-merge `api.*`). Reconcile the divergent memory docs too.
- [x] **★ P7 v1 — VISION CONDITION SCORING (ISOLATED test page) — SHIPPED TO PROD (2026-06-21, `e03c402`).**
  Standalone `/condition` page scores the top-15 leads' exterior condition (0–100 distress + flags) from a Street View photo
  via **Gemini 2.5 Flash** (OpenRouter, env-swappable `CONDITION_LLM_MODEL`). NO /leads integration yet (user wants to evaluate
  accuracy first); funnel-only, per-lead button only. Pure `conditionScore.ts` (15 tests) + `parcelCondition` table +
  `conditionData.ts` + `conditionActions.scoreCondition` + `ConditionTest.tsx`. 212 tests, build clean, reviewed clean.
  Spec/plan `docs/superpowers/{specs,plans}/2026-06-21-vision-condition-scoring*`. Merged ff → main + prod backend deployed
  (parcelCondition added) + OPENROUTER/geocoding keys set on dev+prod; branch deleted. Pending: confirm CF build green + USER
  click-through `/condition` (auth-gated → NO CLI smoke), then design the /leads integration. Research: "GLM 5.2" is text-only
  (use GLM-4.6V); DeepSeek has no vision; cost negligible at this volume → chose on vision reliability.
- [ ] **P7 → /leads integration (FUTURE PHASE, after the user evaluates v1):** a funnel-only `signalEvents` source: score a flagged
  lead's physical condition from imagery (Google Street View Static → LLM-vision → 0–100 condition-distress score + flags),
  stacking in the existing recency×stack scoring. ~$1/1k houses; NEVER run against the 203k spine. Research:
  `memory/lead-engine-enrichment-and-vision.md` (T4 / "Satellite/aerial computer-vision"); roadmap
  `docs/superpowers/specs/2026-06-11-wholesaling-pipeline-crm.md` (P7). LLM = a cheap Claude vision model (read the
  `claude-api` skill first); `ANTHROPIC_API_KEY` + `OPENROUTER_API_KEY` both in `.env.local`. DIY-first (Street View + LLM),
  upgrade to Cape Analytics/Nearmap later. Flow: brainstorm → spec → plan → subagent-driven TDD → finish-branch
  (`feat/p7-vision-condition` off main). Mirror `equityActions` (per-lead + capped batch, funnel-only) + `codeCases`/`signal*`
  (signalEvents source) + the `LeadEquity`/`LeadContacts` panel. Pure parser+scoring+schema are offline-TDD-able now (build
  offline like P5; live scoring needs the key/budget). Open design Qs in `memory/next-session-prompt.md` (P7 section).
- [ ] **Probe `Structure_Details.zip`** (NCC hub bulk daily download — building attributes; also `Owners.zip`, `Parcels_GDB.zip`)
  for year-built/size fields the REST spine lacks. Free bulk enrichment. (Equity verdict: NO free bulk assessed-value roll exists —
  values stay funnel-only via Zillow/comps or the per-parcel county page.)
- [ ] **Quick wins after Phase 2:** one-click **direct-mail CSV export** of filtered leads (owner mailing already in spine);
  **Street View + vision condition scoring** funnel-only (~$1 per 1,000 houses w/ Haiku batch; just another signalEvents source).
- [ ] **Optional quick win** — **augment** (not replace) the sheriff-PDF parse with the structured `SheriffSales/0` layer:
  join its clean `PARCELID` + court `CASENUMBER`/`PLANTIFF` onto scraped rows. (Layer lacks sale type/principal/sale-date
  that `deal.ts` needs, so the PDF stays the source of truth.)

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

## ✅ Shipped this session (2026-06-03) — shadcn UI foundation (branch `ui/shadcn-foundation`, NOT merged)
- [x] **Real shadcn/ui setup** — `components.json` (radix/nova, Tailwind v4), `@efferd` registry; installed the
  **`@efferd/dashboard-3`** block (app-shell-3 + base components + recharts). Reusable utils kept (delta/formater/indicator).
- [x] **IRES theming** — shadcn owns semantic tokens; `--primary` = green, navy `--sidebar*` + `--color-ink`,
  IRES `--chart-1..5`; migrated brand `accent`→`primary` across existing pages (token-collision fix).
- [x] **App shell** — navy `AppSidebar` (logo + role-gated TanStack-router nav) + `AppHeader` (toggle + breadcrumb
  + Clerk-wired user menu), `variant="inset"`; root route renders it around `<Outlet/>`.
- [x] **Dashboard rebuilt on real data** — stat cards + pipeline-by-stage bar + source donut + recent-runs table
  (replaced the mock dashboard; deleted efferd support-desk mock components).
- [x] **Real logo** from the live site (`public/ires-logo-onnavy.png` etc.). Build + tsc clean, 44 tests pass.

## [ ] UI foundation — follow-ups
- [ ] **Merge `ui/shadcn-foundation` → main** and deploy (prod still serves the OLD UI). Build the frontend, `wrangler deploy`.
- [ ] **Decide on the shadcn skill artifacts** — `.agents/`, `.claude/`, `skills-lock.json` are untracked; gitignore or commit (a choice, not an accident).
- [ ] **Verify the collapsed sidebar icon** (`ires-icon.png`) renders well; check Legal Notices + Admin pages live (same shell pattern as Sheriff, verified).
- [ ] (Optional) De-dupe the breadcrumb vs per-page `PageHeader` title, or migrate Sheriff/Legal/Admin headers to shadcn components for full consistency.

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

## ✅ Shipped — Flip Analyzer (additive deal-decision feature, 2026-06-03)
- [x] **Flip Analyzer** — new `/flip` page that turns a property (Sheriff/Legal listing OR manual address) into a
  flip P&L: ARV (manual, pre-filled from Zestimate) − tiered rehab (cosmetic/moderate/gut $/sqft + contingency) −
  full cost stack → **MAO / profit / ROI / grade**. Saved in a NEW `flipAnalyses` table; reads sheriff/legal data
  read-only; does NOT modify those pages/pipelines or `deal.ts`. **Spec:** `docs/superpowers/specs/2026-06-03-flip-analyzer-design.md`;
  **Plan:** `docs/superpowers/plans/2026-06-03-flip-analyzer.md`. Research menu: `memory/flip-decision-features.md`.
  Built subagent-driven + TDD: `src/scraper/flip.ts` (+10 tests), `flipAnalyses` table, `convex/flipData.ts`
  (read-only on sheriff/legal), `/flip` page with live P&L + editable sqft. 54 tests pass, build clean,
  independently code-reviewed (APPROVED; verified additive). **MERGED to `main`.** Backend **deployed + verified
  on prod** (`npx convex deploy` to `pastel-crocodile-994`: added `flipAnalyses` table, existing data validated;
  valid prod key now in `.env.local` as `CONVEX_DEPLOY_KEY_PROD`).
  - [x] **CF deploy-key fixed.** The first push's Workers Build failed with `401 Invalid Convex deploy key` — the
    `CONVEX_DEPLOY_KEY` in **Cloudflare's** build env was the OLD key (the prod key had been rotated and not yet
    copied into CF). User updated it in Cloudflare on 2026-06-03 and manually retried the deployment (CF build cmd
    `npx convex deploy --cmd 'npm run build'` deploys backend+frontend). (See lessons.md 2026-06-03.)
  - [x] **UI polish (2026-06-03)** — removed the centered top-bar logo (`app-header.tsx`); full sidebar logo
    `ires-logo-onnavy.png` (was the cut `ires-icon.png`), hidden when collapsed (`app-sidebar.tsx`); Flip page
    header blended `bg-card`→`bg-background`; native property `<select>` → shadcn **Popover+Command** combobox
    with type-to-filter autocomplete, height matched to the manual-address input (added `popover`/`command`/`dialog`
    ui components + `cmdk` dep). Build clean, 54 tests pass; pushed → Cloudflare deploy.
  - [x] **ARV from comps (2026-06-03)** — "Pull comps" button scrapes recent **Redfin** sold listings near the
    property (Firecrawl, on demand), parses them (`src/scraper/comps.ts` +10 tests), computes a suggested ARV
    (median $/sqft × subject sqft), caches on the row, and **"Use as ARV"** pre-fills the ARV field. New
    `convex/compsActions.ts` (`pullComps`, gated by `getCallerInternal`) + `flipAnalyses` comp fields +
    `getAnalysisInternal`/`storeComps`. Additive (no sheriff/legal/`deal.ts` change). Subagent-driven + TDD;
    independently reviewed (APPROVED; fixed: surface "no comps" + show median $/sqft). 64 tests pass. **MERGED to
    `main` + pushed** (CF build `convex deploy --cmd` deploys comps backend to prod + frontend; key fixed).
    Spec/plan: `docs/superpowers/{specs,plans}/2026-06-03-arv-from-comps*`. Security note: pullComps uses the same
    shared-team auth as the other flipData mutations (any member acts on any analysis by design — no per-user
    ownership; flagged IDOR is not applicable, see chat). Comp-selection ±30% sqft / beds ±1; Redfin `sold-6mo`.
  - [ ] **Then manually smoke-test `/flip` on prod** (create from a Sheriff + a Legal listing + a manual address;
    edit ARV/rehab/sqft/assumptions → live MAO/profit/ROI/grade; **Pull comps → Use as ARV**; save/reopen/delete;
    check sidebar logo + combobox render) — unit-tested + reviewed but never clicked through in a running app.

## ✅ Shipped — Properties / Portfolio (owned-asset management, 2026-06-03)
- [x] **Properties section** — new `/properties` list (card grid, filter All/Flips/Rentals) + `/properties/$id`
  detail page for houses IRES **owns** (distinct from the scrapers that *find* deals and the Flip Analyzer that
  *projects* them — this tracks **actuals**). Each property is a **flip** or **rental**; track a unified
  **expense + income ledger** (`propertyLedger`, `direction:expense|income`, date-stamped); flips run to **sale**
  (realized profit + ROI); rentals show net cash flow. Add manually OR **seed from** a Sheriff/Legal listing or a
  saved Flip Analysis. House **photo from Zillow via Firecrawl** (`extractImageUrl`), with a **Google Street View**
  fallback for off-market houses (spike found most distressed/owned properties have no Zillow listing photo) +
  placeholder + manual paste-URL. New `properties` + `propertyLedger` tables, pure `src/scraper/portfolio.ts`
  (tested), `convex/propertyData.ts` + `convex/propertyActions.ts`. **Additive** — zero changes to sheriff/legal/
  flip/comps pipelines (final review confirmed). Built subagent-driven + TDD in an **isolated git worktree**
  (parallel to the ARV-from-comps session). 75 tests pass, build clean, 4-stage review + final opus review
  (READY TO MERGE). **MERGED to `main` + pushed → prod.** Spec/plan: `docs/superpowers/{specs,plans}/2026-06-03-properties-portfolio*`.
  - [ ] **Manually smoke-test `/properties` on prod** (add manual flip + rental; seed from a Sheriff listing;
    confirm photo appears or placeholder+paste works; add expense & income ledger entries; mark a flip sold →
    profit/ROI; delete) — unit-tested + reviewed + render-screenshotted, but never clicked through live.
  - [x] **Street View Static API ENABLED on the Maps-key project (2026-06-26).** It had never been enabled (only Geocoding
    was) — this is what broke P7 `/condition` (metadata → REQUEST_DENIED "not activated", silently shown as "No coverage").
    Now verified end-to-end on the live key (metadata OK + real JPEGs + Gemini score). Also unblocks the off-market
    property-photo Street View fallback. Gotcha: a key's "Selected APIs" restriction list ≠ the project's "Enabled APIs".
  - [x] **Auto-fill Zillow facts on add (2026-06-04)** — the photo scrape (`scrapePropertyImage`) now also pulls
    **beds/baths/sqft/zestimate** from the *same* page it already fetches (no extra Firecrawl call) via new pure
    `pickZillowFacts(md, rawHtml)` (gated on the `-DE-` homedetails match; +5 tests). New `properties.zestimate`
    column + editable **Zestimate** box on the detail page; `applyZillowFacts` internalMutation fills **only-empty**
    fields (never clobbers seeded/typed values). `PropertyDetail` mirrors late-arriving server facts into still-empty
    inputs via a guarded `useEffect` (inputs are useState-seeded + keyed on `_id`, so the async scrape wouldn't show
    otherwise — and a Save on the stale form would wipe the scraped facts). Spec:
    `docs/superpowers/specs/2026-06-04-property-zillow-facts-design.md`. 80 tests + build + convex codegen green on dev.
    - [ ] **Live smoke-test**: add a manual DE address → stay on detail → confirm beds/baths/sqft/Zestimate populate
      within ~5s without a reload (folds into the broader "smoke-test /properties" item above).
  - [x] **Add-property redesign (2026-06-04)** — the add panel is now **always visible** (removed the show/hide
    toggle), the **two** search bars (existing-record picker + manual-address) are merged into **one** combobox
    `src/web/PropertyPicker.tsx`, and the two `+Add`/`+Add manual` buttons are replaced by **one yellow "Add Property"**
    button. The picker shows, in one bar: **Address suggestions** (live Google Places, reusing the legacy
    `getPlacePredictions` logic), matching **Sheriff/Legal/Flip** records, and a **Use "…"** creatable for a brand-new
    manual address. Built on the app's existing **Popover + Command (cmdk)** pattern (`shouldFilter={false}`, controlled
    input) — zero new deps. Replaced the old internal `CandidateCombobox`. Favicon fix: `index.html` now points at the
    real **`ires-logo-dark.png`** (was the generic navy box `logo.svg`). Build + 93 tests green.
    - [ ] **Live click-through** (records + Places suggestions + creatable all select correctly; yellow button gates on a
      selection; favicon shows the IRES mark) — tsc-verified, not yet clicked in a running app.
  - [~] **ReUI dropdown/combobox standardization — PARKED.** User pasted `@reui/c-dropdown-menu-1` and
    `@reui/c-combobox-1`, but ReUI ships **Base UI** components (`render` prop) while this repo is on the **radix**
    base (`asChild`). `shadcn add @reui/c-combobox-1 --dry-run` showed it would **overwrite `button.tsx` + `separator.tsx`**
    (app-wide Radix components) → user said don't install; built the combobox with our own Radix cmdk pattern instead.
    The dropdown-menu standardization was dropped in favor of the combobox direction.

## ✅ Shipped — Address autocomplete + UX polish (2026-06-03)
- [x] **Google Places address autocomplete** on the **manual address** fields of both Properties ("Add property")
  and Flip Analyzer. New reusable `src/web/AddressAutocomplete.tsx` — dark-themed dropdown, US-restricted,
  `types:['address']`, session-tokened, free-text fallback. Uses the **legacy** `AutocompleteService.getPlacePredictions`
  (the IRES key has legacy "Places API", NOT "Places API (New)" — the New API was the original bug; see lessons.md).
- [x] **Cursor-pointer** base rule in `index.css` so all buttons/links/cards/`select`/shadcn triggers show a pointer.
- [x] **Dropdowns → shadcn `Select`** — converted 8 of 9 plain `<select>`s (Properties deal type; Property detail
  status + ledger category; Flip Analyzer rehab tier + per-row deal status; Sheriff/Legal shared `DealSelect`;
  both Admin role selects). The **map InfoWindow** deal-status select stayed **native by design** (a Radix Select
  portals its dropdown outside the Google InfoWindow → outside-click closes it).
- All three **MERGED to `main` + pushed → prod** (build `index-DFC2G_Eo.js` live, legacy autocomplete confirmed in
  the bundle). Build clean, 75 tests pass.
  - [ ] **Live-test autocomplete on prod** — type an address in the Properties/Flip manual field; suggestions
    should appear. If not, the key has neither legacy nor New Places enabled (check Google Cloud).
  - [ ] (Optional) shadcn-ify the map InfoWindow select via a Radix portal-container fix, if desired.

## ✅ SHIPPED — Market Data Dashboard (FRED auto-pull) — 2026-06-04, committed + DEPLOYED TO PROD
- [x] **Live public market data on the Dashboard, auto-refreshed monthly by cron — no clicks.** Additive: new table +
  pure parser + action + monthly cron + dashboard widgets; zero change to Sheriff/Legal/Flip/Properties.
  Spec: `docs/superpowers/specs/2026-06-04-market-data-dashboard-design.md`. Built TDD (RED→GREEN), 93 tests pass, build clean.
  - **Source = FRED** (St. Louis Fed) free JSON API; key `FRED_API_KEY` **set on dev `fearless-donkey-585`** (user-provided,
    low-risk read-only; rotate later w/ the other chat-shared keys). No-key `fredgraph.csv` fallback also coded.
  - **Files:** `src/scraper/fred.ts` (pure: `FRED_SERIES` catalog + `parseFredJson`/`parseFredCsv`/`pickLatest`/`isFresh`;
    +13 tests `tests/fred.test.ts`) · `convex/marketData.ts` (`upsertMetric` internalMutation + `dashboardMetrics` query,
    `requireUser`, hides stale temperature extras via `isFresh`) · `convex/marketActions.ts` (`"use node"`
    `refreshMarketData` internalAction, tolerant per-series, explicit return type) · `convex/schema.ts` `marketMetrics`
    table (index `by_seriesId`) · `convex/crons.ts` monthly `"0 12 1 * *"` · `src/components/market-widgets.tsx`
    (`MarketWidgets`: rate cards + pure-SVG sparkline, county inventory table, temperature card; neutral uncolored deltas;
    attribution) mounted in `src/components/dashboard.tsx`.
  - **DEV live-verified** (`refreshMarketData` → updated 9 / skipped 0): mortgage 6.53% (2026-05-28, matches independent
    search), Fed funds 3.63%; **active listings by county** New Castle 818 / Kent 490 / Sussex 1876 / DE 3183 (2026-04);
    median DOM 48d, median list price $500k, price cuts 1002 (DE, 2026-04). All series fresh — extras stayed visible.
  - [x] **Committed** by the parallel session into `main` (bundled in `61851c8 feat(market-data, properties): …`, alongside
    the property-zillow-facts WIP + the `620a7bf` error-logging/auth-hardening + `50cf23c` docs commits). `main` pushed to origin.
  - [x] **Headless render verified** (throwaway preview + Chrome screenshot, then reverted): "Delaware market" section renders
    — rate cards w/ teal SVG sparklines, county inventory table, temperature card, attribution. 98 tests pass, build clean.
  - [x] **DEPLOYED TO PROD** (`pastel-crocodile-994`): `FRED_API_KEY` set on prod; `npx convex deploy` (schema validated,
    functions live, **monthly cron now active on prod**); `refreshMarketData` run on prod → **updated 9 / skipped 0** with the
    LATEST data (mortgage 6.48% @ 2026-06-04; active listings May-2026 New Castle 855 / Kent 492 / Sussex 1934 / DE 3302;
    DOM 50d). The auth-gated `dashboardMetrics` correctly rejected the CLI (UNAUTHENTICATED) = security working.
  - [ ] **Confirm the FRONTEND deployed** — open https://crm.instantrealestatesolution.com, sign in, check the Dashboard for the
    "Delaware market" section. It ships via Cloudflare's build on the pushed `main`; if missing, the CF Workers build likely
    failed on a stale prod `CONVEX_DEPLOY_KEY` in CF env (bit us 2026-06-03) → check Workers → Builds + re-run.
  - [ ] **v2 (separate spec):** median SALE price, sale-to-list %, % price drops, **city-level Wilmington/Newark**, ZORI rent
    → page-scrape Redfin county/city page via Firecrawl (the `comps.ts` pattern; NOT the 100MB bulk TSV).
  - [ ] **v2 (separate spec):** median SALE price, sale-to-list %, % price drops, **city-level Wilmington/Newark**, ZORI
    rent → page-scrape Redfin county/city page via Firecrawl (the `comps.ts` pattern; NOT the 100MB bulk TSV).

## ✅ Shipped — Security & error-logging overhaul (2026-06-04)
- [x] **Senior-dev security/robustness pass.** Audited the whole backend (read every `convex/*Data.ts` mutation/query
  + `users`/`invitations`/`helpers`): authorization is **solid** — every browser-callable fn gates `requireUser`, every
  admin op re-checks `role==="admin"`, destructive `clearMonth/Week` are `internalMutation`, invite flow has TOCTOU
  re-check + Clerk rollback + self-target guards. No injection (validators + indexed queries), no unsafe XSS sink, no
  hardcoded secrets, SSRF surface is path-only/fixed-host. **No high/med vuln found.**
- [x] **Error logging on the Admin page** — new `errorLogs` table + `convex/errors.ts` (`logError` requireUser-gated,
  email stamped server-side; admin-only `listErrors`/`unresolvedCount`/`setResolved`/`clearResolved`; internal
  `logServerError`). Admin → **Error Log** tab (resolve/reopen/clear, unresolved/all filter) + **unresolved-count
  sidebar badge**. `logServerError` wired into `refreshMarketData` (all-series-fail surfaces on the log).
- [x] **Branded popups** — reusable `src/web/ConfirmDialog.tsx` (dark card, lucide icon, busy state, inline error)
  replaces the **3 native `window.confirm`** (sheriff/legal force re-scrape, property delete) + the AdminPage bespoke modal.
- [x] **Real error wording (prod bug fixed)** — `pages.tsx` was `(e as Error).message` → "Server Error" in prod;
  now `describeError()` shows the real `ConvexError` message (expected) or a branded "contact your administrator" line
  (unexpected), and logs it. New `src/web/lib/errorReporting.ts` (+5 tests) + `ErrorBoundary.tsx` (no more white screen)
  + a global `window.error`/`unhandledrejection` best-effort logger in `main.tsx` (deduped, noise-filtered).
- [x] **Hardening** — removed the `IRES_DEV` unauthenticated bypass from `requireUser` (latent full-auth-bypass footgun).
- [x] 98 tests pass; tsc + vite build clean; live `errorLogs` write round-trip verified on dev (`convex run` + `convex data`).
  - [ ] **Live authed click-through (user step):** trigger a forced error → see the branded card + a row land in Admin →
    Error Log; force re-scrape + delete a property → branded confirm dialogs; confirm the sidebar badge counts unresolved.
  - [ ] **Confirm CF prod build went green** after the push (stale `CONVEX_DEPLOY_KEY` in CF env = silent 401, serves old bundle).
  - Note: a render crash may log twice (boundary + window.error) — harmless over-logging; admins can resolve both.

## [ ] Housekeeping
- [ ] **Decide on the untracked shadcn-skill artifacts** (`.agents/`, `.claude/`, `_preview.png`, `skills-lock.json`) —
  long-lived untracked files; gitignore them or commit deliberately. (Kept OUT of all feature commits this session.)
- [ ] **Clean the orphaned worktree dir** `.claude/worktrees/properties` (leftover from the Properties build's
  isolated worktree; holds a stray `.env.local` copy) once its locking process exits: `Remove-Item -Recurse -Force .claude\worktrees\properties`.

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
## ✅ PROD CUTOVER VERIFIED (2026-06-11, late session)
- Prod spine: **203,740 parcels / 53,299 absentee** (seed stalled once at 132k — hung fetch, fixed w/ 30s timeouts, resumed via cursor).
- Prod signals: **1,951 events** = 1,886 code-violations + pre-foreclosure from **51 court cases (35 matched, 16 unmatched)**.
- Foreclosure watermark now only advances on a CLEAN sweep (partial stem failures re-sweep next cron). All crons active on prod.
- **Sidebar score legend shipped** (`src/components/score-legend.tsx`: collapsible, localStorage-persisted, reads `SCORE_CONFIG` live).
- Pushed through `09c30c7`; CF build ships the frontend (board + follow-ups + funnel + legend). **User: confirm CF build green + click through prod.**
