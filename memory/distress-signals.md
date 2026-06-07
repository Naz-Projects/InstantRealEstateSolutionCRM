# Distress / Motivated-Seller Signal Catalog (research)

_Date: 2026-06-07. The complete menu of "why would they sell?" signals the engine should be able to attach to a parcel.
Feeds the **scoring layer** (spec layer 3). Pairs with [`source-matrix.md`](source-matrix.md) (WHERE each lives for NCC)
and the taxonomy origin in [`next-initiative-offmarket.md`](next-initiative-offmarket.md). Sources at bottom._

## The organizing framework — 4 categories of seller motivation
Every motivated-seller trigger investors chase falls into one of four buckets. Design the `signalEvents` model so any
signal tags its category (drives scoring + reporting).

### 1. Financial distress (external, time-bound pressure — highest conversion)
- **Pre-foreclosure / lis-pendens** — foreclosure complaint filed in court (months BEFORE the sheriff auction we already scrape). ← #1 upstream win.
- **Tax delinquency / monition (tax-sale) list** — unpaid county/school taxes; county publishes the list.
- **Mortgage default / Notice of Default** (judicial-foreclosure states surface it as the court filing).
- **Liens** (each is a recorded distress flag + a title issue the seller wants gone):
  - **Tax lien** (county/IRS/state) — highest title priority.
  - **Judgment lien** — court judgment for an unpaid debt attaches to the property.
  - **Mechanic's lien** — unpaid contractor.
  - **HOA / condo-association lien** — unpaid dues.
  - **Code-enforcement lien** — unpaid violation fines (NCC: surfaces as "Resolved with Fees Owed").
- **Bankruptcy** — active Chapter 7 / Chapter 13 filing (federal PACER).
- **Reverse mortgage (HECM) default** — heirs/estate must sell; often elderly/probate overlap.

### 2. Life events (the "5 Ds": Death, Divorce, Debt, Diapers/relocation, Downsizing)
- **Probate / inherited / death** — ~5–12% close; ~60% have no mortgage (no price floor); often disrepair + back taxes. Register of Wills + the Legal Notices PDF we already ingest.
- **Divorce** — couples liquidate the shared asset fast (court filings).
- **Relocation / job loss / job transfer** — must move, want cash fast.
- **Health / medical** — assisted living, medical debt.
- **Aging / downsizing — senior owner / empty-nester** — large paid-off home, ready to right-size, often pays/sells cash.

### 3. Physical distress (condition blocks normal financing → cash-buyer territory)
- **Code violations / property-maintenance cases** — high weeds, debris, unsafe structure (NCC free, dated).
- **Condemnation / unsafe-structure orders.**
- **Fire / water / storm damage.**
- **Hoarder houses / severe deferred maintenance.**
- **Drive-for-dollars curb cues** (manual or AI-from-photo later): boarded/broken windows, overgrown lawn, peeling paint,
  bad roof, piled-up mail/door-hangers, posted utility-shutoff or city notices, tarps, code-violation placards.

### 4. Situational distress (ownership/occupancy friction)
- **Absentee owner** — owner mailing ≠ situs (and out-of-state is stronger). Free from the spine.
- **Tired landlord** — rental owned a long time (PropStream uses **15+ yrs**); landlord fatigue. NCC has 39k rental units + license expiry.
- **Vacant property** — paying for an empty house = burden (NCC has a free parcel-level vacant list; USPS vacancy is the paid/restricted national version).
- **Failed / expired / withdrawn / cancelled MLS listing** — owner already PROVED intent to sell, then it fell through. High-intent.
- **Out-of-state / out-of-country owner**, LLC/trust ownership (investor or estate vehicle).

