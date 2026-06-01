# Instant Real Estate Solution — CRM + Automation (Design Spec)

**Date:** 2026-06-01
**Slice 1:** Sheriff Sales scraping automation, button-triggered + scheduled, inside a branded CRM. Replaces the Railway + n8n + FastAPI pipeline entirely.

> **⚠️ FOUNDATION UPDATED (2026-06-01):** After evaluation, the CRM foundation changed from
> "build from scratch on Convex/Clerk/TanStack" (described below) to **self-hosted Twenty**
> (open-source CRM) with the automation as a **native Twenty logic function**. The Convex
> sections below are retained for context, but the **scraping core, data model, fan-out
> enrichment model, guardrails, and error codes still apply unchanged** — they're
> foundation-agnostic. See `docs/TWENTY-ARCHITECTURE.md` for the current target.

## Goal

A CRM where a non-technical team member clicks **"Scrape Sheriff Sales This Week"** and the system:
1. Scrapes the New Castle County Sheriff Sale PDF (via Firecrawl cloud API).
2. Parses the listings, cleans addresses.
3. Enriches each listing with NCC parcel data + Zillow data (via Firecrawl).
4. Writes everything to a Convex database.
5. Shows the data live in a branded table, with a deal-pipeline status per listing.

No Railway. No n8n. No Docker. No self-hosting headaches.

## Why this is feasible

The only true external dependency is **Firecrawl's hosted API** (`api.firecrawl.dev`). Firecrawl runs the headless browser in *their* cloud (this is how the parcel lookup bypasses Reblaze bot protection). Everything Railway/n8n/FastAPI did was *orchestration glue* — markdown parsing, address cleaning, looping, writing to Sheets. That glue is plain code and moves into Convex.

> Note: This is **not** the same as the GBP/social automation, which drives a real logged-in Chrome locally. That requires persistent authenticated browser sessions and is out of scope here. Sheriff Sales is 100% public data via Firecrawl cloud.

## Stack

- **Frontend:** Vite + React + TypeScript + **TanStack Router** (SPA) + TailwindCSS. Deploy target: Cloudflare Workers static assets.
- **Backend / DB:** **Convex** (reactive DB + serverless functions + built-in cron).
- **Auth:** **Clerk** (Convex + Clerk first-class integration; `ctx.auth.getUserIdentity()`).
- **Scraping:** Firecrawl REST API called via `fetch()` from Convex's default V8 runtime (no `"use node"`, no SDK dependency).
- **LLM (Legal Notices fast-follow only):** OpenRouter or Anthropic for prose extraction.

## Architecture

```
TanStack SPA (Cloudflare Workers)
  "Scrape Sheriff Sales" button  +  live reactive table
        │ Clerk-authed mutation            ▲ Convex reactive query
        ▼                                   │
CONVEX
  startRun (mutation, Clerk-gated, idempotent)
     → schedules scrapeAndParse (internalAction) via ctx.scheduler.runAfter
  scrapeAndParse (internalAction)
     → Firecrawl scrape PDF → parse table → clean addresses
     → insert N listing rows (status: pending)
     → fan-out: schedule N × enrichListing (internalAction)
  enrichListing (internalAction, one per listing)
     → Firecrawl parcel lookup + Zillow scrape → patch the row
  daily cron → gate query (pure logic) → only then scrapeAndParse
  tables: scrapeRuns, listings
        │ fetch()
        ▼
  Firecrawl (PDF · parcel browser-actions · Zillow)
```

### Enrichment model: fan-out (decided)

`scrapeAndParse` writes all listing rows immediately as `pending`, then schedules one `enrichListing` action per listing. Benefits:
- No action time-limit risk (each unit is small and independent).
- One bad listing never fails the whole run.
- The Convex-reactive table fills in live — this *is* the "show progress" UX.

Start with plain `ctx.scheduler.runAfter` + per-row retry (2 attempts, backoff). Add `@convex-dev/workpool` to bound concurrency **only if** Firecrawl rate-limits force it (YAGNI).

## Data model

