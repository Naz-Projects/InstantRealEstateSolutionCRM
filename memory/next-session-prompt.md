# Next Session — Start Here

_Handoff from the 2026-06-01 session. Read `memory/memory.md` + `memory/lessons.md` first._

## Where we are
The IRES CRM is built on the serverless stack (Convex + Clerk + TanStack + Cloudflare) and the backend is
**proven end-to-end on the real Convex dev deployment `fearless-donkey-585`**:
- Sheriff Sales + Legal Notices both scrape → write to Convex → fan-out enrich (parcel + Zillow) → live in the UI.
- Frontend (Dashboard, Sheriff Sales, Legal Notices, scrape buttons, deal pipeline) typechecks, builds, and
  serves locally against that live backend. 31 tests pass. ~17 commits.

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
