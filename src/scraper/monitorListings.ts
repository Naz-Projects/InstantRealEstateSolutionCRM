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
