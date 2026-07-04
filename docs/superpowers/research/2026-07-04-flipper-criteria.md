# Professional Flipper Screening Requirements — Definitive Checklist & Spec

_Research date: 2026-07-04 (Opus research agent, WebSearch across investor-education sites [FlipperForce, RealEstateSkills, BiggerPockets, REtipster, New Silver, Lima One], wholesaler lead-gen guides [Property M.O.B., BatchLeads, DealMachine, PropStream], agent/MLS decoders [SoFi, Inman, HomeLight, Redfin], appraisal doctrine [Appraisal Buzz, InterNACHI], MLS operator docs [ARMLS, NTREIS, Canopy], DE/NCC government sources [DNREC, NCC Sheriff, Wilmington L&I]). Commissioned as the spec for the Monitor deep-analysis layer._

**Detection tags:** `[FIELD]` structured listing field · `[COMPUTED]` derived from fields+comps · `[DESC-REGEX]` description text match · `[PRICE-HIST]` priceHistory events · `[SALES-HIST]` last-sold records · `[PHOTO-META]` photo count/metadata · `[YEAR-BUILT]` inferable from year built · `[GEO]` ZIP/geocode lookup · `[VISION]` needs photos/Street View analysis · `[EXTERNAL]` needs third-party data · `[VERIFY]` human diligence gate before bidding

---

## 1. The Flipper's Screening Checklist (prioritized)

Funnel order pros actually run: **hard filters → the $/sqft screen → motivation/condition signals → MAO math → red-flag gates → exit triage.**

### Tier 1 — Financial screens

**1. Subject $/sqft vs. area median $/sqft — the primary triage number.**
`subjectPPSF = listPrice / sqft` vs median $/sqft of nearby recent sales. Pros promote listings **~15–30% below the unrenovated-comp median** to full underwriting. Pitfalls (appraisal doctrine, well corroborated): (a) never mix renovated and unrenovated comps — renovation premium ~$25–35/sqft; screen as-is price against *unrenovated* comps, ARV against *renovated* comps; (b) compare GLA to GLA — finished basements/garages excluded; (c) **median not average**; time-adjust ~0.5–1%/month. → `[COMPUTED]` — **data already scraped; should be the headline sort key.**

**2. MAO / 70%-rule gate with variants.** `MAO = ARV × 0.70 − repairs`. Refinements: **65%** in slow markets/low-ARV homes, **75%** hot product/cosmetic-only, 80% only carpet-and-paint in A-class. The 30% = ~15% fixed costs (selling 8–10% ARV, holding 5–7%, financing 3–5%, buying ~2%) + 10–15% profit. **Delaware correction: NCC transfer tax is 4% and paid BOTH legs** — +2% of purchase and +2% of resale (customary 50/50 split) → run NCC deals at **65–68%, not 70%**. → `[COMPUTED]`.

**3. Minimum profit floors — dual gate.** ROI ≥ 15% (target 20–25%) AND absolute profit ≥ $25–30K. Margin ≥ 8–12% of ARV. ATTOM 2026: avg flip profit ~$65K, ~25% ROI; DE gross ROI compressed to ~36% in 2025 — underwrite conservatively. → `[COMPUTED]`.

### Tier 2 — Buy-box filters

**4. Beds/baths: 3/2 sweet spot; ≥1.5 baths minimum.** **3BR/1BA = resale hindrance** (functional obsolescence). Smart flag: "3/1 with sqft ≥ ~1,300" = *add-a-bath value play*, not a reject. Avoid 1-bath and studio/1-bed flips. → `[FIELD]`.

**5. Sqft sweet spot ~1,400–2,000** (ideal exit = 3/2 ~1,800 sqft). Much larger than neighborhood norm = capped buyer pool + burn. → `[FIELD]` + `[COMPUTED]`.

**6. Year built — era gates** (full hazard table §4). Pre-1978 = lead RRP cost flag; 1980s+ = fewest surprises. → `[YEAR-BUILT]`.

**7. Detached fee-simple SFR preferred.** Condo/HOA = restrictions + fee drag + warrantability risk; manufactured-on-leased-land and co-op = kills. → `[FIELD]` + `[DESC-REGEX]`: `leasehold|leased land|land lease|lot rent|ground rent|co-op|fee simple`.

**8. ARV vs local median sale price.** ARV at/slightly below area median = deepest exit. Typical NCC flip: acquire ~$180–320K → ARV ~$280–480K (the ≤$500K screen is well calibrated). → `[COMPUTED]` + `[GEO]`.

### Tier 3 — Motivation & condition signals

