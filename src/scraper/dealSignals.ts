// Pure derived-metrics for the Monitor deep-analysis layer.
// Turns already-scraped listing data (price/sales history, DOM, year built,
// photos, $/sqft) into the screening signals professional flippers use.
// Thresholds/semantics come from docs/superpowers/research/2026-07-04-flipper-criteria.md
// (§3 price/sales-history playbook, §4 era-hazard table, §1.12 ZIP tiers, §1.1 $/sqft screen).
//
// No Date.now() in here — the caller passes `now` (ms epoch) so the math is testable.

export interface PriceEvent { date?: string; event?: string; price?: number; ppsf?: number | null; }

export interface DealSignalsInput {
  listPrice: number;
  sqft: number | null;
  priceHistory: PriceEvent[];
  lastSoldPrice: number | null;
  dateSold: string | null;
  daysOnZillow: number | null;
  yearBuilt: number | null;
  photoCount: number | null;
  compsPpsf: number | null;
  zip?: string;
  now: number;
}

export type DomBucket = "fresh" | "normal" | "aging" | "stale" | "outlier";
export type TenureSignal = "long_tenure_equity" | "recent_purchase_flag";
export type PhotoSignal = "sparse_photos" | "retail_staging";
export type ZipTier = "city-high-risk" | "suburb-standard" | "suburb-premium";

export interface DealSignals {
  cutDepthPct: number;              // (origList − curList)/origList, 0 when no cuts (§3 row 1)
  cutCount: number;                 // # downward price-change events (§3 row 2)
  cutVelocity: number;              // cuts per 30 days over the cut window (§3 row 3)
  largeLateCut: boolean;            // largest cut ≥5% after day 90 (§3 row 4)
  domDays: number | null;           // days on market (§3 row 5)
  domBucket: DomBucket | null;      // absolute-backstop bucket (§3 rows 5-6)
  tenureYears: number | null;       // now − dateSold in years (§3 row 8)
  tenureSignal: TenureSignal | null;
  listToLastSoldRatio: number | null; // curList / lastSoldPrice (§3 row 9)
  vsAppreciation: string[];         // flags vs 1.03^tenure expectation (§3 row 9)
  backOnMarket: boolean;            // pending/contingent then active again (§3 row 13)
  relisted: boolean;                // Listed after a Sold/Removed gap
  photoSignal: PhotoSignal | null;  // sparse/retail (§1.11)
  ppsfDiscountPct: number | null;   // 1 − subjectPpsf/compsPpsf (§1.1)
  eraHazards: string[];             // from yearBuilt (§4)
  zipTier: ZipTier | null;          // NCC ZIP tier (§1.12)
  motivationPoints: number;         // composite, capped (§3)
  motivationSignals: string[];      // human-readable
}

// ── Tunable thresholds/points (research §-refs in comments) ───────────────────
export const SIGNAL_CONFIG = {
  motivationCap: 10, // §3 "sum motivation points (cap ~10)"
  cutDepth: {        // §3 row 1: <2% noise · 2–5% responsive (+1) · 5–10% softening (+2) · >10% motivated (+3)
    responsive: 0.02, softening: 0.05, motivated: 0.10, // band FLOORS; motivated is exclusive (>10%)
    pts: { responsive: 1, softening: 2, motivated: 3 },
  },
  cutCount: { flexible: 2, strong: 3, pts: { flexible: 1, strong: 2 } }, // §3 row 2
  cutVelocity: { acute: 2, minCuts: 2, pts: 2 }, // §3 row 3: ≥2 cuts/~30d = acute; a single cut is never acute
  largeLateCut: { minPct: 0.05, afterDay: 90, pts: 1 }, // §3 row 4
  dom: { fresh: 14, aging: 30, stale: 60, outlier: 90, stalePts: 2 }, // §3 rows 5-6 backstops
  tenure: { longYears: 15, recentYears: 2, longPts: 2 }, // §3 row 8
  appreciation: { annualRate: 0.03, thinMarginRatio: 1.25, belowApprecPts: 2, underwaterPts: 3 }, // §3 row 9
  backOnMarket: { pts: 2 }, // §3 row 13
  photo: { sparse: 8, retail: 35 }, // §1.11
  relistGapDays: 45, // §3 row 7: MLS resets DOM after 30–45d off-market
} as const;

