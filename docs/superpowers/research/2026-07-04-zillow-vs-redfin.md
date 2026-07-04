# Zillow vs Redfin for New Castle County, DE Flip Discovery — Decision Brief

_Research date: 2026-07-04 (Opus research agent, WebSearch-based). Commissioned for the Monitor-the-Web deep-analysis upgrade: "are we leaving value on the table relying on Zillow alone?"_

**Bottom line up front:** Redfin's biggest gift to a flipper is a *usable, programmatically-driveable keyword search over listing remarks* plus dedicated **Fixer-Upper** and **MLS-Foreclosure** filters — exactly the "as-is / TLC / estate / cash only" distress signals Zillow's search cannot reliably surface. Redfin is also fresher (direct-MLS in brokerage markets) and easier to scrape (Cloudflare, ~3/5) than Zillow (PerimeterX+Cloudflare, ~5/5). Zillow's unique value is its **FSBO layer** and slightly larger raw inventory. The recommendation is to **add Redfin as a second, keyword-targeted discovery source** while keeping Zillow for FSBO + a cross-check estimate band — not to replace Zillow.

---

## 1. Zillow vs Redfin — investor-lens comparison

| Dimension | Zillow | Redfin | Edge |
|---|---|---|---|
| **Listing source** | MLS via IDX (moved off direct feeds ~2021) + FSBO + third-party vendors + user-submitted | Direct MLS feed in markets where Redfin operates a brokerage; syndicated feed elsewhere | Redfin (freshness), Zillow (breadth) |
| **Update latency** | Updates multiple times/day; status can lag MLS by *hours* (under-contract homes show active) | ~70% of new MLS listings post within 5 min; ~50% refresh every 2 min in core markets | **Redfin** |
| **Raw inventory** | Slightly larger overall; **has FSBO** (free direct upload) | Agent/MLS-centric; **thin FSBO** (only via FSBO.com/Fizber partners) | Zillow (FSBO), roughly even on MLS |
| **Coming-soon / pre-market** | Coming-soon supported | Coming-soon + **Redfin Early Access** (launched May 2026): pre-market + Compass-exclusive homes "not on other major sites" | **Redfin** (new moat) |
| **Foreclosure/auction** | Foreclosure/pre-foreclosure/auction tab (Zillow-owned data) | **MLS-Listed Foreclosures** filter + bank-site foreclosures; **Short Sale** status | Different strengths — both worth pulling |
| **On-market estimate error** | Zestimate ~1.94% median | Redfin Estimate ~1.93% (some sources 2.07%) | Effectively tied |
| **Off-market estimate error** | Zestimate ~7.06% | Redfin ~7.38% | Slight Zillow edge off-market |
| **Sold/comps** | "Recently Sold" with confirmed prices; good raw comp feed | Shows **days-on-market + price-change timeline** per comp (spot fast-vs-stale sales); but sometimes uses comps >6 months old | Redfin for comp *context*; both miss off-market/FSBO deeds (county recorder does not) |
| **Scrape difficulty** | ~5/5 — PerimeterX + Cloudflare, behavioral analysis, TLS/IP fingerprinting | ~3/5 — Cloudflare + rate limiting; internal Stingray/GIS JSON API is clean | **Redfin** (much easier) |
| **Keyword remarks search** | Weak, loose, strict-AND, inconsistent (see §3) | **True remarks keyword search** (see §3) | **Redfin — the headline differentiator** |

---

## 2. Filter inventory

