# Wholesaling Lead Engine — Phase 0 Research Plan

> **For agentic workers:** Phase 0 is **research / read-only probing only — NO app code** (no schema, no UI, no
> committed Convex functions). The spec permits "tiny throwaway probe outputs." Steps use `- [ ]` for tracking.
> Spec: [`docs/superpowers/specs/2026-06-06-wholesaling-lead-engine-design.md`](../specs/2026-06-06-wholesaling-lead-engine-design.md).

**Goal:** Produce the **Source Matrix** (`memory/source-matrix.md`) and prove the ArcGIS parcel-spine mechanics, so
that Phase 1+ can be specced without further discovery.

**Approach:** Per-signal discovery via the harness `WebSearch`/`WebFetch`; endpoint *shape/data* verification (which
requires a real outbound fetch) via a **throwaway deployed Convex `internalAction` on the cloud dev deployment**
(`fearless-donkey-585`) run with `npx convex run` — because **this dev sandbox blocks outbound HTTP** (lessons
2026-06-04: WebFetch/curl to external hosts hang; the anonymous *local* backend is also on this blocked machine, so
only the *cloud* deployment can reach the internet). The probe is removed and dev re-synced clean afterward.

**Tech context:** NCC ArcGIS REST (`gis.nccde.org/agsserver`), DE FirstMap open data, NCC/DE court + county record
sources. Signal taxonomy & source starting-points: [`memory/next-initiative-offmarket.md`](../../../memory/next-initiative-offmarket.md).

---

## The two organizing questions (apply to every signal)
1. **Access:** free API / scrape / browser-required / paid?
2. **Cadence mechanism:** **dated-delta feed** (pull only records since a watermark — name the cursor/date field) **or
   per-parcel-only** (no feed → re-check only the funnel on a tiered cadence)?

A complete row also records: endpoint(s), fields available, geo (covers NCC?), rate-limit/ToS, est. cost.

---

## Task 1: Spine-sync proof (ArcGIS Parcels layer) — throwaway Convex probe

**Files:**
- Create (throwaway, NOT committed): `convex/probePhase0.ts` — an `internalAction` that `fetch`es the ArcGIS layer.
- Output: notes folded into `memory/source-matrix.md` (spine row + a "spine proof" appendix).

- [ ] **Step 1: Write the probe action.** An `internalAction` (no args) that performs, against
  `https://gis.nccde.org/agsserver/rest/services/BaseMaps/Base_Layers/MapServer/0/query`:
  - (a) `where=1=1&returnCountOnly=true&f=json` → total parcel count.
  - (b) one page `where=1=1&outFields=PRCLID&returnGeometry=false&resultRecordCount=1000&resultOffset=0&f=json` →
    confirm pagination shape + `exceededTransferLimit`; record payload byte size of the 1000-key page.
  - (c) one full-field page `outFields=*&resultRecordCount=5` → capture 5 sample features (situs + `OWNADDR*`/`OWNSTATE`
    + `PRCLID`) to validate the **absentee** derivation (owner mailing ≠ situs OR `OWNSTATE`≠DE) and field presence.
  - Return `{ totalCount, pageKeyBytes, exceededTransferLimit, sample: [...] }`. Annotate the return type (TS7023).
- [ ] **Step 2: Deploy to cloud dev + run.** `npx convex dev --once` (validates + pushes to `fearless-donkey-585`),
  then `npx convex run probePhase0:run` (dev deploy key from `.env.local`). Cloud has network; local does not.
  Expected: a real `totalCount` (~190–210k), a clean 1000-key page, sample features with `PRCLID`/`OWNADDR*`/`OWNSTATE`.
- [ ] **Step 3: Record findings** in the matrix's spine row + appendix: total count, key-page payload size (proves the
  CDC key-diff is cheap), pagination behaves, absentee derivation sound on the sample, and **which value/owner fields
  are present vs absent** (confirms assessed value / full owner are NOT here → Phase 5 branch decider).
