# Monitor Phase 3 — Triage UI + 5-Second Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/monitor` from a wall of cards into a per-user triage inbox (New / Shortlist / Passed / All, a dense table, a deal side sheet, keyboard flow) and turn the nightly digest into a 5-second brief that deep-links straight into that sheet.

**Architecture:** All formatting, labels, the verdict cell, flag humanizing, triage state transitions, tab/filter/sort and keyboard mapping live in small pure `.ts` modules with vitest tests written first. Two of them (`src/scraper/monitorPresent.ts`, `src/scraper/monitorDigest.ts`) are shared by the page and the Convex digest, so the page and the email always say the same thing. Per-user state lives in two new small tables (`monitorTriage`, `monitorSeen`). New Convex functions go into the existing `convex/monitorData.ts` module, so `api.d.ts` needs no regen. The page reads a slim projection (`board`) and the sheet reads the full document by id (`listingForMe`).

**Tech Stack:** Vite + React 19 + TanStack Router (SPA), Convex (queries/mutations/actions), Clerk, Tailwind v4, shadcn/ui (`radix-nova` style, `base: radix`), lucide-react, Vitest (`environment: "node"`, `tests/**/*.test.ts` only).

**Spec:** the user-approved Phase 3 critique spec, carried verbatim in the orchestrator brief for this plan and summarized in `memory/todo.md` ("Phase 3 — triage UI"). The critique doc is "IRES Monitor Critique" (https://claude.ai/code/artifact/2e98e25e-8c30-4f05-b30e-6b7981216cce). Spec items are quoted where a task implements them. Prior plan (field meanings): `docs/superpowers/plans/2026-10-04-monitor-phase1-2-deal-quality.md`.

## Global Constraints

- Work ONLY in `C:\Users\nazho\Desktop\ires-crm\.claude\worktrees\monitor-critique` (branch `feat/monitor-critique`). Run `git branch --show-current` before every commit and confirm `feat/monitor-critique`. Never touch the main checkout.
- Another agent may be editing this branch at the same time. Locate edit points by the quoted content anchors in each task, never by line numbers. Stage explicit paths only (`git add <path> ...`), never `git add -A` / `git add .` (repo has untracked `.agents/`, `.claude/skills/`, `skills-lock.json`).
- Icons: `lucide-react` only. NEVER emojis or decorative glyphs, anywhere (UI copy, code, comments, commits, email).
- Use the installed shadcn components (`src/components/ui/*`: badge, button, dropdown-menu, kbd, select, sheet, skeleton, table, tooltip, ...). Task 7 adds `tabs`, `toggle-group`, `empty` via the CLI. `className` is for layout, not for recoloring a shadcn component; use `gap-*` not `space-*`; `size-*` for squares; icons inside `Button` take `data-icon="inline-start"` and no size class.
- Primary CTA = yellow `Button` default variant (`btn-metal-yellow`). Exactly one yellow button per view: **Promote** in the deal sheet. Everything else is `outline` / `ghost`.
- Confirmations use `src/web/ConfirmDialog.tsx`, never `window.confirm`. Do NOT open `ConfirmDialog` from inside the Radix Sheet (the modal sheet blocks outside pointer events); in-sheet choices use a Radix `DropdownMenu`.
- Every public Convex query/mutation calls `requireUser(ctx)` (or `requireAdmin` where stated). Per-user rows are keyed by the Clerk subject that `requireUser` returns.
- Every scraped URL rendered as `href` or `src` goes through `safeHref()` (accepts only `http://` / `https://`) — security finding S25-3.
- Every value interpolated into the digest HTML goes through `esc()`.
- Labels must never claim "spread vs ARV". The spread basis is the Zestimate when one exists, else the as-is value (`spreadBasisLabel`).
- Pure helpers (formatting, labels, verdict cell, flag humanizing, triage reducer, tab/filter/sort, keyboard mapping, digest builder) are TDD: failing test first, then code. Tests live in `tests/*.test.ts` (node env; no component tests are possible).
- Convex codegen/validation ONLY via PowerShell: `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`. Never plain `npx convex dev` / `npx convex codegen` / `npx convex deploy` (they push to the shared deployment). On a fresh anonymous backend, if the push fails with "CLERK_JWT_ISSUER_DOMAIN ... not set": `$env:CONVEX_AGENT_MODE='anonymous'; npx convex env set CLERK_JWT_ISSUER_DOMAIN https://example.clerk.accounts.dev` once, then retry. If codegen's only diff in `convex/_generated/*` is LF/CRLF churn, revert it (`git checkout -- convex/_generated`); commit `_generated` only when it has real content changes.
- Every task ends green on all of: `npx vitest run`, `npx tsc --noEmit`, `npx tsc --noEmit -p convex`. UI tasks (7, 8, 9) also `npm run build`.
- Edit files with the editor tool, not shell heredocs/sed.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV
  ```

## Review Focus

1. **Old or partial rows** (pre-Phase-2 keepers: no `roomVsList`, no `dscr`, no `zestimate`, no photo; `redFlags` holding raw slugs like `sparse_photos` or `zipTier: city-high-risk`) — every cell must read `—` or a plain label, never `NaN`, `$NaN`, `undefined` or a slug. Pinned by Task 1 "verdict falls back to —", "humanizes key: value slugs", and `numberGroups` "omits empty groups".
2. **Keyboard shortcuts firing where they should not** — typing in the ZIP Select, an open pass menu, Ctrl+S / Cmd+K, Enter on a focused button, or behind the Run-now confirm. Expect no board action. Also P on a row that shows Restore instead of a pass menu must do nothing; it must never leave the keys locked. Pinned by Task 3 `boardKeyAction` tests and the Task 7 handler gate (P only where a `PassMenu` renders; no blanket early return).
3. **The selected row disappears after P or S** (it moves to another tab) — selection must land on the row that slid into the same slot, clamp at the end, and become -1 on an empty list. Pinned by Task 3 `clampIndex` tests.
4. **Hostile or odd digest data** — an address containing `<script>`, a `javascript:` photo URL, a photo URL with a quote, a row with no photo. Expect escaped text, no `<img>` for a non-http URL, and a card that still renders. Pinned by Task 6 XSS tests.
5. **A deep link to a bad id** (`/monitor?id=garbage`, an id from another table, or an archived/non-keeper listing) — the sheet must show "This deal is no longer available" for garbage and still open archived listings, never throw. `listingForMe` uses `normalizeId`; pinned by the Task 9 harness capture with `?id=not-a-real-id`.

Also covered by tests even though they are not top-5: snooze expiry returns a row to New (Task 2, Task 3); a stale `running` scan row older than 30 min does not lock Run now forever (Task 2).

## Resolved spec ambiguities (decisions this plan makes)

- **"Run now (existing)" does not exist.** There is no public scan trigger today: `devMonitorScan` is `IRES_DEV`-gated and internal, and `runMonitorScan`'s `manual` trigger bypasses both the 20h cron guard and the 10-min webhook guard. Task 5 adds an **admin-only** `requestScan` mutation with its own guard (refuse while a run is `running` and under 30 min old, or when any run started under 10 min ago), behind a `ConfirmDialog` that names the Firecrawl/LLM cost, as an outline button. Task 5 is self-contained and can be dropped without touching the others; if dropped, the header shows no Run button.
- **Where per-user state lives: two new tables, not fields on `monitorListings`.** `monitorListings` is one shared team row per listing. The scan pipeline patches it (`patchAnalysis`, `regateKeepers`), so user fields there would race with those writes. Per-user fields would need a map keyed by user, which Convex cannot index. And every triage keystroke would rewrite a large document. `monitorTriage` (one row per user and listing the user acted on, index `by_user_listing`) and `monitorSeen` (one row per user) are tiny, indexed, and invisible to the pipeline. Users are keyed by the Clerk subject (`requireUser`'s return value), the same identity `triggeredBy` uses elsewhere.
- **Triage states are mutually exclusive:** new, shortlisted, passed (with reason), snoozed (7 days). Snooze hides a row from New until `snoozedUntil`; snoozed rows show in All with a "Snoozed" label. Restore clears all state. S toggles shortlist.
- **"New" tab = untriaged keepers** (not passed, not shortlisted, not actively snoozed). "N new since you looked" = untriaged keepers whose `firstSeen` is after the user's previous `lastSeenAt`. A first visit (no `lastSeenAt`) counts all of them. On page load the previous `lastSeenAt` is captured once for the session, then `markSeen` stamps now, so the "new" dots stay put until the next visit.
- **Bandwidth and DB reads (06-08 free-tier quota lesson):** Convex bills the documents a query READS, not only what it returns, and a query re-runs whenever anything it read changes. So the board is TWO queries:
  - `board` reads only `monitorListings` (keepers) and returns a slim projection (table fields + first photo). It re-runs only when listings change, which is nightly.
  - `boardState` reads only the caller's tiny `monitorTriage` rows (prefix scan on `by_user_listing`) plus `monitorSeen`. It is the only query a P/S keystroke or `markSeen` invalidates.

  The page merges the two client-side. The sheet reads the full document through `listingForMe`. `monitorTriage` rows accumulate per user (about 100 bytes each, a few per night); that is fine for years. Prune if it ever passes about 5k rows per user.
- **Deep link:** `/monitor?id=<listingId>`. The sheet's open state IS the `id` search param: opening a row pushes `?id=`, Esc/close removes it. Sign-in is a modal over `/monitor` (`main.tsx` `SignInGate` renders in place, `SignInButton mode="modal"`), so `?id=` survives sign-in.
- **The verdict cell's deciding number per exit:** FLIP = offer gap (`roomVsList` = NCC max offer minus list), signed and colored by sign, caption "max offer $X". RENTAL = monthly cash flow, signed and colored, caption "DSCR 1.31". WHOLESALE = spread (`spread` = basis minus list), signed and colored, caption "vs Zestimate" or "vs as-is value". PASS or missing = `—`.
- **"Verify before you bid" is a static list** (icon + text), not checkboxes. Checkboxes that reset when the sheet closes would mislead.
- **Exit hues (one per exit):** FLIP teal, RENTAL sky, WHOLESALE violet, PASS neutral. RENTAL moves off emerald because emerald now means a positive number.
- **Email reason line:** the first sentence of `aiReason`, cut to 55 characters with an ellipsis. At 390px the card's content column is about 330px, about 50 characters of 13px text, so 55 characters is one line or just over it.
- **Email card height:** the spec says "~200px per card at 390px". With a 72px thumb row, the 3-cell number table, a reason, a flag and a 40px button, the honest floor is about 250-290px. This plan targets **at most 300px** and keeps every spec element. Task 9 checks against 300, not 200. To get closer to 200, drop the flag pill or the thumbnail; that is the user's call.
- **Card content dropped by the rewrite** (the spec does not ask for it; the orchestrator or user can object):
  - On the board and in the email, the rewrite drops:
    - the Fixer / Distressed / Below-market requirement chips
    - the condition tier chip and value-add scope
    - motivation signals and points
    - last-sold / price-history line and $/sqft-vs-comps line
    - era-hazard chips (they now surface only as humanized red flags when the judge lists them)
    - `aiConditionNotes`
    - the "N% below" spread chip
    - the separate "All new (non-keepers)" toggle (`listRecent` stays in `monitorData.ts`, unused by the page)
  - The sheet keeps:
    - `aiReason`, `breakdown` and the analyst note
    - the owner signal
    - all numbers
    - Promote and the Flip analyzer link
- **Email flags:** at most 1, from `displayFlags` (judge `redFlags` first, then pipeline `riskFlags`), humanized. The analyst line appears only when `exitTriage` disagrees with `bestExit` AND `dealScore >= 50`.
- **No PRODUCT.md / DESIGN.md exist.** `impeccable context` reported an existing visual system ("Industrial Precision": deep black, teal frames, metallic yellow CTA). This plan EXTENDS that system (Operate mode); it does not invent a new world. Offer `/impeccable init` to the user afterwards.

## Design Direction (binding — implementers do not improvise)

Mode: **Operate.** The user is an investor triaging 5-50 deals at night. Scan speed and one obvious next action beat decoration.

**Page frame**
- No `<h1>`. The app header breadcrumb already shows "Monitor" with its icon (`src/components/app-header.tsx` + `activeNavItem`). The page starts with a **status strip**: `flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6`, `text-sm text-muted-foreground`. Left: `Last scan Oct 3, 10:17 PM` + separator dot + **`12 new since you looked`** in `text-foreground font-medium` (or `Nothing new since you looked`). A failed last run appends `· last scan failed` in `text-amber-400`. Right: admin-only `Button variant="outline" size="sm"` with `<RefreshCw data-icon="inline-start" />Run now`.
- **Toolbar** under the strip: `flex flex-col gap-3 px-4 pt-4 md:flex-row md:items-center md:justify-between md:px-6`.
  - Left: shadcn `Tabs` > `TabsList` with 4 `TabsTrigger`s: `New 12`, `Shortlist 3`, `Passed 8`, `All 49`. The count is a `<span className="tabular-nums text-muted-foreground">`. The list scrolls horizontally on a narrow phone (`overflow-x-auto`).
  - Right: `ToggleGroup type="multiple" variant="outline" size="sm"` with Flip / Rental / Wholesale (empty = all exits), `Select` ZIP (`All ZIPs` + sorted ZIPs, trigger `size="sm" className="w-32"`), `Select` sort (`Offer gap`, `Cash flow`, `Score`, `Newest`; trigger `size="sm" className="w-36"`). These wrap to their own row on a phone.
- **Board region:** `px-0 pb-8 pt-3 md:px-6`. On desktop it is a table in a quiet container (`overflow-hidden rounded-xl border border-border bg-card`), NOT the teal-framed Card (that frame is for dashboard widgets; on a 50-row list it is noise).

**Desktop table (md and up), shadcn `Table`**
- No zebra. Rows are `h-14`, with row separation from the Table's default bottom borders (one divider per row). Hover `hover:bg-muted/40`. The keyboard-selected row gets `bg-accent` (teal 16%) plus a 2px teal inset left edge: `shadow-[inset_2px_0_0_var(--color-teal)]`, `aria-selected="true"`.
- Header cells `h-9 text-xs font-medium uppercase tracking-wide text-muted-foreground`.
- Columns, in order:
  1. Photo, `w-16`: a 48x36 `rounded-md object-cover bg-muted`, or an `ImageOff` icon box when missing or failed.
  2. Score, `w-28`: score `text-base font-semibold tabular-nums text-foreground` plus `ExitBadge`.
  3. Address, flexible: line 1 `font-medium truncate` with a leading 6px teal dot (`size-1.5 rounded-full bg-teal-glow`, `<span className="sr-only">New</span>`) when new since looked, plus an `Eye` icon `text-red-400` with `title` when an owner signal exists. Line 2 `text-xs text-muted-foreground truncate`: `Wilmington 19801 · 2 bd · 1 ba · 850 sqft`.
  4. List, right-aligned `tabular-nums`, `w-28`.
  5. Verdict, right-aligned, `w-40`: line 1 is the value, `font-semibold tabular-nums`, emerald-400 when positive, red-400 when negative, foreground when neutral. Line 2 is the caption `text-xs text-muted-foreground`.
  6. Actions, `w-32` right: ghost `icon-sm` buttons — Shortlist (`Star`, filled when shortlisted, `aria-pressed`), Pass (`X`, opens the pass-reason `DropdownMenu`; in the Passed tab it becomes Restore `RotateCcw`), Open (`ChevronRight`). Action clicks `stopPropagation`.
- Under the table, desktop only: a hint row `text-xs text-muted-foreground` with `Kbd`: `J` `K` move · `Enter` open · `S` shortlist · `P` pass · `Esc` close.

**Phone (below md): edge-to-edge list, no horizontal scroll**
- `ul` with `divide-y divide-border`, no side padding on the list. Each row is a full-width `button` (`flex w-full gap-3 px-4 py-3 text-left`): a 64px square thumb (`size-16 rounded-md object-cover`) plus a `min-w-0 flex-1 flex flex-col gap-0.5` column:
  - Line 1: address `text-sm font-medium truncate` (with the new dot).
  - Line 2: `ExitBadge` · score · `List $99,900`, `text-xs tabular-nums text-muted-foreground`.
  - Line 3: verdict value (colored, `font-semibold`) + caption, `text-xs tabular-nums`.
- No row actions on the phone list; triage happens in the sheet.

**Deal sheet (shadcn `Sheet`, side right)**
- `SheetContent` override: `className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"`. The variant prefix is required, because the base classes `w-3/4` and `sm:max-w-sm` live under `data-[side=right]:`.
- Structure is a full-height flex column:
  - **Header** (`SheetHeader className="border-b border-border pr-12"`): `ExitBadge` + score row, then `SheetTitle` = address, then `SheetDescription` = `City ZIP · 3 bd · 1 ba · 1,200 sqft · built 1920`.
  - **Scroll body** `flex-1 overflow-y-auto p-4 flex flex-col gap-6`:
    - Photo strip: `flex gap-2 overflow-x-auto snap-x`, images `h-40 w-60 shrink-0 snap-start rounded-lg object-cover`, first 10 photos, all through `safeHref`.
    - Numbers: one `section` per group (Value, Flip, Rental). Each has a group label `text-xs font-medium uppercase tracking-wide text-muted-foreground` and a `dl` grid `grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3`. Each cell: `dt text-xs text-muted-foreground`, `dd text-sm font-semibold tabular-nums` (toned by sign where the cell has a tone). Value = List, As-is value, ARV, Rehab. Flip = Max offer, Offer gap, Margin. Rental = Rent, Cap rate, Cash flow, DSCR, BRRRR cash left in. A group with no data is omitted.
    - **Verify before you bid**: heading with `ShieldCheck` `text-amber-400`, then a list of `verifyGates` (humanized), each `flex gap-2 text-sm` with a `CircleDashed` icon `text-amber-400`.
    - **Red flags**: heading with `TriangleAlert` `text-amber-400`, then humanized `displayFlags` as `text-sm` rows.
    - **Owner signal**, only when present: `Eye` `text-red-400` + "Owner: tax lien, delinquent balances $4,120".
    - **Analyst note**: `aiReason` as `text-sm text-foreground`, then `breakdown` as `text-sm leading-relaxed text-muted-foreground`, then `analystNote` as `text-xs text-muted-foreground` when present.
    - **Agent**: `Phone` icon + name + a `tel:` link. Zillow: `ExternalLink` link (only when `safeHref` passes), `target="_blank" rel="noopener noreferrer"`.
  - **Footer** (`SheetFooter className="flex-row flex-wrap border-t border-border"`), in order:
    - Promote: yellow default `Button` with `ClipboardPlus`, "Promote". When already promoted it is an outline `Link` to `/potential` with `ClipboardCheck`, "In pipeline".
    - Shortlist: outline `Star` / "Shortlisted".
    - Pass: outline `DropdownMenu` trigger `X` "Pass", with items Bad area / ARV is wrong / Rehab too heavy / Overpriced / Other. When passed it becomes Restore, with the reason shown in the header ("Passed: Overpriced").
    - Snooze: ghost `AlarmClock` "Snooze 7 days". When snoozed it shows "Snoozed to Oct 11" + Restore.
    - Flip analyzer: ghost `Calculator` link to `/flip` (existing handoff).
- Loading: `Skeleton` blocks shaped like the header and number grid. Not found: centered "This deal is no longer available."

**States**
- Loading: 8 skeleton table rows (thumb 48x36, two text bars, two right-aligned bars). On phone, 6 skeleton list rows.
- Empty: shadcn `Empty` with `EmptyMedia variant="icon"` + `Radar`.
  - New: title "Nothing new tonight — the filters are working." (spec copy, verbatim), description "New keepers land here after the 8 PM scan."
  - Shortlist: "No shortlisted deals" / "Press S on a row to save it here."
  - Passed: "Nothing passed yet."
  - All: "No keepers on the board."
  - Filters exclude everything: "No deals match these filters" + an outline `Button` "Clear filters".
- Errors from mutations: a single inline `text-xs text-amber-400` line under the toolbar (`role="status"`), with text from `describeError(e).message`.

**Email (light ground, Outlook-safe tables, all inline CSS)**
- Palette: ink `#17191A`, body `#4A5156`, muted `#5F666B`, line `#E3E6E6`, wash `#F6F7F7`, teal `#1F7A66` (white on it is about 5.3:1), positive `#1E7B46`, negative `#B42318`. FLIP pill `#E3F2EE`/`#1F7A66`, RENTAL pill `#E6EEFB`/`#1E4FA3`, flag `#FFF4E5`/`#8A4B00`. Never white text on amber. Never `#2D9C84` as a text or button color.
- Card (target at most 300px tall at 390px; see Resolved ambiguities on the spec's ~200px):
  - Header table: left cell = exit pill + `Score 90` + address (16px bold); right cell 96px = thumb `width="96" height="72"`, omitted when there is no safe photo.
  - A fixed 3-cell number table on the wash background (FLIP: List / Max offer / Gap; RENTAL: List / Cash flow / DSCR). Each cell has an 11px uppercase label over a 15px bold value; the gap and cash-flow values are toned.
  - One reason line (13px body).
  - At most 1 flag pill.
  - Optional analyst line.
  - A bulletproof table-cell button "Review deal" on `#1F7A66` linking to `/monitor?id=<id>`.
- Header: eyebrow "IRES MONITOR" (teal), title "N worth a look", sub "New Castle County · Oct 3". Footer: "N more on the board" linking to `/monitor` (or "Open the board" when N is 0), then "IRES CRM · automated nightly scan".

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/scraper/monitorPresent.ts` (new) | Shared page+email presentation: `money`, `signedMoney`, `pct1`, `toneOf`, `normalizeExit`, `exitLabel`, `spreadBasisLabel`, `verdictFor`, `humanizeFlag`, `displayFlags`, `safeHref`, `oneLineReason`, `analystNote`, `ownerSignal`, `numberGroups` | 1 |
| `src/scraper/monitorTriage.ts` (new) | Per-user triage rules: `PASS_REASONS`, `applyTriage`, `triageStatus`, `SNOOZE_MS`; scan guard `scanBlockedReason` | 2 |
| `src/web/lib/monitorBoard.ts` (new) | Board logic: `inTab`, `tabCounts`, `filterRows`, `sortRows`, `zipOptions`, `isNewSince`, `newSinceCount`, `clampIndex`, `nextIndex`, `boardKeyAction` | 3 |
| `src/scraper/monitorDigest.ts` (new) | Digest builder (`esc`, `dealLink`, `digestCells`, `buildDigest`) shared by `sendDigest` | 6 |
| `convex/schema.ts` | + `monitorTriage`, `monitorSeen` tables | 4 |
| `convex/monitorData.ts` | + `board`, `listingForMe` (replaces unused `getListing`), `setTriage`, `markSeen`, `requestScan`, `activeKeeperCount` | 4, 5, 6 |
| `convex/monitorActions.ts` | `sendDigest` uses `buildDigest` from `monitorDigest.ts`; old inline digest helpers removed | 6 |
| `src/web/app.tsx` | `monitorRoute.validateSearch` (`id`) | 7 |
| `src/components/ui/tabs.tsx`, `toggle-group.tsx`, `toggle.tsx`, `empty.tsx` (CLI-added) | shadcn primitives | 7 |
| `src/web/MonitorPage.tsx` (rewrite) | Page: status strip, toolbar, board, keyboard, sheet host | 7, 8 |
| `src/web/monitor/ExitBadge.tsx` (new) | One hue per exit badge | 7 |
| `src/web/monitor/BoardTable.tsx` (new) | Desktop table + phone list + skeletons | 7 |
| `src/web/monitor/PassMenu.tsx` (new) | Controlled pass-reason dropdown | 7 |
| `src/web/monitor/DealSheet.tsx` (new) | Side sheet (full listing, actions, promote) | 8 |
| tests: `tests/monitorPresent.test.ts`, `tests/monitorTriage.test.ts`, `tests/monitorBoard.test.ts`, `tests/monitorDigest.test.ts` (all new) | | 1, 2, 3, 6 |

Task order: 1 → 2 → 3 → 4 → 5 (droppable) → 6 → 7 → 8 → 9. Tasks 1-3 have no dependencies on Convex. Task 6 needs only Task 1. Tasks 7-8 need 1-4.

---

### Task 1: Shared presenter (`monitorPresent.ts`)

**Files:**
- Create: `src/scraper/monitorPresent.ts`
- Test: `tests/monitorPresent.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact):
  - `type Exit = "FLIP" | "RENTAL" | "WHOLESALE" | "PASS"`; `type Tone = "pos" | "neg" | "neutral"`
  - `interface PresentRow { bestExit?, listPrice?, flipMao?, roomVsList?, flipMargin?, cashFlow?, dscr?, capRate?, spread?, zestimate?, asIsValue?, conservativeArv?, rehabEstimate?, rentZestimate?, leaseRent?, brrrrCashLeftIn?, dealScore?, exitTriage?, aiReason?, redFlags?, riskFlags?, offMarketSignals?, offMarketBalances?, offMarketConditionScore? }` (numbers `number | null`, strings `string | null`, arrays `string[] | null`, all optional)
  - `MINUS = "\u2212"`
  - `money(n): string`, `signedMoney(n: number): string`, `pct1(fraction): string`, `toneOf(n): Tone`
  - `normalizeExit(s): Exit | null`, `exitLabel(s): string`
  - `spreadBasisLabel(r): "Zestimate" | "as-is value"`
  - `interface Verdict { value: string; caption: string; tone: Tone; sortKey: number | null }`; `verdictFor(r): Verdict`
  - `humanizeFlag(raw: string): string`, `displayFlags(r): string[]`
  - `safeHref(u): string | undefined`
  - `oneLineReason(s, max = 55): string`
  - `analystNote(r): string | null`
  - `ownerSignal(r): string | null`
  - `interface NumberCell { label: string; value: string; tone: Tone }`, `interface NumberGroup { title: "Value" | "Flip" | "Rental"; cells: NumberCell[] }`, `numberGroups(r): NumberGroup[]`

- [ ] **Step 1: Write the failing test**

Create `tests/monitorPresent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MINUS, money, signedMoney, pct1, toneOf, normalizeExit, exitLabel, spreadBasisLabel,
  verdictFor, humanizeFlag, displayFlags, safeHref, oneLineReason, analystNote, ownerSignal, numberGroups,
} from "../src/scraper/monitorPresent";

describe("money / signedMoney / pct1 / toneOf", () => {
  it("formats whole dollars and a dash for missing", () => {
    expect(money(99900)).toBe("$99,900");
    expect(money(99900.6)).toBe("$99,901");
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(NaN)).toBe("—");
  });
  it("signs with + and a true minus sign", () => {
    expect(signedMoney(5371)).toBe("+$5,371");
    expect(signedMoney(-14543)).toBe(`${MINUS}$14,543`);
    expect(signedMoney(0.4)).toBe("$0");
  });
  it("pct1 renders a fraction as a one-decimal percent", () => {
    expect(pct1(0.1234)).toBe("12.3%");
    expect(pct1(null)).toBe("—");
  });
  it("toneOf maps sign", () => {
    expect(toneOf(5)).toBe("pos");
    expect(toneOf(-5)).toBe("neg");
    expect(toneOf(0)).toBe("neutral");
    expect(toneOf(null)).toBe("neutral");
  });
});

describe("exits", () => {
  it("normalizeExit uppercases known exits and rejects others", () => {
    expect(normalizeExit("flip")).toBe("FLIP");
    expect(normalizeExit("RENTAL")).toBe("RENTAL");
    expect(normalizeExit("WHOLETAIL")).toBeNull();
    expect(normalizeExit(undefined)).toBeNull();
  });
  it("exitLabel title-cases any exit word", () => {
    expect(exitLabel("WHOLETAIL")).toBe("Wholetail");
    expect(exitLabel("FLIP")).toBe("Flip");
  });
  it("spread basis is the Zestimate only when one is present and positive", () => {
    expect(spreadBasisLabel({ zestimate: 250000 })).toBe("Zestimate");
    expect(spreadBasisLabel({ zestimate: 0 })).toBe("as-is value");
    expect(spreadBasisLabel({})).toBe("as-is value");
  });
});

describe("verdictFor", () => {
  it("FLIP: offer gap = max offer minus list, colored by sign", () => {
    expect(verdictFor({ bestExit: "FLIP", roomVsList: 5371, flipMao: 105271 })).toEqual({
      value: "+$5,371", caption: "max offer $105,271", tone: "pos", sortKey: 5371,
    });
    expect(verdictFor({ bestExit: "FLIP", roomVsList: -14543, flipMao: 422957 }).tone).toBe("neg");
  });
  it("RENTAL: monthly cash flow + DSCR", () => {
    expect(verdictFor({ bestExit: "RENTAL", cashFlow: 477, dscr: 1.314 })).toEqual({
      value: "+$477/mo", caption: "DSCR 1.31", tone: "pos", sortKey: 477,
    });
    expect(verdictFor({ bestExit: "RENTAL", cashFlow: 120 }).caption).toBe("DSCR —");
  });
  it("WHOLESALE: spread labeled by its real basis, never ARV", () => {
    expect(verdictFor({ bestExit: "WHOLESALE", spread: 40000, zestimate: 240000 })).toEqual({
      value: "+$40,000", caption: "vs Zestimate", tone: "pos", sortKey: 40000,
    });
    expect(verdictFor({ bestExit: "WHOLESALE", spread: 30000 }).caption).toBe("vs as-is value");
  });
  it("verdict falls back to — for PASS or missing numbers (old rows)", () => {
    const empty = { value: "—", caption: "", tone: "neutral", sortKey: null };
    expect(verdictFor({ bestExit: "PASS" })).toEqual(empty);
    expect(verdictFor({ bestExit: "FLIP" })).toEqual(empty);
    expect(verdictFor({})).toEqual(empty);
  });
});

describe("humanizeFlag / displayFlags", () => {
  it("maps bare slugs to plain labels", () => {
    expect(humanizeFlag("sparse_photos")).toBe("Few listing photos");
    expect(humanizeFlag("lead_paint_pre1978")).toBe("Lead paint era (pre-1978)");
    expect(humanizeFlag("heavy-rehab")).toBe("Heavy rehab");
  });
  it("humanizes key: value slugs (zipTier / photoSignal)", () => {
    expect(humanizeFlag("zipTier: city-high-risk")).toBe("Wilmington city ZIP (higher risk)");
    expect(humanizeFlag("photoSignal: sparse_photos")).toBe("Few listing photos");
  });
  it("cleans pipeline flags", () => {
    expect(humanizeFlag("detail-missing (VERIFY)")).toBe("Listing details missing");
    expect(humanizeFlag("tax rate estimated 1.6% (VERIFY)")).toBe("Tax rate estimated 1.6%");
    expect(humanizeFlag("LEASED at $1,450/mo")).toBe("Leased at $1,450/mo");
    expect(humanizeFlag("HIGH-HOA $300/mo")).toBe("High HOA $300/mo");
  });
  it("turns unknown slugs into words and leaves free text alone (first letter capped)", () => {
    expect(humanizeFlag("foundation_crack_risk")).toBe("Foundation crack risk");
    expect(humanizeFlag("stop-work order on file")).toBe("Stop-work order on file");
  });
  it("displayFlags: judge flags first, then pipeline flags, humanized and de-duplicated", () => {
    expect(displayFlags({ redFlags: ["sparse_photos", "Stop-work order"], riskFlags: ["heavy-rehab", "photoSignal: sparse_photos"] }))
      .toEqual(["Few listing photos", "Stop-work order", "Heavy rehab"]);
    expect(displayFlags({})).toEqual([]);
  });
});

describe("safeHref", () => {
  it("accepts only http(s)", () => {
    expect(safeHref("https://www.zillow.com/x")).toBe("https://www.zillow.com/x");
    expect(safeHref("  http://a.b/c ")).toBe("http://a.b/c");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
    expect(safeHref("//evil.com")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});

describe("oneLineReason / analystNote / ownerSignal", () => {
  it("keeps the first sentence and caps the length with an ellipsis", () => {
    expect(oneLineReason("Deep below-market fixer. Second sentence.")).toBe("Deep below-market fixer.");
    const long = "A".repeat(120);
    expect(oneLineReason(long)).toBe("A".repeat(54) + "…");
    expect(oneLineReason(long, 90)).toBe("A".repeat(89) + "…");
    expect(oneLineReason(null)).toBe("");
  });
  it("analyst note only when it disagrees with bestExit and score >= 50", () => {
    expect(analystNote({ bestExit: "FLIP", exitTriage: "WHOLETAIL", dealScore: 72 })).toBe("Analyst leans Wholetail");
    expect(analystNote({ bestExit: "FLIP", exitTriage: "WHOLETAIL", dealScore: 40 })).toBeNull();
    expect(analystNote({ bestExit: "FLIP", exitTriage: "FLIP", dealScore: 90 })).toBeNull();
    expect(analystNote({ bestExit: "FLIP", dealScore: 90 })).toBeNull();
  });
  it("owner signal only from real distress data", () => {
    expect(ownerSignal({ offMarketSignals: ["tax_lien", "code_case"] })).toBe("Tax lien, Code case");
    expect(ownerSignal({ offMarketBalances: 4120 })).toBe("Delinquent balances $4,120");
    expect(ownerSignal({ offMarketConditionScore: 38 })).toBe("Condition score 38");
    expect(ownerSignal({})).toBeNull();
  });
});

describe("numberGroups", () => {
  it("builds Value / Flip / Rental groups with tones", () => {
    const g = numberGroups({
      listPrice: 99900, asIsValue: 180000, conservativeArv: 215657, rehabEstimate: 42000,
      flipMao: 105271, roomVsList: 5371, flipMargin: 0.2,
      rentZestimate: 1500, capRate: 0.107, cashFlow: 477, dscr: 1.31, brrrrCashLeftIn: -12000,
    });
    expect(g.map((x) => x.title)).toEqual(["Value", "Flip", "Rental"]);
    expect(g[0].cells.map((c) => c.label)).toEqual(["List", "As-is value", "ARV", "Rehab"]);
    expect(g[1].cells).toEqual([
      { label: "Max offer", value: "$105,271", tone: "neutral" },
      { label: "Offer gap", value: "+$5,371", tone: "pos" },
      { label: "Margin", value: "20.0%", tone: "neutral" },
    ]);
    expect(g[2].cells.map((c) => c.value)).toEqual(["$1,500/mo", "10.7%", "+$477/mo", "1.31", "$12,000 out"]);
  });
  it("rent shows the binding lease when it is lower than the Zestimate rent", () => {
    const g = numberGroups({ listPrice: 100000, capRate: 0.07, rentZestimate: 1600, leaseRent: 1250, cashFlow: 10, dscr: 1.2 });
    expect(g.find((x) => x.title === "Rental")!.cells[0]).toEqual({ label: "Rent (lease)", value: "$1,250/mo", tone: "neutral" });
  });
  it("omits empty groups (old rows)", () => {
    expect(numberGroups({ listPrice: 100000 }).map((x) => x.title)).toEqual(["Value"]);
    expect(numberGroups({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monitorPresent.test.ts`
Expected: FAIL — "Failed to resolve import ../src/scraper/monitorPresent".

- [ ] **Step 3: Write minimal implementation**

Create `src/scraper/monitorPresent.ts`:

```ts
// Shared, pure presentation rules for the /monitor board AND the nightly digest
// email, so the page and the email always say the same thing. No React, no Convex.
// Spec: docs/superpowers/plans/2026-10-04-monitor-phase3-triage-ui.md (Design Direction).

export type Exit = "FLIP" | "RENTAL" | "WHOLESALE" | "PASS";
export type Tone = "pos" | "neg" | "neutral";

type N = number | null;
type S = string | null;
export interface PresentRow {
  bestExit?: S; listPrice?: N; flipMao?: N; roomVsList?: N; flipMargin?: N;
  cashFlow?: N; dscr?: N; capRate?: N; spread?: N; zestimate?: N; asIsValue?: N;
  conservativeArv?: N; rehabEstimate?: N; rentZestimate?: N; leaseRent?: N; brrrrCashLeftIn?: N;
  dealScore?: N; exitTriage?: S; aiReason?: S; redFlags?: string[] | null; riskFlags?: string[] | null;
  offMarketSignals?: string[] | null; offMarketBalances?: N; offMarketConditionScore?: N;
}

export const MINUS = "\u2212"; // typographic minus for signed money

const ok = (n: N | undefined): n is number => n != null && Number.isFinite(n);

export function money(n: N | undefined): string {
  return ok(n) ? `$${Math.round(n).toLocaleString("en-US")}` : "—";
}
export function signedMoney(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "$0";
  return `${r > 0 ? "+" : MINUS}$${Math.abs(r).toLocaleString("en-US")}`;
}
export function pct1(fraction: N | undefined): string {
  return ok(fraction) ? `${(fraction * 100).toFixed(1)}%` : "—";
}
export function toneOf(n: N | undefined): Tone {
  if (!ok(n) || Math.round(n) === 0) return "neutral";
  return n > 0 ? "pos" : "neg";
}

const EXITS: readonly Exit[] = ["FLIP", "RENTAL", "WHOLESALE", "PASS"];
export function normalizeExit(s: S | undefined): Exit | null {
  const u = (s ?? "").toUpperCase();
  return (EXITS as readonly string[]).includes(u) ? (u as Exit) : null;
}
export function exitLabel(s: string): string {
  const w = s.trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// The below-market spread basis (Phase 1): the Zestimate when present, else the
// comps as-is value. Never "ARV".
export function spreadBasisLabel(r: Pick<PresentRow, "zestimate">): "Zestimate" | "as-is value" {
  return ok(r.zestimate) && r.zestimate > 0 ? "Zestimate" : "as-is value";
}

export interface Verdict { value: string; caption: string; tone: Tone; sortKey: number | null }
const NO_VERDICT: Verdict = { value: "—", caption: "", tone: "neutral", sortKey: null };

// The ONE deciding number for the row's bestExit (the board's verdict cell).
export function verdictFor(r: PresentRow): Verdict {
  const exit = normalizeExit(r.bestExit);
  if (exit === "FLIP" && ok(r.roomVsList)) {
    return { value: signedMoney(r.roomVsList), caption: `max offer ${money(r.flipMao)}`, tone: toneOf(r.roomVsList), sortKey: r.roomVsList };
  }
  if (exit === "RENTAL" && ok(r.cashFlow)) {
    return { value: `${signedMoney(r.cashFlow)}/mo`, caption: `DSCR ${ok(r.dscr) ? r.dscr.toFixed(2) : "—"}`, tone: toneOf(r.cashFlow), sortKey: r.cashFlow };
  }
  if (exit === "WHOLESALE" && ok(r.spread)) {
    return { value: signedMoney(r.spread), caption: `vs ${spreadBasisLabel(r)}`, tone: toneOf(r.spread), sortKey: r.spread };
  }
  return NO_VERDICT;
}

// Raw slugs the judge echoes from its GIVEN dealSignals block, era hazards, and the
// pipeline's riskFlags -> plain labels. Unknown slugs become words; free text keeps
// its wording with the first letter capitalized.
const FLAG_LABELS: Record<string, string> = {
  sparse_photos: "Few listing photos",
  retail_staging: "Staged for retail buyers",
  "city-high-risk": "Wilmington city ZIP (higher risk)",
  "suburb-standard": "Standard suburban ZIP",
  "suburb-premium": "Premium suburban ZIP",
  lead_paint_pre1978: "Lead paint era (pre-1978)",
  asbestos_era_pre1980: "Asbestos era (pre-1980)",
  knob_tube_era_pre1940: "Knob and tube wiring era (pre-1940)",
  aluminum_wiring_era_1965_75: "Aluminum wiring era (1965-75)",
  polybutylene_era_1978_95: "Polybutylene plumbing era (1978-95)",
  oil_tank_risk_pre1975: "Possible buried oil tank (pre-1975)",
  long_tenure_equity: "Long-time owner with equity",
  recent_purchase_flag: "Bought recently",
  underwater: "Owner may be underwater",
  priced_below_appreciation: "Priced below expected appreciation",
  thin_margin_resale: "Thin resale margin",
  "heavy-rehab": "Heavy rehab",
  "non-financeable (cash)": "Cash buyers only",
  "detail-missing (VERIFY)": "Listing details missing",
  "sqft-missing (VERIFY)": "Square footage unknown",
  "comps>>Zestimate (ARV suspect)": "Comps far above Zestimate (ARV suspect)",
  "RENOVATED (no flip)": "Already renovated",
};
const KEY_PREFIX = /^(?:zipTier|photoSignal|eraHazards?|tenureSignal|vsAppreciation|domBucket)\s*[:=]\s*/i;
const REWRITES: Array<[RegExp, string]> = [
  [/^LEASED at /i, "Leased at "],
  [/^HIGH-HOA /i, "High HOA "],
  [/^MANUFACTURED\b.*$/i, "Manufactured home (comps suspect)"],
];
const SLUG = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function humanizeFlag(raw: string): string {
  const s = raw.trim().replace(KEY_PREFIX, "");
  if (FLAG_LABELS[s]) return FLAG_LABELS[s];
  for (const [re, to] of REWRITES) if (re.test(s)) return s.replace(re, to);
  const noVerify = s.replace(/\s*\(VERIFY\)$/i, "");
  if (SLUG.test(noVerify) && !/\s/.test(noVerify)) return cap(noVerify.replace(/[_-]+/g, " ").toLowerCase());
  return cap(noVerify);
}

// Judge red flags first (most specific), then pipeline flags; humanized, de-duplicated.
export function displayFlags(r: Pick<PresentRow, "redFlags" | "riskFlags">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of [...(r.redFlags ?? []), ...(r.riskFlags ?? [])]) {
    const h = humanizeFlag(f);
    const k = h.toLowerCase();
    if (h && !seen.has(k)) { seen.add(k); out.push(h); }
  }
  return out;
}

// Security S25-3: only http(s) URLs may become an href/src.
export function safeHref(u: string | null | undefined): string | undefined {
  if (typeof u !== "string") return undefined;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : undefined;
}

// ~50 chars of 13px text fit one line of the 390px email card (about 330px of content).
export function oneLineReason(s: string | null | undefined, max = 55): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  const first = t.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

// The LLM's exit read, only when it disagrees with the deterministic bestExit on a
// deal strong enough to matter (score >= 50).
export function analystNote(r: Pick<PresentRow, "bestExit" | "exitTriage" | "dealScore">): string | null {
  if (!r.exitTriage || !r.bestExit) return null;
  if (r.exitTriage.toUpperCase() === r.bestExit.toUpperCase()) return null;
  if (!ok(r.dealScore) || r.dealScore < 50) return null;
  return `Analyst leans ${exitLabel(r.exitTriage)}`;
}

// The off-market moat: only a real distress signal counts (a bare parcel match is not one).
export function ownerSignal(r: Pick<PresentRow, "offMarketSignals" | "offMarketBalances" | "offMarketConditionScore">): string | null {
  const sig = r.offMarketSignals ?? [];
  if (sig.length) return sig.map((s) => cap(s.replace(/[_-]+/g, " "))).join(", ");
  if (ok(r.offMarketBalances)) return `Delinquent balances ${money(r.offMarketBalances)}`;
  if (ok(r.offMarketConditionScore)) return `Condition score ${r.offMarketConditionScore}`;
  return null;
}

export interface NumberCell { label: string; value: string; tone: Tone }
export interface NumberGroup { title: "Value" | "Flip" | "Rental"; cells: NumberCell[] }
const cell = (label: string, value: string, tone: Tone = "neutral"): NumberCell => ({ label, value, tone });

// The deal sheet's numbers grid. A group is omitted when it has no data.
export function numberGroups(r: PresentRow): NumberGroup[] {
  const groups: NumberGroup[] = [];
  if ([r.listPrice, r.asIsValue, r.conservativeArv, r.rehabEstimate].some(ok)) {
    groups.push({ title: "Value", cells: [
      cell("List", money(r.listPrice)), cell("As-is value", money(r.asIsValue)),
      cell("ARV", money(r.conservativeArv)), cell("Rehab", money(r.rehabEstimate)),
    ] });
  }
  if (ok(r.flipMao)) {
    groups.push({ title: "Flip", cells: [
      cell("Max offer", money(r.flipMao)),
      cell("Offer gap", ok(r.roomVsList) ? signedMoney(r.roomVsList) : "—", toneOf(r.roomVsList)),
      cell("Margin", pct1(r.flipMargin)),
    ] });
  }
  if (ok(r.capRate)) {
    const leaseBinds = ok(r.leaseRent) && (!ok(r.rentZestimate) || r.leaseRent <= r.rentZestimate);
    const rent = leaseBinds ? r.leaseRent : r.rentZestimate;
    const b = r.brrrrCashLeftIn;
    groups.push({ title: "Rental", cells: [
      cell(leaseBinds ? "Rent (lease)" : "Rent", ok(rent) ? `${money(rent)}/mo` : "—"),
      cell("Cap rate", pct1(r.capRate)),
      cell("Cash flow", ok(r.cashFlow) ? `${signedMoney(r.cashFlow)}/mo` : "—", toneOf(r.cashFlow)),
      cell("DSCR", ok(r.dscr) ? r.dscr.toFixed(2) : "—"),
      cell("BRRRR cash left in", !ok(b) ? "—" : b < 0 ? `${money(-b)} out` : money(b)),
    ] });
  }
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/monitorPresent.test.ts`
Expected: PASS (all describe blocks). Then run the full gate: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex` — all green.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/monitor-critique
git add src/scraper/monitorPresent.ts tests/monitorPresent.test.ts
git commit -m "feat(monitor): shared presenter - verdict cell, humanized flags, safeHref, number groups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 2: Triage rules + scan guard (`monitorTriage.ts`)

**Files:**
- Create: `src/scraper/monitorTriage.ts`
- Test: `tests/monitorTriage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact):
  - `SNOOZE_MS = 7 * 24 * 60 * 60 * 1000`
  - `PASS_REASONS` (readonly array of `{ value, label }`), `type PassReason = "bad_area" | "arv_wrong" | "rehab_heavy" | "overpriced" | "other"`, `passReasonLabel(r): string`
  - `interface TriageState { passedAt?: number; passReason?: PassReason; shortlistedAt?: number; snoozedUntil?: number }`
  - `type TriageAction = { kind: "shortlist" } | { kind: "unshortlist" } | { kind: "pass"; reason: PassReason } | { kind: "snooze" } | { kind: "restore" }`
  - `applyTriage(a: TriageAction, now: number): TriageState` (returns ONLY the defined keys of the new state)
  - `type TriageStatus = "new" | "shortlist" | "passed" | "snoozed"`; `triageStatus(t, now): TriageStatus`
  - `SCAN_COOLDOWN_MS = 10 * 60 * 1000`, `STALE_RUNNING_MS = 30 * 60 * 1000`, `scanBlockedReason(recent: { status: string; startedAt: number } | null, now: number): string | null`