## Derived / "niche" lists the pros actually pull (combinations of the above)
- **Zombie foreclosure** = vacant **+** pre-foreclosure (two stacked signals) — top-tier.
- **High equity / free-and-clear** = value − liens is large / no mortgage → the owner *can* sell at a discount. **Equity is the gate** on whether any lead is workable.
- **Long tenure / propensity-to-sell** = owned 15–30+ yrs (life-stage change likely).
- **Senior + free-and-clear + long tenure** = classic downsizer stack.
- **Vacant land / unmaintained lots.**
- **Inter-family / quitclaim transfers** (recent non-arm's-length deed = possible estate/divorce).
- **New construction / ADUs / permit activity** — less "distress," more opportunity + a leading indicator of new parcels.

## The meta-method that makes it all work: LIST STACKING
- **Definition:** pull each signal as its own list, then surface the owners who appear on **multiple** lists. Each extra
  signal multiplies the odds they'll sell. This is precision targeting vs. volume spray.
- **Best-converting stacks:** a **life event × a property challenge** (e.g. probate + vacant; divorce + high-equity;
  absentee + code-violation + tax-delinquent).
- **This directly validates our architecture:** the spec's *signal event-streams → scoring* design IS list-stacking,
  done reactively. Score = (number of stacked signals) × (recency) × (equity) × (signal weight). Rules first; ML
  propensity (à la BatchRank's 800+ data points) only once we have closed-deal outcomes to train on.
- **Equity is the multiplier/gate, not just a signal:** a perfectly-distressed owner with zero equity can't do a deal.
  So computing equity (needs value + liens) is what turns a "signal" into a "lead worth working."

## NCC availability map (cross-ref source-matrix.md)
- **FREE & serverless NOW (ArcGIS):** absentee/owner-mailing, code violations (dated), vacant, vacant-monition
  candidates, tired-landlord (rentals + expiry), monition/tax-delinquent (via candidates + PDF), permits/new-construction, sheriff sales.
- **FREE but needs a scrape/feed (court/records):** pre-foreclosure/lis-pendens (CourtConnect), divorce filings (courts),
  probate (Register of Wills + the Legal Notices PDF we have), bankruptcy (federal PACER).
- **Per-parcel browser OR paid (funnel-only):** assessed value, tax/sewer balances, full lien detail (judgment/mechanic/
  IRS/HOA), mortgage/equity → **the open lead in source-matrix.md** (hunt a free bulk source first: locked PublicWorks/
  LU_Eng folders, monition PDFs carry delinquent balances, county CSV/bulk export).
- **Paid / inferred / manual:** owner age (senior), relocation/job-loss/health, USPS national vacancy, skip-trace
  phones/emails (+DNC), reverse-mortgage. Physical curb-cues = drive-for-dollars or AI-from-Street-View (future).

## Implications for the build (carry into the scoring spec)
1. `signalEvents` schema must hold: `category` (1–4 above), `type`, `prclid`, `observedDate` (for recency), `source`,
   `rawRef`, and free-form payload. One parcel → many events (stacking).
2. Lead score = weighted stack × recency decay × equity factor; keep weights in config so they're tunable.
3. **Equity needs value − liens** → prioritize solving the free-bulk value/balance question; it unlocks the equity gate that ranks everything.
4. Phasing still holds: ship the free GIS signals first (absentee, code, vacant, monition, rentals), add court-scrape
   signals (lis-pendens, probate, divorce) next, layer equity/liens/skip-trace last (paid/DNC-gated).

## Sources
- PropStream lead lists (20 pre-built; tired-landlord=15yr, failed listing, divorce, bankruptcy, high-equity, vacant): propstream.com/news/propstreams-quick-lists, propstream.com/real-estate-investor-blog/5-motivated-seller-lists-every-investor-should-pull
- BatchLeads / BatchRank (AI rank, 800+ data points; PropStream acquired BatchLeads 2025-07): batchleads.io
- 4 motivation types + highest-converting triggers: ispeedtolead.com/blog/what-actually-makes-a-seller-motivated, propertyradar.com/blog/the-complete-guide-to-distressed-properties
- Life events ("5 Ds"): alltheleads.com/divorce-debt-death-real-estate, propertyreach.com/blog/unexpected-life-events-create-motivated-sellers
- Drive-for-dollars condition cues: batchleads.io/blog/identify-distressed-properties-6-simple-signs, dealmachine.com/blog
- Liens/judgments types: nolo.com, ctccal.com/blog (tax/judgment/mechanic/HOA)
- Zombie foreclosure / vacant / tired-landlord niche: ispeedtolead.com/blog/vacant-property-leads-how-to-find-and-close-them-in-2026, labcoatagents.com
- List stacking: reikit.com/wholesaling-houses/acquisition/list-stacking, realestateskills.com/blog/list-stacking, resimpli.com/blog/what-is-list-stacking
