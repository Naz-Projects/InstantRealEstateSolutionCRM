// Pure FRED (St. Louis Fed) helpers — no Convex/Node imports, so they're
// unit-testable with fixtures. The Convex action does the network fetch; these
// parse the response and select the values the dashboard shows.

export type FredObservation = { date: string; value: number };

export type FredUnit = "percent" | "usd" | "count" | "days";
export type FredGroup = "rates" | "inventory" | "temperature";

export type FredSeriesDef = {
  metric: string; // stable UI key (multiple regions can share one metric, e.g. activeListings)
  seriesId: string; // FRED series id
  region: string; // "US" | "Delaware" | "New Castle" | "Kent" | "Sussex"
  group: FredGroup;
  label: string;
  unit: FredUnit;
  source: string; // attribution shown in the UI
  // When set, the dashboard hides this series if its latest observation is older
  // than this many days (some FRED Realtor.com county derivatives lag). The
  // confirmed-fresh core (rates, active listings, DE days-on-market) omit it.
  freshnessDays?: number;
};

// v1 catalog. The action is tolerant of a missing/empty series, so the
// "verify on first live run" extras are safe to include.
export const FRED_SERIES: FredSeriesDef[] = [
  // --- Rates (always current) ---
  {
    metric: "mortgage30",
    seriesId: "MORTGAGE30US",
    region: "US",
    group: "rates",
    label: "30-yr fixed mortgage",
    unit: "percent",
    source: "FRED · Freddie Mac PMMS",
  },
  {
    metric: "fedFunds",
    seriesId: "FEDFUNDS",
    region: "US",
    group: "rates",
    label: "Fed funds rate",
    unit: "percent",
    source: "FRED · Federal Reserve",
  },
  // --- Inventory: "how many houses are on the market", county-by-county ---
  {
    metric: "activeListings",
    seriesId: "ACTLISCOU10003",
    region: "New Castle",
    group: "inventory",
    label: "Active listings",
    unit: "count",
    source: "FRED · Realtor.com",
  },
  {
    metric: "activeListings",
    seriesId: "ACTLISCOU10001",
    region: "Kent",
    group: "inventory",
    label: "Active listings",
    unit: "count",
    source: "FRED · Realtor.com",
  },
  {
    metric: "activeListings",
    seriesId: "ACTLISCOU10005",
    region: "Sussex",
    group: "inventory",
    label: "Active listings",
    unit: "count",
    source: "FRED · Realtor.com",
  },
  {
    metric: "activeListings",
    seriesId: "ACTLISCOUDE",
    region: "Delaware",
    group: "inventory",
    label: "Active listings",
    unit: "count",
    source: "FRED · Realtor.com",
  },
  // --- Market temperature (confirmed-fresh DE state + verify-on-first-run extras) ---
  {
    metric: "daysOnMarket",
    seriesId: "MEDDAYONMARDE",
    region: "Delaware",
    group: "temperature",
    label: "Median days on market",
    unit: "days",
    source: "FRED · Realtor.com",
  },
  {
    metric: "medListPrice",
    seriesId: "MEDLISPRIDE",
    region: "Delaware",
    group: "temperature",
    label: "Median list price",
    unit: "usd",
    source: "FRED · Realtor.com",
    freshnessDays: 120,
  },
  {
    metric: "priceReduced",
    seriesId: "PRIREDCOUDE",
    region: "Delaware",
    group: "temperature",
    label: "Listings with price cuts",
    unit: "count",
    source: "FRED · Realtor.com",
    freshnessDays: 120,
  },
];

/** Noon anchor avoids off-by-one around timezone boundaries for ISO date strings. */
function parseIso(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

function toObservations(
  raw: Array<{ date: unknown; value: unknown }>,
): FredObservation[] {
  const out: FredObservation[] = [];
  for (const o of raw) {
    if (typeof o?.date !== "string") continue;
    if (typeof o.value !== "string" && typeof o.value !== "number") continue;
    const value = typeof o.value === "number" ? o.value : Number(o.value);
    // FRED uses "." for a missing observation; Number(".") is NaN.
    if (!Number.isFinite(value)) continue;
    out.push({ date: o.date, value });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/** FRED JSON observations response → observations oldest→newest, missing dropped. */
export function parseFredJson(body: unknown): FredObservation[] {
  const obs = (body as { observations?: unknown })?.observations;
  if (!Array.isArray(obs)) return [];
  return toObservations(obs as Array<{ date: unknown; value: unknown }>);
}

/** No-key fredgraph.csv ("DATE,SERIESID\n…") → same shape. */
export function parseFredCsv(text: string): FredObservation[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length <= 1) return [];
  const rows = lines.slice(1).map((line) => {
    const [date, value] = line.split(",");
    return { date: date?.trim(), value: value?.trim() };
  });
  return toObservations(rows);
}

export type MetricSnapshot = {
  latestDate: string;
  latestValue: number;
  priorValue: number | null;
  yearAgoValue: number | null;
  history: FredObservation[]; // oldest→newest, capped
};

/**
 * Reduce an observation series (any order) to the dashboard snapshot: latest,
 * the immediately prior point, the observation closest to one year before the
 * latest (within ~45 days; null if the window is too short), and a capped
 * history for the sparkline.
 */
export function pickLatest(
  obs: FredObservation[],
  historyLen = 24,
): MetricSnapshot | null {
  if (obs.length === 0) return null;
  const sorted = [...obs].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const latest = sorted[sorted.length - 1];
  const prior = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

  const targetMs = parseIso(latest.date).getTime() - 365 * 24 * 60 * 60 * 1000;
  const tolMs = 45 * 24 * 60 * 60 * 1000;
  let yearAgo: FredObservation | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const o of sorted) {
    const diff = Math.abs(parseIso(o.date).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      yearAgo = o;
    }
  }
  if (!yearAgo || bestDiff > tolMs) yearAgo = null;

  return {
    latestDate: latest.date,
    latestValue: latest.value,
    priorValue: prior ? prior.value : null,
    yearAgoValue: yearAgo ? yearAgo.value : null,
    history: sorted.slice(-historyLen),
  };
}

/** True when `isoDate` is no more than `maxDays` before `now`. */
export function isFresh(isoDate: string, maxDays: number, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - parseIso(isoDate).getTime();
  return ageMs <= maxDays * 24 * 60 * 60 * 1000;
}
