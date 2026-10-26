import { Home, MapPin } from "lucide-react";
import { addressLine, type SavedAddress } from "@/lib/addressBook";

interface SavedAddressChipsProps {
  addresses: SavedAddress[];
  onPick: (a: SavedAddress) => void;
}

/**
 * The member's saved addresses, offered above an address search.
 *
 * Tapping one fills the fields below, which leaves them visible and editable:
 * a flat number or a gate code often differs from the address on file, and a
 * picker that hid the fields would make that a retype rather than an edit.
 */
const SavedAddressChips = ({ addresses, onPick }: SavedAddressChipsProps) => {
  if (addresses.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-smoke/70 text-[10px] tracking-[0.2em] uppercase mr-1">Saved</span>
      {addresses.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPick(a)}
          title={addressLine(a)}
          className="flex items-center gap-1.5 border border-border hover:border-champagne-muted px-3 py-1.5 text-xs text-foreground transition-colors"
        >
          {a.is_home ? (
            <Home className="w-3 h-3 text-champagne" />
          ) : (
            <MapPin className="w-3 h-3 text-champagne" />
          )}
          {a.label}
        </button>
      ))}
    </div>
  );
};

export default SavedAddressChips;
