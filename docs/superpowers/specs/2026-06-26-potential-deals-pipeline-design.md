# Potential — Curated Deals Pipeline (design)

_Date: 2026-06-26. Status: APPROVED (design). A new `/potential` page: the curated board of houses the team
is **actively working** (door-knocking / cold-calling), promoted by hand from Leads, Sheriff, or Legal. The
three find-surfaces stay as discovery; Potential is the active-deal CRM. **Strictly additive** — no change to
the /leads, Sheriff, or Legal pipelines or their tables/status fields._

## Decisions (locked with the user)
- **Stages: minimal** — `to_work → contacted → negotiating → under_contract → closed → dead`.
- **Sits alongside /leads** — Potential is a separate, additive pipeline; existing per-source status tracking
  (leadStatus / sheriff+legal dealStatus) is untouched and keeps working.
- **Primary UI: Kanban board** — 6 stage columns; a card moves stage via a quick per-card stage control (the
  same pattern the existing /leads board uses — NOT literal drag-and-drop; true DnD is a later enhancement).
  Clicking a card opens a deal-detail drawer with the activity log.
- **Tracking: full activity log + next action** — per deal, log each touch (call / door-knock / text / email /
  note + outcome + free note + timestamp) and set the next follow-up.
- **Contact = manual** — team types contact name/phone/email on the deal (no skip-trace; Tracerfy explicitly out).

## Data model (2 new tables; nothing existing changes)

### `potentialDeals`
One row per worked house. De-duplicated by `dedupeKey`.
```
prclid: v.optional(v.string())               // present when promoted from a lead (or a sheriff row w/ a parcel)
dedupeKey: v.string()                         // prclid if known, else normalizeAddress(address); upsert target
source: v.object({
  kind: v.union("lead","sheriff","legal","manual"),
  refId: v.optional(v.string()),             // source row _id (string) or prclid — back-link only
})
// snapshot at promotion (display + so a promoted deal survives source edits/deletes)
address: v.string()
ownerName: v.optional(v.string())
propCity: v.optional(v.string())
propZip: v.optional(v.string())
beds: v.optional(v.string())
baths: v.optional(v.string())
sqft: v.optional(v.number())
value: v.optional(v.number())                 // as-is value snapshot
equity: v.optional(v.number())
score: v.optional(v.number())                 // lead score snapshot (if from a lead)
topSignals: v.optional(v.array(v.string()))   // signal type strings snapshot (if from a lead)
// manual contact
contactName: v.optional(v.string())
contactPhone: v.optional(v.string())
contactEmail: v.optional(v.string())
// pipeline
stage: v.union("to_work","contacted","negotiating","under_contract","closed","dead")
notes: v.optional(v.string())
nextFollowUpAt: v.optional(v.number())        // ms — drives the card "next:" + overdue badge
nextFollowUpNote: v.optional(v.string())
createdByEmail: v.optional(v.string())
createdAt: v.number()
updatedAt: v.number()
```
Indexes: `by_dedupeKey` (["dedupeKey"]), `by_stage` (["stage"]).

### `dealActivities`
The touch log (one row per logged contact attempt / note).
```
dealId: v.id("potentialDeals")
type: v.union("call","door_knock","text","email","note")
outcome: v.optional(v.string())               // free text; UI offers chips: no answer / left VM /
                                              //   spoke-interested / not interested / callback
note: v.optional(v.string())
occurredAt: v.number()                         // when the touch happened (default now, editable)
createdByEmail: v.optional(v.string())
createdAt: v.number()
```
Index: `by_deal` (["dealId"]).

## Pure logic — `src/scraper/potentialPipeline.ts` (vitest-tested)
- `POTENTIAL_STAGES` (ordered array) + `STAGE_LABELS` + a stage→color/tier map (mirror `wholesalePipeline.ts`).
- `dealDedupeKey({ prclid?, address }): string` — `prclid` (trimmed) when non-empty, else
  `normalizeAddress(address)` (reuse/adapt the cleaner in `src/scraper/address.ts`: uppercase, strip
  punctuation, collapse whitespace). Tested: prclid wins; same address with different casing/punctuation →
  same key; blank both → "".
- `ACTIVITY_TYPES` + labels + an `outcome` suggestion list.
- `nextActionLabel(at, now)` — reuse `relativeDueLabel` from `src/scraper/commandCenter.ts` if available, else
  add here. Tested.

## Backend — `convex/potentialData.ts` (V8 queries/mutations; all `requireUser`; shared-team)
- `promoteToPotential(args: { source, prclid?, address, ownerName?, propCity?, propZip?, beds?, baths?, sqft?, value?, equity?, score?, topSignals?, contactName?, contactPhone?, contactEmail? })` →
  compute `dedupeKey`; look up `by_dedupeKey`; if found return `{ id, alreadyExisted: true }` (do NOT
  overwrite an in-progress deal); else insert with `stage:"to_work"`, snapshot fields, `createdByEmail` from
  the caller, timestamps → `{ id, alreadyExisted: false }`.