### `scrapeRuns`
| field | type | notes |
|---|---|---|
| type | `"sheriff" \| "legal"` | pipeline kind |
| saleMonth | string | e.g. "June 2026" |
| status | `"running" \| "complete" \| "failed"` | |
| listingCount | number | rows parsed |
| enrichedCount | number | rows finished enriching |
| triggeredBy | string | Clerk user id / "cron" |
| startedAt / finishedAt | number | epoch ms |
| error | optional string | failure reason |

### `listings`
Scraped: `type, attorney, plaintiff, courtCaseNumber, defendant, address, parcel, status, principal`.
Enriched (parcel): `ownerName, propertyAddress, assessmentTotal, countyBalanceDue, schoolBalanceDue, sewerBalanceDue`.
Enriched (Zillow): `zillowUrl, zestimate, beds, baths, sqft`.
System: `runId (ref scrapeRuns), saleMonth, enrichmentStatus ("pending"|"enriched"|"failed"), parcelError, zillowError`.
**Pipeline-ready (for future deal tracking):** `dealStatus ("new"|"reviewing"|"contacted"|"offer"|"dead")`, `notes`, `updatedAt`. Indexed by `runId`, `saleMonth`, `dealStatus`, `parcel`.

## Guardrails (non-technical team safety)

- **Idempotency:** `startRun` refuses if a run is already `running`, or if the current month is already scraped — unless `force: true` is passed (a deliberate "Re-scrape" override in the UI). Prevents accidental double Firecrawl spend.
- **Auth:** every entry point checks `ctx.auth.getUserIdentity()`. No identity → reject.
- **Gate:** daily weekday cron runs a pure-logic gate query (checks last successful run + whether the current-month PDF is published). Firecrawl is only called when a run is actually due — ports the existing `checkStartDate` behavior.

## Scraping logic (ported, source of truth = existing Pydantic schemas + n8n code)

- **PDF parse:** markdown table → listing objects (lift `Parse Table Data` n8n node).
- **Address cleaning:** truncated zips, missing spaces, AKA stripping, DE-state enforcement, ZIP_ONLY fallback (lift `cleanAddress` verbatim into TS).
- **Parcel parse:** detail-page markdown table → 14 fields (port `parcel_scraper._parse_markdown_fields`).
- **Zillow:** build search URL, scrape markdown, extract beds/baths/zestimate/sqft/lot, validate `-DE-` in URL (port `zillow_scraper`).
- **Error codes** (max 2 words) preserved in cells: `SCRAPE FAILED, NOT FOUND, NO ADDRESS, WRONG STATE, NO PARCEL, NO STATE, BAD ADDRESS`.

All pure logic lives in `convex/lib/*` modules, unit-testable with vitest and runnable as a standalone integration script against real Firecrawl — so the automation is verified independent of Convex/Clerk/Cloudflare being provisioned.

## Branding — Instant Real Estate Solution

Wholesaling / flipping / buy-and-rent. Professional real-estate aesthetic: trustworthy, modern, data-dense but clean. Palette + type finalized via the ui-ux-pro-max skill. Logo/wordmark "Instant Real Estate Solution" in header; deal-focused dashboard.

## Slice-1 scope

**In:** scaffold; Convex schema; Sheriff Sales scrape framework (button mutation + scrapeAndParse + fan-out enrichListing + cron/gate); branded CRM shell (auth-gated layout, dashboard, Sheriff Sales table with live updates + deal-status editing); local end-to-end test against real Firecrawl; security review.

**Fast-follow (not deeply specced):** Legal Notices pipeline (reuses framework + LLM extraction).

**Deferred:** full contacts/CRM, dashboards beyond counts, Google Sheet dual-write (optional safety net later), deployment to Cloudflare (user provisions accounts tomorrow).

## Verification standard

1. Unit tests (vitest) for parser + address cleaner against fixtures.
2. Integration script hits real Firecrawl: PDF → parsed listings, one parcel lookup, one Zillow lookup — assert populated data.
3. Convex local dev (anonymous, if available on Windows) → trigger a run → confirm rows populate and enrich.
4. `tsc` typecheck + production build pass.
5. Security review (security-review skill) + agent code review.
