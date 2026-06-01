// Geocode a Delaware property address to {lat,lng} via the Google Geocoding API.
// Response parsing is split out (parseGeocodeResponse) so it's unit-testable with
// no network. We validate the result is in DE — the county data is all New Castle
// County, DE, and a wrong-state match would drop a pin in the wrong place (same
// defensive idea as the Zillow `-DE-` URL check in zillow.ts).

export interface GeoPoint {
  lat: number;
  lng: number;
}

interface GeocodeComponent {
  short_name?: string;
  long_name?: string;
  types?: string[];
}
interface GeocodeResult {
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: GeocodeComponent[];
}
export interface GeocodeResponse {
  status?: string;
  results?: GeocodeResult[];
}

/** Parse a Google Geocoding API response to a DE-validated point, or null. Pure. */
export function parseGeocodeResponse(json: GeocodeResponse): GeoPoint | null {
  if (!json || json.status !== "OK" || !json.results || json.results.length === 0) {
    return null;
  }
  const top = json.results[0];
  const loc = top.geometry?.location;
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;

  const inDelaware = (top.address_components ?? []).some(
    (c) => (c.types ?? []).includes("administrative_area_level_1") && c.short_name === "DE",
  );
  if (!inDelaware) return null;

  return { lat: loc.lat, lng: loc.lng };
}

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Geocode an address to a DE point. Returns null when there's no usable DE match.
 * Throws on network/HTTP error OR a non-OK/non-ZERO_RESULTS status (e.g.
 * OVER_QUERY_LIMIT, REQUEST_DENIED) so the caller can distinguish "no result"
 * (mark failed, don't retry) from "transient/config error" (leave for retry).
 */
export async function geocodeAddress(address: string, apiKey: string): Promise<GeoPoint | null> {
  if (!address || !address.trim()) return null;
  if (!apiKey) throw new Error("GOOGLE_GEOCODING_API_KEY is not set");

  const url =
    `${GEOCODE_URL}?address=${encodeURIComponent(address)}` +
    `&components=country:US|administrative_area:DE&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const json = (await res.json()) as GeocodeResponse;
  if (json.status && !["OK", "ZERO_RESULTS"].includes(json.status)) {
    throw new Error(`Geocoding status ${json.status}`);
  }
  return parseGeocodeResponse(json);
}