**Redfin filters that Zillow lacks (or does far better) — investor-relevant:**
- **Keyword search on marketing remarks** — the big one (§3).
- **Fixer-Uppers Only** — a pre-built filter that matches remarks for *TLC, needs work, handyman special, contractor special*. Directly a flip-lead filter.
- **MLS-Listed Foreclosures** filter — remarks containing *foreclosure / bank-owned*, entered by an agent (i.e., actually buyable, unlike Zillow's often-not-for-sale foreclosure tab).
- **Short Sale** status filter.
- **Time on Redfin / "Days on Redfin"** ranges (e.g. <60 days) — usable for both *fresh* and *stale/aged* discovery; exposed in the API as `time_on_market_range` (`3-` = <3 days, `-7` = >7 days, `3-1` = 1–3 days).
- **Redfin Early Access** as its own searchable/save-search category (pre-market inventory).
- Sort by newest / price-drop via `ord=days-on-redfin-asc` etc.

**Zillow filters/coverage Redfin lacks:**
- **FSBO** as a first-class, well-populated layer (Redfin's is sparse).
- Broader **pre-foreclosure/auction** dataset (Zillow-owned, beyond MLS).
- Larger raw for-sale count overall.

**Which matter for flip-finding:** Fixer-Upper, MLS-Foreclosure, Short-Sale, and remarks keyword search convert directly into distressed/motivated-seller leads. Time-on-market matters for aged listings (price-cut candidates / seller fatigue). Zillow's FSBO layer matters because unrepresented sellers are a classic wholesale channel Redfin doesn't cover.

---

## 3. The keyword-search verdict (the single biggest differentiator)

**Redfin — CONFIRMED, strong.** A genuine keyword search **restricted to the listing's marketing remarks** (not amenities/full text). Multiple terms = AND. Redfin ships pre-canned remarks-keyword filters (Fixer-Upper = TLC/needs work/handyman/contractor special; MLS-Foreclosure = foreclosure/bank-owned). This is the mechanism for sweeps like *"as-is," "estate," "cash only," "investor special," "handyman," "TLC," "needs work," "sold as-is," "bring offers," "motivated."*

**Zillow — CONFIRMED weak / unreliable.** Zillow's keyword box searches the description but independent testing describes it as *primitive, loosely matched, strict-AND, inconsistent exclusion, little feedback*. Not dependable for systematic distress-signal discovery.

**Caveat (verify live):** whether Redfin exposes the remarks keyword as a *clean URL/GIS query parameter* is not definitively documented. The Stingray/GIS endpoint accepts `market, region_id, region_type, sf, uipt, status, num_homes, page_number, min/max_price, num_beds/baths, time_on_market_range`, and scrapers DO get full agent remarks per listing — so the robust fallback is: **pull all NCC listings via GIS, keyword-filter the remarks in-pipeline** (removes the dependency entirely).

---

## 4. Recommended dual-source architecture for the NCC pipeline

**Discovery roles**
- **Redfin = primary distress-signal discovery.** Nightly, pull all NCC for-sale + coming-soon ≤$500K via the Stingray GIS JSON API, then run **remarks keyword sweeps in-pipeline**: `as-is`, `estate`, `cash only`, `handyman`, `TLC`, `needs work`, `investor`, `contractor special`, `won't last`, `motivated`, `sold as-is`, `bring all offers`. Fold in Fixer-Upper + MLS-Foreclosure/Short-Sale filtered pulls.
- **Zillow = FSBO + breadth layer.** Keep the existing nightly Zillow scrape for FSBO listings Redfin misses and as a coverage backstop.

**Cross-check roles**
- **ARV sanity band:** Zestimate ↔ Redfin Estimate per address. Agreement (both ~1.9% on-market) = tighter confidence; divergence = flag for manual comp review. Two mediocre AVMs → a *range*, not a false point estimate.
- **Comps:** keep Redfin SOLD as primary; add per-comp DOM + price-change context (motivation signals). Both platforms miss off-market/FSBO deed transfers; county recorder is the only complete source (future).
- **Freshness/status truth:** when Zillow shows active but Redfin shows pending/sold, trust Redfin — avoids underwriting dead listings.

**Dedupe:** normalized street address (number + street + unit + ZIP), lat/lng-rounding fallback. Merge into one property object; source-tagged fields (`zestimate`, `redfinEstimate`, `zillowDOM`, `redfinDOM`).

**New signals unlocked:** distress-language hits (net-new) · fixer/foreclosure/short-sale booleans · dual-AVM agreement band · fresher status · Early Access/coming-soon pre-market flow · price-cut/aged buckets.

**Scrape cost:** Redfin GIS bulk-returns up to ~350 listings/request *with full remarks* → all of NCC ≤$500K ≈ **1–3 fetches per status bucket** (~10–30 fetches/night total), on the EASIER-to-scrape site. Adding Redfin *lowers* average cost per discovered lead vs the page-heavy PerimeterX-guarded Zillow path.

---

## 5. Source notes

**Broadly corroborated:** Redfin direct-MLS freshness (~5-min posting) vs Zillow lag; Zillow FSBO + larger inventory; estimate error ~1.9% on-market both, ~7.1/7.4% off-market; Redfin remarks keyword search + Fixer-Upper/MLS-Foreclosure/Short-Sale filters vs Zillow's weak keyword box; Redfin ~3/5 scrape difficulty (data in `reactServerState.InitialContext` + Stingray GIS API) vs Zillow ~5/5.

**Single-source / verify live:** exact GIS param for remarks keyword (recommend in-pipeline filtering instead); "Redfin comps >6 months old" criticism; precise `sf`/`uipt`/`status` code values (`status=9`, `uipt=1..8`, `sf=1,2,3,5,6,7`) — confirm against a live NCC query before hard-coding.

**Recently changed:** **Redfin Early Access (May 2026)** — new pre-market category, partly Compass-exclusive, "not on other major sites"; re-check NCC coverage. Zillow anti-bot stiffened through 2026.

**Tertiary:** Realtor.com — ~890 MLSes, 15-min refresh, best accuracy backstop, no investor keyword edge. Homes.com — skip.

**Recommendation:** Add Redfin as second discovery source scoped to (a) remarks keyword sweeps, (b) Fixer-Upper/Foreclosure/Short-Sale pulls, (c) coming-soon/Early Access, (d) dual-AVM cross-check. Keep Zillow for FSBO + breadth. Dedupe on normalized address.

Sources: MLS Import comparison · Redfin data-quality page · HomeLight Redfin-vs-Zillow · Redfin support (keyword remarks) · Redfin new-filters announcement · RealEstateWitch estimate accuracy · ListWithClever Zestimate accuracy · romansorin.com Zillow keyword UX · Redfin Early Access press release + HousingWire · RedfinPlus REDFIN.md (GIS params) · Scrapfly Redfin guide · ScrapeOps Zillow teardown · RealEstateSkills.
