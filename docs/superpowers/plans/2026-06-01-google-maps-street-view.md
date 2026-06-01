# Google Maps + Street View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-page `[ Table | Map ]` view to Sheriff Sales and Legal Notices that plots each geocoded property as a deal-colored pin, with an info window and an interactive Street View of the house.

**Architecture:** A runtime-agnostic geocoding core (`src/scraper/geocode.ts`) is called by a decoupled, idempotent Convex backfill action that stores `lat`/`lng` on each row (auto-scheduled after a scrape + a manual button). The frontend reads those stored coords and renders a Google map with `@vis.gl/react-google-maps`; clicking a pin opens an info window with a Street View thumbnail and a button to a full interactive panorama.

**Tech Stack:** Convex (V8 queries/mutations + `"use node"` actions), React + Tailwind + TanStack Router, `@vis.gl/react-google-maps`, Google Maps Platform (Geocoding API server-side, Maps JavaScript + Street View Static APIs browser-side), Vitest.

**Commit policy:** This project commits ONLY on the user's explicit go-ahead. Each task ends with a **Verify** gate (tests / `npm run build` / `npx convex dev --once`). A single commit step is at the end (Task 12) to run when approved.

**Cross-task gotchas (from `memory/lessons.md`):**
- After changing `convex/` functions, run `npx convex dev --once` FIRST (validates + regenerates `_generated` types), THEN `npm run build`. The frontend reads the regenerated Convex API symbols.
- The Convex CLI prints a cosmetic `UV_HANDLE_CLOSING` assertion on Windows and exits non-zero — trust the printed output, not the exit code.
- A `"use node"` file may contain ONLY actions. Keep V8 queries/mutations in `*Data.ts`.

---

## File Structure

**New:**
- `src/scraper/geocode.ts` — `parseGeocodeResponse` (pure) + `geocodeAddress` (fetch).
- `tests/geocode.test.ts` — unit tests for `parseGeocodeResponse`.
- `convex/geocodeData.ts` — `listMissing` (internalQuery), `setGeocode` (internalMutation), `startGeocode` (mutation).
- `convex/geocodeActions.ts` — `backfillGeocodes` (internalAction, `"use node"`).
- `src/web/dealStages.ts` — shared `DEAL_STAGES`, `DealStage`, `STAGE_LABEL` (extracted so both `pages.tsx` and `PropertyMap.tsx` use them without a circular import).
- `src/web/PropertyMap.tsx` — `MapPoint` type, `streetViewThumb`, `PropertyMap`.
- `src/web/StreetViewModal.tsx` — interactive panorama modal.

**Modified:**
- `convex/schema.ts` — `lat`/`lng`/`geocodeStatus` on both tables.
- `convex/sheriffActions.ts`, `convex/legalActions.ts` — schedule backfill at end of each scrape.
- `src/web/pages.tsx` — import shared deal stages; add view toggle + map mount + MapPoint building + geocode button on both pages.
- `.env.example` — Google Maps keys.
- `package.json` — `@vis.gl/react-google-maps` + `@types/google.maps`.

---

## Task 1: Geocoding core (pure parse + fetch) — TDD

**Files:**
- Create: `src/scraper/geocode.ts`
- Test: `tests/geocode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/geocode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseGeocodeResponse } from "../src/scraper/geocode";

const okDE = {
  status: "OK",
  results: [
    {
      geometry: { location: { lat: 39.7391, lng: -75.5398 } },
      address_components: [
        { short_name: "DE", long_name: "Delaware", types: ["administrative_area_level_1", "political"] },
      ],
    },
  ],
};

describe("parseGeocodeResponse", () => {
  it("returns the point for an OK Delaware result", () => {
    expect(parseGeocodeResponse(okDE)).toEqual({ lat: 39.7391, lng: -75.5398 });
  });

  it("returns null when the top result is out of state", () => {
    const pa = JSON.parse(JSON.stringify(okDE));
    pa.results[0].address_components[0].short_name = "PA";
    expect(parseGeocodeResponse(pa)).toBeNull();
  });

  it("returns null for ZERO_RESULTS", () => {
    expect(parseGeocodeResponse({ status: "ZERO_RESULTS", results: [] })).toBeNull();
  });

  it("returns null when geometry is missing", () => {
    const noGeo = {
      status: "OK",
      results: [{ address_components: [{ short_name: "DE", types: ["administrative_area_level_1"] }] }],
    };
    expect(parseGeocodeResponse(noGeo)).toBeNull();
  });

  it("returns null for an empty/garbage response", () => {
    expect(parseGeocodeResponse({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- geocode`
