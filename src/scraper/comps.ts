// Sold-comp scraping + ARV suggestion for the Flip Analyzer.
// Pure + deterministic so it's unit-tested and safe to call from a Convex action.
// Source: Redfin "recently sold" ZIP search markdown (clean structured rows).

export type CompType = "sfr" | "townhouse";

export interface Comp {
  address: string;
  soldDate: string; // as scraped, e.g. "MAY 18, 2026"
  soldPrice: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pricePerSqft: number | null;
  // Only from the Redfin gis payload (parseRedfinGisComps); markdown rows lack them.
  lat?: number;
  lng?: number;
  propertyType?: CompType;
  soldAt?: number; // ms epoch
}

export interface ArvSuggestion {
  arv: number | null;
  pricePerSqft: number | null;
  low: number | null;
  high: number | null;
  count: number;
}

/** First 5-digit group in an address, or null. */
export function parseZip(address: string): string | null {
  const m = address.match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

export function buildRedfinSoldUrl(zip: string): string {
  return `https://www.redfin.com/zipcode/${zip}/filter/include=sold-6mo`;
}

/** Parse Redfin sold-search markdown into comps. Keeps DE comps only. */
export function parseRedfinComps(markdown: string): Comp[] {
  const comps: Comp[] = [];
  // Split at each "SOLD <DATE>" marker, capturing the date.
  const parts = markdown.split(/SOLD\s+([A-Z]{3,}\.?\s+\d{1,2},\s+\d{4})/i);
  for (let i = 1; i < parts.length; i += 2) {
    const soldDate = parts[i].trim();
    const body = parts[i + 1] ?? "";
    const priceM = body.match(/\$([\d,]+)\s*Last sold price/i);
    if (!priceM) continue;
    const soldPrice = parseInt(priceM[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(soldPrice)) continue;
    const addrM = body.match(/\[([^\]]+)\]\((https?:\/\/www\.redfin\.com\/[^)]+)\)/);
    if (!addrM || !/\/DE\//.test(addrM[2])) continue; // require a Delaware property
    const address = addrM[1].trim();
    const specsM = body.match(/(\d+)\s*beds?\s*(\d+(?:\.\d+)?)\s*baths?\s*([\d,]+)\s*sq\s*ft/i);
    const beds = specsM ? parseInt(specsM[1], 10) : null;
    const baths = specsM ? parseFloat(specsM[2]) : null;
    const sqft = specsM ? parseInt(specsM[3].replace(/,/g, ""), 10) : null;
    const pricePerSqft = sqft && sqft > 0 ? soldPrice / sqft : null;
    comps.push({ address, soldDate, soldPrice, beds, baths, sqft, pricePerSqft });
  }
  return comps;
}

// Redfin propertyType codes seen in NCC sold data: 6 = single-family, 13 = townhouse
// (rowhome/twin), 4 = multi-family, 8 = land. Only 6/13 are comps for our targets.
const REDFIN_COMP_TYPES: Record<number, CompType> = { 6: "sfr", 13: "townhouse" };

/**
 * Parse the stingray `gis` payload Redfin embeds in its sold-search rawHtml
 * (`root.__reactServerState.InitialContext` -> dataCache["/stingray/api/gis?..."]
 * .res.text = "{}&&{...payload:{homes:[...]}}"). Unlike the markdown rows, each home
 * carries lat/lng, a property type and a sold epoch. DE single-family/townhouse
 * only. [] on any shape change (callers fall back to parseRedfinComps).
 */
export function parseRedfinGisComps(rawHtml: string): Comp[] {
  const m = rawHtml.match(/root\.__reactServerState\.InitialContext = (\{[\s\S]*?\});\s*\n/);
  if (!m) return [];
  let homes: any[];
  try {
    const cache = JSON.parse(m[1])?.["ReactServerAgent.cache"]?.dataCache ?? {};
    const key = Object.keys(cache).find((k) => k.startsWith("/stingray/api/gis?"));
    const text: string = key ? (cache[key]?.res?.text ?? "") : "";
    homes = JSON.parse(text.replace(/^\{\}&&/, ""))?.payload?.homes ?? [];
  } catch {
    return [];
  }
  const comps: Comp[] = [];
  for (const h of Array.isArray(homes) ? homes : []) {
    const propertyType = REDFIN_COMP_TYPES[h?.propertyType];
    const soldPrice = h?.price?.value;
    if (!propertyType || h?.state !== "DE" || typeof soldPrice !== "number" || soldPrice <= 0) continue;
    const saleLabel: string = (h.sashes ?? []).find((s: any) => s?.lastSaleDate)?.lastSaleDate ?? "";
    const soldAt = typeof h.soldDate === "number" ? h.soldDate : Date.parse(saleLabel) || undefined;
    const sqft = typeof h.sqFt?.value === "number" && h.sqFt.value > 0 ? h.sqFt.value : null;
    const ll = h.latLong?.value;
    comps.push({
      address: `${h.streetLine?.value ?? ""}, ${h.city ?? ""}, DE ${h.zip ?? ""}`,
      soldDate: saleLabel,
      soldPrice,
      beds: typeof h.beds === "number" ? h.beds : null,
      baths: typeof h.baths === "number" ? h.baths : null,
      sqft,
      pricePerSqft: sqft ? soldPrice / sqft : null,
      ...(typeof ll?.latitude === "number" && typeof ll?.longitude === "number" ? { lat: ll.latitude, lng: ll.longitude } : {}),
      propertyType,
      ...(soldAt ? { soldAt } : {}),
    });
  }
  return comps;
}

/** Pick the most comparable comps to the subject (sqft ±30%, beds ±1), capped at 8. */
export function selectComps(
  comps: Comp[],
  subject: { sqft: number | null; beds: number | null },
): Comp[] {
  const priced = comps.filter((c) => c.pricePerSqft != null);
  let pool = priced;
  if (subject.sqft != null && subject.sqft > 0) {
    const lo = subject.sqft * 0.7;
    const hi = subject.sqft * 1.3;
    const filtered = priced.filter((c) => {
      const sqftOk = c.sqft != null && c.sqft >= lo && c.sqft <= hi;
      const bedsOk = subject.beds == null || c.beds == null || Math.abs(c.beds - subject.beds) <= 1;
      return sqftOk && bedsOk;
    });
    if (filtered.length >= 3) pool = filtered;
  }
  return pool.slice(0, 8);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Suggested ARV = median $/sqft × subject sqft (fallback: median sold price). */
export function suggestArv(selected: Comp[], subjectSqft: number | null): ArvSuggestion {
  if (selected.length === 0) {
    return { arv: null, pricePerSqft: null, low: null, high: null, count: 0 };
  }
  const ppsfs = selected.map((c) => c.pricePerSqft).filter((n): n is number => n != null);
  const medPps = median(ppsfs);
  if (subjectSqft != null && subjectSqft > 0) {
    return {
      arv: Math.round(medPps * subjectSqft),
      pricePerSqft: Math.round(medPps),
      low: Math.round(Math.min(...ppsfs) * subjectSqft),
      high: Math.round(Math.max(...ppsfs) * subjectSqft),
      count: selected.length,
    };
  }
  return {
    arv: Math.round(median(selected.map((c) => c.soldPrice))),
    pricePerSqft: Math.round(medPps),
    low: null,
    high: null,
    count: selected.length,
  };
}
