// Sold-comp scraping + ARV suggestion for the Flip Analyzer.
// Pure + deterministic so it's unit-tested and safe to call from a Convex action.
// Source: Redfin "recently sold" ZIP search markdown (clean structured rows).

export interface Comp {
  address: string;
  soldDate: string; // as scraped, e.g. "MAY 18, 2026"
  soldPrice: number;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  pricePerSqft: number | null;
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