Expected: FAIL — cannot resolve `../src/scraper/geocode` / `parseGeocodeResponse is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/scraper/geocode.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- geocode`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the whole suite still passes**

Run: `npm test`
Expected: PASS — 44 tests (39 existing + 5 new).

---

## Task 2: Schema — add lat/lng/geocodeStatus to both tables

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the three optional fields to `sheriffListings`**

In `convex/schema.ts`, inside `sheriffListings`, after the `// workflow` block's `sqft`/zillow fields and before `enrichmentStatus,` add:

```ts
    // map (geocoded lazily; optional so existing rows still validate)
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeStatus: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
```

(Place these immediately above the `enrichmentStatus,` line in the `sheriffListings` table.)

- [ ] **Step 2: Add the same three fields to `legalNotices`**

In `convex/schema.ts`, inside `legalNotices`, immediately above its `enrichmentStatus,` line add the identical block:

```ts
    // map (geocoded lazily; optional so existing rows still validate)
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeStatus: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
```

- [ ] **Step 3: Push + regenerate types**

Run: `npx convex dev --once`
Expected: "Convex functions ready!" (the optional fields are a non-breaking schema change; existing rows validate). Ignore any `UV_HANDLE_CLOSING` line.

---

## Task 3: Geocode data layer (`convex/geocodeData.ts`)

**Files:**
- Create: `convex/geocodeData.ts`

- [ ] **Step 1: Write the file**

```ts
import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireUser } from "./helpers";

const scrapeType = v.union(v.literal("sheriff"), v.literal("legal"));

// 2-word error codes the scrapers write when data is unavailable — never geocode these.
const ERROR_CODES = new Set([
  "PENDING", "NOT FOUND", "SCRAPE FAILED", "NO ADDRESS", "WRONG STATE",
  "NO PARCEL", "NO STATE", "BAD ADDRESS",
]);

// Rows still missing coordinates (and not already marked failed). Returns the best
// address to geocode per row: the enriched/cleaned propertyAddress (sheriff) when
// available, else the raw scraped address.
export const listMissing = internalQuery({
  args: { type: scrapeType },
  handler: async (ctx, { type }) => {
    const rows =
      type === "sheriff"
        ? await ctx.db.query("sheriffListings").collect()
        : await ctx.db.query("legalNotices").collect();
    return rows
      .filter((r) => r.lat === undefined && r.geocodeStatus !== "failed")
      .map((r) => {
        const cleaned = (r as { propertyAddress?: string }).propertyAddress;
        const best = cleaned && !ERROR_CODES.has(cleaned) ? cleaned : r.address;
        return { id: r._id as string, address: best };
      });
  },
});

// Store (or fail) a row's geocode. Resolves the typed id per table.
export const setGeocode = internalMutation({
  args: {
    type: scrapeType,
    id: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    status: v.union(v.literal("ok"), v.literal("failed")),
  },
  handler: async (ctx, { type, id, lat, lng, status }) => {
    const fields = { lat, lng, geocodeStatus: status, updatedAt: Date.now() };
    if (type === "sheriff") {
      const docId = ctx.db.normalizeId("sheriffListings", id);
      if (docId) await ctx.db.patch(docId, fields);
    } else {
      const docId = ctx.db.normalizeId("legalNotices", id);
      if (docId) await ctx.db.patch(docId, fields);
    }
  },
});

// "Geocode N missing" button (and the post-scrape auto-trigger) schedule the backfill.
export const startGeocode = mutation({
  args: { type: scrapeType },
  handler: async (ctx, { type }) => {
    await requireUser(ctx);
    const rows =
      type === "sheriff"
        ? await ctx.db.query("sheriffListings").collect()
        : await ctx.db.query("legalNotices").collect();
    const missing = rows.filter((r) => r.lat === undefined && r.geocodeStatus !== "failed").length;
    if (missing === 0) return { scheduled: 0 };
    await ctx.scheduler.runAfter(0, internal.geocodeActions.backfillGeocodes, { type });
    return { scheduled: missing };
  },
});
```

