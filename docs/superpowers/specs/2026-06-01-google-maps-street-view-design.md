# Google Maps + Street View — Design Spec

_Date: 2026-06-01 · Status: approved (design), pending spec review_

## Goal
Let the IRES team work deals **visually on a map** instead of copy-pasting addresses into
Google Maps by hand. On both the Sheriff Sales and Legal Notices pages, add a map view that
plots each property as a pin, and let the user click a pin to see the house's **Street View**
(exterior). This makes location-based judgment (neighborhood, street, condition) fast.

## Decisions (from brainstorming, all confirmed)
- **Placement:** a `[ Table | Map ]` toggle on each existing page (Sheriff + Legal), reusing
  that page's selected month/week. Not a separate page.
- **Street View:** clicking a pin shows an info window with a Street View **photo** + an
  **"Open Street View"** button that opens a full interactive (draggable) panorama.
- **Geocoding:** geocode each address once and **store `lat`/`lng` on the row** (auto on new
  scrapes + a backfill for existing rows). Map reads stored coords (instant, no re-bill).
- **Pins:** colored by **deal quality** (Sheriff = cushion tier; Legal = value bucket).
- **Deal status:** editable **inline** from the pin's info window (same mutation as the table).
- **Library:** `@vis.gl/react-google-maps` (Google-maintained; supports AdvancedMarker,
  InfoWindow, and `useMapsLibrary('streetView')`). Chosen over the older `@react-google-maps/api`.
- **API key:** the user will follow provided setup steps (browser key + Map ID + server key).

## Architecture overview
```
scrape ──(end of run)──> schedule backfillGeocodes(type)
                                     │
addresses ──> geocodeAddress() ──> Google Geocoding API ──> {lat,lng} (DE-validated)
                                     │
                              store lat/lng on row  ◄── manual "Geocode N missing" button
                                     │
row.lat/lng ──> PropertyMap (AdvancedMarker, color by deal) ──> InfoWindow
                                     │                               │
                          StreetView static thumbnail        "Open Street View"
                                     │                               │
                                     └──────────> StreetViewModal (interactive panorama)
```

## Components

### 1. `src/scraper/geocode.ts` (runtime-agnostic core, testable)
- `parseGeocodeResponse(json): { lat: number; lng: number } | null` — **pure**, unit-tested.
  - Return `null` unless `status === "OK"`.
  - Take `results[0]`. **Validate Delaware**: require an `address_components` entry whose
    `types` include `administrative_area_level_1` and `short_name === "DE"`. (Mirrors the
    Zillow `-DE-` lesson — never pin the wrong state.) Otherwise `null`.
  - Return `results[0].geometry.location` (`{lat, lng}`).
- `geocodeAddress(address: string, apiKey: string): Promise<{lat,lng} | null>` — builds the
  request `https://maps.googleapis.com/maps/api/geocode/json?address=<enc>&components=country:US|administrative_area:DE&key=<key>`,
  `fetch`es, returns `parseGeocodeResponse(json)`. Throws only on network/HTTP error (so the
  caller can mark the row `failed` vs. retry).

