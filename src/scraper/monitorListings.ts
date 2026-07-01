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
