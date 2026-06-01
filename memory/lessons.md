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

## Carried over from the original Python/n8n pipeline (still true)
- **Zillow:** scrape the search URL (`/homes/ADDRESS_rb/`) with markdown — Firecrawl renders the homedetails page. Validate `-DE-` is in the resulting URL to reject wrong-state matches. Homedetails URLs scraped directly return 403.
- **NCC parcel site:** needs Firecrawl **browser actions** (click/write/click) — bypasses Reblaze bot protection that blocks plain requests from non-local IPs.
- **Address cleaning** is essential: truncated zips, missing spaces, AKA suffixes, `ZIP_ONLY` fallback to the parcel's address.
- **Python launcher on this Windows machine is `py`** (not `python`/`python3`) — for any Python tooling.