- [ ] **Step 1: Write the failing test**

Create `tests/monitorTriage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SNOOZE_MS, PASS_REASONS, passReasonLabel, applyTriage, triageStatus,
  scanBlockedReason, SCAN_COOLDOWN_MS, STALE_RUNNING_MS,
} from "../src/scraper/monitorTriage";

const NOW = 1_800_000_000_000;

describe("applyTriage", () => {
  it("states are mutually exclusive and carry only their own keys", () => {
    expect(applyTriage({ kind: "shortlist" }, NOW)).toEqual({ shortlistedAt: NOW });
    expect(applyTriage({ kind: "pass", reason: "overpriced" }, NOW)).toEqual({ passedAt: NOW, passReason: "overpriced" });
    expect(applyTriage({ kind: "snooze" }, NOW)).toEqual({ snoozedUntil: NOW + SNOOZE_MS });
    expect(applyTriage({ kind: "unshortlist" }, NOW)).toEqual({});
    expect(applyTriage({ kind: "restore" }, NOW)).toEqual({});
  });
  it("snooze is 7 days", () => {
    expect(SNOOZE_MS).toBe(604_800_000);
  });
});

describe("triageStatus", () => {
  it("no state = new", () => {
    expect(triageStatus(null, NOW)).toBe("new");
    expect(triageStatus({}, NOW)).toBe("new");
  });
  it("passed and shortlisted", () => {
    expect(triageStatus({ passedAt: 1, passReason: "other" }, NOW)).toBe("passed");
    expect(triageStatus({ shortlistedAt: 1 }, NOW)).toBe("shortlist");
  });
  it("an active snooze hides the row; an expired one returns it to new", () => {
    expect(triageStatus({ snoozedUntil: NOW + 1 }, NOW)).toBe("snoozed");
    expect(triageStatus({ snoozedUntil: NOW }, NOW)).toBe("new");
  });
});

describe("PASS_REASONS", () => {
  it("lists the five spec reasons in order with labels", () => {
    expect(PASS_REASONS.map((r) => r.label)).toEqual(["Bad area", "ARV is wrong", "Rehab too heavy", "Overpriced", "Other"]);
    expect(passReasonLabel("rehab_heavy")).toBe("Rehab too heavy");
  });
});

describe("scanBlockedReason", () => {
  it("allows a scan when there is no run or the last run is old and done", () => {
    expect(scanBlockedReason(null, NOW)).toBeNull();
    expect(scanBlockedReason({ status: "complete", startedAt: NOW - SCAN_COOLDOWN_MS - 1 }, NOW)).toBeNull();
  });
  it("blocks while a fresh run is running", () => {
    expect(scanBlockedReason({ status: "running", startedAt: NOW - 15 * 60 * 1000 }, NOW)).toBe("A scan is already running.");
  });
  it("a stale running row (killed action) does not lock the button forever", () => {
    expect(scanBlockedReason({ status: "running", startedAt: NOW - STALE_RUNNING_MS - 1 }, NOW)).toBeNull();
  });
  it("blocks any run that started under 10 minutes ago", () => {
    expect(scanBlockedReason({ status: "complete", startedAt: NOW - 60_000 }, NOW)).toBe("A scan started less than 10 minutes ago.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monitorTriage.test.ts`
