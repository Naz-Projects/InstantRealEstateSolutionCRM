# Flip-Decision Features — Research + Feature Menu

_Research output (Firecrawl, 2026-06-03). Goal: features that enhance the **flip decision** — once a
property is in front of us, does the CRM help us decide **whether** to flip it and **what to offer**?
This is the complement to [`next-initiative-offmarket.md`](next-initiative-offmarket.md): that doc is about
**finding** the deal upstream; this is about **deciding** the deal. It fills the "Layer E — Deal math" and
"Deal analyzer — generalize `deal.ts`" bullets in that plan._

---

## The core gap (the thesis everything hangs on)
Today the CRM computes an **auction cushion**: `src/scraper/deal.ts` does `cushion = Zestimate − cost-to-clear`.
- **Zestimate is an _as-is_ value** (what the house is worth in its current, distressed condition).
- `cost-to-clear` is the debt we'd absorb at the sheriff sale (sale-type-aware: principal, +/- liens).
- So the cushion answers: **"Is there equity to capture at the auction?"** — an *acquisition* screen.

A **flip decision** turns on a different number the CRM does not have yet:
- **ARV (After-Repair Value)** — value *after* renovation, derived from **renovated comparable sales**, not the
  as-is Zestimate. (HouseCanary is explicit: ARV ≠ current AVM.)
- minus a **real rehab estimate**, minus the **full cost stack** (holding, financing, selling) →
  **profit / ROI**, and a **Maximum Allowable Offer (MAO)**.

> One-line framing: **we have as-is value + an auction cushion; the flip decision needs `ARV − rehab − costs → profit`.**
> Every feature below is a step toward that equation.

The canonical math the whole industry uses:
```
ARV            = value of comparable RENOVATED homes (size/layout/finish/recency/distance adjusted)
MAO (70% rule) = ARV × 0.70 − RehabCost           # quick offer ceiling / screen
Profit         = ARV − PurchasePrice − RehabCost − HoldingCosts − FinancingCosts − SellingCosts
ROI            = Profit / (cash invested)         # also annualized ROI, and IRR / CoC for completeness
Target margin  = ~10–20% of ARV (varies w/ risk + market)
```

---

## How the leading tools support the flip decision (what we're copying)
Consistent pattern across **DealCheck, FlipperForce, PropLab, HouseCanary, REIkit**:
- **Four phases**: acquisition -> rehab -> holding -> sale, each itemized.
- **ARV from comps**: pull recent *renovated* sales comps (up to ~20), weight by **distance + recency**,
  adjust for size/beds/baths/condition, show a **confidence** number. PropLab reports ARV within 3-5% of sale.
- **Rehab estimate two ways**: a quick **tiered $/sqft** pass and a detailed **line-item / scope-of-work**, always
  with a **10–15% contingency** (NAHB: 42% of overruns come from unseen structural issues).
- **MAO (70% rule)** as the fast screen; full **profit + ROI/IRR/CoC** as the confirm.
- **Scenarios**: best/worst case, vary rehab scope and holding period, compare side-by-side.
- **Exit comparison**: flip vs **BRRRR/rental** (needs rent comps, cash flow, refi/DSCR).
- **Output**: lender/partner-ready **PDF report** ("get funding").
- **2026 / AI angle**: address -> MAO in ~60s; **AI rehab estimate from photos + condition red-flags**;
  **buy-box auto-screening + daily deal scanner**; verifiable public-record comps with weighting logic.

---

## The feature menu (ranked by leverage x effort)

### Tier 1 — Cheap extensions of code/data we ALREADY have (build these first)
Reuse `deal.ts`, the Zillow scrape (sqft/beds/baths/zestimate), parcel taxes, the listings tables, the
sortable table + dark shadcn UI, and the existing tier/flag pattern. No new external data required.

