# Lead Engine — Enrichment Sourcing + Product Vision + Imagery/CV Roadmap

_Date: 2026-06-07. Captures: (1) the **free-first → paid-later** strategy, (2) HOW to source every remaining flag
(free / scrape / paid / software), (3) the **satellite/aerial computer-vision** feasibility for condition signals, and
(4) the **commercial product vision**. Companion to [`distress-signals.md`](distress-signals.md) (WHAT signals) and
[`source-matrix.md`](source-matrix.md) (NCC sources for the free ones). Sources at bottom._

## Strategy (user-set, 2026-06-07)
**Get as many flags as possible FOR FREE; build the engine on those NOW; design the architecture so paid + imagery/CV
enrichment slot in later without a rewrite.** End goal: **robust, top-of-the-line software that finds distressed homes
BEFORE they hit the market** — a defensible gold mine of leads we can **wholesale, flip, or sell** as a data/lead product.
The moat = assembling stacked public data (mostly free) that competitors don't bother to wire together, + our own
condition scoring. Implement free → prove → add paid tiers where ROI justifies.

## Enrichment tiers (cheapest → most expensive) — the spine of the architecture
The 4-layer architecture (spine · signal streams · scoring · tiered enrichment) stays. Enrichment is **tiered + funnel-only**
(only spend on a parcel that already carries a free signal / is on a watchlist / in target geo — NEVER the full 203k):

| Tier | What | Cost | When (roadmap) |
|---|---|---|---|
| **T0 — Free GIS (NCC ArcGIS)** | spine + absentee, code violations, vacant, monition candidates, rentals, permits, sheriff sales | **Free** | **NOW (Phase 1–3)** |
| **T1 — Free court/record scrape** | pre-foreclosure/lis-pendens, judgments + recorded liens, probate, free-and-clear (no open mortgage) | **Free** (scrape; verify ToS) | Phase 2–4 |
| **T2 — Per-parcel value/balance** | assessed value, tax/sewer balances, deed/mortgage detail | Free-but-browser (Firecrawl, funnel-only) or cheap API | Phase 4–5 |
| **T3 — Paid bulk/enrichment** | AVM/equity (RentCast/ATTOM), skip-trace phones/emails (+DNC), owner-age/senior | $ usage-based | Phase 5 |
| **T4 — Imagery / computer vision** | condition score from aerial/Street View (overgrown yard, roof damage, debris) | DIY-cheap → enterprise | Phase 6+ (the "satellite" idea) |

