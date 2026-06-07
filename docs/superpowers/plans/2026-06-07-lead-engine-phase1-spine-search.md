# Lead Engine Phase 1 — Parcel Spine + Absentee + Search (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.
> Master spec: [`../specs/2026-06-06-wholesaling-lead-engine-design.md`]. Source proof: [`../../../memory/source-matrix.md`].

**Goal:** Ingest every NCC parcel (free ArcGIS spine) into a `parcels` table keyed on `PRCLID`, derive **absentee**, keep it
fresh with a `PRCLID` key-diff CDC, and ship a **parcel/owner search page**. Additive; serverless; free.

**Architecture:** Pure tested parser (`src/scraper/arcgisParcels.ts`) reused by Convex; `parcelData.ts` (V8 queries/mutations)
+ `parcelActions.ts` (`"use node"` seed/sync, resumable via `scrapeRuns`, self-rescheduling batches); weekly cron; React search page.

**Tech:** Convex, TanStack Router, shadcn (dark), vitest. **Layer = `BaseMaps/Base_Layers/MapServer/0`** (CDC proven). Seed = paginated API.

**Decisions (advisor-locked 2026-06-07):** spine layer = `BaseMaps/Base_Layers/0`; seed via paginated API (not bulk download);
batch upserts in bounded chunks, store `resultOffset` on the run, `ctx.scheduler.runAfter` to continue; **absentee is NOT a raw
string compare** — `OWNSTATE≠DE` ⇒ absentee; in-state ⇒ compare normalized street-number + ZIP (else "undetermined", don't flag).

---

## Task 1: Pure parser/derivation `src/scraper/arcgisParcels.ts` (TDD) — THIS unit first
**Files:** Create `src/scraper/arcgisParcels.ts`; Test `tests/arcgisParcels.test.ts`.
- [ ] **Types + URL builders:** `Parcel` interface; `ARCGIS_PARCELS_QUERY` const; `buildParcelPageUrl({offset,pageSize})`
  (`where=1=1&outFields=*&orderByFields=PRCLID&returnGeometry=false&resultRecordCount&resultOffset&f=json`);
  `buildKeyPageUrl({offset,pageSize})` (`outFields=PRCLID&orderByFields=PRCLID…`).
- [ ] **`parseParcelFeature(attrs)` → Parcel:** map `PRCLID`, situs (`ADDRESS/STNO/STNAME/PROPCITY/PROPSTATE/PROPZIP`),
  `PROPCLASS`, `LOTSZ`, owner (`CNTCTLAST`→ownerName, `OWNADDR/OWNADDR2/OWNCITY/OWNSTATE/OWNZIP/OWNCOUNTRY`). Trim/squash whitespace; null-safe.
- [ ] **`deriveAbsentee(parcel)` → {absentee, reason}:** `OWNSTATE` present & ≠ "DE" ⇒ `{true,"out-of-state"}`; else compare
  `streetNo`(leading digits) + `zip5` of situs vs owner-mailing — both present & differ ⇒ `{true,"in-state-absentee"}`;
  both match ⇒ `{false,"owner-occupant"}`; indeterminate ⇒ `{false,"undetermined"}`.
- [ ] **`parcelContentHash(parcel)` → string:** stable FNV-1a over the meaningful fields (for CDC in-place change detect).
- [ ] **Tests (fixtures from real probe rows):** parse maps fields; absentee for (a) out-of-state PA owner [real `0600100003`],
  (b) owner-occupant same #+ZIP but messy spacing ⇒ not absentee, (c) in-state different #+ZIP ⇒ absentee, (d) missing owner ⇒ undetermined;
  hash stable for same input + changes when a field changes. Run `npm test -- arcgisParcels`.

## Task 2: Schema + `convex/parcelData.ts`
**Files:** Modify `convex/schema.ts` (add `parcels`); Create `convex/parcelData.ts`.
- [ ] **`parcels` table:** `prclid`(string), situs fields, `propClass`, `lotSz`(number), owner fields, `ownerName`,
  `absentee`(bool), `absenteeReason`(string), `contentHash`(string), `firstSeen`(number), `lastSeen`(number), `active`(bool).
  Indexes: `by_prclid`, `by_owner_state`, `by_active`; **searchIndex** `search_owner` (ownerName) + `search_address` (address).
- [ ] **Internal mutations:** `upsertParcelsBatch({rows})` — for each, find by `by_prclid`; insert (set firstSeen) or patch only when
  `contentHash` changed; always bump `lastSeen`. `markInactive({prclids})`. **Queries:** `searchParcels({q})`, `getParcel({prclid})`,
  `ownerParcels({ownerName})` (absentee-portfolio), `parcelStats()` (counts: total/active/absentee). All `requireUser`.
- [ ] Verify: `npx convex dev --once` (codegen clean) then `npm run build`.

## Task 3: `convex/parcelActions.ts` — seed + CDC sync (resumable)
**Files:** Create `convex/parcelActions.ts` (`"use node"`).
- [ ] **`seedSpine`** internalAction: paginate full-field pages (1000) from `offset` (stored on a `scrapeRuns` row, type `parcelSeed`),
  parse → `deriveAbsentee` + `contentHash` → `upsertParcelsBatch` in chunks; after each page `runAfter(0, continue)` until `< pageSize`
  returned; finalize run. Idempotent (re-run safe via upsert). Explicit return type (TS7023).
- [ ] **`syncSpine`** internalAction (CDC): pull full PRCLID key list (key pages, `orderByFields=PRCLID`); diff vs stored set →
  new/missing; enrich only new PRCLIDs (full-field fetch + upsert); `markInactive` the vanished. Finalize run.
- [ ] **Cron** (`convex/crons.ts`): weekly `syncSpine`.
- [ ] **PROVE (live, dev):** `npx convex run parcelActions:seedSpine` → `parcelStats` count ≈ **203,752**; absentee a sane fraction;
  spot-check a known out-of-state owner; re-run seed → count stable, no dupes. (This is the milestone to show before building the UI.)

## Task 4: Search page (UI)
**Files:** Create `src/web/ParcelSearch.tsx`; route in `src/web/app.tsx`; nav item in `app-sidebar.tsx`.
- [ ] Search box (parcel # OR owner name) → results table: address, owner, **absentee badge**, propClass. Row → detail w/ the owner's
  **other parcels** (absentee portfolio) + `PropertyMap`/Street View reuse. Dark shadcn; lucide icons (never emoji).
- [ ] Verify build + a live click-through (search returns rows; absentee badge shows; map renders).

## Task 5: Wrap-up
- [ ] `npm test` (all green) + `npm run build` clean. Commit per task (explicit paths). Merge to `main` only after live seed proven.
- [ ] Update memory docs; Phase 2 (code-violations signal) next.

## Guardrails
- Additive only — no change to Sheriff/Legal/Flip/Properties/`deal.ts`. Branch `feat/lead-engine-phase1-spine`.
- `schema.ts` + `_generated` are entangled — build inline/sequential; if any parallel session, isolate (worktree + `CONVEX_AGENT_MODE=anonymous`).
- Convex `"use node"` = actions only; annotate action return types; `ConvexError` for user-facing; create run first + finalize in try/catch.