Expected: FAIL — "Failed to resolve import ../src/scraper/monitorTriage".

- [ ] **Step 3: Write minimal implementation**

Create `src/scraper/monitorTriage.ts`:

```ts
// Per-user /monitor triage rules (pure; shared by convex/monitorData.ts and the page).
// States are mutually exclusive: new | shortlisted | passed(reason) | snoozed(7 days).

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// Keep in sync with the passReason union in convex/schema.ts + monitorData.setTriage.
export const PASS_REASONS = [
  { value: "bad_area", label: "Bad area" },
  { value: "arv_wrong", label: "ARV is wrong" },
  { value: "rehab_heavy", label: "Rehab too heavy" },
  { value: "overpriced", label: "Overpriced" },
  { value: "other", label: "Other" },
] as const;
export type PassReason = (typeof PASS_REASONS)[number]["value"];
export function passReasonLabel(r: PassReason | null | undefined): string {
  return PASS_REASONS.find((x) => x.value === r)?.label ?? "Passed";
}

export interface TriageState { passedAt?: number; passReason?: PassReason; shortlistedAt?: number; snoozedUntil?: number }
export type TriageAction =
  | { kind: "shortlist" } | { kind: "unshortlist" } | { kind: "pass"; reason: PassReason }
  | { kind: "snooze" } | { kind: "restore" };

// The full new state (only defined keys). The mutation writes every field, so keys
// absent here are cleared on the stored row.
export function applyTriage(a: TriageAction, now: number): TriageState {
  switch (a.kind) {
    case "shortlist": return { shortlistedAt: now };
    case "pass": return { passedAt: now, passReason: a.reason };
    case "snooze": return { snoozedUntil: now + SNOOZE_MS };
    case "unshortlist":
    case "restore": return {};
  }
}

export type TriageStatus = "new" | "shortlist" | "passed" | "snoozed";
export function triageStatus(t: TriageState | null | undefined, now: number): TriageStatus {
  if (t?.passedAt != null) return "passed";
  if (t?.shortlistedAt != null) return "shortlist";
  if (t?.snoozedUntil != null && t.snoozedUntil > now) return "snoozed";
  return "new";
}

// Run-now guard (admin requestScan). A `running` row older than 30 min is a killed
// action (lessons 2026-06-11), so it must not lock the button forever.
export const SCAN_COOLDOWN_MS = 10 * 60 * 1000;
export const STALE_RUNNING_MS = 30 * 60 * 1000;
export function scanBlockedReason(recent: { status: string; startedAt: number } | null, now: number): string | null {
  if (!recent) return null;
  const age = now - recent.startedAt;
  if (recent.status === "running" && age < STALE_RUNNING_MS) return "A scan is already running.";
  if (age < SCAN_COOLDOWN_MS) return "A scan started less than 10 minutes ago.";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/monitorTriage.test.ts`
Expected: PASS. Then the full gate (`npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex`) is green.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/scraper/monitorTriage.ts tests/monitorTriage.test.ts
git commit -m "feat(monitor): triage state rules (shortlist/pass/snooze) and run-now scan guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 3: Board logic (`monitorBoard.ts`)

**Files:**
- Create: `src/web/lib/monitorBoard.ts`
- Test: `tests/monitorBoard.test.ts`

**Interfaces:**
- Consumes: `triageStatus`, `TriageState` (Task 2); `verdictFor`, `normalizeExit`, `PresentRow` (Task 1).
- Produces (exact):
  - `type BoardTab = "new" | "shortlist" | "passed" | "all"`; `type SortKey = "gap" | "cashflow" | "score" | "newest"`; `type ExitFilter = "FLIP" | "RENTAL" | "WHOLESALE"`
  - `interface BoardRow extends PresentRow { _id: string; firstSeen: number; propZip?: string | null; triage?: TriageState | null }`
  - `inTab(r, tab, now): boolean`, `tabCounts(rows, now): Record<BoardTab, number>`
  - `filterRows<T extends BoardRow>(rows: T[], f: { exits: ExitFilter[]; zip: string | null }): T[]`
  - `sortRows<T extends BoardRow>(rows: T[], key: SortKey): T[]` (new array; nulls last; ties by dealScore desc then firstSeen desc)
  - `zipOptions(rows): string[]`
  - `isNewSince(r, lastSeenAt: number | null): boolean`, `newSinceCount(rows, lastSeenAt, now): number`
  - `clampIndex(i, len): number`, `nextIndex(i, dir: "down" | "up", len): number`
  - `type BoardKey = "down" | "up" | "pass" | "shortlist" | "open"`; `interface KeyLike { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown } | null }`; `boardKeyAction(e: KeyLike): BoardKey | null`
  - `SORT_LABELS: Record<SortKey, string>`

- [ ] **Step 1: Write the failing test**