### 2. Schema (`convex/schema.ts`)
Add to **both** `sheriffListings` and `legalNotices` (all optional → existing rows still validate):
- `lat: v.optional(v.number())`
- `lng: v.optional(v.number())`
- `geocodeStatus: v.optional(v.union(v.literal("ok"), v.literal("failed")))`
  (absent = not yet attempted; `failed` = attempted, no DE result — don't retry in backfill.)

### 3. Geocode Convex functions
**`convex/geocodeData.ts`** (V8 query/mutation):
- `listMissing({ type })` internalQuery → rows of that table where `lat === undefined` **and**
  `geocodeStatus !== "failed"`. Returns `[{ id, address, propertyAddress? }]` (propertyAddress
  only for sheriff). Branches on `type`.
- `setGeocode({ type, id, lat?, lng?, status })` internalMutation → resolves the typed id via
  `ctx.db.normalizeId(table, id)` and patches `{ lat, lng, geocodeStatus: status, updatedAt }`.
  (One mutation for both tables — both have the same three fields.)

**`convex/geocodeActions.ts`** (`"use node"`):
- `backfillGeocodes({ type })` internalAction — `listMissing` → for each row, pick the best
  address (`propertyAddress` if present & not an ERROR_CODE, else raw `address`), call
  `geocodeAddress`; on result `setGeocode(ok)`, on `null` `setGeocode(failed)`, on throw leave
  for retry. Process sequentially with a small per-call delay (~200ms) — well under the
  Geocoding API's rate limits. Idempotent — only touches rows missing coords.
- `startGeocode({ type })` mutation (auth via `requireUser`) → schedules `backfillGeocodes`.
  Called by the map's "Geocode N missing" button. Returns `{ scheduled: number }`.

**Server key:** `geocodeAddress` reads `process.env.GOOGLE_GEOCODING_API_KEY` inside the
action. Separate from the browser key.

### 4. Auto-geocode on scrape
At the end of `runSheriffScrape` / `runLegalScrape` (after the enrich fan-out loop), add one
line: `await ctx.scheduler.runAfter(<after enrichment>, internal.geocodeActions.backfillGeocodes, { type })`.
Delay ≈ `listings.length * stagger + buffer` so `propertyAddress` is populated; if it runs
early, the raw `address` is used (acceptable) and the manual button/next run catches stragglers.

### 5. Frontend
- **Install** `@vis.gl/react-google-maps`.
- **`src/web/PropertyMap.tsx`** — props `{ kind: "sheriff" | "legal", rows }` (rows already
  carry `lat/lng`, deal/value, address, size, dealStatus, zillowUrl).
  - No `VITE_GOOGLE_MAPS_API_KEY` → render a friendly placeholder (no crash).
  - `<APIProvider apiKey>` → `<Map mapId={VITE_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"} ...>`
    (AdvancedMarkers require a Map ID). Fit bounds to pinned rows; default center = New Castle County.
  - One `<AdvancedMarker>` per row **with** coords; `<Pin>` color by deal:
    - Sheriff tier → good `#16a34a`, ok `#10b981`, thin/verify `#f59e0b`, bad `#ef4444`, unknown `#94a3b8`.
    - Legal value bucket → ≥$500k green, ≥$250k amber, <$250k slate, null gray.
  - Click → `<InfoWindow>`: address, headline metric (Sheriff cushion+tier / Legal Worth), size,
    deal-status `<select>` (calls `setDealStatus`), Zillow link, Street View **static thumbnail**,
    **"Open Street View"** button → sets `{lat,lng,address}` for the modal.
  - Helper `streetViewThumb(lat,lng,key)` →
    `https://maps.googleapis.com/maps/api/streetview?size=320x140&location=LAT,LNG&fov=80&return_error_code=true&key=KEY`.
- **`src/web/StreetViewModal.tsx`** — overlay with a ref'd div. On open, `useMapsLibrary('streetView')`
  → `new StreetViewService().getPanorama({ location, radius: 50 })`; if `OK`, mount
  `new StreetViewPanorama(div, { position, pov })`; else show "No Street View here" + the static
  image fallback. Close on backdrop/Esc.
- **Page integration** (`src/web/pages.tsx`) — add `const [view, setView] = useState<"table"|"map">("table")`
  and a small `[ Table | Map ]` toggle near the period tabs on both `SheriffSales` and
  `LegalNotices`. Map view renders `<PropertyMap kind=... rows={sorted ?? rows} />` plus a line
  "X of Y pinned · [Geocode N missing]" (button calls `startGeocode`).

### 6. Env / keys
- `.env.local` (+ `.env.example`): `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID`.
- Convex env: `GOOGLE_GEOCODING_API_KEY` (`npx convex env set ...`).
- **Setup steps the user runs** (billing must be enabled):
  1. Create/select a Google Cloud project; enable billing.
  2. Enable APIs: **Maps JavaScript API**, **Street View Static API**, **Geocoding API**.
  3. Create a **browser key** → restrict to HTTP referrers (`http://localhost:5173/*` + prod
     domain), restrict to Maps JavaScript + Street View Static APIs → `VITE_GOOGLE_MAPS_API_KEY`.
  4. Maps → **Map Management** → create a **Map ID** (vector) → `VITE_GOOGLE_MAPS_MAP_ID`.
  5. Create a **server key** → restrict to the **Geocoding API** → `npx convex env set GOOGLE_GEOCODING_API_KEY ...`.

## Error handling
- Missing browser key → placeholder card, app keeps working.
- Geocode no-DE-result → row marked `failed`, simply not pinned (no crash); shown in the
  "N missing/failed" count.
- No Street View coverage → modal shows a clear message + static fallback image.
- Backfill is idempotent and safe to re-run; network errors leave the row for a later retry.

## Cost
- Geocoding ~60 rows once = well within the free monthly tier.
- Static Street View thumbnails are inexpensive; the pricier **interactive** panorama loads
  only on demand behind the button (not per pin).

## Testing
- `tests/geocode.test.ts`: `parseGeocodeResponse` — OK-in-DE → coords; OK-out-of-state → null;
  ZERO_RESULTS → null; missing geometry → null.
- `npx convex dev --once` (regen types) → `npm run build` → `npm test`.
- Live on dev: run the backfill, confirm `lat/lng` populate (`npx convex run`), spot-check a row.
- Map + Street View **visual check is the user's** (needs the real key + a browser); flagged in
  the handoff like the existing pending stepper eyeball.

## Out of scope (YAGNI)
- Marker clustering (revisit only if a period exceeds ~100 pins).
- A dedicated all-properties Map page.
- Directions/routing, radius drawing, heatmaps.
- Mobile-specific layout.

## File summary
- New: `src/scraper/geocode.ts`, `convex/geocodeData.ts`, `convex/geocodeActions.ts`,
  `src/web/PropertyMap.tsx`, `src/web/StreetViewModal.tsx`, `tests/geocode.test.ts`.
- Edit: `convex/schema.ts` (+lat/lng/geocodeStatus ×2), `convex/sheriffActions.ts` +
  `convex/legalActions.ts` (schedule backfill), `src/web/pages.tsx` (view toggle + map mount),
  `.env.example`, `package.json` (+dependency).
