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