Create `tests/monitorBoard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  inTab, tabCounts, filterRows, sortRows, zipOptions, isNewSince, newSinceCount,
  clampIndex, nextIndex, boardKeyAction, type BoardRow,
} from "../src/web/lib/monitorBoard";

const NOW = 1_800_000_000_000;
const row = (o: Partial<BoardRow> & { _id: string }): BoardRow => ({ firstSeen: NOW - 1000, ...o });

const A = row({ _id: "a", bestExit: "FLIP", roomVsList: 5000, dealScore: 90, propZip: "19801", firstSeen: NOW - 3000 });
const B = row({ _id: "b", bestExit: "RENTAL", cashFlow: 300, dealScore: 72, propZip: "19805", triage: { shortlistedAt: 1 } });
const C = row({ _id: "c", bestExit: "WHOLESALE", spread: 40000, dealScore: 40, propZip: "19801", triage: { passedAt: 1, passReason: "overpriced" } });
const D = row({ _id: "d", bestExit: "FLIP", roomVsList: -2000, dealScore: 75, propZip: "19711", triage: { snoozedUntil: NOW + 5 } });
const E = row({ _id: "e", bestExit: "RENTAL", cashFlow: 50, dealScore: 72, propZip: "19711", triage: { snoozedUntil: NOW - 5 }, firstSeen: NOW - 10 });
const ALL = [A, B, C, D, E];

describe("tabs", () => {
  it("New = untriaged, excluding active snoozes; expired snooze returns", () => {
    expect(ALL.filter((r) => inTab(r, "new", NOW)).map((r) => r._id)).toEqual(["a", "e"]);
  });
  it("Shortlist / Passed / All", () => {
    expect(ALL.filter((r) => inTab(r, "shortlist", NOW)).map((r) => r._id)).toEqual(["b"]);
    expect(ALL.filter((r) => inTab(r, "passed", NOW)).map((r) => r._id)).toEqual(["c"]);
    expect(ALL.filter((r) => inTab(r, "all", NOW))).toHaveLength(5);
  });
  it("tabCounts", () => {
    expect(tabCounts(ALL, NOW)).toEqual({ new: 2, shortlist: 1, passed: 1, all: 5 });
  });
});

describe("filterRows / zipOptions", () => {
  it("no exits selected = all exits; zip null = all zips", () => {
    expect(filterRows(ALL, { exits: [], zip: null })).toHaveLength(5);
  });
  it("filters by exit set and zip", () => {
    expect(filterRows(ALL, { exits: ["FLIP"], zip: null }).map((r) => r._id)).toEqual(["a", "d"]);
    expect(filterRows(ALL, { exits: ["FLIP", "WHOLESALE"], zip: "19801" }).map((r) => r._id)).toEqual(["a", "c"]);
  });
  it("zipOptions: sorted unique non-empty", () => {
    expect(zipOptions([...ALL, row({ _id: "z", propZip: "" }), row({ _id: "y" })])).toEqual(["19711", "19801", "19805"]);
  });
});

describe("sortRows", () => {
  it("gap: offer gap desc, rows without one last (ties by score, then newest)", () => {
    expect(sortRows(ALL, "gap").map((r) => r._id)).toEqual(["a", "d", "e", "b", "c"]);
  });
  it("cashflow: desc, nulls last (ties by score)", () => {
    expect(sortRows(ALL, "cashflow").map((r) => r._id)).toEqual(["b", "e", "a", "d", "c"]);
  });
  it("score: desc, ties by newest firstSeen", () => {
    expect(sortRows(ALL, "score").map((r) => r._id)).toEqual(["a", "d", "e", "b", "c"]);
  });
  it("newest: firstSeen desc", () => {
    expect(sortRows(ALL, "newest")[0]._id).toBe("e");
  });
  it("does not mutate its input", () => {
    const copy = [...ALL];
    sortRows(ALL, "score");
    expect(ALL).toEqual(copy);
  });
});

describe("new since you looked", () => {
  it("first visit (no lastSeenAt) counts every untriaged row", () => {
    expect(isNewSince(A, null)).toBe(true);
    expect(newSinceCount(ALL, null, NOW)).toBe(2);
  });
  it("only rows first seen after lastSeenAt, and only untriaged ones", () => {
    expect(isNewSince(A, NOW - 2000)).toBe(false);
    expect(newSinceCount(ALL, NOW - 2000, NOW)).toBe(1); // e only (b is shortlisted)
  });
});

describe("selection index", () => {
  it("clampIndex keeps the slot after a row leaves the list", () => {
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(4, 4)).toBe(3);
    expect(clampIndex(0, 0)).toBe(-1);
    expect(clampIndex(-1, 3)).toBe(-1);
  });
  it("nextIndex moves and clamps; first press selects row 0", () => {
    expect(nextIndex(-1, "down", 3)).toBe(0);
    expect(nextIndex(0, "down", 3)).toBe(1);
    expect(nextIndex(2, "down", 3)).toBe(2);
    expect(nextIndex(0, "up", 3)).toBe(0);
    expect(nextIndex(1, "up", 0)).toBe(-1);
  });
});

describe("boardKeyAction", () => {
  const body = { tagName: "BODY", closest: () => null };
  it("maps J/K/P/S/Enter", () => {
    expect(boardKeyAction({ key: "j", target: body })).toBe("down");
    expect(boardKeyAction({ key: "K", target: body })).toBe("up");
    expect(boardKeyAction({ key: "p", target: body })).toBe("pass");
    expect(boardKeyAction({ key: "s", target: body })).toBe("shortlist");
    expect(boardKeyAction({ key: "Enter", target: body })).toBe("open");
    expect(boardKeyAction({ key: "x", target: body })).toBeNull();
  });
  it("ignores modifier chords (Ctrl+S, Cmd+K)", () => {
    expect(boardKeyAction({ key: "s", ctrlKey: true, target: body })).toBeNull();
    expect(boardKeyAction({ key: "k", metaKey: true, target: body })).toBeNull();
    expect(boardKeyAction({ key: "j", altKey: true, target: body })).toBeNull();
  });
  it("ignores typing targets and open menus/listboxes", () => {
    expect(boardKeyAction({ key: "j", target: { tagName: "INPUT" } })).toBeNull();
    expect(boardKeyAction({ key: "j", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(boardKeyAction({ key: "s", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    expect(boardKeyAction({ key: "j", target: { tagName: "DIV", closest: (s: string) => (s.includes("menu") ? {} : null) } })).toBeNull();
  });
  it("Enter on a focused button or link is left to the browser", () => {
    expect(boardKeyAction({ key: "Enter", target: { tagName: "BUTTON", closest: () => null } })).toBeNull();
    expect(boardKeyAction({ key: "Enter", target: { tagName: "A", closest: () => null } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monitorBoard.test.ts`
Expected: FAIL — "Failed to resolve import ../src/web/lib/monitorBoard".

- [ ] **Step 3: Write minimal implementation**

Create `src/web/lib/monitorBoard.ts`:

```ts
// /monitor board logic (pure): tabs, filters, sort, "new since you looked",
// selection index and keyboard mapping. The page is a thin shell over these.
import { triageStatus, type TriageState } from "../../scraper/monitorTriage";
import { normalizeExit, type PresentRow } from "../../scraper/monitorPresent";

export type BoardTab = "new" | "shortlist" | "passed" | "all";
export type SortKey = "gap" | "cashflow" | "score" | "newest";
export type ExitFilter = "FLIP" | "RENTAL" | "WHOLESALE";
export const SORT_LABELS: Record<SortKey, string> = { gap: "Offer gap", cashflow: "Cash flow", score: "Score", newest: "Newest" };

export interface BoardRow extends PresentRow {
  _id: string;
  firstSeen: number;
  propZip?: string | null;
  triage?: TriageState | null;
}

export function inTab(r: BoardRow, tab: BoardTab, now: number): boolean {
  return tab === "all" || triageStatus(r.triage, now) === tab;
}
export function tabCounts(rows: BoardRow[], now: number): Record<BoardTab, number> {
  const c: Record<BoardTab, number> = { new: 0, shortlist: 0, passed: 0, all: rows.length };
  for (const r of rows) {
    const s = triageStatus(r.triage, now);
    if (s !== "snoozed") c[s]++;
  }
  return c;
}

export function filterRows<T extends BoardRow>(rows: T[], f: { exits: ExitFilter[]; zip: string | null }): T[] {
  return rows.filter((r) => {
    if (f.exits.length && !f.exits.includes(normalizeExit(r.bestExit) as ExitFilter)) return false;
    if (f.zip && r.propZip !== f.zip) return false;
    return true;
  });
}

const KEY: Record<SortKey, (r: BoardRow) => number | null | undefined> = {
  gap: (r) => r.roomVsList,
  cashflow: (r) => r.cashFlow,
  score: (r) => r.dealScore,
  newest: (r) => r.firstSeen,
};
export function sortRows<T extends BoardRow>(rows: T[], key: SortKey): T[] {
  const k = KEY[key];
  const v = (r: BoardRow) => { const x = k(r); return x == null || !Number.isFinite(x) ? null : x; };
  return [...rows].sort((a, b) => {
    const va = v(a), vb = v(b);
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    if (va != null && vb != null && va !== vb) return vb - va;
    const sa = a.dealScore ?? -Infinity, sb = b.dealScore ?? -Infinity;
    if (sa !== sb) return sb - sa;
    return b.firstSeen - a.firstSeen;
  });
}

export function zipOptions(rows: BoardRow[]): string[] {
  return [...new Set(rows.map((r) => r.propZip ?? "").filter(Boolean))].sort();
}

export function isNewSince(r: BoardRow, lastSeenAt: number | null): boolean {
  return lastSeenAt == null || r.firstSeen > lastSeenAt;
}
export function newSinceCount(rows: BoardRow[], lastSeenAt: number | null, now: number): number {
  return rows.filter((r) => triageStatus(r.triage, now) === "new" && isNewSince(r, lastSeenAt)).length;
}

export function clampIndex(i: number, len: number): number {
  if (len <= 0 || i < 0) return -1;
  return Math.min(i, len - 1);
}
export function nextIndex(i: number, dir: "down" | "up", len: number): number {
  if (len <= 0) return -1;
  if (i < 0) return 0;
  return dir === "down" ? Math.min(i + 1, len - 1) : Math.max(i - 1, 0);
}

export type BoardKey = "down" | "up" | "pass" | "shortlist" | "open";
export interface KeyLike {
  key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown } | null;
}
export function boardKeyAction(e: KeyLike): BoardKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const t = e.target;
  const tag = (t?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return null;
  if (t?.closest?.('[role="menu"],[role="listbox"],[role="alertdialog"]')) return null;
  switch (e.key) {
    case "j": case "J": return "down";
    case "k": case "K": return "up";
    case "p": case "P": return "pass";
    case "s": case "S": return "shortlist";
    case "Enter": return tag === "BUTTON" || tag === "A" ? null : "open";
    default: return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/monitorBoard.test.ts`
Expected: PASS. Full gate green.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add src/web/lib/monitorBoard.ts tests/monitorBoard.test.ts
git commit -m "feat(monitor): board logic - tabs, filters, sort, new-since-seen, keyboard mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 4: Per-user triage backend (schema + `board` / `listingForMe` / `setTriage` / `markSeen`)

**Files:**
- Modify: `convex/schema.ts` (append two tables after the `zipComps` table definition)
- Modify: `convex/monitorData.ts` (imports; replace `getListing`; append new functions at the end of the "browser-facing (requireUser-gated) reads for /monitor" section)

