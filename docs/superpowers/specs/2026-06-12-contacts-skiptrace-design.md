# P5 — Contacts + Skip-Trace with DNC/TCPA Compliance (Design)

_Date: 2026-06-12. Status: APPROVED (user, this session). The fifth pipeline phase from
`2026-06-11-wholesaling-pipeline-crm.md`: per-lead paid skip-trace → owner phones/emails with
compliance flags, an internal do-not-contact layer, and a call-attempt log. Strictly additive.
**Compliance framing is informational, NOT legal advice** — the spec encodes the conservative
baseline for manual dialing only._

## Locked scope decisions (user-confirmed)
1. **Provider: Tracerfy** (tracerfy.com) — self-serve Bearer-token REST API, pay-per-hit
   (**5 credits = ~$0.10 per hit, 0 credits on miss**, credits don't expire, no subscription),
   synchronous instant-lookup endpoint, response includes per-phone **DNC status** + person-level
   **litigator/deceased/owner flags**, typed phones (mobile/landline), emails, mailing address.
   Provider sits behind a pure parser (`src/scraper/skipTrace.ts`) so a swap to BatchData
   (research runner-up: best data, enterprise-leaning access) is one parser + one URL.
   Research artifacts: `.firecrawl/tracerfy-docs.md` (full API doc), `.firecrawl/search-*.json`.
   **User setup step:** create the Tracerfy account, load ~$10 credits, set `TRACERFY_API_KEY`
   on Convex dev + prod.
2. **Trigger: per-lead button only** — "Skip trace ($0.10)" in the expanded lead row. No batch
   in v1 (trace only leads you're about to work; contact data ages).
3. **Compliance v1 = full baseline (manual dialing only, no SMS/autodialer):** provider DNC +
   litigator flags stored per phone and visually gated; internal do-not-contact list (per phone
   AND per person, timestamped, with reason); quiet-hours warning (8am–9pm ET); every call
   attempt logged.
4. **Call log: yes, minimal** — timestamp + outcome (`no-answer | spoke | bad-number |
   dnc-request`) + note; `dnc-request` auto-adds to the internal DNC layer. This is the TCPA
   record-keeping and feeds the future P3 outreach log.

## Legal context (summary, not legal advice)
TCPA telemarketing = "encouraging the **purchase or rental of, or investment in**, property,
goods, or services." Calls offering to BUY a house are a contested gray zone (some courts have
held buy-side calls are not telephone solicitation; FCC/FTC enforcement and state mini-TCPAs are
tightening regardless, and professional litigators target wholesalers — fines run $500–$1,500
per violation). The defensible baseline for manual dialing: honor provider DNC/litigator flags,
keep an internal opt-out list with timestamps, observe quiet hours, log every attempt. v1 keeps
ALL liability-heavy channels (autodialer, SMS blast, RVM) out of scope.

## Approach chosen (A of 3)
One `contacts` row per parcel with phones as an embedded array + a `contactAttempts` log table —
mirrors the `parcelEquity` pattern (prclid-keyed, funnel-only-tiny, fetched per-parcel on row
expand; the leads list query is untouched). Rejected: (B) normalized per-phone table (joins +
mutations for a theoretical dedup win at 50–300 traces/mo — YAGNI); (C) contact fields on
`leadStatus` (wrong layer — workflow state vs paid enrichment data).

## Schema (additive)
- `contacts`: `{ prclid, provider: "tracerfy", tracedAt, personName?, age?, deceased?, isOwner?,
  litigator?, phones: Array<{ number, type, dnc, carrier?, internalDnc?, internalDncAt?,
  internalDncReason?, badNumber? }>, emails: string[], doNotContact?, doNotContactAt?,
  doNotContactReason?, lastError?, updatedAt }` — index `by_prclid`. One row per traced parcel;
  re-trace overwrites provider data but **merges** internal flags.
- `contactAttempts`: `{ prclid, phone?, outcome: "no-answer" | "spoke" | "bad-number" |
  "dnc-request", note?, at, byEmail }` — index `by_prclid`. Email stamped server-side from the
  caller (errorLogs precedent), never trusted from the client.

## Pure logic (TDD, `src/scraper/skipTrace.ts`)
- `parseTracerfyPerson(json)` → normalized contact. Multiple persons returned → prefer the
  owner-flagged person, else the first. Miss (`credits_deducted: 0`, no person) → null.
- `mergeInternalFlags(existing, fresh)` — re-trace must NEVER wipe internal DNC/bad-number
  marks: match phones by number, carry `internalDnc*`/`badNumber` forward.
- `isCallable(phone, contact)` → `{ callable, reason }`: provider `dnc` ∨ person `litigator` ∨
  `internalDnc` ∨ `badNumber` ∨ person `doNotContact` ⇒ not callable, with the specific reason.
- `isQuietHours(now)` → outside 8am–9pm **Eastern** (DE is ET). UI adds an owner-state caveat
  when `ownerState ≠ DE` ("absentee owner in {state} — their local time governs").

## Convex
- `convex/contactData.ts` (V8): `contactForParcel` (query) · `attemptsForParcel` (query) ·
  `logAttempt` (mutation; `dnc-request` outcome atomically sets the phone's `internalDnc` —
  or person-level `doNotContact` when no phone given) · `setInternalDnc` / `setDoNotContact`
  (mutations, toggleable with reason) · internal `storeContact` + `getContactInternal`
  (CLI verify). All browser-callable fns `requireUser`; shared-team model.
- `convex/contactActions.ts` (`"use node"`): `skipTraceLead({ prclid })` public action —
  auth via `internal.users.getCallerInternal`; reads the spine row via a small internal query;
  POSTs Tracerfy instant lookup (address-based; Bearer `TRACERFY_API_KEY`;
  `AbortSignal.timeout(30_000)` per the hung-fetch lesson); parses → merges internal flags
  against any existing row → `storeContact`. Failures land on `contacts.lastError`
  (visible, never silent); a miss (costs $0) stores a "no match" marker (tracedAt set, empty
  phones) so the UI shows "no contact found — traced {date}" rather than an untraced state.

## UI (/leads expanded row — `LeadContacts` panel below the equity panel)
- "Skip trace ($0.10)" button (busy + inline error via `describeError`).
- Result: person name + owner/deceased/**litigator** badges (litigator = red).
- Phones: type label, callable numbers as `tel:` links; **blocked numbers red, link disabled,
  reason chip** (DNC / litigator / internal DNC / bad number) via `isCallable`. Per-phone
  "Mark DNC" and "Bad number" toggles. Emails as `mailto:` links.
- Person-level red "Do not contact this owner" toggle (reason prompt).
- **Quiet-hours banner** when outside 8am–9pm ET — warning, not a hard block (manual dialing
  stays at the operator's discretion); absentee out-of-state caveat line.
- Attempts log: rows (time, outcome, phone, note, who) + add form (outcome select, optional
  phone select, note). Compliance footnote: "Flags are informational, not legal advice."
- lucide icons only; dark-theme conventions as in `LeadEquity`.

## Error handling
Per-trace failures → `contacts.lastError` + UI surfacing; user-facing throws are `ConvexError`;
`describeError` in every catch shown to users (prod-redaction lesson). Tracerfy 429 (rate
limit) surfaces as a retryable error message.

## Testing & verification
Vitest on `skipTrace.ts` (parser fixtures from the documented response shapes incl. owner-hit /
person-hit / miss; merge semantics incl. re-trace preserving internal flags; `isCallable` matrix;
quiet-hours boundaries). Full suite + build + `convex dev --once` green. Live dev verify (after
the user provides `TRACERFY_API_KEY`): one real trace on a signal-bearing parcel → row stored,
flags rendered, attempt logged, dnc-request round-trip. The action without the key set throws a
clear "TRACERFY_API_KEY is not set" (not a silent no-op).

## Deferred (documented, not built)
SMS/autodialer/RVM integrations · batch tracing · periodic DNC re-scrub cron (flags refresh on
re-trace; Tracerfy has dedicated scrub endpoints when needed) · federal SAN registry
subscription · LLC/trust entity resolution · cross-parcel phone dedup · click-to-call via a
dialer integration.

## Untouched
The leads list query (contacts load per-parcel on expand), Sheriff/Legal/Flip/Properties,
parcel seed/sync, signals, equity. Purely additive.