// §1.12 NCC ZIP tiers (data, tunable).
export const NCC_ZIP_TIERS: Record<string, ZipTier> = {
  // city-high-risk (Wilmington city) — rental/BRRRR territory, high variance
  "19801": "city-high-risk", "19802": "city-high-risk", "19805": "city-high-risk", "19806": "city-high-risk",
  // suburb-standard (Newark/Bear/New Castle/Claymont/Elsmere)
  "19702": "suburb-standard", "19711": "suburb-standard", "19713": "suburb-standard",
  "19701": "suburb-standard", "19720": "suburb-standard", "19703": "suburb-standard",
  // suburb-premium (Middletown/Hockessin/Pike Creek)
  "19709": "suburb-premium", "19707": "suburb-premium", "19808": "suburb-premium",
};

// ── Tolerant Zillow event classification ──────────────────────────────────────
// ASSUMPTION: Zillow event strings vary ("Listed for sale", "Price change",
// "Pending sale", "Contingent", "Listing removed", "Sold", "Back on market").
// We classify by tolerant regex on lowercased text, not exact equality.
export type EventKind = "listed" | "price_change" | "pending" | "removed" | "sold" | "other";
export function classifyEvent(event: string | undefined): EventKind {
  const e = (event || "").toLowerCase();
  if (!e) return "other";
  if (/price\s*change|price\s*(reduc|increas)|reduced|new price/.test(e)) return "price_change";
  if (/pending|contingent|under contract|accepting backup/.test(e)) return "pending";
  if (/\bsold\b/.test(e)) return "sold";
  if (/removed|withdrawn|delisted|off market|canceled|cancelled|expired/.test(e)) return "removed";
  // "Back on market" / "Listed for sale" / "Listing" / "for sale" / "active" / "coming soon"
  if (/list|for sale|back on market|active|coming soon/.test(e)) return "listed";
  return "other";
}

function toMs(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isNaN(t) ? null : t;
}

interface Ev extends PriceEvent { kind: EventKind; ms: number | null; }

// Sort ascending by date (oldest first); events without a parseable date sink to front.
function normalizeHistory(priceHistory: PriceEvent[]): Ev[] {
  return priceHistory
    .map((h) => ({ ...h, kind: classifyEvent(h.event), ms: toMs(h.date) }))
    .sort((a, b) => (a.ms ?? -Infinity) - (b.ms ?? -Infinity));
}

// The original list price = the earliest listed-price event's price (fallback: earliest priced event).
function originalListPrice(events: Ev[]): number | null {
  const listed = events.find((e) => e.kind === "listed" && typeof e.price === "number");
  if (listed) return listed.price!;
  const anyPriced = events.find((e) => typeof e.price === "number");
  return anyPriced ? anyPriced.price! : null;
}

