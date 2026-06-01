# IRES CRM — Handoff

**Stack:** Convex (backend/DB) · Clerk (auth) · TanStack Router + React + Tailwind (frontend) · Cloudflare (hosting). Serverless — no server, no Docker.

## ✅ What's done and PROVEN
- **Both automations work live:**
  - Sheriff Sales: Firecrawl → real NCC PDF → 53 listings → parcel + Zillow enrichment.
  - Legal Notices: Firecrawl + OpenRouter LLM → 21 estate listings.
- **Convex backend deployed to your real dev deployment** (`fearless-donkey-585`) and **end-to-end tested there**: triggering the scrape created listing rows in the live DB and the fan-out enrichment filled in owner / assessment / Zillow data (3/3 enriched).
- **Frontend** (IRES-branded: Dashboard, Sheriff Sales, Legal Notices, scrape buttons, live tables, deal-status pipeline) typechecks, builds, and serves locally against the live backend.
- 31 unit/integration tests pass. 16 commits.

## ▶️ Run it locally right now
```bash
cd C:\Users\nazho\Desktop\ires-crm
npm install                 # if needed
npx convex dev              # terminal 1 — keeps functions synced to dev deployment
npm run dev                 # terminal 2 — open http://localhost:5173
```
The dev deployment already has the scraped sheriff listings. Click **“Scrape Sheriff Sales This Week”** / **“Scrape Legal Notices This Week”** to pull fresh data; rows enrich live.

Also useful:
```bash
npm test                    # 31 tests
npm run integration         # Sheriff core vs live Firecrawl
npm run integration:legal   # Legal core vs Firecrawl + OpenRouter
npx convex run sheriffActions:devScrapeSheriff '{"limit":3}'   # cheap cloud e2e
```

## 🔒 Security (do this)
- **Rotate** the keys shared in chat (Firecrawl, OpenRouter, Anthropic, and both Convex deploy keys) in their dashboards. They live only in `.env.local` (gitignored), never committed.
- **`IRES_DEV=1`** is set on the dev deployment to bypass Clerk auth for testing. **Never set it in production** — it allows anonymous access. (`convex/helpers.ts`.)

## 🌅 To finish (your stuff for the morning)
1. **Clerk:** create the Clerk app → set `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`; set the real `CLERK_JWT_ISSUER_DOMAIN` as a Convex env var; swap `ConvexProvider` → `ConvexProviderWithClerk` in `src/web/main.tsx` and add a sign-in gate; **remove `IRES_DEV`** from the deployment.
2. **Convex prod:** `npx convex deploy` using the prod deploy key; set `FIRECRAWL_API_KEY`, `OPENROUTER_API_KEY`, `CLERK_JWT_ISSUER_DOMAIN` on prod.
3. **Cloudflare:** `npm run build` → deploy `dist/` to Cloudflare Pages/Workers; set `VITE_CONVEX_URL` (prod) + `VITE_CLERK_PUBLISHABLE_KEY`; point `crm.instantrealestatesolution.com` at it.
4. The **crons** (weekday sheriff / weekly legal) are already defined in `convex/crons.ts` and run automatically on whichever deployment they're on.

Ping me once Clerk/Cloudflare are set and I'll wire the auth provider, deploy, and run the live in-app test with you.

## Map
- `src/scraper/*` — proven scraping core (Firecrawl, parsing, address cleaning, parcel, Zillow, legal, enrich). Source of truth.
- `convex/*` — schema, `sheriffData`/`sheriffActions`, `legalData`/`legalActions`, `runs`, `crons`, `auth.config`, `helpers`.
- `src/web/*` — React app (main, app/router+shell, pages).
- `docs/twenty-app-archived/` — the dropped Twenty app, kept for UI reference.
- `docs/2026-06-01-ires-crm-automation-design.md`, `docs/TWENTY-ARCHITECTURE.md` — design history.
