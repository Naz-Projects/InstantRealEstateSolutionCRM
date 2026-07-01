export const MONITOR = {
  regionId: 2986, regionType: 4, // New Castle County, DE
  priceCeiling: 500000, dozDays: "7", sort: "days",
  spreadThreshold: 0.15, flipMarginBar: 0.12, capRateBar: 0.06,
  ncc_bounds: { west: -75.97218944726562, east: -75.22237255273437, south: 39.36230086205304, north: 39.76777058263119 },
} as const;

export function buildSearchUrl({ page }: { page?: number } = {}): string {
  const sqs = {
    pagination: page && page > 1 ? { currentPage: page } : {},
    isMapVisible: false,
    mapBounds: MONITOR.ncc_bounds,
    regionSelection: [{ regionId: MONITOR.regionId, regionType: MONITOR.regionType }],
    filterState: { sort: { value: MONITOR.sort }, doz: { value: MONITOR.dozDays }, price: { max: MONITOR.priceCeiling } },
    isListVisible: true,
  };
  return "https://www.zillow.com/new-castle-county-de/?searchQueryState=" + encodeURIComponent(JSON.stringify(sqs));
}

export function extractNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
export interface SearchListing {
  zpid: string; price: number | null; beds: number | null; baths: number | null; sqft: number | null;
  ppsf: number | null; status: string; homeType?: string; daysOnZillow?: number;
  zestimate: number | null; zestSpreadPct: number | null; address: string; zip?: string;
  lat?: number; lng?: number; isNewConstruction: boolean; isZillowOwned: boolean; url: string;
}
export function totalResultCount(nextData: any): number | null {
  return nextData?.props?.pageProps?.searchPageState?.cat1?.searchList?.totalResultCount ?? null;
}
export function listingsFromSearch(nextData: any): SearchListing[] {
  const lr = nextData?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults ?? [];
  return lr.map((c: any): SearchListing => {
    const hi = c.hdpData?.homeInfo ?? {};
    const price = c.unformattedPrice ?? hi.price ?? null;
    const sqft = c.area ?? hi.livingArea ?? null;
    const zest = c.zestimate ?? hi.zestimate ?? null;
    const url = c.detailUrl ?? "";
    return {
      zpid: String(c.zpid), price, beds: c.beds ?? hi.bedrooms ?? null, baths: c.baths ?? hi.bathrooms ?? null,
      sqft, ppsf: price && sqft ? Math.round(price / sqft) : null,
      status: c.marketingStatusSimplifiedCd || c.statusText || c.statusType || "",
      homeType: hi.homeType, daysOnZillow: hi.daysOnZillow, zestimate: zest,
      zestSpreadPct: zest && price ? +(((zest - price) / zest) * 100).toFixed(1) : null,
      address: c.address ?? "", zip: c.addressZipcode, lat: c.latLong?.latitude, lng: c.latLong?.longitude,
      isNewConstruction: !!(c.builderName || c.isPaidBuilderNewConstruction) || /\/community\//.test(url),
      isZillowOwned: !!c.isZillowOwned, url,
    };
  });
}

export interface ListingDetail {
  description: string; homeType?: string; homeStatus?: string; yearBuilt: number | null;
  zestimate: number | null; rentZestimate: number | null; lastSoldPrice: number | null; dateSold: string | null;
  monthlyHoaFee: number | null; foreclosure: boolean; daysOnZillow: number | null; mlsId?: string;
  agentName?: string; agentPhone?: string; brokerName?: string; lotSize: number | null;
  priceHistory: { date?: string; event?: string; price?: number; ppsf?: number }[]; photoUrls: string[];
}
export function detailFromCache(nextData: any): ListingDetail | null {
  const cc = nextData?.props?.pageProps?.componentProps?.gdpClientCache;
  if (!cc) return null;
  let cache: any; try { cache = JSON.parse(cc); } catch { return null; }
  const key = Object.keys(cache).find((k) => cache[k] && cache[k].property);
  if (!key) return null;
  const p = cache[key].property;
  const ai = p.attributionInfo ?? {};
  const photos = (p.responsivePhotos ?? p.originalPhotos ?? [])
    .map((ph: any) => ph?.mixedSources?.jpeg?.[0]?.url ?? ph?.url).filter(Boolean).slice(0, 8);
  return {
    description: p.description ?? "", homeType: p.homeType, homeStatus: p.homeStatus,
    yearBuilt: p.resoFacts?.yearBuilt ?? null, zestimate: p.zestimate ?? null, rentZestimate: p.rentZestimate ?? null,
    lastSoldPrice: p.lastSoldPrice ?? null, dateSold: p.dateSoldString ?? null, monthlyHoaFee: p.monthlyHoaFee ?? null,
    foreclosure: !!(p.isPreforeclosureAuction || (p.foreclosureTypes && Object.values(p.foreclosureTypes).some(Boolean))),
    daysOnZillow: p.daysOnZillow ?? null, mlsId: ai.mlsId, agentName: ai.agentName,
    agentPhone: ai.agentPhoneNumber ?? ai.agentPhone, brokerName: ai.brokerName, lotSize: p.lotSize ?? p.lotAreaValue ?? null,
    priceHistory: (p.priceHistory ?? []).slice(0, 6).map((h: any) => ({ date: h.date, event: h.event, price: h.price, ppsf: h.pricePerSquareFoot })),
    photoUrls: photos,
  };
}

import { selectComps, suggestArv, type Comp } from "./comps";
import { estimateRehab, computeFlip, FLIP_DEFAULTS } from "./flip";
export { estimateRehab };

