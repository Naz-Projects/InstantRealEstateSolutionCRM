# IRES CRM → Full Wholesaling Pipeline — Gap Analysis & Architecture

_Date: 2026-06-11. User directive: "the CRM should be a full-on wholesaling pipeline — seamless from
one step to the next, to selling houses, to buying houses… find the gaps… think about scalability,
architecture, and future implementation that can be ADDED." This doc maps the industry-standard
wholesaling flow onto the CRM, names every gap, and defines the ADDable build order. Modeled on the
patterns of PropStream/BatchLeads (lead gen + stacking), REsimpli/InvestorFuse (pipeline + follow-up),
and InvestorLift (disposition) — built serverless on our stack instead of $200+/mo subscriptions._

## The wholesaling value chain — and where the CRM stands

| # | Stage | Industry tool pattern | IRES CRM today | Gap |
|---|---|---|---|---|
| 1 | **Lead generation** | PropStream lists, drivers, MLS | ✅ BEST-IN-CLASS path: parcel spine (203k) + absentee + code violations + **pre-foreclosure court sweep** (months earlier than competitors' data vendors) + sheriff/legal scrapers | More signals later (vacant, rentals, monition — free, same table) |
| 2 | **Lead qualification / scoring** | BatchRank, Quick Lists | ✅ Rules scoring (stack × recency × absentee), /leads | Equity gate (value − liens) = funnel-only enrichment (researched, Phase 5); vision condition score (~$1/1k, researched) |
| 3 | **Lead pipeline / workflow** | REsimpli stages, InvestorFuse | ❌ **GAP → built this session**: `leadStatus` stages + notes | Kanban board view; follow-up tasks/reminders; per-lead activity log |
| 4 | **Contact / skip-trace** | BatchSkipTracing ($0.10/hit) | ❌ GAP (Phase 5, paid + **DNC/TCPA-gated** — designed before any outreach) | `contacts` table keyed to prclid+owner; provider integration |
| 5 | **Outreach** | smrtPhone, direct-mail vendors | ◐ **Mail-list CSV export built** (owner mailing is free) | Outreach log (what sent/when/response); later: email (Resend) / SMS (Twilio, TCPA) |
| 6 | **Underwriting / offer** | Flipster calculators | ✅ Flip Analyzer (ARV/comps/MAO/grade) + sheriff cushion math | Offer tracking (amount/date/status/counter) on the lead; lead→Flip handoff (built this session) |
| 7 | **Contract** | DocuSign, REI contract packs | ❌ GAP | `offers`/`contracts` fields on leadStatus v2; e-sign integration later |
| 8 | **Disposition / buyers** | InvestorLift, buyer blasts | ❌ **GAP → built this session**: `buyers` CRM + assignment fields | Buyer-match (target zip/price ⋈ lead), blast email, showings |
| 9 | **Closing / actuals** | QuickBooks, spreadsheets | ✅ Properties + unified ledger (flip P&L, rental cash flow) | Auto-handoff: assigned lead → Properties row (built: seed-from exists) |
| 10 | **KPIs / reporting** | REsimpli dashboards | ◐ Dashboard (runs, market data) | Funnel KPIs: leads by source/stage, conversion %, speed-to-lead, fee per deal |

**Verdict: the CRM's acquisition engine (1-2, 6, 9) is already stronger than the off-the-shelf stacks
— the missing middle is workflow (3-5, 7-8, 10).** This session ships the workflow spine (stages +
buyers + handoffs); the rest are ADDable phases below.

## Architecture rules that make everything ADDable (no rewrites)
1. **`prclid` is the join backbone.** Every workflow artifact (status, contacts, offers, outreach,
   assignments) keys to the parcel spine. Leads stay DERIVED (signals ⋈ parcels ⋈ leadStatus) —
   human workflow state lives in small per-parcel tables, never duplicated parcel data.
2. **Signals are an open vocabulary** — new sources (vacant, rentals, lis-pendens variants, vision
   scores) are just new `signalEvents` rows + a parser; scoring weights are config.
3. **Tiered, funnel-only enrichment** — paid data (skip-trace, value) only ever runs against parcels
   that already carry signals/stages, never the 203k.
4. **Compliance before outreach** — DNC/TCPA module gates any automated contact (fines $500–1,500/msg);
   direct mail (no consent needed) ships first.
5. **Additive phases** — each phase = new tables + new pages; existing pipelines untouched; spec →
   plan → TDD → live-verify per phase (the project's proven loop).
6. **Multi-county-ready** — keep county implicit in prclid/source for now; introduce a `county` column
   when expansion happens (documented, not speculatively built).

## The pipeline data model (v1 built this session, v2+ sketched)

```
parcels (spine) ──< signalEvents (distress)        [built]
    │
    ├──< leadStatus (stage, notes, buyer, fee)     [v1 BUILT: stage machine + notes + assignment]
    │       stages: new → contacted → negotiating → under_contract → marketing → assigned → closed → dead
    ├──< contacts (owner people + phones/emails)   [v2: skip-trace, DNC flags]
    ├──< outreachLog (mail/call/sms/email events)  [v2: what/when/response]
    ├──< offers (amount, date, status, counters)   [v2]
    └──< assignments → properties (actuals)        [v1: buyerId+fee on leadStatus; close → seed Properties]

buyers (cash-buyer CRM)                            [v1 BUILT: type, target areas, max price]
tasksReminders (follow-ups, per lead, due dates)   [v2]
```

## Build order (each ADDable, in ROI order)
- **NOW (this session): pipeline v1** — `leadStatus` stages + notes + stage filter/select on /leads;
  `buyers` CRM page; assignment (buyer + fee) at marketing/assigned stages; handoffs (lead → Flip
  Analyzer prefill; closed lead → Properties seed path already exists via address).
- **P1 — funnel KPIs + Kanban:** stage-grouped board view of /leads; dashboard funnel card (count by
  stage, conversion, median days-in-stage). Pure UI/query over v1 tables.
- **P2 — follow-up discipline:** `tasksReminders` (due-date tasks per lead) + "next action" on the
  board + overdue badge. This is the single biggest conversion lever in REsimpli-style systems.
- **P3 — outreach log + mail automation:** log mail batches (which leads, which template, date) so
  responses tie back; one-click re-export of non-responders. Email alerts on new hot leads (cron).
- **P4 — equity gate:** funnel-only value (Zillow/comps scrapers exist) + delinquent balances
  (monition PDFs) + free-and-clear proxy (Recorder, per-doc) → equity multiplier into the score config.
- **P5 — contacts + skip-trace (paid, DNC/TCPA module first)** → call/SMS workflows.
- **P6 — offers/contracts:** offer history per lead; e-sign integration (DocuSign/Dropbox Sign API).
- **P7 — vision condition scoring** (~$1/1k houses, researched) as a `signalEvents` source.
- **P8 — disposition pro:** buyer-match query (lead ⋈ buyers on area/price), buyer blast (Resend),
  showings scheduling.

## Scalability notes
- Convex paid plan (done 2026-06-11) removes the quota ceiling; current design is differential
  everywhere (writes only on change). At 10× signal volume the leads query should move from
  collect-and-group to a paginated/indexed pattern or a materialized `leadScores` table — defer until
  event count > ~20k (measure first).
- Court sweep, ArcGIS pulls, and future enrichment are all watermark + overlap + idempotent-upsert —
  safe to re-run, safe to miss a week.
- UI scales by filters/limits (leads query caps at 200 rows server-side; board groups the same data).
