import LocationSearch from "@/components/LocationSearch";
import { placeFrom } from "@/lib/asDirected";
import type { PlaceSuggestion } from "@/lib/mfa";

interface DestinationBoxProps {
  /** Where the passenger has asked for, as it was recorded, or nothing yet. */
  chosen: string | null;
  /** The chauffeur is putting in a different address. */
  changing: boolean;
  onChange: () => void;
  onPick: (picked: PlaceSuggestion) => void;
}

/**
 * Where an hourly hire is going, as the passenger just said in the car.
 *
 * On these jobs nobody knows the destination when the day starts, so this is
 * the only place the address ever comes from. Putting it in is what gets the
 * car navigated and what puts the address on the job for the office, so it
 * asks plainly and keeps asking after every stop.
 */
const DestinationBox = ({ chosen, changing, onChange, onPick }: DestinationBoxProps) => {
  const settled = chosen && !changing;

  return (
    <div className="border border-champagne-muted bg-champagne/5 px-3 py-3 space-y-2">
      <p className="text-[10px] tracking-[0.15em] uppercase text-smoke">
        {settled ? "Heading for" : "Where has the passenger asked for?"}
      </p>

      {settled ? (
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-foreground">{chosen}</p>
          <button
            type="button"
            onClick={onChange}
            className="text-[10px] tracking-[0.15em] uppercase text-champagne shrink-0 pt-0.5"
          >
            Change
          </button>
        </div>
      ) : (
        <LocationSearch placeholder="Address, place or postcode" onSelect={onPick} />
      )}

      {/*
        Google knows places with no postcode. The address is still worth having
        on the job, but the sat nav has nothing to aim at, and a chauffeur is
        better told why than left pressing a button that is not there.
      */}
      {settled && !placeFrom(chosen).postcode && (
        <p className="text-[10px] text-smoke/70 leading-relaxed">
          That address has no postcode, so it is on the job for the office but the sat nav
          cannot take you there. Use Waze, or pick a nearby postcode.
        </p>
      )}
    </div>
  );
};

export default DestinationBox;