- [ ] **Step 2: Verify (deferred to Task 5 — depends on `geocodeActions`)**

`startGeocode` references `internal.geocodeActions.backfillGeocodes`, created in Task 4. Do not push until Task 4 is written (Convex codegen typechecks the whole `convex/` tree together).

---

## Task 4: Geocode action (`convex/geocodeActions.ts`)

**Files:**
- Create: `convex/geocodeActions.ts`

- [ ] **Step 1: Write the file**

```ts
"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { geocodeAddress } from "../src/scraper/geocode";

function geoKey(): string {
  const k = (process.env.GOOGLE_GEOCODING_API_KEY ?? "").trim();
  if (!k) throw new Error("GOOGLE_GEOCODING_API_KEY is not set (npx convex env set GOOGLE_GEOCODING_API_KEY ...)");
  return k;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Geocode every row of `type` that's missing coordinates. Idempotent: only rows
// with no lat and not already marked failed are touched. A no-DE-result marks the
// row "failed" (won't retry); a thrown error (rate limit / network) leaves it for
// the next run.
export const backfillGeocodes = internalAction({
  args: { type: v.union(v.literal("sheriff"), v.literal("legal")) },
  handler: async (ctx, { type }): Promise<{ geocoded: number; failed: number }> => {
    const key = geoKey();
    const missing = await ctx.runQuery(internal.geocodeData.listMissing, { type });
    let geocoded = 0;
    let failed = 0;
    for (const row of missing) {
      try {
        const pt = await geocodeAddress(row.address, key);
        if (pt) {
          await ctx.runMutation(internal.geocodeData.setGeocode, {
            type, id: row.id, lat: pt.lat, lng: pt.lng, status: "ok",
          });
          geocoded++;
        } else {
          await ctx.runMutation(internal.geocodeData.setGeocode, { type, id: row.id, status: "failed" });
          failed++;
        }
      } catch {
        // transient — leave the row (lat still undefined, status not failed) for a later run
      }
      await sleep(200);
    }
    return { geocoded, failed };
  },
});
```

- [ ] **Step 2: Push + regenerate types**

Run: `npx convex dev --once`
Expected: "Convex functions ready!" (validates `geocodeData` + `geocodeActions` together, regenerates `_generated`). Ignore `UV_HANDLE_CLOSING`.

---

## Task 5: Auto-geocode after each scrape

**Files:**
- Modify: `convex/sheriffActions.ts`
- Modify: `convex/legalActions.ts`

- [ ] **Step 1: Schedule the backfill at the end of `runSheriffScrape`**

In `convex/sheriffActions.ts`, in `runSheriffScrape`, find the fan-out loop's closing and the line `return { saleMonth, created: listings.length, runId };`. Immediately BEFORE that return, add:

```ts
      // Geocode the new rows for the map once enrichment has had time to fill the
      // cleaned propertyAddress. Backfill is idempotent and only touches rows
      // missing coords, so an early run (raw address) is harmless.
      await ctx.scheduler.runAfter(
        listings.length * 2500 + 5000,
        internal.geocodeActions.backfillGeocodes,
        { type: "sheriff" },
      );
```

- [ ] **Step 2: Schedule the backfill at the end of `runLegalScrape`**

In `convex/legalActions.ts`, in `runLegalScrape`, immediately BEFORE `return { weekDate, created: listings.length, runId };`, add:

```ts
      // Geocode the new rows for the map (idempotent; only missing-coord rows).
      await ctx.scheduler.runAfter(
        listings.length * 1500 + 5000,
        internal.geocodeActions.backfillGeocodes,
        { type: "legal" },
      );
```

- [ ] **Step 3: Verify backend pushes + types regenerate**

Run: `npx convex dev --once`
Expected: "Convex functions ready!". (`internal` is already imported in both action files.)

