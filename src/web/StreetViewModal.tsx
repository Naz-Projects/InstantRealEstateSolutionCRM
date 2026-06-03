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
    svc.getPanorama({ location: { lat: point.lat, lng: point.lng }, radius: 60 }, (data: google.maps.StreetViewPanoramaData | null, svStatus: "OK" | "ZERO_RESULTS" | "UNKNOWN_ERROR") => {
      if (svStatus === "OK" && data?.location?.latLng && ref.current) {
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
        className="relative h-[80vh] w-full max-w-4xl overflow-hidden rounded-xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="text-sm font-semibold text-foreground">{point.address}</div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative h-[calc(80vh-41px)]">
          <div ref={ref} className="h-full w-full" />
          {status !== "ok" && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted text-sm text-muted-foreground">
              {status === "loading" ? "Loading Street View…" : "No Street View available at this location."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
