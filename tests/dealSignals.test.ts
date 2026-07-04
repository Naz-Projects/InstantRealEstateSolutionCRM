import { describe, it, expect } from "vitest";
import { deriveDealSignals, SIGNAL_CONFIG, NCC_ZIP_TIERS, classifyEvent } from "../src/scraper/dealSignals";
import type { PriceEvent } from "../src/scraper/dealSignals";

// A fixed "now" so tenure/velocity/DOM math is deterministic (no Date.now in module).
const NOW = Date.parse("2026-07-04T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString().slice(0, 10);

// Minimal valid input; individual tests override fields.
const base = {
  listPrice: 200000,
  sqft: 1500,
  priceHistory: [] as PriceEvent[],
  lastSoldPrice: null as number | null,
  dateSold: null as string | null,
  daysOnZillow: null as number | null,
  yearBuilt: null as number | null,
  photoCount: null as number | null,
  compsPpsf: null as number | null,
  now: NOW,
};

describe("classifyEvent (tolerant Zillow event names)", () => {
  it("classifies the common Zillow event strings", () => {
    expect(classifyEvent("Listed for sale")).toBe("listed");
    expect(classifyEvent("Price change")).toBe("price_change");
    expect(classifyEvent("Pending sale")).toBe("pending");
    expect(classifyEvent("Contingent")).toBe("pending");
    expect(classifyEvent("Listing removed")).toBe("removed");
    expect(classifyEvent("Sold")).toBe("sold");
    expect(classifyEvent("Back on market")).toBe("listed");
  });
  it("is tolerant of casing/unknowns", () => {
    expect(classifyEvent("PRICE CHANGE")).toBe("price_change");
    expect(classifyEvent("something weird")).toBe("other");
    expect(classifyEvent("")).toBe("other");
    expect(classifyEvent(undefined)).toBe("other");
  });
});

describe("cut depth / count / velocity / large-late cut (§3 rows 1-4)", () => {
  it("computes cumulative cut depth from earliest listed price vs current list", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(80), event: "Listed for sale", price: 250000, ppsf: null },
      { date: daysAgo(40), event: "Price change", price: 235000, ppsf: null },
      { date: daysAgo(10), event: "Price change", price: 220000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, listPrice: 220000, priceHistory });
    // (250000 - 220000) / 250000 = 0.12
    expect(s.cutDepthPct).toBeCloseTo(0.12, 4);
    expect(s.cutCount).toBe(2); // two downward price changes
  });
  it("counts only DOWNWARD price changes as cuts", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(90), event: "Listed for sale", price: 200000, ppsf: null },
      { date: daysAgo(60), event: "Price change", price: 210000, ppsf: null }, // increase - not a cut
      { date: daysAgo(30), event: "Price change", price: 195000, ppsf: null }, // cut
    ];
    const s = deriveDealSignals({ ...base, listPrice: 195000, priceHistory });
    expect(s.cutCount).toBe(1);
  });
  it("cut velocity = cuts per 30 days over the cut window", () => {
    // two cuts spanning ~20 days -> ~3 cuts/30d = acute
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(40), event: "Listed for sale", price: 300000, ppsf: null },
      { date: daysAgo(20), event: "Price change", price: 285000, ppsf: null },
      { date: daysAgo(0), event: "Price change", price: 270000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, listPrice: 270000, priceHistory });
    expect(s.cutVelocity).toBeGreaterThanOrEqual(2); // acute
  });
  it("largeLateCut when the largest cut >=5% happens after day 90", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(200), event: "Listed for sale", price: 300000, ppsf: null },
      { date: daysAgo(100), event: "Price change", price: 255000, ppsf: null }, // -15% at day 100 (late, large)
    ];
    const s = deriveDealSignals({ ...base, listPrice: 255000, priceHistory, daysOnZillow: 200 });
    expect(s.largeLateCut).toBe(true);
  });
  it("no largeLateCut for a small early cut", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(30), event: "Listed for sale", price: 300000, ppsf: null },
      { date: daysAgo(20), event: "Price change", price: 294000, ppsf: null }, // -2% early
    ];
    const s = deriveDealSignals({ ...base, listPrice: 294000, priceHistory, daysOnZillow: 30 });
    expect(s.largeLateCut).toBe(false);
  });
  it("no cuts on a single listed event -> zeros, not NaN", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(5), event: "Listed for sale", price: 200000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, priceHistory });
    expect(s.cutCount).toBe(0);
    expect(s.cutDepthPct).toBe(0);
    expect(s.cutVelocity).toBe(0);
    expect(s.largeLateCut).toBe(false);
  });
});