1. **Flip P&L "Deal Analyzer" — generalize `deal.ts`.** Add the full cost stack and outputs:
   `MAO`, `Profit`, `ROI`, `annualized ROI`. Keep the existing auction cushion as the *acquisition* line;
   add the *flip* line on top. Inputs default-able per deal (purchase = our bid/cost-to-clear; ARV + rehab
   from features #2/#7). **Extends:** `deal.ts` (pure, unit-tested) + `sheriffData.monthListings`.
2. **Tiered rehab estimator (quick pass).** Pick **Cosmetic ($10–25/sqft) / Moderate ($25–60/sqft) /
   Full Gut ($60–150+/sqft)** x the sqft we already scrape -> instant rehab range, auto-add **10–15%
   contingency**. One dropdown per listing. **Extends:** existing sqft field; tiny new pure module.
3. **Cost-stack defaults (holding / financing / selling).** Configurable assumptions: property tax (we have
   it from parcel), insurance, utilities, **hard-money points + interest x months**, agent commission +
   DE transfer tax + closing. Stored as team settings; feed the P&L. **New:** a small settings record.
4. **Scenario / sensitivity.** Best/worst case: vary rehab tier, holding months, and ARV +/- a few %; show
   profit/ROI side-by-side so a thin deal's fragility is visible. **Extends:** the P&L + UI.
5. **Buy-box screening + flip grade.** Generalize the current cushion-tier into a **flip grade** (clears 70%
   rule? margin >= target?); auto-rank/flag rows, filter by grade. **Extends:** the tier logic + table sort.
6. **Lender / partner report (PDF or share link).** One-click branded report (the property, ARV, rehab,
   cost stack, profit/ROI) for funding conversations. **New** export; all data already in the CRM.

### Tier 2 — Need a NEW data dependency (forces the build-vs-buy decision from the initiative doc)
7. **ARV from renovated comps — _the missing number_.** Either **scrape sold/renovated comps** (Zillow/Redfin
   "recently sold", same approach as our Zillow scrape) **or license an AVM/comps API** (ATTOM, HouseCanary
   "Value at Six Conditions"). Select by recency + distance + size/beds/baths, condition-adjust, show
   **confidence**. *This is the single most valuable add and the key **build-vs-buy** call the off-market doc
   already raised — don't re-decide it here, tie back to it.*
8. **Condition-adjusted AVM** (one provider gives both as-is and ARV) — cleaner than scraping two numbers.
9. **Rent comps -> flip-vs-BRRRR exit comparison.** Rent-comp data + cash flow + refi/DSCR so the CRM can say
   *which exit wins* on a given house. **New data:** rent comps.
10. **AI rehab-from-photos + condition red-flags.** Vision model (OpenRouter, already in stack) over listing
    photos -> rough scope + risk flags (roof age, foundation, galvanized plumbing). **New data:** photos.

### Tier 3 — Decision-support context (signal layer; varying effort)
- **Market trend / days-on-market / price trend** for the comp set -> "market-shift risk" on the ARV.
- **Comp recency + confidence surfaced** on the row (stale comps = unreliable ARV).
- **Structural-overrun risk flag** (ties to the rehab contingency; NAHB 42% stat).

---

## My recommendation (your call — not a build commitment)
Build **Tier 1 #1 + #2 together** first (Flip P&L + tiered rehab estimator), because they:
- reuse what's already here (`deal.ts`, Zillow sqft, parcel taxes, the table) — days, not weeks;
- directly answer "should I flip this, and what's my max offer?";
- are the **scaffold** the ARV work (Tier 2 #7) plugs into later.
Then make the **one** strategic decision that unlocks accuracy: **scrape vs. buy ARV/comps** (Tier 2 #7) —
that's the same build-vs-buy fork in [`next-initiative-offmarket.md`](next-initiative-offmarket.md) Part 4.

## How this fits the documented initiative
Off-market engine = **find** the distressed owner upstream. This = **decide** the deal (ARV/rehab/MAO/profit).
Together with later outreach: **find -> decide -> reach**. This doc is the detail behind that plan's
"Layer E — Deal math" and "Deal analyzer — generalize `deal.ts`."

## Sources (verified this session)
- Flip analyzers / feature sets: DealCheck (https://dealcheck.io/features/house-flipping-calculator/),
  FlipperForce (https://flipperforce.com/software-solutions/deal-analysis),
  PropLab "12 best AI underwriting 2026" (https://proplab.app/blog/best-ai-real-estate-underwriting-software-2026-pricing-features).
- ARV method + 70% rule + profit margin: HouseCanary (https://www.housecanary.com/blog/arv).
- Rehab estimation (line items + why not $/sqft): REIkit (https://www.reikit.com/house-flipping-guide/how-to-estimate-rehab-construction-costs);
  tiers + contingency + photos: PropLab rehab estimator (https://proplab.app/rehab-estimator).
- 70% rule / cost stack: Rocket Mortgage, AmeriSave, Stormfield Capital (see `.firecrawl/search-flip-costs-roi.json`).
