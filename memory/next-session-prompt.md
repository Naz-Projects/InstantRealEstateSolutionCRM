# Next Session — Start Here

_Read `memory/memory.md` + `memory/lessons.md` first, then this._

## Most recent work — shadcn UI foundation (branch `ui/shadcn-foundation`, NOT merged)
This session rebuilt the UI on a real **shadcn/ui** foundation (the `@efferd/dashboard-3` block) with IRES
navy/green theming: a navy sidebar shell (logo + role-gated router nav + Clerk user menu) and a brand-new
**Dashboard** wired to real Convex data (stat cards + pipeline-by-stage bar + source donut + recent-runs table).
Sheriff/Legal/Admin features are untouched and render inside the new shell. Build/tsc/44-tests all green;
verified visually via headless screenshots. Details in `memory.md` → "UI foundation — shadcn/ui".
**Then (same branch) the whole app was re-themed to a dark "Industrial Precision" look** — deep black + teal
frames/active/links + metallic-yellow CTAs + Inter + 3% noise grain; `class="dark"` on `<html>`, palette in the
`.dark` block of `src/web/index.css`; legacy Sheriff/Legal/Admin/map/dialog pages migrated to dark tokens; the
INSTANT wordmark is centered in the top bar (sidebar shows the compact mark). Verified via headless screenshots
(dashboard, Admin, Sheriff). See `memory.md` → "UI foundation" + lessons.md 2026-06-03 for the dark-theme gotchas.

**First next step: review + merge `ui/shadcn-foundation` into `main` and deploy** (prod still serves the OLD UI:
`npm run build` then `npx wrangler deploy`). Also decide what to do with the untracked shadcn-skill artifacts
(`.agents/`, `.claude/`, `skills-lock.json`) — gitignore or commit. Then optionally verify Legal/Admin pages live
+ the collapsed-sidebar icon, and de-dupe the breadcrumb-vs-PageHeader title.

## Where we are — production is live
The IRES CRM is **live in production** at **https://crm.instantrealestatesolution.com** — Convex prod
`pastel-crocodile-994`, Cloudflare Workers project `instant-real-estate-solution-crm`, Clerk **production**
instance (invite-only). Sign in as `nazhossain16@gmail.com` (the seeded owner/admin). Dev runs on
`fearless-donkey-585` (Clerk dev `optimal-frog-32`); `IRES_DEV` is removed (dev secured). All work is merged to
`main` and pushed; 44 tests pass; build clean.

This session shipped: the Cloudflare build fix (committed `convex/_generated` + a root `wrangler.jsonc`),
**Clerk auth** (dev + prod), a full **admin user-management** feature (invite-only `users` table; Admin page with
invite / role / deactivate / delete synced to Clerk via its Backend API), and the **production cutover**.
Geocoding on prod works (53 sheriff pins). Full deployment + key reference is in `memory/memory.md` →
"Deployments & keys".

## Next — post-launch punch list
1. **Finish the Google Maps key rotation** (the user started it). ONE domain-restricted key serves both jobs:
   new key → Cloudflare `VITE_GOOGLE_MAPS_API_KEY` (redeploy) **and** Convex `GOOGLE_GEOCODING_API_KEY` on
   **prod + dev**. The key needs Maps JS + Geocoding + Street View Static APIs; website restrictions =
   `https://crm.instantrealestatesolution.com/*` + `http://localhost:5173/*`.
   Set Convex: `CONVEX_DEPLOY_KEY='prod:…' npx convex env set GOOGLE_GEOCODING_API_KEY <key>`.
2. **Rotate the other chat-shared keys** — Firecrawl, OpenRouter, Anthropic, Convex dev/prod deploy keys,
   Clerk dev/prod secret. Update `.env.local` + Convex env (both deployments) + Cloudflare as needed.
3. **Create a real `VITE_GOOGLE_MAPS_MAP_ID`** (Google Cloud → Map Management → vector Map ID) → Cloudflare env
   → redeploy. Removes the `DEMO_MAP_ID` "for development only" watermark on the map.
4. **Fix `backfillGeocodes` silent `catch{}`** (`convex/geocodeActions.ts`) — log + surface hard errors
   (REQUEST_DENIED / expired key) so a dead key shows an error instead of the button silently no-opping.
5. **E2E-test the invite flow on prod** — Admin → Invite a teammate → they accept on `/accept-invite` → land as
   a `member`. (Needs `CLERK_SECRET_KEY=sk_live` on Convex prod [set] + email sign-up ON + restricted mode [done].)
6. (Optional) **Backend-deploy-on-push** — switch the Cloudflare build cmd to `npx convex deploy --cmd 'npm run build'`
   + add `NODE_VERSION=22` (BlueRock's working Workers setup). Today the backend deploys manually via `npx convex deploy`.

Then pick from `memory/todo.md` (Kanban board, dashboard charts, AI deal analyst).

## Run / deploy
```bash
cd C:\Users\nazho\Desktop\ires-crm
npm install
npx convex dev        # terminal 1 — syncs functions to dev (fearless-donkey-585)
npm run dev           # terminal 2 — http://localhost:5173 (sign in via Clerk dev)
```
- **Frontend deploy:** `git push origin main` → Cloudflare Workers builds (`npm run build`) + `wrangler deploy` serves `./dist`.
- **Backend deploy (manual):** `CONVEX_DEPLOY_KEY='prod:pastel-crocodile-994|…' npx convex deploy` (key value in `.env.local`).
- **Geocode missing rows:** the "Geocode N missing" button on the map, or
  `CONVEX_DEPLOY_KEY='prod:…' npx convex run geocodeActions:backfillGeocodes '{"type":"sheriff"}'`.
- `npm test` (44). The Windows `UV_HANDLE_CLOSING` Convex-CLI assertion is cosmetic — trust the output.

## Gotchas (also in lessons.md)
- **`convex/_generated` + `wrangler.jsonc` are committed on purpose** (Cloudflare CI). `wrangler.jsonc` `name`
  MUST match the Workers project. Don't gitignore `_generated`.
- **One domain-restricted Google key** serves browser map + server geocoding (a Website restriction isn't
  enforced on the Geocoding web service). Geocoding broke this session only because the key value was *expired*.
- **Clerk:** restricted/invite-only sign-up, but "Sign-up with email" must stay ON (or invitations fail). First
  admin = dashboard Create-user. The `convex` JWT template (with the **email** claim) must exist on each instance.
- **`convex deploy --cmd` errors on Cloudflare Workers** ("non-production build environment") — we deploy the backend manually.
- After changing `convex/`, run `npx convex dev --once` (validates + regenerates `_generated`) THEN `npm run build`.
- Convex `"use node"` files = actions only; V8 queries/mutations in `*Data.ts`. Annotate action return types to avoid TS7023.
