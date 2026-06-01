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

## ~ Blocked on the user (the go-live setup — see next-session-prompt.md)
- [~] **Security: split the Google key** into a referrer-restricted browser key + a Geocoding-only server key, then rotate (it was shared in chat). Currently one unrestricted key serves both.
- [~] **Clerk auth** — publishable key, `ConvexProviderWithClerk`, real `CLERK_JWT_ISSUER_DOMAIN`, sign-in gate, **remove `IRES_DEV`**.
- [~] **Convex prod** deploy + prod env vars (Firecrawl, OpenRouter, Clerk, `GOOGLE_GEOCODING_API_KEY`).
- [~] **Cloudflare prod env** — `VITE_CONVEX_URL`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`, `VITE_CLERK_PUBLISHABLE_KEY`; point `crm.instantrealestatesolution.com`. Confirm crons active on prod.
- [~] Rotate the other keys shared in chat (Firecrawl, OpenRouter, Anthropic, Convex deploy keys).

## [ ] Verify / near-term
- [ ] **Eyeball the map + Street View** in `npm run dev` (needs the browser key, which is set): pins appear + colored by deal; Map column → focuses the property + opens Street View; deal-status edit from a pin doesn't re-center the map.
- [ ] **Create a real Map ID** (`VITE_GOOGLE_MAPS_MAP_ID`) for production instead of the `DEMO_MAP_ID` fallback.
- [ ] **Prove the parcel/Zillow retries live** at full scale — cheapest proof is the in-app "Retry N blocked" on a month (non-destructive). Firecrawl "stealth" proxy mode is the next lever if retries leave failures.
- [ ] **Marker clustering** if a period ever exceeds ~100 pins.

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