**Interfaces:**
- Consumes: `applyTriage`, `TriageState` (Task 2).
- Produces (exact, all in `api.monitorData`):
  - `board` query, args `{}` → `BoardProjection[]` where `BoardProjection` = `{ _id, address, propCity?, propZip?, beds?, baths?, sqft?, listPrice?, photo?: string, bestExit?, dealScore?, roomVsList?, flipMao?, flipMargin?, cashFlow?, dscr?, capRate?, spread?, zestimate?, firstSeen, promotedDealId?, hasOwnerSignal: boolean }` (reads ONLY `monitorListings`)
  - `boardState` query, args `{}` → `{ triage: Array<TriageState & { listingId: Id<"monitorListings"> }>; lastSeenAt: number | null }` (reads ONLY the caller's `monitorTriage` + `monitorSeen`)
  - `listingForMe` query, args `{ id: string }` → `{ listing: Doc<"monitorListings">; triage: TriageState | null } | null`
  - `setTriage` mutation, args `{ listingId: Id<"monitorListings">; action: "shortlist" | "unshortlist" | "pass" | "snooze" | "restore"; reason?: PassReason }` → `TriageState`
  - `markSeen` mutation, args `{}` → `number` (the stamped time)
  - The unused public `getListing` query is REMOVED (replaced by `listingForMe`).

No vitest here: Convex functions have no test harness in this repo (no `convex-test`). The rules they apply are already unit-tested (Task 2). Verification = codegen push + both typechecks.

- [ ] **Step 1: Confirm `getListing` is unused**

Run: `git grep -n "monitorData.getListing\b" -- src convex ':!convex/_generated'`
Expected: no output. If there is output, keep `getListing` and add `listingForMe` alongside it.

- [ ] **Step 2: Add the two tables to the schema**

In `convex/schema.ts`, find this anchor (the end of the `zipComps` table):

```ts
  zipComps: defineTable({
    zip: v.string(),
    comps: v.array(v.any()),
    fetchedAt: v.number(),
  }).index("by_zip", ["zip"]),
```

and insert directly after it:

```ts

  // Per-user /monitor triage (Phase 3). One row per (user, listing) the user acted on;
  // states are mutually exclusive (src/scraper/monitorTriage.ts). Kept OFF
  // monitorListings: that row is shared team-wide and patched by the scan pipeline.
  // userId = Clerk subject (requireUser's return).
  monitorTriage: defineTable({
    userId: v.string(),
    listingId: v.id("monitorListings"),
    passedAt: v.optional(v.number()),
    // keep in sync with PASS_REASONS in src/scraper/monitorTriage.ts
    passReason: v.optional(
      v.union(
        v.literal("bad_area"),
        v.literal("arv_wrong"),
        v.literal("rehab_heavy"),
        v.literal("overpriced"),
        v.literal("other"),
      ),
    ),
    shortlistedAt: v.optional(v.number()),
    snoozedUntil: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user_listing", ["userId", "listingId"]),

  // Per-user "new since you looked" watermark for /monitor.
  monitorSeen: defineTable({
    userId: v.string(),
    lastSeenAt: v.number(),
  }).index("by_user", ["userId"]),
```

- [ ] **Step 3: Add the functions to `convex/monitorData.ts`**

3a. Imports. Replace the anchor line

```ts
import { v } from "convex/values";
```

with

```ts
import { v, ConvexError } from "convex/values";
```

and replace the anchor line

```ts
import type { Doc } from "./_generated/dataModel";
```

with

```ts
import type { Doc, Id } from "./_generated/dataModel";
```

and after the anchor line

```ts
import { partitionDigestRows, evaluateDeal, dealInputFromStored, decisionFields } from "../src/scraper/monitorListings";
```

add

```ts
import { applyTriage, type TriageState } from "../src/scraper/monitorTriage";
```

3b. Delete the whole `getListing` export (anchor: the doc comment `/** One listing (the /monitor card drawer). */` through the closing `});` of `export const getListing = query({ ... });`).

3c. Insert the following directly ABOVE the anchor comment `/**\n * Public (requireUser-gated) counterpart to the internal \`setPromotedDeal\``. That is the `markPromoted` doc comment; locate it by the text "Public (requireUser-gated) counterpart to the internal".

```ts
// ---- Phase 3: per-user triage (board / sheet / triage writes) ----

const passReasonV = v.union(
  v.literal("bad_area"),
  v.literal("arv_wrong"),
  v.literal("rehab_heavy"),
  v.literal("overpriced"),
  v.literal("other"),
);
const BOARD_LIMIT = 300;

async function triageFor(ctx: QueryCtx | MutationCtx, userId: string, listingId: Id<"monitorListings">) {
  return await ctx.db
    .query("monitorTriage")
    .withIndex("by_user_listing", (q) => q.eq("userId", userId).eq("listingId", listingId))
    .unique();
}
function pickTriage(t: Doc<"monitorTriage"> | null): TriageState | null {
  if (!t) return null;
  return { passedAt: t.passedAt, passReason: t.passReason, shortlistedAt: t.shortlistedAt, snoozedUntil: t.snoozedUntil };
}

/**
 * The /monitor board: active keepers (best score first) as a SLIM projection.
 * Reads ONLY monitorListings, so a triage write or markSeen never re-runs it
 * (Convex bills documents read; 06-08 quota lesson). Per-user state comes from
 * boardState and is merged on the client. The sheet reads the full doc via listingForMe.
 */
export const board = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const keepers = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .order("desc")
      .take(BOARD_LIMIT);
    return keepers.map((r) => ({
      _id: r._id,
      address: r.address,
      propCity: r.propCity,
      propZip: r.propZip,
      beds: r.beds,
      baths: r.baths,
      sqft: r.sqft,
      listPrice: r.listPrice,
      photo: r.photoUrls?.[0],
      bestExit: r.bestExit,
      dealScore: r.dealScore,
      roomVsList: r.roomVsList,
      flipMao: r.flipMao,
      flipMargin: r.flipMargin,
      cashFlow: r.cashFlow,
      dscr: r.dscr,
      capRate: r.capRate,
      spread: r.spread,
      zestimate: r.zestimate,
      firstSeen: r.firstSeen,
      promotedDealId: r.promotedDealId,
      hasOwnerSignal:
        (r.offMarketSignals?.length ?? 0) > 0 || r.offMarketBalances != null || r.offMarketConditionScore != null,
    }));
  },
});

/**
 * The caller's per-user board state: every triage row (prefix scan on
 * by_user_listing; rows are ~100 bytes) plus the "last looked" watermark. This is
 * the only board query a P/S keystroke or markSeen invalidates.
 */
export const boardState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query("monitorTriage")
      .withIndex("by_user_listing", (q) => q.eq("userId", userId))
      .collect();
    const seen = await ctx.db
      .query("monitorSeen")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      triage: rows.map((t) => ({ listingId: t.listingId, ...pickTriage(t)! })),
      lastSeenAt: seen?.lastSeenAt ?? null,
    };
  },
});

/**
 * One listing + the caller's triage, for the deal sheet and the email deep link
 * (/monitor?id=...). Takes a plain string: a garbage or foreign id returns null
 * instead of throwing a validator error. Archived/non-keeper listings still open.
 */
export const listingForMe = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const lid = ctx.db.normalizeId("monitorListings", id);
    if (!lid) return null;
    const listing = await ctx.db.get(lid);
    if (!listing) return null;
    return { listing, triage: pickTriage(await triageFor(ctx, userId, lid)) };
  },
});

/** Shortlist / unshortlist / pass(reason) / snooze 7d / restore — for the caller only. */
export const setTriage = mutation({
  args: {
    listingId: v.id("monitorListings"),
    action: v.union(
      v.literal("shortlist"),
      v.literal("unshortlist"),
      v.literal("pass"),
      v.literal("snooze"),
      v.literal("restore"),
    ),
    reason: v.optional(passReasonV),
  },
  handler: async (ctx, { listingId, action, reason }): Promise<TriageState> => {
    const userId = await requireUser(ctx);
    if (!(await ctx.db.get(listingId))) {
      throw new ConvexError({ code: "NOT_FOUND", message: "That listing no longer exists." });
    }
    if (action === "pass" && !reason) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Pick a reason to pass." });
    }
    const now = Date.now();
    const next = applyTriage(action === "pass" ? { kind: "pass", reason: reason! } : { kind: action }, now);
    const existing = await triageFor(ctx, userId, listingId);
    if (existing) {
      // Write every field: keys absent from `next` become undefined = removed.
      await ctx.db.patch(existing._id, {
        passedAt: next.passedAt,
        passReason: next.passReason,
        shortlistedAt: next.shortlistedAt,
        snoozedUntil: next.snoozedUntil,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("monitorTriage", { userId, listingId, ...next, updatedAt: now });
    }
    return next;
  },
});

/** Stamp the caller's "last looked at the board" time (drives "N new since you looked"). */
export const markSeen = mutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const row = await ctx.db
      .query("monitorSeen")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { lastSeenAt: now });
    else await ctx.db.insert("monitorSeen", { userId, lastSeenAt: now });
    return now;
  },
});

```

Also change the anchor line `import type { QueryCtx } from "./_generated/server";` to `import type { QueryCtx, MutationCtx } from "./_generated/server";` (`triageFor` is called from both queries and mutations, matching `requireUser`'s `QueryCtx | MutationCtx` signature).

- [ ] **Step 4: Validate with the isolated backend + typecheck**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once`
Expected: "Convex functions ready" with no schema or type error. If it fails with "CLERK_JWT_ISSUER_DOMAIN ... not set", run `$env:CONVEX_AGENT_MODE='anonymous'; npx convex env set CLERK_JWT_ISSUER_DOMAIN https://example.clerk.accounts.dev` once and retry.

Then: `git status --short convex/_generated`. If the only diff is line-ending churn (`git diff --ignore-all-space --stat convex/_generated` shows nothing), run `git checkout -- convex/_generated`.

Then: `npx tsc --noEmit -p convex; npx tsc --noEmit; npx vitest run` — all green. (`tsc --noEmit` covers `src/`; the old `MonitorPage.tsx` does not reference `getListing`, so it still compiles.)

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add convex/schema.ts convex/monitorData.ts
git commit -m "feat(monitor): per-user triage tables + board/listingForMe/setTriage/markSeen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

(If Step 4 produced real `_generated` content changes, add `convex/_generated` explicitly to the same commit.)

---

### Task 5: Admin "Run now" (`requestScan`) — droppable

> Spec deviation: the spec calls Run now "existing"; it is not. This task adds it, admin-only, with a guard. If the orchestrator drops this task, Task 7 simply omits the button: `api.monitorData.requestScan` is used in exactly one place, the `RunNow` component, which is deleted together with this task (see the note at the end of Task 7 Step 5).

**Files:**
- Modify: `convex/monitorData.ts`

**Interfaces:**
- Consumes: `scanBlockedReason` (Task 2), `requireAdmin` (`convex/lib/getAuthUser.ts`), `internal.monitorActions.runMonitorScan` (existing internal action, args `{ trigger: "manual" }`).
- Produces: `api.monitorData.requestScan` mutation, args `{}` → `{ scheduled: true }`. Throws `ConvexError { code: "BUSY", message }` when blocked; `FORBIDDEN` for non-admins.

- [ ] **Step 1: Confirm the guard is already tested**

Run: `npx vitest run tests/monitorTriage.test.ts -t scanBlockedReason`
Expected: PASS (4 tests). The mutation only wires this rule; there is no Convex test harness.

- [ ] **Step 2: Add the mutation**

In `convex/monitorData.ts`:
- add `import { requireAdmin } from "./lib/getAuthUser";` after the `import { requireUser } from "./helpers";` anchor line;
- change the Task-4 import line `import { applyTriage, type TriageState } from "../src/scraper/monitorTriage";` to `import { applyTriage, scanBlockedReason, type TriageState } from "../src/scraper/monitorTriage";`;
- insert directly after the `markSeen` export (anchor: the closing `});` that follows `else await ctx.db.insert("monitorSeen", { userId, lastSeenAt: now });`):

```ts

/**
 * Admin "Run now" on /monitor: schedule one manual scan. `runMonitorScan`'s manual
 * trigger skips the cron/webhook guards, so this mutation guards itself (no fresh
 * running run, nothing started in the last 10 min). Costs Firecrawl + LLM credits,
 * so it is admin-only and the page confirms first.
 */
export const requestScan = mutation({
  args: {},
  // Explicit return type: references internal.monitorActions.* (circular-inference
  // cycle with monitorActions, lessons 2026-06-01).
  handler: async (ctx): Promise<{ scheduled: true }> => {
    await requireAdmin(ctx);
    const recent = await ctx.db.query("monitorRuns").withIndex("by_started").order("desc").first();
    const blocked = scanBlockedReason(recent, Date.now());
    if (blocked) throw new ConvexError({ code: "BUSY", message: blocked });
    await ctx.scheduler.runAfter(0, internal.monitorActions.runMonitorScan, { trigger: "manual" });
    return { scheduled: true };
  },
});
```

- [ ] **Step 3: Validate**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once` — expected clean push. Revert pure line-ending churn in `convex/_generated` as in Task 4. Then `npx tsc --noEmit -p convex; npx tsc --noEmit; npx vitest run` — green.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add convex/monitorData.ts
git commit -m "feat(monitor): admin requestScan (run now) with running/10-min guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 6: The 5-second digest (`monitorDigest.ts`) wired into `sendDigest`

**Files:**
- Create: `src/scraper/monitorDigest.ts`
- Test: `tests/monitorDigest.test.ts`
- Modify: `convex/monitorActions.ts` (remove the inline digest helpers; `sendDigest` calls the new builder)
- Modify: `convex/monitorData.ts` (add `activeKeeperCount` internal query)

**Interfaces:**
- Consumes: `money`, `signedMoney`, `toneOf`, `normalizeExit`, `displayFlags`, `oneLineReason`, `analystNote`, `safeHref`, `PresentRow`, `Tone` (Task 1).
- Produces (exact):
  - `esc(s: string): string`
  - `interface DigestRow extends PresentRow { _id: string; address: string; photoUrls?: string[] | null }`
  - `interface DigestOpts { baseUrl: string; moreOnBoard: number; date: string }`
  - `dealLink(baseUrl: string, id: string): string` → `<base>/monitor?id=<encoded id>`
  - `interface DigestCell { label: string; value: string; tone: Tone }`, `digestCells(r: PresentRow): DigestCell[]` (always 3)
  - `buildDigest(rows: DigestRow[], o: DigestOpts): { subject: string; text: string; html: string }`
  - `internal.monitorData.activeKeeperCount` query, args `{}` → `number`

- [ ] **Step 1: Write the failing test**

Create `tests/monitorDigest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { esc, dealLink, digestCells, buildDigest, type DigestRow } from "../src/scraper/monitorDigest";
import { MINUS } from "../src/scraper/monitorPresent";

const OPTS = { baseUrl: "https://crm.example.com/", moreOnBoard: 7, date: "Oct 3" };
const FLIP: DigestRow = {
  _id: "abc123", address: "319 E 13th St, Wilmington, DE 19801", bestExit: "FLIP", dealScore: 90,
  listPrice: 99900, flipMao: 105271, roomVsList: 5371, photoUrls: ["https://photos.zillowstatic.com/a.jpg"],
  aiReason: "Deep below-market fixer with a halted renovation. More detail here.",
  redFlags: ["sparse_photos", "zipTier: city-high-risk", "Stop-work order"],
  exitTriage: "WHOLETAIL",
};
const RENTAL: DigestRow = {
  _id: "def456", address: "1529 W 4th St, Wilmington, DE 19805", bestExit: "RENTAL", dealScore: 40,
  listPrice: 74900, cashFlow: 477, dscr: 1.314, exitTriage: "FLIP",
};

describe("esc / dealLink", () => {
  it("escapes html-significant characters including quotes", () => {
    expect(esc(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
  it("deep-links to the sheet and tolerates a trailing slash", () => {
    expect(dealLink("https://crm.example.com/", "abc123")).toBe("https://crm.example.com/monitor?id=abc123");
    expect(dealLink("https://crm.example.com", "a b")).toBe("https://crm.example.com/monitor?id=a%20b");
  });
});

describe("digestCells", () => {
  it("FLIP -> List / Max offer / Gap", () => {
    expect(digestCells(FLIP)).toEqual([
      { label: "List", value: "$99,900", tone: "neutral" },
      { label: "Max offer", value: "$105,271", tone: "neutral" },
      { label: "Gap", value: "+$5,371", tone: "pos" },
    ]);
  });
  it("RENTAL -> List / Cash flow / DSCR", () => {
    expect(digestCells(RENTAL).map((c) => c.value)).toEqual(["$74,900", "+$477/mo", "1.31"]);
  });
  it("negative gap is toned negative with a true minus", () => {
    expect(digestCells({ ...FLIP, roomVsList: -2000 })[2]).toEqual({ label: "Gap", value: `${MINUS}$2,000`, tone: "neg" });
  });
});

describe("buildDigest", () => {
  const d = buildDigest([FLIP, RENTAL], OPTS);

  it("subject mirrors the count", () => {
    expect(d.subject).toBe("IRES Monitor: 2 worth a look");
    expect(d.html).toContain("2 worth a look");
    expect(buildDigest([FLIP], OPTS).subject).toBe("IRES Monitor: 1 worth a look");
  });
  it("one Review deal CTA per card, deep-linked", () => {
    expect(d.html.match(/>Review deal</g)).toHaveLength(2);
    expect(d.html).toContain('href="https://crm.example.com/monitor?id=abc123"');
    expect(d.text).toContain("Review: https://crm.example.com/monitor?id=abc123");
  });
  it("small 96px side thumbnail, not a hero", () => {
    expect(d.html).toContain('width="96" height="72"');
    expect(d.html).not.toContain('width="560"');
  });
  it("one plain reason line (first sentence)", () => {
    expect(d.html).toContain("Deep below-market fixer with a halted renovation.");
    expect(d.html).not.toContain("More detail here");
  });
  it("at most one humanized flag; no raw slugs", () => {
    expect(d.html).toContain("Few listing photos");
    expect(d.html).not.toContain("Wilmington city ZIP");
    expect(d.html).not.toContain("sparse_photos");
    expect(d.html).not.toContain("zipTier");
  });
  it("analyst line only when it disagrees and score >= 50", () => {
    expect(d.html).toContain("Analyst leans Wholetail"); // FLIP card, score 90
    expect(d.html).not.toContain("Analyst leans Flip"); // RENTAL card, score 40
  });
  it("AA palette: darkened teal, no old teal, no white-on-amber", () => {
    expect(d.html).toContain("#1F7A66");
    expect(d.html).not.toMatch(/#2D9C84/i);
    expect(d.html).not.toMatch(/#B7791F/i);
  });
  it("footer counts the rest of the board", () => {
    expect(d.html).toContain("7 more on the board");
    expect(d.text).toContain("7 more on the board");
    expect(buildDigest([FLIP], { ...OPTS, moreOnBoard: 0 }).html).toContain("Open the board");
  });
  it("never claims a spread vs ARV", () => {
    expect(d.html).not.toMatch(/vs ARV/i);
  });
});

describe("buildDigest XSS + odd data", () => {
  it("escapes a hostile address and reason", () => {
    const evil: DigestRow = { ...FLIP, address: `<script>alert(1)</script>`, aiReason: `<img src=x onerror=alert(1)>.` };
    const { html } = buildDigest([evil], OPTS);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
  });
  it("drops a javascript: photo and escapes a quote-bearing photo URL", () => {
    expect(buildDigest([{ ...FLIP, photoUrls: ["javascript:alert(1)"] }], OPTS).html).not.toContain("<img");
    const q = buildDigest([{ ...FLIP, photoUrls: [`https://x.com/a.jpg" onerror="alert(1)`] }], OPTS).html;
    expect(q).not.toContain(`" onerror="`);
    expect(q).toContain("&quot; onerror=&quot;");
  });
  it("a card with no photo, no reason and no flags still renders its numbers and CTA", () => {
    const bare: DigestRow = { _id: "z", address: "1 Main St", bestExit: "FLIP", listPrice: 100000, flipMao: 90000, roomVsList: -10000 };
    const { html } = buildDigest([bare], OPTS);
    expect(html).not.toContain("<img");
    expect(html).toContain("Max offer");
    expect(html).toContain(">Review deal<");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/monitorDigest.test.ts`
Expected: FAIL — "Failed to resolve import ../src/scraper/monitorDigest".

- [ ] **Step 3: Write minimal implementation**

Create `src/scraper/monitorDigest.ts`:

```ts
// The nightly digest as a 5-second brief (pure; called by convex/monitorActions.ts
// sendDigest). Light ground, Outlook-safe tables, all CSS inline (Gmail strips
// <style>). Every interpolated value goes through esc(); every URL through safeHref.
import {
  money, signedMoney, toneOf, normalizeExit, displayFlags, oneLineReason, analystNote, safeHref,
  type PresentRow, type Tone,
} from "./monitorPresent";

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface DigestRow extends PresentRow { _id: string; address: string; photoUrls?: string[] | null }
export interface DigestOpts { baseUrl: string; moreOnBoard: number; date: string }
export interface DigestCell { label: string; value: string; tone: Tone }

// AA on white: ink 17:1, body 8:1, muted 5.9:1, teal 5.3:1 (and white-on-teal 5.3:1),
// pos 5.4:1, neg 6.5:1.
const C = {
  ink: "#17191A", body: "#4A5156", muted: "#5F666B", line: "#E3E6E6", wash: "#F6F7F7",
  teal: "#1F7A66", pos: "#1E7B46", neg: "#B42318", flagBg: "#FFF4E5", flagFg: "#8A4B00",
} as const;
const PILL: Record<string, { bg: string; fg: string }> = {
  FLIP: { bg: "#E3F2EE", fg: "#1F7A66" },
  RENTAL: { bg: "#E6EEFB", fg: "#1E4FA3" },
};
const toneColor = (t: Tone) => (t === "pos" ? C.pos : t === "neg" ? C.neg : C.ink);
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const base = (u: string) => u.replace(/\/+$/, "");

export function dealLink(baseUrl: string, id: string): string {
  return `${base(baseUrl)}/monitor?id=${encodeURIComponent(id)}`;
}

export function digestCells(r: PresentRow): DigestCell[] {
  const list: DigestCell = { label: "List", value: money(r.listPrice), tone: "neutral" };
  if (normalizeExit(r.bestExit) === "RENTAL") {
    return [
      list,
      { label: "Cash flow", value: r.cashFlow != null ? `${signedMoney(r.cashFlow)}/mo` : "—", tone: toneOf(r.cashFlow) },
      { label: "DSCR", value: r.dscr != null ? r.dscr.toFixed(2) : "—", tone: "neutral" },
    ];
  }
  return [
    list,
    { label: "Max offer", value: money(r.flipMao), tone: "neutral" },
    { label: "Gap", value: r.roomVsList != null ? signedMoney(r.roomVsList) : "—", tone: toneOf(r.roomVsList) },
  ];
}

const TABLE = `role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`;

function cardHtml(r: DigestRow, o: DigestOpts): string {
  const exit = normalizeExit(r.bestExit) ?? "FLIP";
  const pill = PILL[exit] ?? PILL.FLIP;
  const score = r.dealScore != null ? `<span style="color:${C.body};font-size:12px;font-weight:600;">&nbsp;Score ${esc(String(r.dealScore))}</span>` : "";
  const photo = safeHref(r.photoUrls?.[0]);
  const thumb = photo
    ? `<td width="96" valign="top" style="width:96px;"><img src="${esc(photo)}" width="96" height="72" alt="" style="display:block;width:96px;height:72px;border:0;border-radius:6px;object-fit:cover;"></td>`
    : "";
  const cells = digestCells(r)
    .map((c) => `<td width="33%" valign="top" style="padding:8px 10px;"><div style="font-size:11px;line-height:14px;color:${C.muted};text-transform:uppercase;letter-spacing:0.5px;">${esc(c.label)}</div><div style="font-size:15px;line-height:20px;font-weight:700;color:${toneColor(c.tone)};">${esc(c.value)}</div></td>`)
    .join("");
  const reason = oneLineReason(r.aiReason);
  const flag = displayFlags(r)[0];
  const note = analystNote(r);
  const link = dealLink(o.baseUrl, r._id);
  return `<table ${TABLE} style="background:#ffffff;border:1px solid ${C.line};border-radius:10px;border-collapse:separate;margin:0 0 12px;">
<tr><td style="padding:16px;">
  <table ${TABLE}><tr>
    <td valign="top" style="padding:0 12px 0 0;">
      <div style="margin:0 0 6px;"><span style="display:inline-block;background:${pill.bg};color:${pill.fg};font-size:11px;font-weight:700;letter-spacing:0.5px;padding:3px 8px;border-radius:10px;">${esc(exit)}</span>${score}</div>
      <div style="font-size:16px;line-height:21px;font-weight:700;color:${C.ink};">${esc(r.address)}</div>
    </td>${thumb}
  </tr></table>
  <table ${TABLE} style="margin:12px 0 10px;background:${C.wash};border-radius:8px;"><tr>${cells}</tr></table>
  ${reason ? `<div style="font-size:13px;line-height:18px;color:${C.body};margin:0 0 8px;">${esc(reason)}</div>` : ""}
  ${flag ? `<div style="margin:0 0 8px;"><span style="display:inline-block;background:${C.flagBg};color:${C.flagFg};font-size:12px;font-weight:600;padding:3px 8px;border-radius:10px;">${esc(flag)}</span></div>` : ""}
  ${note ? `<div style="font-size:12px;line-height:16px;color:${C.muted};margin:0 0 8px;">${esc(note)}</div>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;"><tr><td style="background:${C.teal};border-radius:8px;"><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Review deal</a></td></tr></table>
</td></tr></table>`;
}

function cardText(r: DigestRow, o: DigestOpts): string {
  const lines = [
    `${normalizeExit(r.bestExit) ?? "FLIP"}${r.dealScore != null ? ` ${r.dealScore}` : ""} · ${r.address}`,
    `   ${digestCells(r).map((c) => `${c.label} ${c.value}`).join(" · ")}`,
  ];
  const reason = oneLineReason(r.aiReason);
  if (reason) lines.push(`   ${reason}`);
  const flag = displayFlags(r)[0];
  if (flag) lines.push(`   Flag: ${flag}`);
  const note = analystNote(r);
  if (note) lines.push(`   ${note}`);
  lines.push(`   Review: ${dealLink(o.baseUrl, r._id)}`);
  return lines.join("\n");
}

export function buildDigest(rows: DigestRow[], o: DigestOpts): { subject: string; text: string; html: string } {
  const title = `${rows.length} worth a look`;
  const board = `${base(o.baseUrl)}/monitor`;
  const footerLabel = o.moreOnBoard > 0 ? `${o.moreOnBoard} more on the board` : "Open the board";
  const subject = `IRES Monitor: ${title}`;
  const text =
    `IRES MONITOR\n${title}\nNew Castle County · ${o.date}\n\n` +
    `${rows.map((r) => cardText(r, o)).join("\n\n")}\n\n` +
    `${footerLabel}: ${board}\nIRES CRM · automated nightly scan\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.wash};">
<div style="background:${C.wash};padding:20px 12px;font-family:${FONT};">
  <div style="max-width:600px;margin:0 auto;">
    <div style="padding:0 4px 14px;">
      <div style="color:${C.teal};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">IRES Monitor</div>
      <div style="color:${C.ink};font-size:22px;font-weight:800;line-height:1.2;margin:0 0 4px;">${esc(title)}</div>
      <div style="color:${C.muted};font-size:13px;">New Castle County &middot; ${esc(o.date)}</div>
    </div>
    ${rows.map((r) => cardHtml(r, o)).join("\n")}
    <div style="text-align:center;color:${C.muted};font-size:13px;line-height:1.7;padding:8px 4px 4px;">
      <a href="${esc(board)}" style="color:${C.teal};font-weight:600;text-decoration:none;">${esc(footerLabel)}</a><br>
      IRES CRM &middot; automated nightly scan
    </div>
  </div>
</div>
</body></html>`;
  return { subject, text, html };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/monitorDigest.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `activeKeeperCount` (internal) to `convex/monitorData.ts`**

Insert directly after the `keepersToEmail` export (anchor: the line `    return active.slice(0, limit ?? 50);` and its closing `  },\n});`):

```ts

/** Active (un-archived) keepers on the board, for the digest's "N more on the board". Bounded. */
export const activeKeeperCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("monitorListings")
      .withIndex("by_keeper_archived", (q) => q.eq("keeper", true).eq("archivedAt", undefined))
      .take(1000);
    return rows.length;
  },
});
```

- [ ] **Step 6: Wire `sendDigest` and remove the old inline helpers**

In `convex/monitorActions.ts`:

6a. Add the import after the anchor line `import { deriveDealSignals } from "../src/scraper/dealSignals";`:

```ts
import { buildDigest } from "../src/scraper/monitorDigest";
```

6b. Before deleting, check which old helpers are used outside the digest block: `git grep -n -E "\b(money|pct|esc|chipLabel|exitDetail|historyLine|analystExitNote|scoreTier|factsLine|keeperText|keeperHtml)\(" -- convex/monitorActions.ts`. Every hit must be inside the block deleted in 6c. If a hit lies outside it, import the equivalent from `../src/scraper/monitorPresent` (`money`) or `../src/scraper/monitorDigest` (`esc`) instead of keeping the old copy.

6c. Delete the whole block from the anchor comment `// ---- digest formatting (pure helpers for sendDigest) ----` down to, but NOT including, the `/**` that opens the doc comment `Email the un-emailed keepers as a ranked digest via Resend.` That block holds `type Keeper`, `money`, `pct`, `esc`, `chipLabel`, `exitDetail`, `historyLine`, `analystExitNote`, `scoreTier`, `factsLine`, `keeperText`, `keeperHtml`, `buildDigest`. If `Doc` is no longer used anywhere in the file after the deletion, `tsc -p convex` will say so; then remove `import type { Doc } from "./_generated/dataModel";`.

6d. In `sendDigest`, replace these anchor lines

```ts
    const monitorLink = `${base}/monitor`;
    const { subject, text, html } = buildDigest(keepers, monitorLink);
```

with

```ts
    // "N more on the board" = active keepers beyond the ones in this email.
    const boardTotal = await ctx.runQuery(internal.monitorData.activeKeeperCount, {});
    const moreOnBoard = Math.max(0, boardTotal - keepers.length);
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    const { subject, text, html } = buildDigest(keepers, { baseUrl: base, moreOnBoard, date });
```

Also update the `sendDigest` doc comment's first sentence from "Email the un-emailed keepers as a ranked digest via Resend." to "Email the un-emailed FLIP/RENTAL keepers as a 5-second brief (src/scraper/monitorDigest.ts) via Resend."

- [ ] **Step 7: Validate**

Run (PowerShell): `$env:CONVEX_AGENT_MODE='anonymous'; npx convex dev --once` → clean push. Revert line-ending-only churn in `convex/_generated`. Then `npx tsc --noEmit -p convex; npx tsc --noEmit; npx vitest run` → green.

- [ ] **Step 8: Commit**

```bash
git branch --show-current
git add src/scraper/monitorDigest.ts tests/monitorDigest.test.ts convex/monitorActions.ts convex/monitorData.ts
git commit -m "feat(monitor): digest as a 5-second brief - 3-cell numbers, 96px thumb, deep link, AA palette

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 7: The board — route, shadcn primitives, status strip, toolbar, table, phone list, keyboard

**Files:**
- Modify: `src/web/app.tsx` (`monitorRoute` gets `validateSearch`)
- Create via CLI: `src/components/ui/tabs.tsx`, `src/components/ui/toggle-group.tsx`, `src/components/ui/toggle.tsx`, `src/components/ui/empty.tsx`
- Create: `src/web/monitor/ExitBadge.tsx`, `src/web/monitor/PassMenu.tsx`, `src/web/monitor/BoardTable.tsx`
- Rewrite: `src/web/MonitorPage.tsx`

**Interfaces:**
- Consumes: Task 1 (`verdictFor`, `exitLabel`, `normalizeExit`, `safeHref`), Task 2 (`PASS_REASONS`, `PassReason`, `triageStatus`), Task 3 (all board helpers), Task 4 (`api.monitorData.board`, `boardState`, `setTriage`, `markSeen`), Task 5 (`api.monitorData.requestScan`; omit the `RunNow` component if Task 5 was dropped), existing `api.monitorData.latestRun`, `api.users.currentUser`.
- Produces:
  - Route search `{ id?: string }` on `/monitor`.
  - `ExitBadge({ exit }: { exit: string | null | undefined })`
  - `PassMenu({ open, onOpenChange, onPick, trigger }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (r: PassReason) => void; trigger: ReactNode })`
  - `type BoardListing = FunctionReturnType<typeof api.monitorData.board>[number] & { triage: TriageState | null }` (exported from `BoardTable.tsx`)
  - `BoardTable(props: { rows: BoardListing[]; selected: number; tab: BoardTab; lastSeenAt: number | null; now: number; passMenuFor: string | null; sheetOpen: boolean; onSelect(i: number): void; onOpen(id: string): void; onShortlist(r: BoardListing): void; onPassMenu(id: string | null): void; onPass(id: string, r: PassReason): void; onRestore(id: string): void })`, `BoardSkeleton()`
  - `MonitorPage` keeps its export name (app.tsx import unchanged). Task 8 mounts `DealSheet` inside it.

UI code has no unit tests (node env). Its logic lives in Tasks 1-3. Verification = typecheck + build + the Task 9 visual pass.

- [ ] **Step 1: Add the route search param**

In `src/web/app.tsx`, replace the anchor line

```ts
const monitorRoute = createRoute({ getParentRoute: () => rootRoute, path: "/monitor", component: MonitorPage });
```

with

```ts
// `?id=<listingId>` = the open deal sheet (email "Review deal" deep link + in-app open state).
type MonitorSearch = { id?: string };
const monitorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/monitor",
  component: MonitorPage,
  validateSearch: (search: Record<string, unknown>): MonitorSearch => ({
    id: typeof search.id === "string" && search.id ? search.id : undefined,
  }),
});
```

- [ ] **Step 2: Add the shadcn primitives (no overwrites)**

Run: `npx shadcn@latest add tabs toggle-group empty --dry-run`
Expected: it lists only NEW files (`tabs.tsx`, `toggle-group.tsx`, `toggle.tsx`, `empty.tsx`). If it lists `button.tsx`, `sheet.tsx`, `index.css` or any other existing file as "overwrite", STOP and add the components one by one, answering "no" to every overwrite prompt.

Run: `npx shadcn@latest add tabs toggle-group empty`
Then: `git status --short src/components/ui src/web/index.css` — only the 4 new files are untracked; `git diff --stat src/components/ui/button.tsx src/components/ui/sheet.tsx src/web/index.css` prints nothing. If any existing file changed, `git checkout -- <file>`. Read the four new files and confirm they use `radix-ui` + `asChild`, import icons only from `lucide-react`, and export `Tabs, TabsList, TabsTrigger`, `ToggleGroup, ToggleGroupItem`, `Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent`. Adjust the import names below if the installed versions differ.

- [ ] **Step 3: `ExitBadge` + `PassMenu`**

Create `src/web/monitor/ExitBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { exitLabel } from "../../scraper/monitorPresent";

// One hue per exit (Design Direction). RENTAL is sky, not emerald: emerald means a
// positive number on this page.
const HUE: Record<string, string> = {
  FLIP: "border-teal/40 bg-teal/10 text-teal-glow",
  RENTAL: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  WHOLESALE: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  WHOLETAIL: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  PASS: "border-border bg-muted/40 text-muted-foreground",
};

export function ExitBadge({ exit }: { exit: string | null | undefined }) {
  if (!exit) return null;
  const key = exit.toUpperCase();
  return (
    <Badge variant="outline" className={cn("rounded-md uppercase tracking-wide", HUE[key] ?? HUE.PASS)}>
      {exitLabel(key)}
    </Badge>
  );
}
```

Create `src/web/monitor/PassMenu.tsx`:

```tsx
import type { ReactNode } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PASS_REASONS, type PassReason } from "../../scraper/monitorTriage";

// Controlled pass-with-reason menu. Controlled so the P key can open it for the
// selected row (or the open sheet). Radix layers correctly above the Sheet.
export function PassMenu({
  open, onOpenChange, onPick, trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (reason: PassReason) => void;
  trigger: ReactNode;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Pass because</DropdownMenuLabel>
        <DropdownMenuGroup>
          {PASS_REASONS.map((r) => (
            <DropdownMenuItem key={r.value} onSelect={() => onPick(r.value)}>
              {r.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: `BoardTable` (desktop table + phone list + skeleton)**

Create `src/web/monitor/BoardTable.tsx`:

```tsx
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { ChevronRight, Eye, ImageOff, RotateCcw, Star, X } from "lucide-react";
import type { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { money, safeHref, verdictFor, type Tone } from "../../scraper/monitorPresent";
import { triageStatus, type PassReason, type TriageState } from "../../scraper/monitorTriage";
import { isNewSince, type BoardTab } from "../lib/monitorBoard";
import { ExitBadge } from "./ExitBadge";
import { PassMenu } from "./PassMenu";

// A board projection row merged with the caller's triage (MonitorPage does the merge).
export type BoardListing = FunctionReturnType<typeof api.monitorData.board>[number] & { triage: TriageState | null };

export const TONE_TEXT: Record<Tone, string> = {
  pos: "text-emerald-400",
  neg: "text-red-400",
  neutral: "text-foreground",
};

function Thumb({ src, alt, className }: { src: string | undefined; alt: string; className: string }) {
  const [err, setErr] = useState(false);
  const url = safeHref(src);
  if (!url || err) {
    return (
      <div className={cn("grid shrink-0 place-items-center rounded-md bg-muted", className)}>
        <ImageOff className="size-4 text-muted-foreground opacity-50" />
      </div>
    );
  }
  return <img src={url} alt={alt} loading="lazy" onError={() => setErr(true)} className={cn("shrink-0 rounded-md bg-muted object-cover", className)} />;
}

function NewDot() {
  return (
    <>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-teal-glow" />
      <span className="sr-only">New</span>
    </>
  );
}

function subline(r: BoardListing): string {
  return [
    [r.propCity, r.propZip].filter(Boolean).join(" "),
    r.beds != null && r.beds !== "" ? `${r.beds} bd` : null,
    r.baths != null && r.baths !== "" ? `${r.baths} ba` : null,
    r.sqft ? `${r.sqft.toLocaleString("en-US")} sqft` : null,
  ].filter(Boolean).join(" · ");
}

export interface BoardTableProps {
  rows: BoardListing[];
  selected: number;
  tab: BoardTab;
  lastSeenAt: number | null;
  now: number;
  passMenuFor: string | null;
  sheetOpen: boolean;
  onSelect: (i: number) => void;
  onOpen: (id: string) => void;
  onShortlist: (r: BoardListing) => void;
  onPassMenu: (id: string | null) => void;
  onPass: (id: string, reason: PassReason) => void;
  onRestore: (id: string) => void;
}

export function BoardTable(p: BoardTableProps) {
  return (
    <>
      {/* Desktop: dense table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {["", "Score", "Address", "List", "Verdict", ""].map((h, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    "h-9 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                    i === 0 && "w-16", i === 1 && "w-28", (i === 3 || i === 4) && "text-right",
                    i === 3 && "w-28", i === 4 && "w-40", i === 5 && "w-32",
                  )}
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.rows.map((r, i) => {
              const v = verdictFor(r);
              const status = triageStatus(r.triage, p.now);
              const isSel = i === p.selected;
              return (
                <TableRow
                  key={r._id}
                  data-row-index={i}
                  aria-selected={isSel}
                  onClick={() => { p.onSelect(i); p.onOpen(r._id); }}
                  className={cn("h-14 cursor-pointer hover:bg-muted/40", isSel && "bg-accent shadow-[inset_2px_0_0_var(--color-teal)] hover:bg-accent")}
                >
                  <TableCell className="py-2"><Thumb src={r.photo} alt="" className="h-9 w-12" /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold tabular-nums text-foreground">{r.dealScore ?? "—"}</span>
                      <ExitBadge exit={r.bestExit} />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <div className="flex items-center gap-1.5">
                      {status === "new" && isNewSince(r, p.lastSeenAt) && <NewDot />}
                      <span className="truncate font-medium text-foreground">{r.address}</span>
                      {r.hasOwnerSignal && (
                        <span title="Owner signal on the parcel"><Eye className="size-3.5 shrink-0 text-red-400" /></span>
                      )}
                      {status === "snoozed" && <span className="shrink-0 text-xs text-muted-foreground">Snoozed</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{subline(r)}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.listPrice)}</TableCell>
                  <TableCell className="text-right">
                    <div className={cn("font-semibold tabular-nums", TONE_TEXT[v.tone])}>{v.value}</div>
                    {v.caption && <div className="text-xs tabular-nums text-muted-foreground">{v.caption}</div>}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon-sm"
                        aria-label={status === "shortlist" ? "Remove from shortlist" : "Shortlist"}
                        aria-pressed={status === "shortlist"}
                        onClick={() => p.onShortlist(r)}
                      >
                        <Star className={cn(status === "shortlist" && "fill-current text-primary")} />
                      </Button>
                      {p.tab === "passed" ? (
                        <Button variant="ghost" size="icon-sm" aria-label="Restore" onClick={() => p.onRestore(r._id)}>
                          <RotateCcw />
                        </Button>
                      ) : (
                        <PassMenu
                          open={p.passMenuFor === r._id && !p.sheetOpen}
                          onOpenChange={(o) => p.onPassMenu(o ? r._id : null)}
                          onPick={(reason) => p.onPass(r._id, reason)}
                          trigger={<Button variant="ghost" size="icon-sm" aria-label="Pass"><X /></Button>}
                        />
                      )}
                      <Button variant="ghost" size="icon-sm" aria-label="Open deal" onClick={() => { p.onSelect(i); p.onOpen(r._id); }}>
                        <ChevronRight />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Phone: edge-to-edge rows, 64px thumb + address + two number lines */}
      <ul className="divide-y divide-border border-y border-border md:hidden">
        {p.rows.map((r, i) => {
          const v = verdictFor(r);
          const status = triageStatus(r.triage, p.now);
          return (
            <li key={r._id}>
              <button
                type="button"
                onClick={() => { p.onSelect(i); p.onOpen(r._id); }}
                className={cn("flex w-full gap-3 px-4 py-3 text-left", i === p.selected && "bg-accent")}
              >
                <Thumb src={r.photo} alt="" className="size-16" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    {status === "new" && isNewSince(r, p.lastSeenAt) && <NewDot />}
                    <span className="truncate text-sm font-medium text-foreground">{r.address}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                    <ExitBadge exit={r.bestExit} />
                    <span>{r.dealScore ?? "—"}</span>
                    <span>List {money(r.listPrice)}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 text-xs tabular-nums">
                    <span className={cn("font-semibold", TONE_TEXT[v.tone])}>{v.value}</span>
                    {v.caption && <span className="truncate text-muted-foreground">{v.caption}</span>}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function BoardSkeleton() {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-14 items-center gap-4 border-b border-border px-2 last:border-0">
            <Skeleton className="h-9 w-12 rounded-md" />
            <Skeleton className="h-4 w-16" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-border md:hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-3 px-4 py-3">
            <Skeleton className="size-16 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Rewrite `MonitorPage.tsx`**

Replace the entire contents of `src/web/MonitorPage.tsx` with the following. The card UI, `AnalystBreakdown` and `MonitorPromote` are removed here; Task 8's `DealSheet` re-homes Promote, the owner signal and the analyst content. `DealSheet` is imported and mounted in Task 8; until then the sheet open state only updates the URL.

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { Radar, RefreshCw } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "./ConfirmDialog";
import { describeError } from "./lib/errorReporting";
import {
  boardKeyAction, clampIndex, filterRows, inTab, newSinceCount, nextIndex, sortRows, tabCounts, zipOptions,
  SORT_LABELS, type BoardTab, type ExitFilter, type SortKey,
} from "./lib/monitorBoard";
import { triageStatus, type PassReason, type TriageState } from "../scraper/monitorTriage";
import { BoardSkeleton, BoardTable, type BoardListing } from "./monitor/BoardTable";

// "Monitor the Web" — the /monitor triage inbox (Phase 3). Per-user tabs (New /
// Shortlist / Passed / All), filters, sort, a dense table (phone: compact list), a
// deal side sheet driven by ?id=, and J/K/P/S/Enter keys. All logic lives in
// src/web/lib/monitorBoard.ts + src/scraper/monitor{Present,Triage}.ts.
// Plan: docs/superpowers/plans/2026-10-04-monitor-phase3-triage-ui.md.

type LatestRun = FunctionReturnType<typeof api.monitorData.latestRun>;

function lastScanText(s: LatestRun | undefined): string {
  if (s === undefined) return "Loading…";
  if (s === null) return "No scans yet. The monitor runs nightly at 8 PM ET.";
  const t = s.run.finishedAt ?? s.run.startedAt;
  return `Last scan ${new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

const TABS: { value: BoardTab; label: string }[] = [
  { value: "new", label: "New" },
  { value: "shortlist", label: "Shortlist" },
  { value: "passed", label: "Passed" },
  { value: "all", label: "All" },
];
const EMPTY: Record<BoardTab, { title: string; description?: string }> = {
  new: { title: "Nothing new tonight — the filters are working.", description: "New keepers land here after the 8 PM scan." },
  shortlist: { title: "No shortlisted deals", description: "Press S on a row to save it here." },
  passed: { title: "Nothing passed yet." },
  all: { title: "No keepers on the board." },
};

function RunNow() {
  const requestScan = useMutation(api.monitorData.requestScan);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw data-icon="inline-start" />
        Run now
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Run a scan now?"
        description="Scrapes the newest New Castle County listings on Zillow and analyzes the new ones. Uses Firecrawl and LLM credits. The nightly scan runs at 8 PM ET either way."
        confirmLabel="Run scan"
        onConfirm={() => requestScan({})}
      />
    </>
  );
}

export function MonitorPage() {
  const latestRun = useQuery(api.monitorData.latestRun);
  const listings = useQuery(api.monitorData.board);
  const state = useQuery(api.monitorData.boardState);
  const me = useQuery(api.users.currentUser);
  const setTriage = useMutation(api.monitorData.setTriage);
  const markSeen = useMutation(api.monitorData.markSeen);
  const { id: openId } = useSearch({ from: "/monitor" });
  const navigate = useNavigate({ from: "/monitor" });

  const [tab, setTab] = useState<BoardTab>("new");
  const [exits, setExits] = useState<ExitFilter[]>([]);
  const [zip, setZip] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [selected, setSelected] = useState(-1);
  const [passMenuFor, setPassMenuFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = Date.now();

  // "New since you looked": capture the PREVIOUS watermark once, then stamp now.
  const [baseline, setBaseline] = useState<number | null | undefined>(undefined);
  const stamped = useRef(false);
  useEffect(() => {
    if (state === undefined || stamped.current) return;
    stamped.current = true;
    setBaseline(state.lastSeenAt);
    void markSeen({}).catch(() => {});
  }, [state, markSeen]);
  const lastSeenAt = baseline === undefined ? state?.lastSeenAt ?? null : baseline;

  // Merge the listing projection with the caller's triage (two queries so a P/S
  // keystroke only re-runs the tiny boardState query).
  const loading = listings === undefined || state === undefined;
  const all = useMemo<BoardListing[]>(() => {
    if (!listings || !state) return [];
    const byId = new Map<string, TriageState>(state.triage.map((t) => [t.listingId, t]));
    return listings.map((r) => ({ ...r, triage: byId.get(r._id) ?? null }));
  }, [listings, state]);
  const counts = tabCounts(all, now);
  const zips = useMemo(() => zipOptions(all), [all]);
  const visible = useMemo(
    () => sortRows(filterRows(all.filter((r) => inTab(r, tab, now)), { exits, zip: zip === "all" ? null : zip }), sort),
    // `now` intentionally omitted: recomputing per render tick is unnecessary
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, tab, exits, zip, sort],
  );
  const sel = clampIndex(selected, visible.length);
  const newCount = newSinceCount(all, lastSeenAt, now);

  const open = (id: string) => navigate({ search: (prev) => ({ ...prev, id }) });

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); } catch (e) { setErr(describeError(e).message); }
  };
  const act = (id: string, action: "shortlist" | "unshortlist" | "snooze" | "restore") =>
    run(() => setTriage({ listingId: id as Id<"monitorListings">, action }));
  const pass = (id: string, reason: PassReason) => {
    setPassMenuFor(null);
    return run(() => setTriage({ listingId: id as Id<"monitorListings">, action: "pass", reason }));
  };
  const toggleShortlist = (r: BoardListing) =>
    act(r._id, triageStatus(r.triage, now) === "shortlist" ? "unshortlist" : "shortlist");

  // Keyboard: J/K move, Enter open, S shortlist, P pass menu. Esc is Radix's (closes
  // the sheet / menu). With the sheet open, J/K walk the sheet through the list.
  // No blanket "menu open" early return: Radix moves focus into [role="menu"], which
  // boardKeyAction already ignores, so a stuck passMenuFor can never lock the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The custom ConfirmDialog (Run now) is role="dialog" aria-modal: no board keys behind it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-slot="sheet-content"])')) return;
      const a = boardKeyAction({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      if (!a) return;
      // With the sheet open (incl. a deep link), J/K start from the open deal, not the old selection.
      const base = openId ? visible.findIndex((r) => r._id === openId) : sel;
      const current = openId ?? visible[sel]?._id;
      if (a === "down" || a === "up") {
        e.preventDefault();
        const ni = nextIndex(base, a, visible.length);
        setSelected(ni);
        if (openId && visible[ni]) navigate({ search: (prev) => ({ ...prev, id: visible[ni]._id }), replace: true });
        return;
      }
      if (!current) return;
      e.preventDefault();
      const r = all.find((x) => x._id === current);
      const s = r ? triageStatus(r.triage, now) : null;
      if (a === "open") open(current);
      // P only where a pass menu is actually rendered: not on passed rows / the Passed
      // tab, and not on a snoozed deal in the sheet (both show Restore instead).
      if (a === "pass" && r && s !== "passed" && (openId ? s !== "snoozed" : tab !== "passed")) setPassMenuFor(current);
      if (a === "shortlist" && r) void toggleShortlist(r);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    if (sel >= 0) document.querySelector(`[data-row-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const failed = latestRun?.run.status === "failed";
  const filtered = exits.length > 0 || zip !== "all";

  return (
    <div>
      {/* Status strip (the page title lives in the app header breadcrumb) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm text-muted-foreground md:px-6">
        <p className="flex flex-wrap items-center gap-x-2">
          <span>{lastScanText(latestRun)}</span>
          {failed && <span className="text-amber-400">· last scan failed</span>}
          {!loading && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-foreground">
                {newCount > 0 ? `${newCount} new since you looked` : "Nothing new since you looked"}
              </span>
            </>
          )}
        </p>
        {me?.role === "admin" && <RunNow />}
      </div>

      {/* Toolbar: tabs + filters + sort */}
      <div className="flex flex-col gap-3 px-4 pt-4 md:flex-row md:items-center md:justify-between md:px-6">
        <Tabs value={tab} onValueChange={(v) => { setTab(v as BoardTab); setSelected(-1); }} className="overflow-x-auto">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                {t.label}
                <span className="tabular-nums text-muted-foreground">{counts[t.value]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="multiple" variant="outline" size="sm" value={exits} onValueChange={(v) => setExits(v as ExitFilter[])}>
            <ToggleGroupItem value="FLIP">Flip</ToggleGroupItem>
            <ToggleGroupItem value="RENTAL">Rental</ToggleGroupItem>
            <ToggleGroupItem value="WHOLESALE">Wholesale</ToggleGroupItem>
          </ToggleGroup>
          <Select value={zip} onValueChange={setZip}>
            <SelectTrigger size="sm" className="w-32" aria-label="ZIP"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All ZIPs</SelectItem>
                {zips.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      {err && <p role="status" className="px-4 pt-2 text-xs text-amber-400 md:px-6">{err}</p>}

      {/* Board */}
      <div className="px-0 pb-8 pt-3 md:px-6">
        {loading ? (
          <BoardSkeleton />
        ) : visible.length === 0 ? (
          <Empty className="mx-4 border border-dashed border-border md:mx-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Radar /></EmptyMedia>
              <EmptyTitle>{filtered && counts[tab] > 0 ? "No deals match these filters" : EMPTY[tab].title}</EmptyTitle>
              {!(filtered && counts[tab] > 0) && EMPTY[tab].description && <EmptyDescription>{EMPTY[tab].description}</EmptyDescription>}
            </EmptyHeader>
            {filtered && counts[tab] > 0 && (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => { setExits([]); setZip("all"); }}>Clear filters</Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <>
            <BoardTable
              rows={visible}
              selected={sel}
              tab={tab}
              lastSeenAt={lastSeenAt}
              now={now}
              passMenuFor={passMenuFor}
              sheetOpen={!!openId}
              onSelect={setSelected}
              onOpen={open}
              onShortlist={toggleShortlist}
              onPassMenu={setPassMenuFor}
              onPass={pass}
              onRestore={(id) => act(id, "restore")}
            />
            <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <Kbd>J</Kbd><Kbd>K</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>S</Kbd> shortlist · <Kbd>P</Kbd> pass · <Kbd>Esc</Kbd> close
            </p>
          </>
        )}
      </div>
      {/* DEAL SHEET MOUNT (Task 8) */}
    </div>
  );
}
```

Until Task 8 lands, clicking a row only sets `?id=` in the URL. That is expected; `tsconfig.json` has `noUnusedLocals`, so the `close` helper is added in Task 8 together with its only caller.

If Task 5 was dropped: delete the `RunNow` component, its `ConfirmDialog` and `RefreshCw` imports, and the `{me?.role === "admin" && <RunNow />}` line (and `me` if unused).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit; npx tsc --noEmit -p convex; npx vitest run; npm run build`
Expected: all green. If `useSearch({ from: "/monitor" })` fails to type, check that the Step 1 edit is in place: TanStack's `Register` (in `main.tsx`) types the route tree from `app.tsx`.

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add src/web/app.tsx src/components/ui/tabs.tsx src/components/ui/toggle-group.tsx src/components/ui/toggle.tsx src/components/ui/empty.tsx src/web/monitor/ExitBadge.tsx src/web/monitor/PassMenu.tsx src/web/monitor/BoardTable.tsx src/web/MonitorPage.tsx
git commit -m "feat(monitor): triage inbox board - tabs, filters, sort, dense table, phone list, J/K/P/S keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 8: The deal sheet (+ deep link)

**Files:**
- Create: `src/web/monitor/DealSheet.tsx`
- Modify: `src/web/MonitorPage.tsx` (mount the sheet)

**Interfaces:**
- Consumes: `api.monitorData.listingForMe`, `setTriage`, `markPromoted`; `api.potentialData.promoteToPotential` (existing; args as in the old `MonitorPromote`); Task 1 (`numberGroups`, `displayFlags`, `humanizeFlag`, `ownerSignal`, `analystNote`, `safeHref`, `Tone`); Task 2 (`triageStatus`, `passReasonLabel`, `PassReason`); `ExitBadge`, `PassMenu`, `TONE_TEXT` (Task 7).
- Produces: `DealSheet(props: { id: string | undefined; passMenuOpen: boolean; onPassMenu: (open: boolean) => void; onClose: () => void; onError: (msg: string | null) => void })`.

- [ ] **Step 1: Create `DealSheet.tsx`**

```tsx
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import {
  AlarmClock, Calculator, CircleDashed, ClipboardCheck, ClipboardPlus, ExternalLink, Eye, Phone,
  RotateCcw, ShieldCheck, Star, TriangleAlert, X,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { describeError } from "../lib/errorReporting";
import { analystNote, displayFlags, humanizeFlag, numberGroups, ownerSignal, safeHref } from "../../scraper/monitorPresent";
import { passReasonLabel, triageStatus, type PassReason } from "../../scraper/monitorTriage";
import { ExitBadge } from "./ExitBadge";
import { PassMenu } from "./PassMenu";
import { TONE_TEXT } from "./BoardTable";

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{icon}{title}</h3>
      {children}
    </section>
  );
}

export function DealSheet({
  id, passMenuOpen, onPassMenu, onClose, onError,
}: {
  id: string | undefined;
  passMenuOpen: boolean;
  onPassMenu: (open: boolean) => void;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const data = useQuery(api.monitorData.listingForMe, id ? { id } : "skip");
  const setTriage = useMutation(api.monitorData.setTriage);
  const promote = useMutation(api.potentialData.promoteToPotential);
  const markPromoted = useMutation(api.monitorData.markPromoted);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const run = async (fn: () => Promise<unknown>) => {
    onError(null);
    setBusy(true);
    try { await fn(); } catch (e) { onError(describeError(e).message); } finally { setBusy(false); }
  };

  const l = data?.listing;
  const status = triageStatus(data?.triage, now);
  const lid = l?._id as Id<"monitorListings"> | undefined;
  const act = (action: "shortlist" | "unshortlist" | "snooze" | "restore") => lid && run(() => setTriage({ listingId: lid, action }));
  const pass = (reason: PassReason) => { onPassMenu(false); if (lid) void run(() => setTriage({ listingId: lid, action: "pass", reason })); };

  const cityZip = l ? [l.propCity, l.propZip].filter(Boolean).join(" ") : "";
  const fullAddress = l ? [l.address, cityZip].filter(Boolean).join(", ") : "";
  const facts = l
    ? [cityZip, l.beds != null && l.beds !== "" ? `${l.beds} bd` : null, l.baths != null && l.baths !== "" ? `${l.baths} ba` : null,
       l.sqft ? `${l.sqft.toLocaleString("en-US")} sqft` : null, l.yearBuilt ? `built ${l.yearBuilt}` : null].filter(Boolean).join(" · ")
    : "";
  const photos = (l?.photoUrls ?? []).map((u) => safeHref(u)).filter((u): u is string => !!u).slice(0, 10);
  const zillow = safeHref(l?.url);
  const owner = l ? ownerSignal(l) : null;
  const note = l ? analystNote(l) : null;
  const flags = l ? displayFlags(l) : [];
  const gates = (l?.verifyGates ?? []).map(humanizeFlag);

  const onPromote = () => l && run(async () => {
    const res = await promote({
      source: { kind: "manual", refId: l.zpid },
      address: fullAddress,
      propCity: l.propCity ?? undefined,
      propZip: l.propZip ?? undefined,
      beds: l.beds != null ? String(l.beds) : undefined,
      baths: l.baths != null ? String(l.baths) : undefined,
      sqft: l.sqft ?? undefined,
      value: l.conservativeArv ?? undefined,
      score: l.dealScore ?? undefined,
      topSignals: l.matchedRequirements ?? undefined,
      contactName: l.agentName ?? undefined,
      contactPhone: l.agentPhone ?? undefined,
      lat: l.lat ?? undefined,
      lng: l.lng ?? undefined,
    });
    await markPromoted({ id: l._id, promotedDealId: res.id });
  });

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {data === undefined ? (
          <div className="flex flex-col gap-4 p-4">
            <SheetTitle className="sr-only">Loading deal</SheetTitle>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <div className="grid grid-cols-3 gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
          </div>
        ) : data === null || !l ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <SheetTitle className="text-base font-medium text-muted-foreground">This deal is no longer available.</SheetTitle>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border pr-12">
              <div className="flex items-center gap-2">
                <ExitBadge exit={l.bestExit} />
                <span className="text-sm font-semibold tabular-nums">{l.dealScore ?? "—"}</span>
                {status === "passed" && <span className="text-xs text-muted-foreground">Passed: {passReasonLabel(data.triage?.passReason)}</span>}
                {status === "snoozed" && data.triage?.snoozedUntil && (
                  <span className="text-xs text-muted-foreground">
                    Snoozed to {new Date(data.triage.snoozedUntil).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
              <SheetTitle className="text-lg">{l.address}</SheetTitle>
              {facts && <SheetDescription>{facts}</SheetDescription>}
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
              {photos.length > 0 && (
                <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4">
                  {photos.map((u, i) => (
                    <img key={u} src={u} alt={i === 0 ? l.address : ""} loading="lazy" className="h-40 w-60 shrink-0 snap-start rounded-lg bg-muted object-cover" />
                  ))}
                </div>
              )}

              {numberGroups(l).map((g) => (
                <Section key={g.title} title={g.title}>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    {g.cells.map((c) => (
                      <div key={c.label} className="flex flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">{c.label}</dt>
                        <dd className={cn("text-sm font-semibold tabular-nums", TONE_TEXT[c.tone])}>{c.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              ))}

              {gates.length > 0 && (
                <Section title="Verify before you bid" icon={<ShieldCheck className="size-3.5 text-amber-400" />}>
                  <ul className="flex flex-col gap-1.5">
                    {gates.map((g) => (
                      <li key={g} className="flex gap-2 text-sm text-foreground">
                        <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-400" />{g}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {flags.length > 0 && (
                <Section title="Red flags" icon={<TriangleAlert className="size-3.5 text-amber-400" />}>
                  <ul className="flex flex-col gap-1.5">
                    {flags.map((f) => <li key={f} className="text-sm text-foreground">{f}</li>)}
                  </ul>
                </Section>
              )}

              {owner && (
                <p className="flex items-center gap-1.5 text-sm text-red-400"><Eye className="size-4" />Owner: {owner}</p>
              )}

              {(l.aiReason || l.breakdown || note) && (
                <Section title="Analyst note">
                  {l.aiReason && <p className="text-sm text-foreground">{l.aiReason}</p>}
                  {l.breakdown && <p className="text-sm leading-relaxed text-muted-foreground">{l.breakdown}</p>}
                  {note && <p className="text-xs text-muted-foreground">{note}</p>}
                </Section>
              )}

              {(l.agentName || l.agentPhone || zillow) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {(l.agentName || l.agentPhone) && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="size-4" />
                      {l.agentName}
                      {l.agentPhone && (
                        <a className="text-teal-glow hover:underline" href={`tel:${l.agentPhone.replace(/[^\d+]/g, "")}`}>{l.agentPhone}</a>
                      )}
                    </span>
                  )}
                  {zillow && (
                    <a className="flex items-center gap-1.5 text-teal-glow hover:underline" href={zillow} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-4" />Zillow
                    </a>
                  )}
                </div>
              )}
            </div>

            <SheetFooter className="flex-row flex-wrap border-t border-border">
              {l.promotedDealId ? (
                <Button variant="outline" asChild>
                  <Link to="/potential"><ClipboardCheck data-icon="inline-start" />In pipeline</Link>
                </Button>
              ) : (
                <Button onClick={onPromote} disabled={busy}><ClipboardPlus data-icon="inline-start" />Promote</Button>
              )}
              <Button variant="outline" disabled={busy} aria-pressed={status === "shortlist"} onClick={() => act(status === "shortlist" ? "unshortlist" : "shortlist")}>
                <Star data-icon="inline-start" className={cn(status === "shortlist" && "fill-current text-primary")} />
                {status === "shortlist" ? "Shortlisted" : "Shortlist"}
              </Button>
              {status === "passed" || status === "snoozed" ? (
                <Button variant="outline" disabled={busy} onClick={() => act("restore")}><RotateCcw data-icon="inline-start" />Restore</Button>
              ) : (
                <>
                  <PassMenu
                    open={passMenuOpen}
                    onOpenChange={onPassMenu}
                    onPick={pass}
                    trigger={<Button variant="outline" disabled={busy}><X data-icon="inline-start" />Pass</Button>}
                  />
                  <Button variant="ghost" disabled={busy} onClick={() => act("snooze")}><AlarmClock data-icon="inline-start" />Snooze 7 days</Button>
                </>
              )}
              <Button variant="ghost" asChild>
                <Link to="/flip" search={{ address: fullAddress, value: l.conservativeArv ?? undefined, sqft: l.sqft ?? undefined }}>
                  <Calculator data-icon="inline-start" />Flip analyzer
                </Link>
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

(The `Star` inside the Shortlist button carries a color/fill class only, not a size class, which matches the shadcn icon rule.)

- [ ] **Step 2: Mount it in `MonitorPage.tsx`**

Add the import after the anchor line `import { BoardSkeleton, BoardTable, type BoardListing } from "./monitor/BoardTable";`:

```tsx
import { DealSheet } from "./monitor/DealSheet";
```

Add the `close` helper directly after the anchor line `  const open = (id: string) => navigate({ search: (prev) => ({ ...prev, id }) });`:

```tsx
  const close = () => navigate({ search: (prev) => ({ ...prev, id: undefined }) });
```

Replace the anchor line

```tsx
      {/* DEAL SHEET MOUNT (Task 8) */}
```

with

```tsx
      <DealSheet
        id={openId}
        passMenuOpen={!!openId && passMenuFor === openId}
        onPassMenu={(o) => setPassMenuFor(o && openId ? openId : null)}
        onClose={() => { setPassMenuFor(null); close(); }}
        onError={setErr}
      />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit; npx tsc --noEmit -p convex; npx vitest run; npm run build`
Expected: all green. Then confirm no raw unsafe hrefs remain on the page: `git grep -n -E "href=\{(row|l)\.url\}|src=\{(row|l)\.photoUrls" -- src/web` prints nothing.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add src/web/monitor/DealSheet.tsx src/web/MonitorPage.tsx
git commit -m "feat(monitor): deal side sheet - numbers grid, verify list, humanized flags, promote/pass/snooze, ?id deep link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

### Task 9: Visual verification (page 1440/390 + sheet + digest 390/700), detector, memory

**Files:**
- Throwaway harness under the scratchpad (never committed): `C:\Users\nazho\AppData\Local\Temp\claude\C--Users-nazho-Desktop-ires-crm\db82ec5e-61c9-42b9-ad44-89610c1fa72b\scratchpad\h3\`
- Modify: `memory/memory.md` (Monitor section), `memory/todo.md` (Phase 3 line)

**Interfaces:**
- Consumes: everything above; the earlier critique harness at `...\scratchpad\h\` (its `data.json` holds real prod-shaped keeper rows; `convex-react-mock.ts` / `vite.config.mts` show the alias pattern).

- [ ] **Step 1: Build the harness (copy, then extend)**

1. Copy `scratchpad\h\` to `scratchpad\h3\`. In `h3\vite.config.mts`:
   - change the `@` alias replacement to `C:/Users/nazho/Desktop/ires-crm/.claude/worktrees/monitor-critique/src` (the old one points at the MAIN checkout — wrong tree);
   - set `H` to the `h3` path;
   - set `server.port` to `5198`.
2. Replace `h3\convex-react-mock.ts` with:

```ts
import { getFunctionName } from "convex/server";
import data from "./data.json";
const NOW = Date.now();
const keepers = (data.keepers as any[]).map((r, i) => ({
  ...r,
  photo: r.photoUrls?.[0],
  hasOwnerSignal: (r.offMarketSignals?.length ?? 0) > 0,
  firstSeen: NOW - i * 3_600_000,
  triage: i === 1 ? { shortlistedAt: NOW } : i === 2 ? { passedAt: NOW, passReason: "overpriced" } : null, // for listingForMe only
}));
export function useQuery(fn: any, args?: any) {
  if (args === "skip") return undefined;
  const n = getFunctionName(fn);
  if (n.endsWith("latestRun")) return { run: { startedAt: NOW - 3_600_000, finishedAt: NOW - 3_000_000, status: "complete" }, newLast24h: 31, runsLast24h: 1 };
  if (n.endsWith("monitorData:board")) return keepers;
  if (n.endsWith("boardState")) {
    return {
      triage: [
        { listingId: keepers[1]?._id, shortlistedAt: NOW },
        { listingId: keepers[2]?._id, passedAt: NOW, passReason: "overpriced" },
      ].filter((t) => t.listingId),
      lastSeenAt: NOW - 4 * 3_600_000,
    };
  }
  if (n.endsWith("listingForMe")) {
    const l = keepers.find((k) => k._id === args?.id);
    return l ? { listing: l, triage: l.triage } : null;
  }
  if (n.endsWith("currentUser")) return { role: "admin", isActive: true, name: "Harness" };
  return undefined;
}
export function useMutation() { return async () => ({}); }
```

3. Replace `h3\router-mock.tsx` with a mock that reads and writes `?id=` (no real router, no AppShell/Clerk):

```tsx
import { useEffect, useState } from "react";
const read = () => Object.fromEntries(new URLSearchParams(window.location.search));
export function useSearch() {
  const [s, set] = useState(read());
  useEffect(() => { const f = () => set(read()); window.addEventListener("popstate", f); return () => window.removeEventListener("popstate", f); }, []);
  return s;
}
export function useNavigate() {
  return ({ search }: any) => {
    const next = typeof search === "function" ? search(read()) : search;
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v != null) as any).toString();
    window.history.pushState({}, "", q ? `?${q}` : window.location.pathname);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
}
export function Link({ to, search: _s, children, ...p }: any) { return <a href={to} {...p}>{children}</a>; }
```

4. Copy the current `src/web/index.css` from the worktree over `h3\harness.css` (it must match the real tokens). Keep `h3\index.html` (`class="dark"`) and `h3\main.tsx` (renders `MonitorPage`).

- [ ] **Step 2: Serve and capture the page**

Start the server in the background: `npx vite --config "<scratchpad>\h3\vite.config.mts"` (cwd = worktree, so `node_modules` resolve). Wait until `http://localhost:5198/` answers. Serve over HTTP, never `file://` (module scripts do not run over `file://`, lesson 2026-07-01).

Capture with headless Chrome (`"C:\Program Files\Google\Chrome\Application\chrome.exe"`; Edge also works) using `--headless=new --hide-scrollbars --virtual-time-budget=9000 --window-size=W,H --screenshot=<out.png> <url>`:

| Shot | Size | URL |
|---|---|---|
| `p3-board-1440.png` | 1440x1000 | `http://localhost:5198/` |
| `p3-board-390.png` | 390x1600 | `http://localhost:5198/` |
| `p3-sheet-1440.png` | 1440x1000 | `http://localhost:5198/?id=<data.keepers[0]._id>` |
| `p3-sheet-390.png` | 390x1200 | same `?id=` |
| `p3-sheet-missing-390.png` | 390x800 | `http://localhost:5198/?id=not-a-real-id` |

- [ ] **Step 3: Render the digest**

Create `scratchpad\h3\digest.ts`:

```ts
import { writeFileSync } from "node:fs";
import data from "./data.json";
import { buildDigest } from "../../../../../../../../Users/nazho/Desktop/ires-crm/.claude/worktrees/monitor-critique/src/scraper/monitorDigest";
const rows = (data.keepers as any[]).filter((r) => r.bestExit === "FLIP" || r.bestExit === "RENTAL").slice(0, 5);
const { subject, html } = buildDigest(rows, { baseUrl: "https://crm.instantrealestatesolution.com", moreOnBoard: 12, date: "Oct 3" });
console.log(subject);
writeFileSync(new URL("./digest3.html", import.meta.url), html);
```

If the relative import path is awkward, use an absolute `file:///C:/Users/nazho/Desktop/ires-crm/.claude/worktrees/monitor-critique/src/scraper/monitorDigest.ts` import instead. Run it from the worktree: `npx tsx "<scratchpad>\h3\digest.ts"`. Expected stdout: `IRES Monitor: N worth a look`. If `data.json` has fewer than 2 FLIP/RENTAL rows (it predates Phase 2), set `bestExit` on the first rows in the script ("FLIP" with `roomVsList`/`flipMao`, "RENTAL" with `cashFlow`/`dscr`) so both card variants render.

Serve `digest3.html` through the same vite server (it lives in `h3`, the vite root) and capture `p3-email-390.png` (390x1400) and `p3-email-700.png` (700x1400) from `http://localhost:5198/digest3.html`.

- [ ] **Step 4: Check every screenshot against the Design Direction (one batched pass)**

Open each PNG with the Read tool and check this list. Note each failure.
- Board 1440:
  - no h1; status strip shows last scan and "N new since you looked";
  - tabs carry counts; filters and sort sit on the right;
  - the table has 6 columns with right-aligned tabular numbers;
  - the verdict is green for positive and red for negative;
  - exit badges are teal / sky / violet;
  - no zebra striping; new dots are visible; the hint row is under the table;
  - no yellow button on the board (only Run now, outline).
- Board 390:
  - no horizontal scroll (the right edge is clean);
  - 64px thumbs; address + 2 number lines; rows edge-to-edge;
  - tabs fit or scroll inside their own strip.
- Sheet 1440 and 390:
  - the panel is wide (about 576px at 1440, full width at 390), not the 3/4-width `max-w-sm` default;
  - photo strip; Value/Flip/Rental grids; "Verify before you bid" with amber icons;
  - red flags read as plain English (no `_`, no `zipTier:`);
  - Promote is the only yellow button; Zillow link present.
- Sheet missing: "This deal is no longer available." with no crash.
- Email 390 and 700:
  - header "N worth a look"; each card at most 300px tall at 390;
  - 96px thumb on the right; 3-cell number row; one reason line; at most one flag;
  - one "Review deal" button on dark teal; no white-on-amber; footer "12 more on the board".

Fix every failure in one batch in the real source files, re-run Step 2/3 captures once, and stop (bounded verification: build, inspect once, fix, confirm once).

- [ ] **Step 5: Run the Impeccable detector once**

Run: `sh C:/Users/nazho/.claude/skills/impeccable/scripts/impeccable detect --json src/web/MonitorPage.tsx src/web/monitor/BoardTable.tsx src/web/monitor/DealSheet.tsx src/web/monitor/ExitBadge.tsx src/web/monitor/PassMenu.tsx`
Fix findings that are real (contrast, missing labels, layout shifts). List any you judge false positives in the commit body.

- [ ] **Step 6: Full gate + tear down**

Run: `npx vitest run; npx tsc --noEmit; npx tsc --noEmit -p convex; npm run build` — all green. Stop the vite server. The harness stays in the scratchpad (nothing to revert in the repo; `git status --short` must show no harness files).

- [ ] **Step 7: Update memory**

- `memory/todo.md`: mark the "Phase 3 — triage UI" line `[x]` with a one-line summary and the final commit hash. Add an open item if Task 5 (Run now) was dropped or still needs a prod decision.
- `memory/memory.md`, in the Monitor section, add 3-5 lines:
  - `/monitor` is now a per-user triage inbox (tables `monitorTriage`, `monitorSeen`; functions `board`, `listingForMe`, `setTriage`, `markSeen`, admin `requestScan`);
  - the digest is built by `src/scraper/monitorDigest.ts` (deep link `/monitor?id=`);
  - shared presentation lives in `src/scraper/monitorPresent.ts`.
- Do NOT edit `CLAUDE.md`.

- [ ] **Step 8: Commit**

```bash
git branch --show-current
git add memory/todo.md memory/memory.md   # plus any source files fixed in Step 4/5
git commit -m "chore(monitor): phase 3 visual verification fixes + memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BLSGv8DSEn1gkdquU5iXLV"
```

---

## Self-Review

**1. Spec coverage**

| Spec item | Where |
|---|---|
| Header: last scan time | Task 7 |
| Header: "N new since you looked" (per-user seen state) | Task 3 `newSinceCount`, Task 4 `markSeen`/`monitorSeen`, Task 7 baseline capture |
| Header: Run now | Task 5 (built new; flagged deviation) + Task 7 `RunNow` |
| Tabs New / Shortlist / Passed / All | Task 3 `inTab`/`tabCounts`, Task 7 |
| Exit toggle group, ZIP select, sort select (offer gap / cash flow / score / newest) | Task 3, Task 7 |
| Dense table: divide rows, no zebra, color only for status | Task 7 + Design Direction |
| Page title in the top bar | Design Direction (breadcrumb already shows it; h1 removed) |
| Columns thumb, score+exit badge (one hue per exit), address, list, verdict cell, row actions Pass/Shortlist/open | Task 7 `BoardTable`, `ExitBadge` |
| Verdict cell per exit, right-aligned tabular-nums | Task 1 `verdictFor`, Task 7 |
| Phone 390: 64px thumb + numbers, edge-to-edge, no horizontal scroll | Task 7 phone list, Task 9 check |
| Sheet: photos, numbers grid (all listed fields) | Task 1 `numberGroups`, Task 8 |
| Sheet: verify checklist | Task 8 |
| Sheet: humanized red flags | Task 1 `humanizeFlag`/`displayFlags`, Task 8 |
| Sheet: analyst note, agent phone | Task 8 |
| Sheet: Zillow link through safeHref (S25-3) | Task 1 `safeHref`, Task 8, Task 8 Step 3 grep |
| Sheet: Promote (yellow) | Task 8 |
| Sheet: Pass with 5 reasons | Task 2 `PASS_REASONS`, Task 7 `PassMenu`, Task 8 |
| Sheet: Snooze 7 days | Task 2, Task 8 |
| Keyboard J/K/P/S/Enter/Esc | Task 3 `boardKeyAction`/`nextIndex`, Task 7 handler, Radix Esc |
| Per-user state + where it lives (justified) | Resolved ambiguities, Task 4 (`board` + `boardState` split) |
| requireUser on all mutations | Task 4 (`setTriage`, `markSeen`), Task 5 `requireAdmin` |
| ConfirmDialog, never window.confirm | Task 7 `RunNow`; pass is reversible, so no confirm needed |
| No "spread vs ARV" labels | Task 1 `spreadBasisLabel`, Task 6 test |
| Loading skeleton | Task 7 `BoardSkeleton`, Task 8 sheet skeleton |
| Empty states incl. "Nothing new tonight — the filters are working" | Task 7 `EMPTY` |
| Email subject "N worth a look" | Task 6 |
| Email: FLIP/RENTAL only | already enforced by `keepersToEmail`/`partitionDigestRows` (Phase 1); unchanged |
| Email card: exit + score, address, 96px side thumb, 3-cell Outlook-safe number table per exit | Task 6 |
| Email card: one-line reason | Task 6 (`oneLineReason`) |
| Email card: one "Review deal" CTA to /monitor?id= | Task 6 |
| Page opens the sheet for ?id= | Task 7 route + Task 8 |
| Email: AA contrast (#1F7A66, no white-on-amber) | Task 6 palette + test |
| Email: max 1 humanized flag | Task 6 |
| Email: analyst line only on disagreement and score >= 50 | Task 1 `analystNote`, Task 6 test |
| Email: esc on everything | Task 6 + XSS tests |
| Email: mobile-first, ~200px per card | Task 6 layout, Task 9 check (target relaxed to <= 300px, see Resolved ambiguities) |
| Email footer "N more on the board" | Task 6 `activeKeeperCount` |
| Visual verification at 1440/390 and digest at 390/700 | Task 9 |

No gaps.

**2. Placeholder scan:** no TBD/TODO/"similar to". Every code step shows its code. The `{/* DEAL SHEET MOUNT (Task 8) */}` comment in Task 7 is a content anchor that Task 8 replaces, not a placeholder for missing work.

**3. Type consistency:**
- `TriageState`, `PassReason`, `applyTriage(a, now)`, `triageStatus(t, now)` are identical in Tasks 2, 3, 4, 7, 8.
- `verdictFor` returns `{ value, caption, tone, sortKey }` in Tasks 1 and 7.
- `BoardListing` (Task 7) is the `board` projection (Task 4) merged with a `boardState` triage entry. It carries every `BoardRow` field used by `monitorBoard.ts`: `_id`, `firstSeen`, `propZip`, `triage`, `bestExit`, `roomVsList`, `cashFlow`, `dealScore`, `spread`, `zestimate`, `flipMao`, `dscr`.
- `PassMenu` props match in Tasks 7 and 8. `DealSheet` props match its mount in Task 8 Step 2. `TONE_TEXT` is exported from `BoardTable.tsx` (Task 7) and imported by `DealSheet` (Task 8).

**4. Review Focus:** the five items above each name their pinning test or check. Two extra edge tests (snooze expiry, stale running row) are in Tasks 2-3.

## Execution

Subagent-driven (orchestrator's choice): one fresh implementer per task, then a reviewer gate, in order 1 → 9. Tasks 1, 2, 3 and 6 are independent pure modules and may run in parallel worktrees if the orchestrator wants. Tasks 4 → 5 → 7 → 8 are sequential. Task 9 runs last.