// ── Price-cut metrics (§3 rows 1-4) ───────────────────────────────────────────
function cutMetrics(events: Ev[], listPrice: number, now: number, domDays: number | null) {
  // downward price-change events → a "cut"
  const priced = events.filter((e) => typeof e.price === "number");
  const cuts: { ms: number | null; from: number; to: number; pct: number }[] = [];
  for (let i = 1; i < priced.length; i++) {
    const prev = priced[i - 1].price!;
    const cur = priced[i].price!;
    if (cur < prev && priced[i].kind === "price_change") {
      cuts.push({ ms: priced[i].ms, from: prev, to: cur, pct: (prev - cur) / prev });
    }
  }
  const orig = originalListPrice(events);
  const cutDepthPct = orig && orig > 0 && listPrice > 0 && listPrice < orig ? (orig - listPrice) / orig : 0;
  const cutCount = cuts.length;

  // velocity = cuts per 30 days across the span of the cut window (first→last cut, or first cut→now)
  let cutVelocity = 0;
  if (cutCount >= 1) {
    const cutMsList = cuts.map((c) => c.ms).filter((m): m is number => m != null);
    if (cutMsList.length >= 1) {
      const first = Math.min(...cutMsList);
      const last = cutMsList.length >= 2 ? Math.max(...cutMsList) : now;
      const spanDays = Math.max((last - first) / 86400000, 1); // ≥1 day to avoid div-by-zero
      cutVelocity = (cutCount / spanDays) * 30;
    }
  }

  // largest cut ≥5% happening after day 90 of the listing
  let largeLateCut = false;
  const listedMs = events.find((e) => e.kind === "listed" && e.ms != null)?.ms
    ?? (domDays != null ? now - domDays * 86400000 : null);
  const bigCuts = cuts.filter((c) => c.pct >= SIGNAL_CONFIG.largeLateCut.minPct);
  if (bigCuts.length && listedMs != null) {
    for (const c of bigCuts) {
      if (c.ms != null) {
        const dayOfCut = (c.ms - listedMs) / 86400000;
        if (dayOfCut >= SIGNAL_CONFIG.largeLateCut.afterDay) { largeLateCut = true; break; }
      }
    }
  }
  return { cutDepthPct, cutCount, cutVelocity, largeLateCut, cuts };
}

// ── DOM (§3 rows 5-6) ─────────────────────────────────────────────────────────
function domMetrics(daysOnZillow: number | null, events: Ev[], now: number): { domDays: number | null; domBucket: DomBucket | null } {
  let domDays = daysOnZillow;
  if (domDays == null) {
    const listedMs = events.find((e) => e.kind === "listed" && e.ms != null)?.ms ?? null;
    if (listedMs != null) domDays = Math.round((now - listedMs) / 86400000);
  }
  if (domDays == null) return { domDays: null, domBucket: null };
  const c = SIGNAL_CONFIG.dom;
  const domBucket: DomBucket =
    domDays < c.fresh ? "fresh" :
    domDays < c.aging ? "normal" :
    domDays < c.stale ? "aging" :
    domDays < c.outlier ? "stale" : "outlier";
  return { domDays, domBucket };
}

// ── Tenure (§3 row 8) ─────────────────────────────────────────────────────────
function tenureMetrics(dateSold: string | null, now: number): { tenureYears: number | null; tenureSignal: TenureSignal | null } {
  const ms = toMs(dateSold);
  if (ms == null) return { tenureYears: null, tenureSignal: null };
  const tenureYears = (now - ms) / (365.25 * 86400000);
  const t = SIGNAL_CONFIG.tenure;
  const tenureSignal: TenureSignal | null =
    tenureYears > t.longYears ? "long_tenure_equity" :
    tenureYears < t.recentYears ? "recent_purchase_flag" : null;
  return { tenureYears, tenureSignal };
}

// ── List-to-last-sold vs appreciation (§3 row 9) ──────────────────────────────
function appreciationMetrics(listPrice: number, lastSoldPrice: number | null, tenureYears: number | null) {
  if (!lastSoldPrice || lastSoldPrice <= 0) return { listToLastSoldRatio: null as number | null, vsAppreciation: [] as string[] };
  const ratio = listPrice / lastSoldPrice;
  const flags: string[] = [];
  const a = SIGNAL_CONFIG.appreciation;
  if (ratio < 1.0) flags.push("underwater");
  if (tenureYears != null) {
    const expectedRatio = Math.pow(1 + a.annualRate, tenureYears);
    // §3 row 9 scopes this to "at/below appreciation-implied ON LONG TENURE" —
    // a short-tenure reseller at a low ratio is the thin-margin case, not pricing-to-move.
    if (tenureYears >= SIGNAL_CONFIG.tenure.longYears && ratio <= expectedRatio && ratio >= 1.0) {
      flags.push("priced_below_appreciation");
    }
    if (tenureYears < SIGNAL_CONFIG.tenure.recentYears && ratio < a.thinMarginRatio && ratio >= 1.0) {
      flags.push("thin_margin_resale");
    }
  }
  return { listToLastSoldRatio: ratio, vsAppreciation: flags };
}

