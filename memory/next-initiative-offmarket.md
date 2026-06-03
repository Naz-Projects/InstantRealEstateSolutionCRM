# Next Initiative — Off-Market & Pre-Foreclosure Acquisition Engine

_Research + build plan. Goal: find distressed / motivated-seller houses (especially pre-foreclosure)
**before they hit the MLS**, reach the owner first, run the flip/wholesale math, and automate it inside the
IRES CRM. This is the strategic upgrade from "scrape the public auction" to "catch the owner upstream."_

## Thesis — move upstream
Our two current pipelines are **late-stage / public**:
- **Sheriff Sales** = the *auction* — the foreclosure is basically over; max competition, owner often already gone.
- **Legal Notices** = estate/probate — a good *early* signal, but only one source.

The money is **upstream**: the earlier you reach a distressed owner, the more deals and the **less competition**
(you're talking to them off-market while they can still sell to you). The same house we catch at the sheriff sale
was a **foreclosure complaint filed in court months earlier** — that's the window we're missing today.

---

## Part 1 — The 5 data layers a deal actually needs
For every property/owner you must assemble:

| Layer | Question | Examples / fields |
|---|---|---|
| **A. Distress signal** (the trigger) | *Why* would they sell? | pre-foreclosure, tax delinquent, probate, code violation, vacancy, divorce, eviction, bankruptcy |
| **B. Ownership & property** | *Who* owns *what*? | owner name(s), mailing≠situs (absentee), LLC/trust, APN, beds/baths/sqft/year, last sale, deed |
| **C. Equity & financials** | Is there *room* for a deal? | AVM/value − mortgage balance − liens = **equity** (high equity = a seller who *can* sell) |
| **D. Contact (skip trace)** | *How* to reach them? | mobile/landline phones, emails, relatives — **+ DNC/TCPA flags** |
| **E. Deal math** | *What* to offer? | ARV (comps) − repairs, **70% rule** MAO, cushion tier (we already have `deal.ts`) |

### Distress signals, ranked roughly by conversion / leverage
1. **Probate / inherited** — ~5–12% close (vs 2–5% typical); **~60% have no mortgage** (no price floor). *We partly do this via Legal Notices; expand to Register of Wills.*
2. **Pre-foreclosure** — **foreclosure complaint / lis pendens FILED** in court / recorded with the county. Comes **months before** the sheriff sale we already scrape. **← the #1 upgrade.**
3. **Tax delinquent** — county tax office / monition (tax sale) lists; financial stress + often equity.
4. **Code violations / condemnations** — code enforcement / L&I.
5. **Vacancy** — HUD/USPS quarterly vacancy data (90+ days no mail) + utility shutoffs + drive-for-dollars confirmation.
6. **Divorce / bankruptcy / eviction** filings (eviction = tired landlords).
7. **Absentee / out-of-state owners** (owner mailing ≠ property address).
8. **High equity + long tenure** (30+ yrs, seniors downsizing) → "propensity to sell."
9. **Expired / withdrawn / cancelled MLS, FSBO, "coming-soon"/pocket listings**, liens/judgments (HOA, mechanic's, IRS).
10. **Signal stacking = highest intent**: e.g. *vacant + tax-delinquent + absentee* on one parcel → top priority.

---

## Part 2 — How the big companies do it (to copy / compete with)
- **Enterprise data feeds:** ATTOM (158M properties, incl. a *Propensity-to-Default* score), CoreLogic (5.5B records, AVM), ICE/Black Knight, **First American DataTree** (~94%+ ownership accuracy), Regrid (parcels), HouseCanary (AVM/forecast API).
- **Investor platforms** (bundle the above + lists + skip trace): **PropStream** (160M properties, 70M MLS, 308M deeds, 185M mortgages, 150M liens), **BatchData/BatchLeads** (API-first, 1000+ data points), DealMachine, REsimpli, PropertyRadar.
- **Predictive propensity-to-sell / -to-list ML:** models score hundreds of variables — length of ownership, equity, inferred life events (retirement, divorce, death), property condition, even online listing-search behavior — to reach owners **before they list**. iBuyers (Opendoor/Offerpad) and hedge funds run AVMs + propensity at scale.
- **Marketing/outreach engine:** multi-touch **direct mail** (yellow letters/postcards), **cold calling** (power dialers: Mojo, BatchDialer), **SMS** (Launch Control, Smarter Contact), RVM, PPC/SEO ("we buy houses"), agent/wholesaler networks — all on **speed-to-lead + long follow-up** cadences. Everything is **TCPA/DNC-gated**.
- **Disposition:** cash-buyer list + JV with other investors.

---

## Part 3 — How to build it into the IRES CRM
The existing stack (**Convex** reactive DB + crons, **Firecrawl** scraping, **OpenRouter** LLM extraction,
TanStack/shadcn UI) already proves the pattern: *button → scrape → enrich → pipeline → live UI*. We extend it,
we don't rebuild it.

### New lead-source pipelines (each mirrors the current sheriff/legal scraper)
1. **Pre-foreclosure (lis pendens / foreclosure complaints) — NCC/Delaware.** Scrape the Delaware courts docket (Superior Court / Court of Common Pleas, `courts.delaware.gov/docket.aspx`) + **NCC Recorder of Deeds** lis-pendens recordings (`newcastlede.gov/144/Document-Search`) for **newly-filed mortgage-foreclosure cases**. *Highest leverage: same houses as our sheriff-sale scraper, months earlier.*
2. **Tax delinquent** — NCC tax / monition (tax-sale) lists.
3. **Code violations / condemnations** — NCC code enforcement / L&I.
4. **Vacancy** — HUD aggregated USPS vacancy dataset (quarterly) + cross-reference; optional drive-for-dollars mobile capture.
5. **Probate (expand)** — Register of Wills filings (beyond the weekly Legal Notices PDF).
6. **Divorce / eviction / bankruptcy** — court records.
7. **Absentee + high-equity (derived)** — from assessor/deed data (owner mailing ≠ situs; long tenure; low/no mortgage).
8. **(Optional) 3rd-party API** instead of/alongside scraping — ATTOM or BatchData for nationwide coverage + propensity + skip trace in one call.

### New backend (Convex)
- **`leads` table** — unified across all sources: signal type(s), property facts, owner(s), equity, `dealStatus`, score, lastContact. *Dedup by parcel → one lead can carry multiple stacked signals (= higher score).*
- **`contacts` table** (owners / defendants / personal reps) + a **skip-trace** action (BatchSkipTracing / REISkip API) → phones/emails **with DNC/TCPA flags**.
- **Lead scoring** — rules first (stacked signals × equity × recency), an OpenRouter/ML propensity model later.
- **Deal analyzer** — generalize `src/scraper/deal.ts`: ARV (comps via Zillow/ATTOM) − repair estimate → **70% MAO** + reuse the existing cushion-tier logic.
- **Alerts/notifications** — new high-score lead → email/SMS to the team (already on the todo).
- **Outreach automation (compliance-gated)** — generate skip-traced, **DNC-scrubbed** call/SMS/mail lists; optional dialer/SMS/mail-vendor integration; log every touch + response.
- **Cron** — schedule each source (the cron pattern already exists).

### New UI (shadcn, dark theme)
- A unified **Leads** view + the **Kanban deal board** (already on the todo) across all sources; filter by signal / score / equity.
- **Lead detail:** signals timeline, contact + skip-trace, deal math, outreach log, map + Street View (reuse `PropertyMap`).
- **Dashboard:** leads by source/signal, equity in pipeline, conversion funnel (we've started this).

---

## Part 4 — Decisions to make next session
1. **Build vs. buy the data.** Scrape DE county/court sources ourselves (free, owned, local, matches our model) **vs.** license a data API (ATTOM/BatchData — nationwide + propensity + skip trace, but $$ + ToS limits). **Likely hybrid:** scrape DE pre-foreclosure/tax/code (cheap, high-signal, local) + an API for **skip trace** and **AVM/comps**.
2. **Source legality/feasibility** — verify each DE/NCC source is publicly accessible + scrapable within ToS/rate limits (courts docket, recorder of deeds, tax, code enforcement). Some courts throttle or CAPTCHA — Firecrawl browser-actions + stealth may be needed (we already handle Reblaze on the parcel site).
3. **Skip-trace provider + TCPA/DNC design** — REISkip pay-per-hit (~$0.10–0.15/record) to start, BatchData API to scale. **Non-negotiable before any automated outreach:** scrub Federal + State DNC + known-litigator lists, honor internal DNC + opt-outs + quiet hours, document consent. TCPA fines run ~$500–$1,500 **per** message.
4. **ARV/comps source** — keep scraping Zillow (we do) vs. an AVM API (ATTOM/HouseCanary).
5. **Scoring** — rules engine first; revisit ML/propensity once we have labeled outcomes (which leads actually closed).
6. **Outreach channel + tooling** — direct mail vs. SMS vs. cold call; integrate a vendor vs. just export compliant lists.
7. **Legal/ethical** — this is regulated marketing; confirm DE rules, never mislead distressed owners, give clear opt-outs.

## Concrete first step (highest leverage)
Build the **pre-foreclosure (lis-pendens / foreclosure-complaint) scraper for New Castle County** and wire it into a
new unified **`leads`** pipeline + **`contacts`/skip-trace** + basic lead scoring. Rationale: it surfaces the *exact
same* properties we currently catch at the sheriff-sale (auction) stage, but **months earlier**, while the owner can
still sell to us off-market — directly serving "find them before they go to market."

## Related todo items this unifies
Kanban deal board · dashboard charts · AI "Deal Analyst" (OpenRouter) · per-listing notes/activity log · **contacts & relations + skip-tracing** · notifications · CSV export · cross-run dedup · multi-county/multi-source. (See `todo.md` → "Future / bigger ideas".)

## Sources (starting points — verify next session)
- Off-market lead types & conversion: [iSpeedToLead](https://ispeedtolead.com/blog/off-market-real-estate-leads/), [ProbateData "most profitable lead types 2026"](https://www.probatedata.com/blog/the-most-profitable-real-estate-lead-types-for-investors-2026-data), [ResImpli motivated sellers](https://resimpli.com/blog/how-to-find-highly-motivated-off-market-sellers/), [PropStream lead lists](https://www.propstream.com/real-estate-investor-blog/5-motivated-seller-lists-every-investor-should-pull)
- Data providers/APIs: [BatchData top providers](https://batchdata.io/blog/top-property-data-providers-real-estate-investors), [ATTOM](https://www.attomdata.com/), [HouseCanary real-estate APIs](https://www.housecanary.com/blog/real-estate-api), [ProbateData property platforms 2026](https://www.probatedata.com/blog/property-insights-platforms-the-most-comprehensive-u-s-data-sources-for-agents-and-investors-2026)
- Propensity-to-sell / predictive: [HouseCanary off-market predictive](https://www.housecanary.com/blog/spot-off-market-leads-with-predictive-data), [BatchData propensity modeling](https://batchdata.io/uncategorized/what-is-propensity-modeling)
- Skip trace + TCPA/DNC: [BatchData skip-trace rankings 2026](https://batchdata.io/blog/best-skip-tracing-services-real-estate-investors-2026-rankings), [Homesage skip-trace 2026](https://homesage.ai/resources/blog/5-best-skip-tracing-data-providers-2026/)
- DE/NCC public records: [NCC Document Search (Recorder of Deeds)](https://www.newcastlede.gov/144/Document-Search), [Delaware courts docket](https://courts.delaware.gov/docket.aspx), [DE foreclosure process](https://www.newcastlehousebuyers.com/foreclosure-in-delaware/)
- Vacancy data: [HUD/USPS vacancy dataset](https://www.huduser.gov/portal/datasets/usps.html), [Goliath USPS+drive-by](https://goliathdata.com/how-to-use-usps-data-and-drive-bys-to-spot-vacant-homes)
- Flip math (70% rule/ARV): [RealEstateSkills 70% rule](https://www.realestateskills.com/blog/what-is-70-rule-in-house-flipping), [PropStream 70% rule](https://www.propstream.com/news/what-is-the-70-rule-for-fix-and-flippers)