---

## Task 6: Verify geocoding end-to-end on dev

**Files:** none (verification only). Requires `GOOGLE_GEOCODING_API_KEY` set on the dev deployment.

- [ ] **Step 1: Set the server geocoding key on dev (one-time)**

Run: `npx convex env set GOOGLE_GEOCODING_API_KEY <server-key>`
(If the key isn't available yet, STOP and ask the user — Task 6 cannot proceed without it. Tasks 7–11 do not depend on it.)

- [ ] **Step 2: Run the backfill for legal (3 existing rows) via the authed mutation**

Run: `npx convex run geocodeData:startGeocode '{"type":"legal"}'`
Expected: `{ "scheduled": 3 }` (IRES_DEV=1 lets the CLI pass `requireUser`). The scheduled action runs within seconds.

- [ ] **Step 3: Confirm coordinates were stored**

Run: `npx convex run legalData:weekNotices '{"weekDate":"2026-05-26"}'`
Expected: each row now has numeric `lat` (~38–40) and `lng` (~ -75) and `geocodeStatus: "ok"` (Delaware bounds). Any row that fails DE validation shows `geocodeStatus: "failed"` and no lat — that's correct, not a bug.

- [ ] **Step 4: Run the backfill for sheriff and spot-check**

Run: `npx convex run geocodeData:startGeocode '{"type":"sheriff"}'`
Then: `npx convex run sheriffData:monthListings '{"saleMonth":"June 2026"}'`
Expected: sheriff rows now carry `lat`/`lng`/`geocodeStatus`.

---

## Task 7: Install map dependencies + env example

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env.example`

- [ ] **Step 1: Install the library + types**

Run: `npm install @vis.gl/react-google-maps && npm install -D @types/google.maps`
Expected: both added to `package.json`; no peer-dep errors that block (warnings OK).

- [ ] **Step 2: Document the env vars in `.env.example`**

In `.env.example`, under the `# --- Frontend (Vite) ---` section, add:

```
# Google Maps browser key (restrict to your domains) + a Map ID (Advanced Markers).
# DEMO_MAP_ID works for local dev before you create a real Map ID.
VITE_GOOGLE_MAPS_API_KEY=
VITE_GOOGLE_MAPS_MAP_ID=
```

And under the `# --- Convex environment variables ---` section, add:

```
# GOOGLE_GEOCODING_API_KEY   (server key, restricted to the Geocoding API)
```

- [ ] **Step 3: Verify the build still works**

Run: `npm run build`
Expected: PASS (no usage yet; just confirms the install didn't break the toolchain).

---

## Task 8: Extract shared deal-stage constants

**Files:**
- Create: `src/web/dealStages.ts`
- Modify: `src/web/pages.tsx`

- [ ] **Step 1: Create `src/web/dealStages.ts`**

```ts
// Shared deal-pipeline stages — used by the table (pages.tsx) and the map
// (PropertyMap.tsx). Kept in its own module to avoid a circular import.
export const DEAL_STAGES = ["new", "reviewing", "contacted", "offer", "dead"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const STAGE_LABEL: Record<DealStage, string> = {
  new: "New",
  reviewing: "Reviewing",
  contacted: "Contacted",
  offer: "Offer",
  dead: "Dead",
};
```

- [ ] **Step 2: Replace the local definitions in `pages.tsx` with an import**

In `src/web/pages.tsx`, DELETE these lines (near the top, after the lucide import):

```ts
const DEAL_STAGES = ["new", "reviewing", "contacted", "offer", "dead"] as const;
type DealStage = (typeof DEAL_STAGES)[number];
const STAGE_LABEL: Record<DealStage, string> = {
  new: "New",
  reviewing: "Reviewing",
  contacted: "Contacted",
  offer: "Offer",
  dead: "Dead",
};
```

And add to the import block (after the `cn` import line):

```ts
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "./dealStages";
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: PASS (all existing `DealStage`/`STAGE_LABEL`/`DEAL_STAGES` references in `pages.tsx` now resolve to the import).

---

## Task 9: Map component (`src/web/PropertyMap.tsx`)

**Files:**
- Create: `src/web/PropertyMap.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { useEffect, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  Pin,
  useMap,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";
import { ExternalLink, MapPin } from "lucide-react";
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "./dealStages";
import { StreetViewModal } from "./StreetViewModal";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";
// New Castle County, DE — default center before bounds are fit.
const NCC_CENTER = { lat: 39.6, lng: -75.6 };

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  address: string;
  subtitle?: string;
  metricLabel: string;
  metricValue: string;
  color: string;
  size: string;
  zillowUrl: string;
  dealStatus: DealStage;
}

export function streetViewThumb(lat: number, lng: number, key: string): string {
  return (
    `https://maps.googleapis.com/maps/api/streetview?size=320x140` +
    `&location=${lat},${lng}&fov=80&return_error_code=true&key=${key}`
  );
}

// Fit the map to all pins whenever the set changes.
function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 64);
  }, [map, points]);
  return null;
}