## How to source every remaining flag (the research answer)
| Flag | Source | Access / cost | Notes |
|---|---|---|---|
| **Pre-foreclosure / lis-pendens** | **DE CourtConnect** `courts.delaware.gov/docket.aspx` (Superior Court) | Free scrape (verify CAPTCHA/ToS) | Judicial-foreclosure filings; filterable by case type + date → dated feed. **The #1 upstream signal.** |
| **Judgment liens** | CourtConnect civil judgments | Free scrape | Court money judgments attach to property. |
| **Recorded liens (mechanic's/HOA/IRS/tax) + mortgages + deeds** | **NCC Recorder of Deeds** Document Search `newcastlede.gov/144/Document-Search` | Free-ish (per-doc) scrape | Also gives **mortgage presence** → *free-and-clear* detection (no open mortgage = high equity). |
| **Free-and-clear / high equity** | Recorder of Deeds (no open mortgage) + value (below) − recorded liens | Free-ish (derive) | Equity is the **ranking multiplier** (distress-signals.md). "No mortgage on record" is a strong free proxy. |
| **Bankruptcy** | **PACER** (federal: DE Bankruptcy Court) | ~$0.08/page (cheap-paid) | Chapter 7/13; not free but low cost. |
| **Divorce** | DE **Family Court** | **CONFIDENTIAL — NOT public** | ⚠ Drop as a free flag in DE; only inferable via paid skip-trace/people-data. Document so we don't chase it. |
| **Probate / inherited** | Register of Wills "Wills Finder" + **our existing weekly Legal Notices PDF** | Free | Already have the PDF feed; expand via Wills Finder. |
| **Assessed value / tax & sewer balances** | NCC "personal search" parcel lookup (Reblaze) | Browser (funnel-only) or paid | Open lead: hunt a free bulk source first (source-matrix.md). |
| **AVM / market value (ARV-ish)** | **Existing Zillow scrape** (`zillow.ts`) / **RentCast** (cheap) / ATTOM/HouseCanary (paid) | Free (have) → $ | No truly-free bulk AVM exists; keep Zillow funnel-only. |
| **Skip-trace (phones/emails + DNC)** | BatchData / REISkip / Homesage | ~$0.10–0.15/hit (paid) | Phase 5; **DNC/TCPA-gated** before any outreach. |
| **Owner age / senior / tenure** | tenure = derive from deed date (free); age = paid people-data | Free (tenure) / $ (age) | Long tenure is a free proxy for "propensity to sell." |
| **National vacancy** | USPS/HUD | Restricted (gov/nonprofit) + tract-only | Use NCC's free **parcel-level** vacant list instead. |

## Satellite / aerial computer-vision condition signals (the "LiveSatellite" idea)
**Verdict: real, valuable, and architecturally plannable — but a later/optional tier (T4), and "real-time satellite" is
the wrong/expensive framing.** What the pros actually use is **aerial imagery (flown 1–2×/yr) + AI**, not live satellite.

- **Enterprise CV providers (do exactly what you described):** **Cape Analytics** (AI roof condition, yard debris,
  vegetation, pool — API; works off Vexcel/EagleView/Nearmap imagery), **Nearmap "Betterview"** (130+ features:
  roof condition, debris, vegetation overhang), **EagleView "Reveal"** (roof condition, vegetation encroachment). All
  **enterprise/quote-priced (expensive)** — the end-of-roadmap, "we're at scale and it pays for itself" option.
- **Cheap DIY path WE can build (recommended first):** we already have a **Google Maps key**. Pull **Google Street View
  Static** (front-of-house) + **Google Solar/aerial** imagery (roof geometry + aerial RGB) — or free **NAIP** aerial —
  for a flagged parcel, then run an **LLM vision model via OpenRouter** (or a small CV model) to score: overgrown grass,
  junk/debris, tarped/damaged roof, boarded windows, distressed exterior. Output a 0–100 "condition distress" score =
  a **physical-distress signal** (distress-signals.md category 3). Costs pennies per house, funnel-only.
- **Why this fits the architecture cleanly:** it's just **another signal source feeding `signalEvents`** + an enrichment
  step in T4 — no schema change beyond a new signal type. Funnel-only (only score parcels already flagged by free
  signals). Start DIY (Street View + LLM-vision), upgrade to Cape Analytics if/when volume + accuracy demand it.
- **"Real-time" caveat:** true real-time/frequent satellite (Planet, Maxar) is costly and overkill — a house's grass/roof
  doesn't change daily. Recent aerial (annual) + on-demand Street View is enough and cheap. Design for "latest available
  imagery," not "live." (Note: Street View can be a few years stale; aerial is fresher — use both, prefer aerial for roof.)

## Commercial / product vision (why we build it robust)
- **Internal use:** our own pipeline to find + wholesale/flip distressed homes off-market (speed-to-lead advantage).
- **Sellable product:** a **lead-gen / data SaaS** (or lead marketplace) — stacked-signal distressed-home leads for NCC
  (then multi-county) that are hard for others to assemble. The CV condition score + signal-stacking + skip-trace +
  off-market timing = a premium, defensible offering priced high because the data is valuable and hard to get.
- **Design implications baked in NOW (so no rewrite later):** (1) generic `signalEvents` (any source/category/date);
  (2) tiered, funnel-only enrichment (cost control); (3) config-driven scoring weights (tune per market/buyer);
  (4) multi-county-ready (NCC first, but key on county+APN, not NCC-only assumptions); (5) provenance on every datum
  (so we can sell/audit it); (6) compliance hooks (DNC/TCPA) before outreach.

## Sources
- CV/imagery: capeanalytics.com/blog, nearmap.com/products/betterview + /products/insights/roof-condition, eagleview.com, developers.google.com/maps/documentation/solar/overview
- Court/records: courts.delaware.gov/docket.aspx (CourtConnect), deb.uscourts.gov (PACER bankruptcy), newcastlede.gov/144/Document-Search (Recorder of Deeds); DE divorce confidential (Family Court).
- Value/AVM: rentcast.io/api, attomdata.com, housecanary.com/blog/real-estate-api, homesage.ai/resources/blog/8-best-property-evaluation-apis-in-2026
- Signals/stacking: see distress-signals.md sources.