**9. Description motivation & condition scoring** — full lexicon §2. Net: distress/motivation (+), rehab-scope tier (+, scaled), renovated/retail (−). **Co-occurrence beats single hits** ("as-is" + "cash only" + "estate" = classic target). → `[DESC-REGEX]` + LLM judge.

**10. Price-cut depth/count/velocity, DOM staleness, tenure, list-vs-last-sold, relist/BOM** — full playbook §3. **Highest-ROI upgrades — inputs already scraped.** → `[PRICE-HIST]` `[SALES-HIST]`.

**11. Photo-count heuristic.** ≤5–8 photos, exterior-only, "photos coming soon" persisting = agent hiding condition or tenant-occupied ("no photos = bad inside" — consistent agent lore). 40+ pro-staged = retail product. → `[PHOTO-META]`.

### Tier 4 — Location gates

**12. School district / ZIP tier.** Swings 10–25% across boundaries. NCC mapping: **Appoquinimink (Middletown 19709) = premium**; Brandywine + suburban Red Clay (Hockessin/Pike Creek 19707/19808) = medium-high; Christina suburbs mixed; Wilmington city = headwind. ZIP tiers: `city-high-risk` (19801/02/05/06 — rental/BRRRR territory, 60–129% gross ROI, high variance) · `suburb-standard` (Newark 19702/11/13, Bear 19701, New Castle 19720, Claymont 19703, Elsmere) · `suburb-premium` (19709, 19707/19808). → `[GEO]` lookup table.

**13. Street-level incurable discounts.** Busy road −5–15%; railroad <1,000 ft ~−10%; backing commercial significant; power lines minor/disputed. Cap ARV permanently. → `[VISION]`/`[EXTERNAL]` + `[DESC-REGEX]`: `busy road|main road|convenient to (I-95|Route)`.

**14. Flood zone.** SFHA = mandatory insurance on financed exits, −10%+. NCC hotspots: Southbridge, Christina corridor, Christiana/Glenville/Stanton. Ida flooded outside mapped zones — creek-adjacent = VERIFY. → `[EXTERNAL]` (FEMA/DNREC) + `[DESC-REGEX]`: `flood|sump pump|elevation certificate|water intrusion`.

### Tier 5 — Delaware-specific

**15. Transfer tax 4% (2.5% state + 1.5% NCC), both legs** — hard-code: 2% buy + 2% sell. Highest-value DE-specific number. → `[COMPUTED]`.
**16. Wilmington city-limits overhead:** vacant-property registration (escalating fees), rental license + inspection + lead-safe cert (pre-1978 rentals). Suburbs carry none. → `[GEO]` city flag → cost adders.
**17. Sheriff-sale mechanics:** 2nd Tuesday monthly, 10%/$5K deposit, court confirmation, no general mortgage redemption. (Cross-ref with our off-market pre-foreclosure data stays the moat.)

---

## 2. Description-Language Lexicon (regex/prompt-ready)

Normalize: case-insensitive; `as[- ]?is`, `fixer[- ]?upper`, `turn[- ]?key`, `move[- ]?in ready`, `pre[- ]?foreclosure`, `bank[- ]?owned`; anchor `\bTLC\b`, `\bREO\b`, `\bOBO\b`. Confidence: **H** 3+ sources · **M** 2 · **F** folk wisdom.

