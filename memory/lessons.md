# Lessons Learned

Format: `[date] | what went wrong | rule to prevent it`. Review at every session start.

2026-06-01 | Spent a long detour evaluating and building the CRM on self-hosted **Twenty**, only to hit the wall that Twenty needs a 24/7 Docker server (WSL + admin + reboot + ongoing cost) — the opposite of the user's serverless model and unrunnable on their machine. | For this user, default to the **serverless stack (Convex/Clerk/TanStack/Cloudflare)**. Don't propose self-hosted server apps (Docker/VPS) for a CRM unless they explicitly say they want to run a server. Surface the hosting requirement (server vs serverless) BEFORE building.

2026-06-01 | Convex **circular type inference**: action handlers that reference sibling functions in the same file (via `internal.*`, `ctx.runAction`, scheduled fan-out) failed with `TS7022/TS7023` ("implicitly has type any"). | Add an **explicit return-type annotation** (`: Promise<...>`) to every Convex action handler that calls other functions. Define a small result type and annotate.

2026-06-01 | Tried to put queries/mutations and a `"use node"` action in the same Convex file → push failed. | A `"use node"` file can ONLY contain actions. **Split**: V8 queries/mutations in `xData.ts`, `"use node"` actions in `xActions.ts`.

2026-06-01 | `convex dev` refused to push: "Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was not set" — even though it was in a dead conditional branch. | Convex **statically requires every env var referenced in `auth.config.ts`** to exist. Set it (a dummy locally, e.g. `https://dev.clerk.accounts.dev`) so dev pushes before Clerk is wired.

2026-06-01 | Assumed a live backend test was impossible without Docker/cloud login. It wasn't. | **Convex runs locally with NO account/Docker/admin** via `CONVEX_AGENT_MODE=anonymous npx convex dev` (downloads a user-space backend binary). Use it for offline end-to-end testing. (Later switched to the user's real dev deploy key via `CONVEX_DEPLOY_KEY` in `.env.local`.)

2026-06-01 | The sale-period label (`saleMonth`) was derived from `new Date()`, so a scheduled run before the county posts the new PDF would mislabel last month's data and the idempotency guard would lock the month as "done". | **Derive period labels from the source document**, not `now`. The sheriff PDF carries `Gross List MM/DD/YYYY`; parse it. Idempotency keys must come from the real data.

2026-06-01 | A helper that built object fields widened enum literals (e.g. `FieldType.TEXT` → `FieldType`), breaking a discriminated-union schema type. | When an object must match a **discriminated union**, build it inline (or annotate) so the literal `type` is preserved; don't pass it through a generic helper that widens.

2026-06-01 | Node 24 + Convex CLI on Windows prints `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and exits non-zero. | It's a **cosmetic teardown crash** that fires AFTER the command's real output. Trust the captured output, not the exit code, for `convex` CLI calls here.

2026-06-01 | A `git commit` with a PowerShell here-string broke when the message contained `->`, quotes, and parens (parsed as separate pathspecs). | On Windows PowerShell, use **simple single-line `-m` commit messages**; avoid here-strings with shell-special characters.

2026-06-01 | The scrape run was created AFTER fetch+parse, so a fetch failure or an idempotency skip recorded nothing and the UI button silently did nothing; worse, a mid-run throw left the run `status:"running"` forever, which permanently locks the `startScrape` concurrency guard. | **Create the run first (phase "starting") and always finalize it in try/catch** (`finishRun` complete/failed). Record skips as a visible event. A run must never be left "running" or the button locks.

2026-06-01 | Passing a Convex mutation call directly as an `onEvent` callback typed `(e) => void | Promise<void>` failed `TS2345`: `ctx.runMutation(...)` returns `Promise<Id>`, not `Promise<void>`. | When a Convex mutation/action is used as a void-returning callback, **wrap it**: `async (e) => { await ctx.runMutation(...); }`. Don't return the mutation promise directly.

2026-06-01 | Integrating a shadcn component (`stepper.tsx`) into this non-shadcn Tailwind-v4 project. The vendor's "install these deps" list (Button, radix-ui, lucide-react, cva) was mostly wrong — `stepper.tsx` imports ONLY `cn`. | **Check the component's actual imports, don't trust the dep list.** It usually needs only `cn` (`clsx` + `tailwind-merge`). Setup = add `@/`→`src` alias (vite `resolve.alias` + tsconfig `paths`), create `src/lib/utils.ts` + `src/components/ui/`, and add the shadcn semantic tokens (`--color-primary` etc.) to the `@theme` block in `index.css` WITHOUT clobbering existing tokens. In Tailwind v4 an undefined token's class simply isn't generated — **no build error**, just no style, so missing tokens degrade gracefully.

2026-06-01 | `convex dev --once` runs `tsc` on the convex/ functions and refuses to push/regenerate `_generated` types on a type error — and the frontend `tsc` then reads stale generated types for any newly added/renamed Convex function. | After adding/changing Convex functions, **run `npx convex dev --once` first** (it validates convex/ AND regenerates `_generated`), then run the frontend `npm run build`. Don't run the frontend typecheck expecting new Convex API symbols before the codegen.

2026-06-01 | ~30% of parcel rows came back `SCRAPE FAILED` at scale. Root cause: NCC's Reblaze bot protection returns a **block page with HTTP 200** (not an HTTP error), so `firecrawlScrape`'s built-in HTTP retry never fires; `lookupParcel` then threw on the content check with no retry. | For sites with bot protection, **retry at the operation level, not just the HTTP level**: wrap the whole browser-action sequence in `withRetry` and retry when the *content* check fails (block page), since a re-attempt usually clears Reblaze. Also throttle peak concurrency (bigger scheduler stagger) — `runAfter(i*ms)` staggers starts but they still overlap, so volume still trips rate limits.

2026-06-01 | Sheriff-sale "cushion" math is sale-type-dependent and easy to get backwards. | **TAX (monition) sale:** the foreclosing `principal` ≈ the delinquent county/school/sewer taxes, so cost ≈ principal — do NOT also add the balances (double-count). **MTG (Lev Fac)/JUDG sale:** principal is the loan and the taxes are SEPARATE senior liens, so cost ≈ principal + balances; watch for a surviving senior mortgage if principal is tiny vs. value. Logic lives in `src/scraper/deal.ts` (`computeDeal`), unit-tested, and runs server-side in `sheriffData.monthListings`. (Delaware Code: taxes are paid from sale proceeds by priority; sheriff says bidder must research title per property — not legal advice.)

## Carried over from the original Python/n8n pipeline (still true)
- **Zillow:** scrape the search URL (`/homes/ADDRESS_rb/`) with markdown — Firecrawl renders the homedetails page. Validate `-DE-` is in the resulting URL to reject wrong-state matches. Homedetails URLs scraped directly return 403.
- **NCC parcel site:** needs Firecrawl **browser actions** (click/write/click) — bypasses Reblaze bot protection that blocks plain requests from non-local IPs.
- **Address cleaning** is essential: truncated zips, missing spaces, AKA suffixes, `ZIP_ONLY` fallback to the parcel's address.
- **Python launcher on this Windows machine is `py`** (not `python`/`python3`) — for any Python tooling.
