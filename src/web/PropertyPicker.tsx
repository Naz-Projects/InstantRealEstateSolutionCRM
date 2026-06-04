import { useEffect, useRef, useState } from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Gavel, Scale, Calculator, MapPin, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export type PropertySelection =
  | { kind: "sheriff" | "legal" | "flip"; refId: string; address: string }
  | { kind: "manual"; address: string }
  | null;

type Candidate = { id: string; address: string };
type Candidates = { sheriff: Candidate[]; legal: Candidate[]; flip: Candidate[] };

interface Props {
  candidates: Candidates | undefined;
  value: PropertySelection;
  onChange: (v: PropertySelection) => void;
  className?: string;
}

/**
 * One search bar to add a property: type to filter existing Sheriff/Legal/Flip records
 * AND get live Google Places address suggestions, or commit your typed text as a new
 * manual address. Built on the app's Popover + Command (cmdk) pattern — no extra deps.
 * Degrades to records + free-text when no Maps key is configured.
 */
export function PropertyPicker(props: Props) {
  if (!MAPS_KEY) return <PickerCore {...props} places={null} />;
  return (
    <APIProvider apiKey={MAPS_KEY}>
      <WithPlaces {...props} />
    </APIProvider>
  );
}

function WithPlaces(props: Props) {
  const places = useMapsLibrary("places");
  return <PickerCore {...props} places={places} />;
}

type Suggestion = { id: string; text: string };

function PickerCore({
  candidates,
  value,
  onChange,
  className,
  places,
}: Props & { places: google.maps.PlacesLibrary | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Legacy Places Autocomplete service (matches the "Places API" enabled on the IRES
  // key). A session token groups keystrokes for billing; cleared on a selection.
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
        setSuggestions(predictions.map((p) => ({ id: p.place_id, text: p.description })));
      },
    );
  };

  // Only the user typing triggers a fetch (debounced), so picking an item never loops.
  const onType = (text: string) => {
    setQuery(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchSuggestions(text), 250);
  };

  const choose = (sel: PropertySelection) => {
    onChange(sel);
    setOpen(false);
    setQuery(""); // reset so reopening doesn't show a stale-filtered list
    setSuggestions([]);
    tokenRef.current = null; // a selection ends the autocomplete session
  };

  const q = query.trim().toLowerCase();
  const filterRecords = (list: Candidate[] | undefined) =>
    (list ?? []).filter((c) => !q || c.address.toLowerCase().includes(q)).slice(0, 6);
  const sheriff = filterRecords(candidates?.sheriff);
  const legal = filterRecords(candidates?.legal);
  const flip = filterRecords(candidates?.flip);
  const hasRecords = sheriff.length + legal.length + flip.length > 0;

  const recordGroup = (
    heading: string,
    kind: "sheriff" | "legal" | "flip",
    Icon: typeof Gavel,
    list: Candidate[],
  ) =>
    list.length > 0 ? (
      <CommandGroup heading={heading}>
        {list.map((c) => (
          <CommandItem
            key={`${kind}:${c.id}`}
            value={`${kind}:${c.id}`}
            onSelect={() => choose({ kind, refId: c.id, address: c.address })}
          >
            <Icon className="mr-2 h-3.5 w-3.5 shrink-0 text-teal-glow" />
            <span className="truncate">{c.address}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-sm focus:border-primary focus:outline-none",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {value?.address || "Search an address or pick a record…"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type an address…" value={query} onValueChange={onType} />
          <CommandList>
            {suggestions.length > 0 && (
              <CommandGroup heading="Address suggestions">
                {suggestions.map((s) => (
                  <CommandItem
                    key={`place:${s.id}`}
                    value={`place:${s.id}`}
                    onSelect={() => choose({ kind: "manual", address: s.text })}
                  >
                    <MapPin className="mr-2 h-3.5 w-3.5 shrink-0 text-teal-glow" />
                    <span className="truncate">{s.text}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {recordGroup("Sheriff Sales", "sheriff", Gavel, sheriff)}
            {recordGroup("Legal Notices", "legal", Scale, legal)}
            {recordGroup("Flip Analyses", "flip", Calculator, flip)}
            {q && (
              <CommandGroup heading="New address">
                <CommandItem
                  value="create-manual"
                  onSelect={() => choose({ kind: "manual", address: query.trim() })}
                >
                  <Plus className="mr-2 h-3.5 w-3.5 shrink-0 text-teal-glow" />
                  <span className="truncate">Use "{query.trim()}"</span>
                </CommandItem>
              </CommandGroup>
            )}
            {!q && !hasRecords && <CommandEmpty>Type an address to search.</CommandEmpty>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