describe("DOM bucket (§3 rows 5-6, absolute backstops)", () => {
  it("prefers daysOnZillow, else derives from earliest listed event", () => {
    const s = deriveDealSignals({ ...base, daysOnZillow: 45 });
    expect(s.domDays).toBe(45);
    expect(s.domBucket).toBe("aging");
  });
  it("buckets: fresh / normal / aging / stale / outlier", () => {
    expect(deriveDealSignals({ ...base, daysOnZillow: 7 }).domBucket).toBe("fresh");
    expect(deriveDealSignals({ ...base, daysOnZillow: 20 }).domBucket).toBe("normal");
    expect(deriveDealSignals({ ...base, daysOnZillow: 45 }).domBucket).toBe("aging");
    expect(deriveDealSignals({ ...base, daysOnZillow: 75 }).domBucket).toBe("stale");
    expect(deriveDealSignals({ ...base, daysOnZillow: 120 }).domBucket).toBe("outlier");
  });
  it("derives DOM from earliest listed event date when daysOnZillow is null", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(100), event: "Listed for sale", price: 200000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, daysOnZillow: null, priceHistory });
    expect(s.domDays).toBe(100);
    expect(s.domBucket).toBe("outlier");
  });
  it("domDays null when neither daysOnZillow nor a listed event exist", () => {
    const s = deriveDealSignals({ ...base, daysOnZillow: null, priceHistory: [] });
    expect(s.domDays).toBeNull();
    expect(s.domBucket).toBeNull();
  });
});

describe("tenure (§3 row 8)", () => {
  it("long tenure (>15y) flags equity profile", () => {
    const s = deriveDealSignals({ ...base, dateSold: "2000-05-01", lastSoldPrice: 100000 });
    expect(s.tenureYears).toBeGreaterThan(25);
    expect(s.tenureSignal).toBe("long_tenure_equity");
  });
  it("recent purchase (<2y) flags investor/quick-exit", () => {
    const s = deriveDealSignals({ ...base, dateSold: daysAgo(300), lastSoldPrice: 180000 });
    expect(s.tenureYears).toBeLessThan(2);
    expect(s.tenureSignal).toBe("recent_purchase_flag");
  });
  it("mid tenure -> null signal", () => {
    const s = deriveDealSignals({ ...base, dateSold: daysAgo(365 * 6), lastSoldPrice: 150000 });
    expect(s.tenureSignal).toBeNull();
  });
  it("null dateSold -> null tenure", () => {
    const s = deriveDealSignals({ ...base, dateSold: null });
    expect(s.tenureYears).toBeNull();
    expect(s.tenureSignal).toBeNull();
  });
});

describe("list-to-last-sold ratio + appreciation (§3 row 9)", () => {
  it("priced below appreciation-implied on long tenure", () => {
    // bought 100k 20y ago; expected = 100000 * 1.03^20 ~= 180611; list 150k is below
    const s = deriveDealSignals({ ...base, listPrice: 150000, dateSold: daysAgo(365 * 20), lastSoldPrice: 100000 });
    expect(s.listToLastSoldRatio).toBeCloseTo(1.5, 2);
    expect(s.vsAppreciation).toContain("priced_below_appreciation");
  });
  it("underwater when ratio < 1.0", () => {
    const s = deriveDealSignals({ ...base, listPrice: 90000, dateSold: daysAgo(365 * 3), lastSoldPrice: 100000 });
    expect(s.listToLastSoldRatio).toBeCloseTo(0.9, 4);
    expect(s.vsAppreciation).toContain("underwater");
  });
  it("thin margin resale when <2y tenure and ratio < 1.25", () => {
    const s = deriveDealSignals({ ...base, listPrice: 205000, dateSold: daysAgo(300), lastSoldPrice: 180000 });
    // ratio ~1.139 < 1.25 and tenure < 2y
    expect(s.vsAppreciation).toContain("thin_margin_resale");
  });
  it("null lastSold -> null ratio, empty vsAppreciation", () => {
    const s = deriveDealSignals({ ...base, lastSoldPrice: null, dateSold: null });
    expect(s.listToLastSoldRatio).toBeNull();
    expect(s.vsAppreciation).toEqual([]);
  });
  it("zero lastSold -> null ratio (no divide by zero)", () => {
    const s = deriveDealSignals({ ...base, lastSoldPrice: 0, dateSold: daysAgo(365) });
    expect(s.listToLastSoldRatio).toBeNull();
  });
});