- `listDeals()` → all deals (small table) for the board (include `nextFollowUpAt` for badges). Sort newest-updated.
- `dealByDedupeKey({ dedupeKey })` → the deal id or null (so the source pages can show "In Pipeline" + link).
- `getDeal({ id })` → the deal. `activitiesForDeal({ dealId })` → activities desc by `occurredAt`.
- `setDealStage({ id, stage })` → patch stage + updatedAt.
- `updateDeal({ id, patch })` → patch contact/notes/snapshot-editable fields + updatedAt (explicit allowed fields; no blind spread).
- `setNextFollowUp({ id, at?, note? })` → set/clear next action (undefined clears).
- `addActivity({ dealId, type, outcome?, note?, occurredAt? })` → insert (default `occurredAt = Date.now()`),
  stamp `createdByEmail`, bump deal.updatedAt.
- `deleteActivity({ id })`, `deleteDeal({ id })` (cascade-delete its `dealActivities`).
All return values explicit; validators on every arg.

## Frontend
- **Route + nav:** add `/potential` route in `src/web/app.tsx`; add a "Potential" nav item (lucide icon, e.g.
  `Target`/`ClipboardList`) to the sidebar (`src/components/app-sidebar.tsx` / `app-shared.tsx`).
- **`src/web/PotentialPage.tsx` — Kanban board.** 6 stage columns; each card shows address (+ city/zip), the
  score/value snapshot, contact name/phone, stage, and a next-action badge (overdue = red, today = amber —
  reuse the funnel-widget palette). A per-card stage control (shadcn `Select` or prev/next buttons) moves the
  card (`setDealStage`). Loading skeletons + empty states. Dark theme, lucide icons, NO emojis.
- **Deal detail drawer** (shadcn `Sheet` or `Dialog`): snapshot facts (read-only) + a Zillow/Map link if data
  present; editable contact (name/phone/email) + notes (`updateDeal`); next-action setter (`setNextFollowUp`);
  the **activity log** — a list (type icon + outcome + note + relative time) and a "log a touch" form (type
  chips, outcome chips + free text, note, date defaulting to now → `addActivity`). Delete deal (ConfirmDialog).
- **"Move to Potential" button** on:
  - Leads (`src/web/LeadsPage.tsx`, in the `LeadWorkflow` area of the expanded row) — carries prclid + the
    lead snapshot (address, owner, value, equity, score, top signal types).
  - Sheriff + Legal rows (`src/web/pages.tsx`) — carries the listing snapshot (address, owner, zestimate→value,
    beds/baths/sqft; prclid from the sheriff `parcel` field when present).
  Use `dealByDedupeKey` to render "In Pipeline" + a link to `/potential` when already promoted; else the button
  calls `promoteToPotential` then navigates/toasts. Reuse `describeError(err).message` for failures.

## What is explicitly UNTOUCHED
`/leads` scoring + leadStatus + followUps, Sheriff/Legal tables + their dealStatus, equity/condition/offers/
contracts, the spine + signal engine. No existing Convex function is modified. (The promote buttons are new
additions to LeadsPage/pages.tsx, not changes to existing logic.)

## Testing
- Pure: `tests/potentialPipeline.test.ts` — `dealDedupeKey` (prclid wins; address normalization equivalence;
  blank), stage config integrity, `nextActionLabel`.
- Backend behavior is exercised via the pure dedupe logic + manual click-through (Convex fns are thin CRUD).
- `npm test` all green; `npm run build` clean.

## Build / ops notes
- Branch `feat/potential-pipeline` off `main`. Adds 2 tables to `convex/schema.ts` → **regenerate
  `convex/_generated` via the OFFLINE anonymous backend** (`CONVEX_AGENT_MODE=anonymous npx convex dev --once`)
  so the shared dev deployment + the concurrent session are not disturbed; commit the regenerated `_generated`
  (CI typecheck needs it). This is a 3rd schema-adding branch in flight (hardening did NOT touch schema;
  command-center did NOT) → on merge, whichever lands after regenerates `_generated` against the merged tree.
- Built TDD via Opus subagents; main loop verifies `npm test` + `npm run build` + a clean commit (explicit
  paths only — never stage `memory/*`, `.agents/`, `.claude/`, `skills-lock.json`).
- NOT merged/deployed until the user says so.

## Task breakdown (implementation order)
1. Pure `src/scraper/potentialPipeline.ts` + `tests/potentialPipeline.test.ts` (TDD).
2. `convex/schema.ts` — add `potentialDeals` + `dealActivities`. Regenerate `_generated` (anonymous backend).
3. `convex/potentialData.ts` — the queries/mutations above.
4. `src/web/PotentialPage.tsx` (board) + deal-detail drawer + route + nav item.
5. "Move to Potential" buttons on LeadsPage + Sheriff/Legal (pages.tsx), with "In Pipeline" state.
6. `npm test` + `npm run build` green; commit.

## Future (out of scope for v1)
True drag-and-drop; surfacing Potential deals' due follow-ups on the Command Center; auto-promote rules;
linking a Potential deal to a generated offer/contract; condition score on the card.