export function conservativeArv(opts: { comps: Comp[]; sqft: number | null; beds: number | null; zestimate: number | null; homeType?: string; }):
  { arv: number | null; source: "comps" | "zestimate" | "none"; compsPpsf: number | null; compsCount: number } {
  const manufactured = (opts.homeType || "").toUpperCase() === "MANUFACTURED";
  if (manufactured) return { arv: opts.zestimate ?? null, source: opts.zestimate ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
  const sel = selectComps(opts.comps, { sqft: opts.sqft, beds: opts.beds });
  const sug = suggestArv(sel, opts.sqft);
  if (sug.arv == null) return { arv: opts.zestimate ?? null, source: opts.zestimate ? "zestimate" : "none", compsPpsf: null, compsCount: 0 };
  let arv = sug.arv;
  if (opts.zestimate && arv > opts.zestimate * 1.15) arv = Math.round(opts.zestimate * 1.15); // cap inflated comps
  return { arv, source: "comps", compsPpsf: sug.pricePerSqft, compsCount: sug.count };
}

const GUT = /fire|flood|gut|shell|structural|severe|full rehab|full renovation|complete renovation|tear down|needs everything/i;
const COSMETIC = /updated|renovated|remodel|move.?in|turn.?key|shows like new|refreshed|pride of ownership|new (kitchen|roof|hvac|appliances)/i;
const MODERATE = /needs? (work|updating|tlc|repairs|renovation)|dated|handyman|investor|value.?add|personal touch|bring your (vision|contractor|imagination)|fixer|sold (strictly )?as.?is|cash only|may not qualify/i;
export function inferRehabTier(description: string): "cosmetic" | "moderate" | "gut" {
  const d = description || "";
  if (GUT.test(d)) return "gut";
  if (COSMETIC.test(d) && !MODERATE.test(d)) return "cosmetic";
  return "moderate";
}

export interface RentalMetrics { rent: number; onePct: number; capRate: number; cashFlow: number; cashOnCash: number; allIn: number; }

export function analyzeFlip(arv: number | null, list: number | null, rehab: number) {
  if (arv == null || list == null) return null;
  const m = computeFlip({ arv, purchasePrice: list, rehabTotal: rehab, assumptions: FLIP_DEFAULTS.assumptions });
  return { mao: m.mao, profit: m.profit, margin: m.margin ?? 0, roi: m.roi, roomVsList: m.mao != null ? Math.round(m.mao - list) : null };
}
export function analyzeRental({ rent, list, rehab, taxRatePct }: { rent: number | null; list: number; rehab: number; taxRatePct?: number }): RentalMetrics | null {
  if (!rent || !list) return null;
  const allIn = list + (rehab || 0);
  const taxMo = (list * ((taxRatePct ?? 1.6) / 100)) / 12, ins = 95, opVar = 0.25 * rent;
  const noiMo = rent - taxMo - ins - opVar;
  const r = 0.075 / 12, loan = 0.75 * allIn, pi = loan * r / (1 - (1 + r) ** -360);
  const cashFlow = noiMo - pi, capRate = (noiMo * 12) / allIn;
  const invested = 0.25 * allIn + 0.03 * list;
  return { rent, onePct: rent / list, capRate, cashFlow: Math.round(cashFlow), cashOnCash: (cashFlow * 12) / invested, allIn };
}
export function scoreDeal(flip: any, rental: RentalMetrics | null) {
  const flipScore = !flip || flip.margin == null ? 0 : flip.margin >= 0.2 ? 90 : flip.margin >= 0.15 ? 75 : flip.margin >= 0.1 ? 60 : flip.margin >= 0.05 ? 40 : flip.margin > 0 ? 20 : 0;
  const rentScore = !rental ? 0 : rental.capRate >= 0.08 ? 90 : rental.capRate >= 0.06 ? 72 : rental.capRate >= 0.05 ? 55 : rental.capRate >= 0.04 ? 40 : 20;
  const dealScore = Math.max(flipScore, rentScore);
  const bestExit = dealScore < 35 ? "PASS" : flipScore >= rentScore ? "FLIP" : "RENTAL";
  return { flipScore, rentScore, dealScore, bestExit } as const;
}
export function decideKeeper({ belowMarket, flip, rental, distress }: { belowMarket: boolean; flip?: any; rental?: any; distress: boolean }): boolean {
  if (belowMarket || distress) return true;
  if (flip && flip.margin != null && flip.margin >= MONITOR.flipMarginBar) return true;
  if (rental && rental.capRate != null && rental.capRate >= MONITOR.capRateBar) return true;
  return false;
}
export function riskFlags(r: { homeType?: string; monthlyHoaFee?: number | null; description?: string; rehabTier?: string; zestimate?: number | null; compsArv?: number | null; detailOk?: boolean }): string[] {
  const f: string[] = [];
  if ((r.homeType || "").toUpperCase() === "MANUFACTURED") f.push("MANUFACTURED (comps/lot-rent suspect)");
  if (r.monthlyHoaFee && r.monthlyHoaFee > 250) f.push("HIGH-HOA $" + r.monthlyHoaFee + "/mo");
  if (/may not qualify|cash only|\bFHA\b|\bVA\b/i.test(r.description || "")) f.push("non-financeable (cash)");
  if (r.rehabTier === "gut") f.push("heavy-rehab");
  if (r.zestimate && r.compsArv && r.compsArv > r.zestimate * 1.5) f.push("comps>>Zestimate (ARV suspect)");
  if (r.detailOk === false) f.push("detail-missing (VERIFY)");
  return f;
}
