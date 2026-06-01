# Next Session — Start Here

_Read `memory/memory.md` + `memory/lessons.md` first, then this._

## Where we are
The IRES CRM (serverless: Convex + TanStack/React + Tailwind, hosted on Cloudflare) is feature-complete for
the core workflow and **running live on the Convex dev deployment `fearless-donkey-585`**. The repo is on
**GitHub** (`origin` = Naz-Projects/InstantRealEstateSolutionCRM) and **Cloudflare builds the frontend from it
via CI**. 44 tests pass; tsc+vite build clean; everything is committed.

**Shipped:** Sheriff Sales + Legal Notices scrape → enrich (parcel/Zillow) → live tables with the deal screen
(cushion for Sheriff, Zestimate for Legal), monthly/weekly tabs, retry-failed, split scrape buttons, live
progress stepper (collapsible log), and a **Google Maps + Street View** view (collapsible map panel above the
table, price-pill markers colored by deal, click→InfoWindow + Street View, table **Map column** that jumps to a
property and auto-opens Street View). Geocoding is stored per row and verified live (74/74). See
`memory/memory.md` for the full map; `docs/superpowers/` for the maps spec + plan.

## ⭐ Next (do these — go-live)
1. **Security: split the Google key.** Right now one **unrestricted** key (in `.env.local` as
   `VITE_GOOGLE_MAPS_API_KEY` AND set on Convex as `GOOGLE_GEOCODING_API_KEY`) serves both browser + server,
   and it was shared in chat. Create two keys: a browser key restricted to HTTP referrers (Maps JS + Street
   View Static) and a server key restricted to the Geocoding API. Update both, then **rotate** the old one.
2. **Eyeball the app** (`npm run dev`): on Sheriff + Legal, click "Open map" → pins colored by deal; click the
   table **Map** column → it focuses that property and opens Street View; editing a deal status from a pin must
   NOT re-center the map. Also confirm the stepper/tabs/split-buttons look right.
3. **Clerk auth** — create the app; `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local`; set real
   `CLERK_JWT_ISSUER_DOMAIN` (`npx convex env set`); in `src/web/main.tsx` swap `ConvexProvider` →
   `ConvexProviderWithClerk` + a sign-in gate; **`npx convex env remove IRES_DEV`** (it bypasses auth).
4. **Convex prod** — `npx convex deploy` with the prod key; set `FIRECRAWL_API_KEY`, `OPENROUTER_API_KEY`,
   `CLERK_JWT_ISSUER_DOMAIN`, `GOOGLE_GEOCODING_API_KEY` on prod. Confirm crons (weekday sheriff / weekly legal).
5. **Cloudflare prod env** — set `VITE_CONVEX_URL` (prod), `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`
   (create a real Map ID), `VITE_CLERK_PUBLISHABLE_KEY`; restrict the browser key to the prod domain; point
   `crm.instantrealestatesolution.com`. (Build passing ≠ app working — these runtime vars must be set.)

Then pick from `memory/todo.md` (Kanban board, dashboard charts, AI deal analyst).

## Run it
```bash
cd C:\Users\nazho\Desktop\ires-crm
npm install
npx convex dev        # terminal 1 — syncs functions to the dev deployment
npm run dev           # terminal 2 — http://localhost:5173
```
The dev deployment already has enriched + geocoded sheriff + legal rows. Handy checks:
- `npm test` (44) · `npm run integration` / `npm run integration:legal` (core vs live Firecrawl/OpenRouter)
- `npx convex run sheriffActions:devScrapeSheriff '{"limit":3}'` — cheap cloud e2e (IRES_DEV=1)
- `npx convex run geocodeActions:backfillGeocodes '{"type":"sheriff"}'` — geocode any rows missing coords

## Gotchas (also in lessons.md)
- After changing `convex/`, run `npx convex dev --once` FIRST (validates + regenerates `_generated`), THEN `npm run build`.
- Convex `"use node"` files = actions only; V8 queries/mutations live in `*Data.ts`. Annotate action return types (`: Promise<...>`) to avoid TS7023.
- The Convex CLI's `UV_HANDLE_CLOSING` assertion on Windows is cosmetic — trust the output, ignore the exit code.
- `convex/_generated` is committed on purpose (Cloudflare CI typechecks without the Convex CLI). Don't gitignore it.
