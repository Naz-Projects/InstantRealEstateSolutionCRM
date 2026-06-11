# P3 — Outreach Log + Mail Automation (Design)

_Date: 2026-06-11. **STATUS: DEFERRED — backlogged by user decision.** Build at the END of the pipeline
build-out, together with the other notification/polish work (email notifications, mobile UI). Rationale:
the pipeline shape may still change, and alerts/notifications built now would have to change with it.
The design below is fully brainstormed + scoped (user answered the 4 scope questions); pick it up as-is._

## Locked scope decisions (user-confirmed 2026-06-11)
1. **Email alerts:** include via **Resend** REST API (plain `fetch`, no SDK), gated on `RESEND_API_KEY`
   env — without the key the cron no-ops gracefully. `RESEND_FROM` default `onboarding@resend.dev`
   (free tier delivers only to the account owner's email until the domain is verified — fine for v1).
2. **Responses:** **manual mark on lead** — "Mark responded" stamps the lead's most recent un-responded
   outreach entry. (Responses arrive by phone; per-batch checkbox grids rejected as over-build.)
3. **Templates:** **free-text label** per batch (e.g. "postcard-v1"). No template editor/content storage.
4. **Hot lead (for alerts):** **score ≥ 70 OR any new pre-foreclosure signal** (union).

## Approach chosen (A of 3)
Two tables — `outreachBatches` + per-lead `outreachLog` rows. Rejected: (B) single table with implicit
batch grouping (batch-level ops awkward); (C) outreach as `signalEvents` rows (wrong layer — signals feed
scoring; outreach is human workflow state, the `leadStatus`/`followUps` family).

## Design

**Schema (additive):**
- `outreachBatches`: `{ template, notes?, channel: "mail", sentAt, sentCount }` — index `by_sentAt`.
- `outreachLog`: `{ batchId, prclid, respondedAt? }` — indexes `by_prclid`, `by_batch`.

**Logging a batch (/leads):** "Log mail batch" button beside the existing CSV export → small dialog
(template label, notes, checkbox "advance new → contacted", default on). Confirm = one mutation: insert
batch + one log row per currently-filtered lead (client already holds the filtered prclids, ≤200 = the
leads-query cap), optionally advance stage, AND download the same mail CSV (one click = export + record).
The plain "Export mail list" button stays for no-log exports.

**Responses:** in the expanded lead detail on /leads, an outreach-history block (each batch the lead was
in, sent date, responded date) + "Mark responded" button.

**Non-responder re-export (/outreach page):** new light page listing batches (template, date, sent,
responses, response rate) with per-batch "Re-export non-responders" → same CSV format, only members
without `respondedAt`. Nav item next to /buyers.

**Hot-lead email alerts (cron):** `"use node"` action `alertActions.sendHotLeadAlert`, daily cron
12:00 UTC (after the Mon/Tue signal syncs). Reuses the `signalWatermarks` pattern
(`source: "hot-lead-alert"`): signal events with `firstSeen` > watermark → score their parcels → hot per
rule above → digest email (address, owner, score, signal types, link to /leads) to active admin users.
`AbortSignal.timeout(30_000)` on the fetch (hung-fetch lesson). Partial failure → watermark does NOT
advance (foreclosure-sweep lesson). Errors → `logServerError`.

**Pure logic (TDD):** `src/scraper/outreach.ts` — `summarizeBatch` (response-rate math),
`pickNonResponders`, `isHotLead(score, signalTypes)`, `buildHotLeadEmail(leads)` (HTML string). Reuses
existing `buildMailCsv`. Convex split per convention: `outreachData.ts` (V8, all `requireUser`) +
`alertActions.ts` (`"use node"`).

**Untouched:** Sheriff/Legal/Flip/Properties/parcel sync — purely additive.

## Revival note
The **outreach-log half** (batches, responses, non-responder re-export) is pipeline workflow with no
external dependency — it can be pulled forward independently of the email-alert half whenever real mail
starts going out, even before the end-of-pipeline notification phase.