### 2A. Motivation/distress — POSITIVE
- **Tier A hard distress (weight highest):** `pre-foreclosure` `notice of default` `short sale` `foreclosure` `bank owned` `REO` `auction` `sheriff sale` `trustee sale` `bankruptcy` `liquidation` `behind on payments` `back taxes` `tax lien` `code violation(s)` `code enforcement` `condemned` — H/M.
- **Tier B estate/probate:** `estate sale` `estate` `sold as part of estate` `settling (an|the) estate` `probate` `inherited` `heirs?` `executor` `administrator` `trust sale` `deceased` `passed away` — H.
- **Tier C urgency/negotiability:** `motivated seller` `must sell` `priced to sell` `priced below market` `below market value` `bring (all )?(your )?offers` `all offers considered` `make (me )?an offer` `\bOBO\b` `quick close` `fast close` `flexible (seller|on price|terms|closing)` `priced to move` `immediate sale` `reduced` `price improvement` `new price` `just reduced` — H/M. Caveat: `won't last` = marketing; cross-check DOM (M).
- **Tier D life events:** `divorce` `relocat(ing|ion)` `job transfer` `downsiz(e|ing)` `empty nest` `retir(ing|ement)` `out[- ]of[- ]state owner` `absentee` `health (issues|problems)` `tired landlord` — H/M.
- **Tier E as-is/cash/access:** `as[- ]?is` `sold as[- ]?is` `cash (only|buyers only|offers only)` `no repairs` `seller will not make repairs` `no contingencies` `vacant` `unoccupied` `abandoned` `easy to show` `lockbox` `tenant occupied` `24[- ]hour notice` `distressed` `owner financing` `seller financing` `owner will carry` `lease option` — H/M. (`cash only` = won't pass financing, H.)

### 2B. Condition/opportunity — POSITIVE, scaled by tier
- **Tier 1 cosmetic:** `needs updating` `dated` `outdated` `some updat(es|ing)` `cosmetic` `original condition` `all original` `original owner` `vintage` `retro` `well[- ]maintained` `bring your paint ?brush` `elbow grease` — H/M/F.
- **Tier 2 moderate (the classic flip band):** `\bTLC\b` `needs (some )?TLC` `needs (some |a little )?work` `needs love` `fixer([- ]?upper)?` `handy(man|person)('s)? special` `contractor('s)? special` `bring your contractor` `diamond in the rough` `bring your (imagination|vision|ideas)` `(great|lots of|tons of|endless|full of) potential` `possibilities` `opportunity` `investor special` `investor opportunity` `great for investors` `value[- ]add` `upside` `sweat equity` `instant equity` `hidden gem` `first time on (the )?market` `same owner (for )?\d+ years` `one owner` — H/M. "minor TLC" understates; "investor special" often = tenant-occupied rough (H).
- **Tier 3 systems/structural:** `good bones` `great bones` `deferred maintenance` `foundation (issue|crack|problem)s?` `structural` `settling` `bowing` `sloping floors` `roof (leak|needs|end of life)` `mold` `water damage` `fire damage` `storm damage` `tear[- ]?down` `lot value` `land value` `gut( rehab| job)?` `total rehab` `needs everything` `uninhabitable` `vandalized` `stripped` — H/M. Also raise §4 gates.
- **Euphemism decoder (F, for the LLM judge):** `cozy`/`quaint`/`dollhouse` = small · `charming`/`character` = old, needs work · `rustic` = poorly maintained · `unique`/`custom`/`quirky` = resale risk · heavy location/view talk = house underwhelms · `up-and-coming` = unproven block · `updated`/`refreshed` w/o specifics = maybe just paint.

### 2C. Renovated/retail — NEGATIVE
`turn[- ]?key` `move[- ]in ready` `fully|completely|newly|recently (renovated|remodeled|updated)` `updated throughout` `tastefully updated` `extensively renovated` `new everything` `all new` `renovated|updated|new|remodeled kitchen` `updated|renovated|new bath(room)?s?` `new roof( \d{4})?` `new HVAC` `new (furnace|AC|windows|electrical|plumbing)` `rewired` `re-?plumbed` `new mechanicals` `stainless (steel )?appliances` `granite` `quartz` `marble` `luxury` `high[- ]end( finishes)?` `upscale` `designer` `custom[- ]built` `gourmet|chef's kitchen` `open concept` `smart home` `immaculate` `pristine` `mint condition` `meticulously maintained` `model (perfect|home)` `picture perfect` — H/M.
**Caveat (H):** "turnkey" used loosely — Cat-C is a score *reducer*, not auto-reject. Cat-C + Tier-A distress co-occurring ("fully renovated, must sell") = failed flip resale — worth a look.

**Judge output shape:** `{motivation_score, motivation_tier, condition_tier (cosmetic|moderate|systems|structural), retail_flags[], red_flags[], euphemisms[]}` — not a boolean.

---

## 3. Price/Sales-History Playbook

All computable from `listPrice`, `priceHistory[{date,price,event}]`, `lastSoldDate`, `lastSoldPrice`, `daysOnMarket`, status events. **Reconstruct cuts from dated events — Zillow "price cut" badges have display artifacts (H).**

| # | Metric | Formula | Thresholds & signal |
|---|---|---|---|
| 1 | Cumulative cut depth | `(origList − curList)/origList` | <2% noise · 2–5% responsive (+1) · 5–10% softening (+2) · >10% motivated (+3) · **>15% = motivated AND hidden-problem flag** (H) |
| 2 | Cut count | # downward PriceChange events | 2 = flexible (+1) · **≥3 = strong motivation (+2)** (H) |
| 3 | Cut velocity | cuts per 30 days | **≥2 cuts/~30d = acute motivation (+2/+3)** (F, directional) · slow drip (45–60d) = anchored (+1) |
| 4 | Cut timing/decisiveness | largest cut × when | small early (day 14–45) = responsive; **large late (90+) = distress + condition diligence** (H) |
| 5 | DOM staleness ratio | `DOM / areaMedianDOM` | >1.2–1.3× = leverage · **≥2× = stale (+2)** (H). Backstops: 60d motivated, 90d outlier |
| 6 | DOM discount curve | — | 0–14d ~0% · 14–30d 1–3% · 30–60d 2–5% · 60–90d 5–10% + credits · 90d+ at/below comps; ≈2–2.5%/30d (H) |
| 7 | Hidden CDOM / relist gaming | `CDOM − currentDOM` | MLS resets DOM after 30–45d off-market; **gap >30–45d = staler than shown** (H) |
| 8 | Ownership tenure | `today − lastSoldDate` | **>15–20 yrs = prime flip profile** (equity + deferred maintenance + dated) (+2) (H) · **<1–2 yrs = investor resale or distressed quick exit — disambiguate via #9** (H) |
| 9 | List-to-last-sold ratio | `curList / lastSoldPrice` vs `(1+~3%)^tenureYears` | at/below appreciation-implied on long tenure = pricing to move (+2) · barely above last-sold on short tenure = thin-margin reseller flag · **<1.0 = underwater/urgent (+3, verify condition)** (M) |
| 10 | Equity headroom | `estValue − ~0.8×lastSoldPrice×amortFactor` | high = seller CAN discount; low/negative = short-sale friction (H) |
| 11 | Expired listing | status history | **highly motivated (+3)**; classic investor cohort (H) |
| 12 | Withdrawn/canceled | status history | ambiguous (+1, investigate); reappearing w/ cut → treat as expired (H) |
| 13 | Back-on-market | Pending→Active | **+2 AND mandatory condition flag** — ~70% of fall-throughs are inspection-driven (H). BOM <1 wk = financing/cold feet; long gap or BOM+cut = inspection (H) |
| 14 | Low-DOM trap | low DOM + price well below median | mispriced (act fast) OR defect already sniffed out; **never treat low price + lingering as free equity** (H) |

**Composite:** sum motivation points (cap ~10); **risk flags stay separate** — they gate the offer, not the score.

---

## 4. Red-Flag Kill List

**Principle (H):** bounded repairs = PRICE-IN; true KILLs = **unbounded costs** (contamination, unpermitted structural) and **insurance/financing blockers** (collapsed buyer pool kills flips, not repair bills).

### Era hazards — auto-flag from year_built
| Hazard | Flag range | Severity | Cost | Confidence |
|---|---|---|---|---|
| Lead paint | **<1978** | PRICE-IN, disclosure | $500–3K stabilize; $10–30K full | High |
| Asbestos | **≤1980** | PRICE-IN | $3–7K ceiling; $1.5–30K house | High likelihood |
| Knob-and-tube | ~1880–1940 (to ~1950) | PRICE-IN + **insurance-blocking** | $5–25K rewire | Medium |
| Aluminum wiring | ~1965–1975 | PRICE-IN + insurance-blocking | $1.5–8K pigtail; $12–20K rewire | Medium |
| FPE/Zinsco panel | ~1950–1990 | PRICE-IN + insurance-blocking | $2–4.5K | Low (needs `[VISION]`) |
| Polybutylene | ~1978–1995 | PRICE-IN | $1.5–7K repipe | Medium |
| Galvanized/cast-iron | <1970 | PRICE-IN | bounded | Medium |
| **Underground oil tank** | ≤~1975 + oil heat | **VERIFY → KILL if leaked** | $1.5–3.5K removal; **$2.5–17K+ unbounded if leaked** | DE-signature risk; DNREC closure-assistance ≤1,100 gal |

### Structural/system
Foundation (VERIFY→PRICE-IN $20–80K, KILL on thin spread; horizontal/bowing/>¼" = bad; repaired still stigmatizes) · Roof (PRICE-IN $8–25K; insurers force review 15 yr) · Full rewire ($12–25K) · Sewer lateral ($2–12K+, `[VERIFY]`) · Mold (isolated $1.2–3.8K → VERIFY widespread; 50% of retail buyers walk) · Fire (cosmetic PRICE-IN; structural burn = KILL; water → hidden mold) · Failed septic ($10–40K → **KILL if lot can't fit new drainfield**; FHA/VA won't close; relevant south of C&D).

### Location/site
Flood A/AE/VE (PRICE-IN→KILL-leaning w/ damage history) · Wetlands (DE: no structures 100 ft tidal / 25 ft delineated) · Busy road/railroad/commercial (incurable haircuts) · Power lines (minor, evidence split) · Shared driveway (**no recorded agreement = title/financing problem**) · Functional obsolescence: 3/1 (curable if add-a-bath fits), no-closet bedrooms, railroad layout, no primary bath, **low ceilings = incurable** (H).

### Legal/product-type
**Manufactured on leased land = KILL** (chattel-only, captive lot rent) · Co-op = KILL/VERIFY · Condo litigation/special assessment/**non-warrantable = KILL** (cash-only exit); high HOA = cheap proxy flag · **Unpermitted structural = walk away**; lenders exclude unpermitted sqft → corrupts ARV; sqft-vs-tax-record mismatch = detector · Title/liens = VERIFY · Tenant-occupied w/ long lease = PRICE-IN→KILL · 55+ restricted (exit pool capped) · DE ground rent/leasehold = VERIFY flag.

**Modeling rule:** era + product-type flags auto-score; non-listing-detectable KILLs (tank leak, drainfield, unpermitted scope, warrantability, driveway agreement) = **"VERIFY-before-bid" checklist per deal**, not silent deductions.

---

## 5. Exit Triage Rules (flip vs wholetail vs rental/BRRRR)

Never one exit — score all three, tag best-fit + fallbacks (H). **Route on condition tier first:**
- **WHOLETAIL** — sound, livable, *financeable as-is*; trash-out/clean/paint/safety only. **$5–15K cosmetics → $20–40K added margin over wholesaling**; 30–60 day hold; profit ~$40K typical. Profile: Tier-1 condition language (dated/original), decent photos, no system red flags, estate/tenure signals.
- **FLIP** — Tier 2–3 condition lifting ARV well beyond cost; MAO at 65–75%; both profit floors; 3–6 mo hold.
- **RENTAL/BRRRR** — big as-is→ARV gap AND rents hold: **post-refi DSCR ≥ ~1.15 at ≤75% LTV**; buy ~65% ARV; 6–12 mo seasoning; refi trap → pivot to flip/wholetail.

**Tiebreakers:** area median DOM <30d → flip; >60d → hold/BRRRR (H) · cost of capital >~8% → flip; <~7% → BRRRR · **DSCR < 1.15 → never force a negative-carry hold** (M/H) · NCC overlay: Wilmington city ZIPs → rental/BRRRR bias (rental license + lead-cert costs noted); suburb-premium → retail-flip bias; wholetail works anywhere financeable · Wholesale fallback: assign $5–20K.

**CRM logic:** condition tier + $/sqft spread + DOM + rent estimate (rentZestimate covers it) → `{best_exit, fallbacks[], dscr, wholetail_margin}`.

---

## 6. Source Notes & Confidence

**Broadly corroborated (3+ source families):** 70% rule + 65/75 variants + cost decomposition; ROI/profit floors; 3/2 sweet spot + 3/1 penalty; sqft band; rehab $/sqft tiers ($10–30/$30–50/$50–80+, 10–20% contingency); $/sqft screening + renovated-vs-unrenovated/GLA pitfalls; 2× median DOM = stale; DOM discount curve; ≥3-cuts behavior; MLS 30–45d DOM-reset; expired = motivated; BOM ≈70% inspection-driven; long tenure = equity + deferred maintenance; era-hazard ranges; insurance-blocking wiring; leased-land = chattel; unpermitted structural = walk; failed-septic FHA/VA block; **NCC 4% transfer tax**; Wilmington VPR/rental/lead ordinances; NCC sheriff mechanics; wholetail economics.

**Folk wisdom / tunable weights (not constants):** exact cut-velocity thresholds; tenure-adjusted list-to-last-sold reseller detector; 15–30%-below-median promotion band; photo-count proxy; power-line discounts (split); road/rail haircut magnitudes; $25–30K profit floor (operator-set); 7%/8% rate framings.

**Time-sensitive — re-verify at build:** Wilmington VPR fees; hard-money rates; DE flip ROI (compressed 2024→25); DE property-tax reassessment (in flux 2025–26); DE ground-rent prevalence.

**Biggest build insight — leverage ranking:** (1) price/sales-history derived metrics — pure computation on scraped data; (2) three-list lexicon feeding the AI judge with a structured output contract; (3) year-built era-hazard lookup; (4) ZIP tier + transfer-tax + city-boundary tables; (5) photo-count heuristic; (6) rent/FEMA/permit lookups — the only new external deps; (7) photo/Street-View vision tiering — already prototyped in condition-batch.
