import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchPlaces, type PlaceSuggestion } from "@/lib/mfa";

interface LocationSearchProps {
  placeholder?: string;
  onSelect: (suggestion: PlaceSuggestion) => void;
}

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

/**
 * Debounced location autocomplete: place names, landmarks, or UK postcodes.
 * Selecting a suggestion hands the structured address to the parent form.
 */
const LocationSearch = ({ placeholder, onSelect }: LocationSearchProps) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const requestSeq = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++requestSeq.current;
    const t = setTimeout(async () => {
      try {
        const results = await searchPlaces(trimmed);
        if (seq !== requestSeq.current) return; // stale response
        setSuggestions(results);
        setOpen(true);
      } catch {
        if (seq === requestSeq.current) {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = (s: PlaceSuggestion) => {
    onSelect(s);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-smoke pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            // Never submit the booking form from the search box
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder={placeholder ?? "Search a place, airport, restaurant or postcode"}
          className="bg-transparent border-border focus:border-champagne-muted rounded-none h-11 pl-10 pr-10 text-foreground placeholder:text-muted-foreground text-sm"
          autoComplete="off"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-champagne" />
        )}
      </div>

      {open && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-charcoal border border-border max-h-72 overflow-y-auto shadow-xl">
          {suggestions.length === 0 ? (
            <li className="px-4 py-3 text-smoke text-sm font-light">
              No matches. Try a postcode, or enter the address below.
            </li>
          ) : (
            suggestions.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className="w-full text-left px-4 py-3 hover:bg-background/60 transition-colors flex items-start gap-3"
                >
                  <MapPin className="w-4 h-4 text-champagne mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-foreground font-light">{s.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

export default LocationSearch;