// ── Back-on-market + relisted (§3 rows 7, 13) ─────────────────────────────────
function marketReturnMetrics(events: Ev[]): { backOnMarket: boolean; relisted: boolean } {
  let backOnMarket = false;
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === "pending") {
      // any later event that puts it back active (listed / price change)
      if (events.slice(i + 1).some((e) => e.kind === "listed" || e.kind === "price_change")) {
        backOnMarket = true;
        break;
      }
    }
  }
  // relisted: a Listed event following a Sold/Removed with a real gap
  let relisted = false;
  for (let i = 1; i < events.length; i++) {
    if (events[i].kind === "listed" && (events[i - 1].kind === "removed" || events[i - 1].kind === "sold")) {
      const a = events[i - 1].ms, b = events[i].ms;
      if (a != null && b != null && (b - a) / 86400000 >= SIGNAL_CONFIG.relistGapDays) { relisted = true; break; }
      if (a == null || b == null) { relisted = true; break; } // undated but sequenced → treat as relist
    }
  }
  return { backOnMarket, relisted };
}

// ── Photo (§1.11) ─────────────────────────────────────────────────────────────
function photoMetrics(photoCount: number | null): PhotoSignal | null {
  if (photoCount == null) return null;
  if (photoCount <= SIGNAL_CONFIG.photo.sparse) return "sparse_photos";
  if (photoCount >= SIGNAL_CONFIG.photo.retail) return "retail_staging";
  return null;
}

// ── $/sqft discount vs comps (§1.1) ───────────────────────────────────────────
function ppsfDiscount(listPrice: number, sqft: number | null, compsPpsf: number | null): number | null {
  if (!sqft || sqft <= 0 || !compsPpsf || compsPpsf <= 0 || !listPrice) return null;
  const subjectPpsf = listPrice / sqft;
  return 1 - subjectPpsf / compsPpsf;
}

// ── Era hazards from year built (§4). year-only confidence → VERIFY-gated ──────
function eraHazardsFromYear(yearBuilt: number | null): string[] {
  if (yearBuilt == null) return [];
  const h: string[] = [];
  if (yearBuilt < 1978) h.push("lead_paint_pre1978");
  if (yearBuilt <= 1980) h.push("asbestos_era_pre1980"); // §4: flag range ≤1980 (inclusive)
  if (yearBuilt < 1940) h.push("knob_tube_era_pre1940");
  if (yearBuilt >= 1965 && yearBuilt <= 1975) h.push("aluminum_wiring_era_1965_75");
  if (yearBuilt >= 1978 && yearBuilt <= 1995) h.push("polybutylene_era_1978_95");
  if (yearBuilt <= 1975) h.push("oil_tank_risk_pre1975");
  return h;
}

