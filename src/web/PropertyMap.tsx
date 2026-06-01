import { useEffect, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
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
  metricValue: string; // shown inside the pin (Sheriff cushion / Legal worth)
  popupMetric?: { label: string; value: string }; // complementary line in the popup (Sheriff: Zestimate)
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

// Abbreviate a formatted money string ("$809,843" -> "$810k", "$2,303,800" -> "$2.3M")
// so the figure fits inside the map marker. Non-numeric (e.g. "—") passes through.
function shortMoney(formatted: string): string {
  const n = Number(formatted.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return formatted;
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}k`;
  return `${sign}$${a}`;
}

// Fit the map to all pins, but only when the actual set/location of pins changes
// — keyed on a stable signature, NOT the array reference. `points` is rebuilt on
// every reactive render (e.g. editing a deal status from a pin or geocode results
// streaming in), so depending on the array itself would re-fit and snap the map
// back to full bounds, fighting the user's pan/zoom.
function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  const sig = points.map((p) => `${p.id}:${p.lat},${p.lng}`).join("|");
  useEffect(() => {
    if (!map || points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    map.fitBounds(bounds, 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig]);
  return null;
}

// Pan to one property and open its Street View when the table's "Map" link is
// clicked. `focusId` is set by the parent and cleared (consumed) once handled, so
// the same row can be clicked again. Waits for the map instance before acting.
function FocusController({
  focusId,
  points,
  onFocus,
  onConsumed,
}: {
  focusId: string | null;
  points: MapPoint[];
  onFocus: (p: MapPoint) => void;
  onConsumed: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focusId || !map) return;
    const p = points.find((pt) => pt.id === focusId);
    if (p) {
      map.panTo({ lat: p.lat, lng: p.lng });
      map.setZoom(17);
      onFocus(p);
    }
    onConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, map]);
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
        {/* Zillow-style price pill: the cushion (Sheriff) / worth (Legal) shown
            inside the marker, colored by deal quality. */}
        <div
          className="cursor-pointer whitespace-nowrap rounded-full border-2 px-2 py-0.5 text-[11px] font-bold text-white shadow-md transition"
          style={{
            backgroundColor: point.color,
            borderColor: open ? "#0ea5e9" : "#1e293b",
            textShadow: "0 1px 2px rgba(0,0,0,0.45)",
          }}
        >
          {shortMoney(point.metricValue)}
        </div>
      </AdvancedMarker>
      {open && (
        <InfoWindow anchor={marker} onClose={onClose} maxWidth={300}>
          <div className="space-y-1.5 text-slate-800">
            <div className="font-semibold">{point.address}</div>
            {point.subtitle && <div className="text-xs text-slate-500">{point.subtitle}</div>}
            {point.popupMetric && (
              <div className="text-sm">
                <span className="text-slate-500">{point.popupMetric.label}: </span>
                <span className="font-bold">{point.popupMetric.value}</span>
              </div>
            )}
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
  focusId,
  onFocusConsumed,
}: {
  points: MapPoint[];
  onDealChange: (id: string, s: DealStage) => void;
  missingCount: number;
  onGeocode: () => void;
  geocoding: boolean;
  focusId: string | null;
  onFocusConsumed: () => void;
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
            <FocusController
              focusId={focusId}
              points={points}
              onFocus={(p) => {
                setOpenId(p.id);
                setStreetView(p);
              }}
              onConsumed={onFocusConsumed}
            />
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