describe("back-on-market + relisted (§3 row 13)", () => {
  it("backOnMarket when a pending/contingent is later followed by an active/listed/price event", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(60), event: "Listed for sale", price: 200000, ppsf: null },
      { date: daysAgo(30), event: "Pending sale", price: 200000, ppsf: null },
      { date: daysAgo(10), event: "Price change", price: 190000, ppsf: null }, // back active after pending
    ];
    const s = deriveDealSignals({ ...base, listPrice: 190000, priceHistory });
    expect(s.backOnMarket).toBe(true);
  });
  it("contingent->active also counts as back on market", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(40), event: "Listed for sale", price: 200000, ppsf: null },
      { date: daysAgo(20), event: "Contingent", price: 200000, ppsf: null },
      { date: daysAgo(5), event: "Listed for sale", price: 200000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, priceHistory });
    expect(s.backOnMarket).toBe(true);
  });
  it("still-pending (no later active) is NOT back on market", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(40), event: "Listed for sale", price: 200000, ppsf: null },
      { date: daysAgo(20), event: "Pending sale", price: 200000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, priceHistory });
    expect(s.backOnMarket).toBe(false);
  });
  it("relisted when a Listed event follows a Sold/Removed gap", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(400), event: "Listed for sale", price: 180000, ppsf: null },
      { date: daysAgo(380), event: "Listing removed", price: 180000, ppsf: null },
      { date: daysAgo(20), event: "Listed for sale", price: 210000, ppsf: null }, // relist much later
    ];
    const s = deriveDealSignals({ ...base, listPrice: 210000, priceHistory });
    expect(s.relisted).toBe(true);
  });
  it("no relist on a straight single-listing history", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(20), event: "Listed for sale", price: 200000, ppsf: null },
      { date: daysAgo(10), event: "Price change", price: 195000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, priceHistory });
    expect(s.relisted).toBe(false);
  });
});

describe("photo signal (§1.11)", () => {
  it("sparse_photos when <=8", () => {
    expect(deriveDealSignals({ ...base, photoCount: 5 }).photoSignal).toBe("sparse_photos");
    expect(deriveDealSignals({ ...base, photoCount: 8 }).photoSignal).toBe("sparse_photos");
  });
  it("retail_staging when >=35", () => {
    expect(deriveDealSignals({ ...base, photoCount: 40 }).photoSignal).toBe("retail_staging");
  });
  it("null in the middle / when count unknown", () => {
    expect(deriveDealSignals({ ...base, photoCount: 20 }).photoSignal).toBeNull();
    expect(deriveDealSignals({ ...base, photoCount: null }).photoSignal).toBeNull();
  });
});

describe("ppsf discount vs comps (§1.1 headline screen)", () => {
  it("computes 1 - subjectPpsf/compsPpsf", () => {
    // subject 200000/1500 = 133.33; comps 180 -> 1 - 133.33/180 = ~0.259
    const s = deriveDealSignals({ ...base, listPrice: 200000, sqft: 1500, compsPpsf: 180 });
    expect(s.ppsfDiscountPct).toBeCloseTo(0.259, 3);
  });
  it("null when comps or sqft missing / zero sqft", () => {
    expect(deriveDealSignals({ ...base, compsPpsf: null }).ppsfDiscountPct).toBeNull();
    expect(deriveDealSignals({ ...base, sqft: 0, compsPpsf: 180 }).ppsfDiscountPct).toBeNull();
    expect(deriveDealSignals({ ...base, sqft: null, compsPpsf: 180 }).ppsfDiscountPct).toBeNull();
  });
});

describe("era hazards from year built (§4 table)", () => {
  it("pre-1978 house triggers lead + asbestos + polybutylene where ranges overlap", () => {
    const s = deriveDealSignals({ ...base, yearBuilt: 1956 });
    expect(s.eraHazards).toContain("lead_paint_pre1978");
    expect(s.eraHazards).toContain("asbestos_era_pre1980");
  });
  it("1930 house triggers knob-and-tube + oil tank", () => {
    const s = deriveDealSignals({ ...base, yearBuilt: 1930 });
    expect(s.eraHazards).toContain("knob_tube_era_pre1940");
    expect(s.eraHazards).toContain("oil_tank_risk_pre1975");
    expect(s.eraHazards).toContain("lead_paint_pre1978");
  });
  it("1970 house triggers aluminum wiring era", () => {
    const s = deriveDealSignals({ ...base, yearBuilt: 1970 });
    expect(s.eraHazards).toContain("aluminum_wiring_era_1965_75");
  });
  it("1985 house triggers polybutylene era but not lead/asbestos", () => {
    const s = deriveDealSignals({ ...base, yearBuilt: 1985 });
    expect(s.eraHazards).toContain("polybutylene_era_1978_95");
    expect(s.eraHazards).not.toContain("lead_paint_pre1978");
    expect(s.eraHazards).not.toContain("asbestos_era_pre1980");
  });
  it("2005 house triggers no era hazards", () => {
    expect(deriveDealSignals({ ...base, yearBuilt: 2005 }).eraHazards).toEqual([]);
  });
  it("null year -> empty hazards", () => {
    expect(deriveDealSignals({ ...base, yearBuilt: null }).eraHazards).toEqual([]);
  });
});

