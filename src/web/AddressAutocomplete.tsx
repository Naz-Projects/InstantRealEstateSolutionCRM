import { useEffect, useRef, useState } from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const inputCls =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm focus:border-primary focus:outline-none";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Width/layout class for the wrapper (e.g. "w-72"). */
  className?: string;
}

/**
 * Address field with Google Places (New) autocomplete, styled to match the dark
 * theme. Free-text always works — typing flows straight to `onChange`, so it is
 * never more restrictive than a plain input. Picking a suggestion fills the field
 * with that formatted address. Degrades to a plain input if the Maps key or the
 * Places library is unavailable.
 */
export function AddressAutocomplete({ value, onChange, placeholder, className }: Props) {
  if (!MAPS_KEY) {
    return (
      <input
        className={cn(inputCls, className)}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <APIProvider apiKey={MAPS_KEY}>
      <Inner value={value} onChange={onChange} placeholder={placeholder} className={className} />
    </APIProvider>
  );
}

type Suggestion = { id: string; text: string };

function Inner({ value, onChange, placeholder, className }: Props) {
  const places = useMapsLibrary("places");
  const [input, setInput] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the local field in sync when the parent clears/sets it (e.g. after Add).
  useEffect(() => setInput(value), [value]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Uses the legacy Places Autocomplete service (getPlacePredictions), which matches
  // the "Places API" enabled on the IRES Maps key. Guarded so a missing library
  // degrades to free-text. A session token groups keystrokes for billing.
  const fetchSuggestions = (text: string) => {
    if (!places?.AutocompleteService || !text.trim()) {
      setSuggestions([]);
      return;
    }
    if (!serviceRef.current) serviceRef.current = new places.AutocompleteService();
    if (!tokenRef.current) tokenRef.current = new places.AutocompleteSessionToken();
    serviceRef.current.getPlacePredictions(
      {
        input: text,
        sessionToken: tokenRef.current,
        componentRestrictions: { country: "us" },
        types: ["address"],
      },
      (predictions, status) => {
        if (status !== places.PlacesServiceStatus.OK || !predictions) {
          setSuggestions([]);
          return;
        }
        setSuggestions(
          predictions.map((p) => ({ id: p.place_id, text: p.description })),
        );
      },
    );
  };

  const onType = (text: string) => {
    setInput(text);
    onChange(text); // free-text always propagates
    setOpen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchSuggestions(text), 250);
  };

  const pick = (text: string) => {
    setInput(text);
    onChange(text);
    setSuggestions([]);
    setOpen(false);
    tokenRef.current = null; // a selection ends the autocomplete session
  };

  return (
    <div className={cn("relative", className)}>
      <input
        className={inputCls}
        placeholder={placeholder}
        value={input}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                // onMouseDown (not onClick) so the input's onBlur doesn't close the
                // list before the selection registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s.text);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-teal-glow" />
                <span className="truncate">{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