// ── Motivation composite (§3, cap 10) ─────────────────────────────────────────
function composeMotivation(m: {
  cutDepthPct: number; cutCount: number; cutVelocity: number; largeLateCut: boolean;
  domBucket: DomBucket | null; tenureYears: number | null; tenureSignal: TenureSignal | null;
  vsAppreciation: string[]; backOnMarket: boolean;
}): { motivationPoints: number; motivationSignals: string[] } {
  let pts = 0;
  const signals: string[] = [];
  const C = SIGNAL_CONFIG;

  // cut depth (§3 row 1) — 2–5% +1 · 5–10% +2 · >10% +3 (below 2% = noise)
  if (m.cutDepthPct > C.cutDepth.motivated) { pts += C.cutDepth.pts.motivated; }
  else if (m.cutDepthPct >= C.cutDepth.softening) { pts += C.cutDepth.pts.softening; }
  else if (m.cutDepthPct >= C.cutDepth.responsive) { pts += C.cutDepth.pts.responsive; }

  // cut count (§3 row 2)
  if (m.cutCount >= C.cutCount.strong) pts += C.cutCount.pts.strong;
  else if (m.cutCount >= C.cutCount.flexible) pts += C.cutCount.pts.flexible;
  if (m.cutCount > 0) {
    signals.push(`${m.cutCount} price cut${m.cutCount === 1 ? "" : "s"} (-${Math.round(m.cutDepthPct * 100)}%)`);
  }

  // cut velocity (§3 row 3) — "≥2 cuts/~30d": a single cut can never be acute
  if (m.cutCount >= C.cutVelocity.minCuts && m.cutVelocity >= C.cutVelocity.acute) {
    pts += C.cutVelocity.pts; signals.push("rapid price cuts");
  }

  // large late cut (§3 row 4)
  if (m.largeLateCut) { pts += C.largeLateCut.pts; signals.push("large late price cut"); }

  // DOM staleness (§3 rows 5-6)
  if (m.domBucket === "stale" || m.domBucket === "outlier") { pts += C.dom.stalePts; signals.push("stale on market"); }

  // tenure (§3 row 8)
  if (m.tenureSignal === "long_tenure_equity" && m.tenureYears != null) {
    pts += C.tenure.longPts;
    signals.push(`${Math.round(m.tenureYears)}-yr owner`);
  }

  // list vs appreciation (§3 row 9)
  if (m.vsAppreciation.includes("underwater")) { pts += C.appreciation.underwaterPts; signals.push("underwater vs last sale"); }
  else if (m.vsAppreciation.includes("priced_below_appreciation")) { pts += C.appreciation.belowApprecPts; signals.push("priced below appreciation"); }

  // back on market (§3 row 13)
  if (m.backOnMarket) { pts += C.backOnMarket.pts; signals.push("back on market"); }

  return { motivationPoints: Math.min(pts, C.motivationCap), motivationSignals: signals };
}

export function deriveDealSignals(input: DealSignalsInput): DealSignals {
  const { listPrice, sqft, priceHistory, lastSoldPrice, dateSold, daysOnZillow, yearBuilt, photoCount, compsPpsf, zip, now } = input;
  const events = normalizeHistory(priceHistory || []);

  const { domDays, domBucket } = domMetrics(daysOnZillow, events, now);
  const { cutDepthPct, cutCount, cutVelocity, largeLateCut } = cutMetrics(events, listPrice, now, domDays);
  const { tenureYears, tenureSignal } = tenureMetrics(dateSold, now);
  const { listToLastSoldRatio, vsAppreciation } = appreciationMetrics(listPrice, lastSoldPrice, tenureYears);
  const { backOnMarket, relisted } = marketReturnMetrics(events);
  const photoSignal = photoMetrics(photoCount);
  const ppsfDiscountPct = ppsfDiscount(listPrice, sqft, compsPpsf);
  const eraHazards = eraHazardsFromYear(yearBuilt);
  const zipTier = (zip && NCC_ZIP_TIERS[zip]) || null;

  const { motivationPoints, motivationSignals } = composeMotivation({
    cutDepthPct, cutCount, cutVelocity, largeLateCut, domBucket, tenureYears, tenureSignal, vsAppreciation, backOnMarket,
  });

  return {
    cutDepthPct, cutCount, cutVelocity, largeLateCut,
    domDays, domBucket,
    tenureYears, tenureSignal,
    listToLastSoldRatio, vsAppreciation,
    backOnMarket, relisted,
    photoSignal,
    ppsfDiscountPct,
    eraHazards,
    zipTier,
    motivationPoints, motivationSignals,
  };
}