function PointMarker({
  point,
  open,
  onOpen,
  onClose,
  onDealChange,
  onStreetView,
}: {
  point: MapPoint;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDealChange: (id: string, s: DealStage) => void;
  onStreetView: (p: MapPoint) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  return (
    <>
      <AdvancedMarker ref={markerRef} position={{ lat: point.lat, lng: point.lng }} onClick={onOpen}>
        <Pin background={point.color} borderColor="#1e293b" glyphColor="#1e293b" />
      </AdvancedMarker>
      {open && (
        <InfoWindow anchor={marker} onClose={onClose} maxWidth={300}>
          <div className="space-y-1.5 text-slate-800">
            <div className="font-semibold">{point.address}</div>
            {point.subtitle && <div className="text-xs text-slate-500">{point.subtitle}</div>}
            <div className="text-sm">
              <span className="text-slate-500">{point.metricLabel}: </span>
              <span className="font-bold">{point.metricValue}</span>
            </div>
            <div className="text-xs text-slate-500">{point.size}</div>
            {MAPS_KEY && (
              <img
                src={streetViewThumb(point.lat, point.lng, MAPS_KEY)}
                alt="Street View of the property"
                className="h-24 w-full rounded object-cover"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
            )}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => onStreetView(point)}
                className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-semibold text-white hover:bg-accent-dark"
              >
                <MapPin className="h-3 w-3" /> Street View
              </button>
              {point.zillowUrl.startsWith("http") && (
                <a
                  href={point.zillowUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  Zillow <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <select
              value={point.dealStatus}
              onChange={(e) => onDealChange(point.id, e.target.value as DealStage)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
            >
              {DEAL_STAGES.map((s) => (
                <option key={s} value={s}>{STAGE_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function PropertyMap({
  points,
  onDealChange,
  missingCount,
  onGeocode,
  geocoding,
}: {
  points: MapPoint[];
  onDealChange: (id: string, s: DealStage) => void;
  missingCount: number;
  onGeocode: () => void;
  geocoding: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [streetView, setStreetView] = useState<MapPoint | null>(null);

  if (!MAPS_KEY) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Add <code className="rounded bg-slate-100 px-1">VITE_GOOGLE_MAPS_API_KEY</code> to{" "}
        <code className="rounded bg-slate-100 px-1">.env.local</code> to enable the map.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          {points.length} pinned{missingCount > 0 ? ` · ${missingCount} not geocoded` : ""}
        </span>
        {missingCount > 0 && (
          <button
            onClick={onGeocode}
            disabled={geocoding}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
          >
            <MapPin className="h-3 w-3" /> {geocoding ? "Geocoding…" : `Geocode ${missingCount} missing`}
          </button>
        )}
      </div>
      <div className="h-[70vh] overflow-hidden rounded-xl border border-slate-200">
        <APIProvider apiKey={MAPS_KEY}>
          <Map mapId={MAP_ID} defaultCenter={NCC_CENTER} defaultZoom={10} gestureHandling="greedy">
            <FitBounds points={points} />
            {points.map((p) => (
              <PointMarker
                key={p.id}
                point={p}
                open={openId === p.id}
                onOpen={() => setOpenId(p.id)}
                onClose={() => setOpenId(null)}
                onDealChange={onDealChange}
                onStreetView={(pt) => setStreetView(pt)}
              />
            ))}
          </Map>
          {streetView && <StreetViewModal point={streetView} onClose={() => setStreetView(null)} />}
        </APIProvider>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify (deferred to Task 10)**

`PropertyMap` imports `StreetViewModal` (Task 10). Build after Task 10.

---

## Task 10: Street View modal (`src/web/StreetViewModal.tsx`)

**Files:**
- Create: `src/web/StreetViewModal.tsx`

- [ ] **Step 1: Write the file**

```tsx
import { useEffect, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { X } from "lucide-react";
import type { MapPoint } from "./PropertyMap";

// Full interactive (draggable) Street View for a property. Checks coverage first
// via StreetViewService; if there's no panorama nearby, shows a clear message.
export function StreetViewModal({ point, onClose }: { point: MapPoint; onClose: () => void }) {
  const streetViewLib = useMapsLibrary("streetView");
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "none">("loading");

  // Close on Escape.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // Find the nearest panorama, then mount it.
  useEffect(() => {
    if (!streetViewLib || !ref.current) return;
    const svc = new streetViewLib.StreetViewService();
    svc.getPanorama({ location: { lat: point.lat, lng: point.lng }, radius: 60 }, (data, svStatus) => {
      if (svStatus === streetViewLib.StreetViewStatus.OK && data?.location?.latLng && ref.current) {
        new streetViewLib.StreetViewPanorama(ref.current, {
          position: data.location.latLng,
          pov: { heading: 0, pitch: 0 },
          zoom: 0,
          visible: true,
        });
        setStatus("ok");
      } else {
        setStatus("none");
      }
    });
  }, [streetViewLib, point.lat, point.lng]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="relative h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div className="text-sm font-semibold text-ink">{point.address}</div>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative h-[calc(80vh-41px)]">
          <div ref={ref} className="h-full w-full" />
          {status !== "ok" && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-sm text-slate-500">
              {status === "loading" ? "Loading Street View…" : "No Street View available at this location."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the map components compile**

Run: `npm run build`
Expected: PASS — `PropertyMap.tsx` + `StreetViewModal.tsx` typecheck (the `google.maps.*` types come from `@types/google.maps`).

---

## Task 11: Wire the map into both pages

**Files:**
- Modify: `src/web/pages.tsx`

- [ ] **Step 1: Add imports**

In `src/web/pages.tsx`, add after the `./dealStages` import from Task 8:

```ts
import { PropertyMap, type MapPoint } from "./PropertyMap";
```

- [ ] **Step 2: Add a small view-toggle component (place it next to `PeriodTabs`)**

Add this near `PeriodTabs` in `pages.tsx`:

```tsx
function ViewToggle({ view, onChange }: { view: "table" | "map"; onChange: (v: "table" | "map") => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
      {(["table", "map"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            "px-3 py-1.5 font-medium capitalize transition",
            view === v ? "bg-accent text-white" : "bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

const SHERIFF_PIN: Record<string, string> = {
  good: "#16a34a", ok: "#10b981", thin: "#f59e0b", verify: "#f59e0b", bad: "#ef4444", unknown: "#94a3b8",
};
function legalPinColor(value: number | null): string {
  if (value === null) return "#94a3b8";
  if (value >= 500000) return "#16a34a";
  if (value >= 250000) return "#f59e0b";
  return "#64748b";
}
```

- [ ] **Step 3: Add Sheriff map state, points, and geocode handler**

In `SheriffSales`, after the existing `const [sort, setSort] = useState<SortState>(null);` line, add:

```tsx
  const [view, setView] = useState<"table" | "map">("table");
  const [geocoding, setGeocoding] = useState(false);
  const startGeocode = useMutation(api.geocodeData.startGeocode);

  const mapPoints: MapPoint[] = (listings ?? [])
    .filter((l) => typeof l.lat === "number" && typeof l.lng === "number")
    .map((l) => ({
      id: l._id,
      lat: l.lat as number,
      lng: l.lng as number,
      address: l.address,
      subtitle: ERROR_VALUES.has(l.ownerName) ? undefined : l.ownerName,
      metricLabel: "Cushion",
      metricValue: fmtMoney(l.deal.cushion),
      color: SHERIFF_PIN[l.deal.tier] ?? SHERIFF_PIN.unknown,
      size: fmtSize(l.beds, l.baths, l.sqft),
      zillowUrl: l.zillowUrl,
      dealStatus: l.dealStatus as DealStage,
    }));
  const missingGeocode = (listings ?? []).filter(
    (l) => l.lat === undefined && l.geocodeStatus !== "failed",
  ).length;

  const onGeocode = async () => {
    setGeocoding(true);
    try {
      await startGeocode({ type: "sheriff" });
      setMsg("Geocoding started — pins will appear as addresses resolve.");
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setGeocoding(false);
    }
  };
```

- [ ] **Step 4: Render the toggle + conditional map/table in Sheriff**

In `SheriffSales`, locate the `<MonthTabs.../>`→ now `<PeriodTabs ... />` block (added in the Legal-parity session). Immediately AFTER the `<PeriodTabs ... />` element, add the toggle:

```tsx
            <div className="mb-3">
              <ViewToggle view={view} onChange={setView} />
            </div>
```

Then find the legend `<div className="mb-2 flex flex-wrap items-center gap-2 ...">` ... through the table block that ends with the closing `</div>` of `overflow-x-auto`. WRAP the existing legend + table region so it only shows in table view, and add the map for map view. Concretely, change the structure from:

```tsx
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              ... legend ...
            </div>
            {!listings ? (
              <Loading />
            ) : listings.length === 0 ? (
              <div className="py-16 text-center text-slate-400">No listings for {selectedMonth}.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                ... table ...
              </div>
            )}
```

to wrap both branches in a `view === "table"` guard and add the map branch:

```tsx
            {view === "table" ? (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  ... legend (unchanged) ...
                </div>
                {!listings ? (
                  <Loading />
                ) : listings.length === 0 ? (
                  <div className="py-16 text-center text-slate-400">No listings for {selectedMonth}.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    ... table (unchanged) ...
                  </div>
                )}
              </>
            ) : (
              <PropertyMap
                points={mapPoints}
                missingCount={missingGeocode}
                onGeocode={onGeocode}
                geocoding={geocoding}
                onDealChange={(id, s) =>
                  setDeal({ listingId: id as Id<"sheriffListings">, dealStatus: s })
                }
              />
            )}
```

(Do not change the legend/table internals — only wrap them.)

- [ ] **Step 5: Add the same wiring to `LegalNotices`**

In `LegalNotices`, after its `const [sort, setSort] = useState<SortState>(null);` line, add:

```tsx
  const [view, setView] = useState<"table" | "map">("table");
  const [geocoding, setGeocoding] = useState(false);
  const startGeocode = useMutation(api.geocodeData.startGeocode);

  const mapPoints: MapPoint[] = (notices ?? [])
    .filter((n) => typeof n.lat === "number" && typeof n.lng === "number")
    .map((n) => ({
      id: n._id,
      lat: n.lat as number,
      lng: n.lng as number,
      address: n.address,
      subtitle: ERROR_VALUES.has(n.ownerName) ? undefined : n.ownerName,
      metricLabel: "Worth",
      metricValue: fmtMoney(n.value),
      color: legalPinColor(n.value),
      size: fmtSize(n.beds, n.baths, n.sqft),
      zillowUrl: n.zillowUrl,
      dealStatus: n.dealStatus as DealStage,
    }));
  const missingGeocode = (notices ?? []).filter(
    (n) => n.lat === undefined && n.geocodeStatus !== "failed",
  ).length;

  const onGeocode = async () => {
    setGeocoding(true);
    try {
      await startGeocode({ type: "legal" });
      setMsg("Geocoding started — pins will appear as addresses resolve.");
    } catch (e) {
      setMsg("Error: " + (e as Error).message);
    } finally {
      setGeocoding(false);
    }
  };
```

- [ ] **Step 6: Render the toggle + conditional map/table in Legal**

In `LegalNotices`, immediately after its `<PeriodTabs ... />` element add:

```tsx
            <div className="mb-3">
              <ViewToggle view={view} onChange={setView} />
            </div>
```

Then wrap the Legal legend + table region (the `<div className="mb-2 flex flex-wrap items-center gap-2 ...">` legend through the `overflow-x-auto` table block) in the same `view === "table" ? (...) : (<PropertyMap .../>)` structure, with the map branch:

```tsx
            ) : (
              <PropertyMap
                points={mapPoints}
                missingCount={missingGeocode}
                onGeocode={onGeocode}
                geocoding={geocoding}
                onDealChange={(id, s) =>
                  setDeal({ noticeId: id as Id<"legalNotices">, dealStatus: s })
                }
              />
            )}
```

- [ ] **Step 7: Verify the full build + tests**

Run: `npx convex dev --once` then `npm run build` then `npm test`
Expected: Convex ready; tsc + vite clean; 44 tests pass.

---

## Task 12: Final verification, memory update, commit

**Files:**
- Modify: `memory/memory.md`, `memory/todo.md`, `memory/next-session-prompt.md`
- (commit — on the user's go-ahead)

- [ ] **Step 1: Update memory**

- `memory/memory.md`: add a "Status (session 5)" note — Google Maps + Street View shipped (per-page Table/Map toggle, geocoded `lat`/`lng`, deal-colored pins, interactive Street View). Verified: geocode unit tests, build, live backfill on dev. Pending: map/Street View visual eyeball (needs the real browser key).
- `memory/todo.md`: add a "Built (session 5)" section checking off the map work; note the visual eyeball + the key-setup as the open items.
- `memory/next-session-prompt.md`: new handoff — first action = open `npm run dev`, switch to Map view on both pages, click a pin, open Street View; confirm pins colored by deal; then the key rotation + Clerk/prod items.

- [ ] **Step 2: Confirm the suite is green**

Run: `npm run build && npm test`
Expected: build clean; 44 tests pass.

- [ ] **Step 3: Commit (ONLY after the user says to)**

When the user approves, suggest committing the accumulated work:

```bash
git add -A
git commit -m "feat: Google Maps view + interactive Street View for Sheriff & Legal (geocoded pins, deal colors)"
```

(Per project rule, do not run this without the user's explicit go-ahead.)

---

## Setup the user must do (hand these over before Task 6 / before the map renders live)

1. Google Cloud Console → create/select a project; **enable billing**.
2. Enable: **Maps JavaScript API**, **Street View Static API**, **Geocoding API**.
3. **Browser key** → APIs: Maps JavaScript + Street View Static; Application restriction: HTTP referrers (`http://localhost:5173/*` and the prod domain). → `.env.local`: `VITE_GOOGLE_MAPS_API_KEY=...`.
4. Maps → **Map Management** → create a **Map ID** (type: JavaScript / vector). → `.env.local`: `VITE_GOOGLE_MAPS_MAP_ID=...` (or rely on `DEMO_MAP_ID` for dev).
5. **Server key** → API restriction: Geocoding API only. → `npx convex env set GOOGLE_GEOCODING_API_KEY ...`.
6. Restart `npm run dev` after editing `.env.local` (Vite reads env at startup).

---

## Self-review (done while writing)
- **Spec coverage:** geocode core + DE validation (T1), schema (T2), data layer (T3), backfill action (T4), auto-trigger (T5), live verify (T6), deps/env (T7), shared stages (T8), map (T9), street view (T10), page toggles + colored pins + inline deal status + geocode button (T11), keys/cost/handoff (T7/T12/setup). All spec sections map to a task.
- **Type consistency:** `MapPoint` defined in T9 is imported in T10/T11; `DealStage`/`STAGE_LABEL`/`DEAL_STAGES` from `dealStages.ts` (T8) used in T9/T11; `backfillGeocodes`/`listMissing`/`setGeocode`/`startGeocode` signatures match across T3/T4/T5/T6/T11; `geocodeStatus` literals `"ok"`/`"failed"` consistent in schema (T2), data (T3), action (T4), filters (T11).
- **No placeholders:** every code step has complete code; T11's "unchanged" regions explicitly reference existing code and only describe the wrap.