describe("ZIP tier lookup (§1.12)", () => {
  it("maps city-high-risk / suburb-standard / suburb-premium", () => {
    expect(deriveDealSignals({ ...base, zip: "19801" }).zipTier).toBe("city-high-risk");
    expect(deriveDealSignals({ ...base, zip: "19702" }).zipTier).toBe("suburb-standard");
    expect(deriveDealSignals({ ...base, zip: "19709" }).zipTier).toBe("suburb-premium");
    expect(deriveDealSignals({ ...base, zip: "19707" }).zipTier).toBe("suburb-premium");
    expect(deriveDealSignals({ ...base, zip: "19808" }).zipTier).toBe("suburb-premium");
  });
  it("unknown zip -> null", () => {
    expect(deriveDealSignals({ ...base, zip: "07030" }).zipTier).toBeNull();
    expect(deriveDealSignals({ ...base, zip: undefined }).zipTier).toBeNull();
  });
  it("NCC_ZIP_TIERS is exported and covers the three tiers", () => {
    expect(NCC_ZIP_TIERS["19801"]).toBe("city-high-risk");
    expect(NCC_ZIP_TIERS["19709"]).toBe("suburb-premium");
  });
});

describe("motivation composite (§3, cap 10)", () => {
  it("sums points and returns human-readable signals; caps at 10", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(200), event: "Listed for sale", price: 300000, ppsf: null },
      { date: daysAgo(150), event: "Price change", price: 280000, ppsf: null },
      { date: daysAgo(100), event: "Price change", price: 260000, ppsf: null },
      { date: daysAgo(50), event: "Price change", price: 240000, ppsf: null }, // 3 cuts, >15% depth, large late
    ];
    const s = deriveDealSignals({
      ...base,
      listPrice: 240000,
      priceHistory,
      daysOnZillow: 200, // outlier / stale
      dateSold: daysAgo(365 * 22), // 22-yr owner
      lastSoldPrice: 120000,
    });
    expect(s.motivationPoints).toBeGreaterThan(0);
    expect(s.motivationPoints).toBeLessThanOrEqual(SIGNAL_CONFIG.motivationCap);
    expect(s.motivationSignals.length).toBeGreaterThan(0);
    // human-readable strings mention the cuts and the tenure
    const joined = s.motivationSignals.join(" | ").toLowerCase();
    expect(joined).toMatch(/cut/);
    expect(joined).toMatch(/owner|tenure|yr/);
  });
  it("a clean fresh listing has ~zero motivation and no signals", () => {
    const priceHistory: PriceEvent[] = [
      { date: daysAgo(3), event: "Listed for sale", price: 200000, ppsf: null },
    ];
    const s = deriveDealSignals({ ...base, priceHistory, daysOnZillow: 3 });
    expect(s.motivationPoints).toBe(0);
    expect(s.motivationSignals).toEqual([]);
  });
});

describe("SIGNAL_CONFIG shape", () => {
  it("exposes tunable thresholds/points", () => {
    expect(typeof SIGNAL_CONFIG.motivationCap).toBe("number");
    expect(SIGNAL_CONFIG.cutDepth).toBeDefined();
    expect(SIGNAL_CONFIG.dom).toBeDefined();
    expect(SIGNAL_CONFIG.tenure).toBeDefined();
    expect(SIGNAL_CONFIG.photo).toBeDefined();
  });
});

describe("edge cases: empty / minimal input", () => {
  it("empty history + all nulls -> safe zero/null result (no throw)", () => {
    const s = deriveDealSignals({
      listPrice: 0,
      sqft: 0,
      priceHistory: [],
      lastSoldPrice: null,
      dateSold: null,
      daysOnZillow: null,
      yearBuilt: null,
      photoCount: null,
      compsPpsf: null,
      now: NOW,
    });
    expect(s.cutCount).toBe(0);
    expect(s.cutDepthPct).toBe(0);
    expect(s.domDays).toBeNull();
    expect(s.tenureYears).toBeNull();
    expect(s.ppsfDiscountPct).toBeNull();
    expect(s.eraHazards).toEqual([]);
    expect(s.zipTier).toBeNull();
    expect(s.motivationPoints).toBe(0);
    expect(s.motivationSignals).toEqual([]);
  });
});