- [ ] **Step 4: Probe sibling free layers** in the same action (or a second run): check whether **assessed value** /
  **full owner name** exist on *any* free NCC/FirstMap layer (e.g. FirstMap statewide parcels, a Hub-hosted assessment
  layer). Record endpoint + fields or "not found free → per-parcel/paid."
- [ ] **Step 5: Remove the probe + re-sync dev clean.** Delete `convex/probePhase0.ts`; run `npx convex dev --once`
  so the dev deployment no longer carries the throwaway function. Confirm `git status` shows no `convex/` app changes
  (only the expected `_generated` CRLF drift, which we do NOT commit here).

## Task 2: Source Matrix — per-signal discovery (WebSearch/WebFetch)

**Files:**
- Create: `memory/source-matrix.md` (the deliverable).

For each signal below, run WebSearch (and WebFetch where reachable) to fill: endpoint(s) · access · dated-feed? + cursor
field · fields · geo(NCC?) · rate-limit/ToS · est. cost. **Timebox each row (~10 min); if unresolved, write
"unknown — needs live probe" and name the exact next probe** rather than rabbit-holing.

- [ ] **Step 1: Parcel spine + owner-mailing/absentee** — already proven free (Task 1); write the row from findings.
- [ ] **Step 2: Assessed value / full owner name** — NCC assessment / Board of Assessment; FirstMap; any free layer vs
  per-parcel parcel-site (Reblaze browser) vs paid. (Branch decider for Phase 5.)
- [ ] **Step 3: Tax & sewer balances** — NCC tax/sewer billing lookup; is there a list/feed or per-parcel-only?
- [ ] **Step 4: Code violations / property-maintenance / condemnations** — NCC code enforcement / L&I; dated case feed?
- [ ] **Step 5: Lis-pendens / mortgage-foreclosure filings** — DE courts docket (Superior/CCP) + NCC Recorder of Deeds
  Document Search; newly-filed feed + cursor (case filed-date)? access (browser/CAPTCHA)?
- [ ] **Step 6: Tax-delinquent / monition (tax-sale) list** — NCC Sheriff/tax-sale published list; annual vs dated.
- [ ] **Step 7: Probate / Register of Wills** — NCC Register of Wills filings (beyond the weekly Legal Notices PDF);
  dated feed?
- [ ] **Step 8: Vacancy** — HUD aggregated USPS vacancy dataset (quarterly; geo granularity — tract/ZIP vs parcel?);
  access (registration?), cadence (quarterly cursor).
- [ ] **Step 9: (note-only) skip-trace + AVM/comps** — list candidate providers + rough cost (BatchData/REISkip;
  ATTOM/HouseCanary) as a Phase 5 pointer; not fully specced here.
- [ ] **Step 10: Write `memory/source-matrix.md`** — the table (one row per signal) + per-signal access/cadence verdict
  + a "spine proof" appendix (Task 1 numbers) + an "open questions / next live probes" list + a short
  **recommendation** for which signal Phase 2 should implement first (dated-feed + high-leverage wins).

## Task 3: Wrap-up (no code)

- [ ] **Step 1: Self-check** the matrix against the spec's Phase 0 success criteria: for every signal we know access
  method, dated-feed-vs-funnel-only, and whether it forces a browser/paid path.
- [ ] **Step 2: Update memory docs** — `memory.md` (Phase 0 result line), `todo.md` (Phase 0 done → Phase 1 next),
  `next-session-prompt.md` (point at Phase 1 spec as the next step). Commit docs + `source-matrix.md` + this plan
  together (explicit paths; NOT `git add -A`). Co-author trailer.
- [ ] **Step 3: Hand off** — Phase 1 (`parcels` spine + absentee + search page) gets its own spec→plan next session.

---

## Notes / guardrails
- **Serverless only**; the probe is throwaway and removed — no committed Convex code in Phase 0.
- **CDC key = `PRCLID`, never `OBJECTID`** (county reload reassigns OIDs).
- Don't trust local `curl`/WebFetch reachability as proof of an endpoint being down — the sandbox blocks it; the cloud
  Convex probe is the source of truth for "does this endpoint return data."
- Stage explicit paths on commit; the long-lived untracked artifacts (`.agents/`, `.claude/`, etc.) stay out.
