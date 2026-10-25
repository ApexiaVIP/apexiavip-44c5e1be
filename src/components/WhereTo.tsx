import { useState } from "react";
import { Loader2, Navigation } from "lucide-react";
import LocationSearch from "@/components/LocationSearch";
import { tellChauffeur, type PlaceSuggestion } from "@/lib/mfa";
import { placeLine } from "@/lib/whereTo";
import { toast } from "@/hooks/use-toast";

interface WhereToProps {
  reference: string;
  /** An hourly hire has no destination of its own, so the wording differs. */
  asDirected: boolean;
}

/**
 * Where the passenger would like to go, said from the back seat.
 *
 * On an hourly hire this is the destination, and it saves the chauffeur
 * typing an address at the wheel. On a booked journey it is a change of mind,
 * which is worth honouring without a phone call.
 *
 * It tells the chauffeur. It does not steer the car: they are shown the
 * address and decide when to turn, because a route that redraws itself at
 * speed is worse than a chauffeur who has to be asked.
 */
const WhereTo = ({ reference, asDirected }: WhereToProps) => {
  const [sending, setSending] = useState(false);
  const [asked, setAsked] = useState<{ place: string; at: string } | null>(null);
  const [again, setAgain] = useState(false);

  const send = async (picked: PlaceSuggestion) => {
    const place = placeLine(picked);
    if (!place) return;
    setSending(true);
    try {
      await tellChauffeur(reference, place);
      setAsked({
        place,
        at: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      });
      setAgain(false);
      toast({
        title: "Your chauffeur has been told",
        description: place,
      });
    } catch (err) {
      toast({
        title: "We could not pass that on",
        description:
          err instanceof Error
            ? err.message
            : "Please tell your chauffeur directly, or call your travel team.",
      });
    } finally {
      setSending(false);
    }
  };

  const settled = asked && !again;

  return (
    <div className="border border-champagne-muted bg-champagne/5 px-4 py-3 space-y-2">
      <p className="text-[10px] tracking-[0.2em] uppercase text-smoke">
        {asDirected ? "Where would you like to go?" : "Somewhere else?"}
      </p>

      {settled ? (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <Navigation className="w-4 h-4 text-champagne flex-none mt-0.5" />
            {asked.place}
          </p>
          <p className="text-[10px] text-smoke">
            Passed to your chauffeur at {asked.at}. They will confirm as they set off.
          </p>
          <button
            type="button"
            onClick={() => setAgain(true)}
            className="text-[10px] tracking-[0.15em] uppercase text-champagne"
          >
            Somewhere else
          </button>
        </div>
      ) : (
        <>
          <LocationSearch placeholder="Search a place, address or postcode" onSelect={send} />
          <p className="text-[10px] text-smoke leading-relaxed">
            {asDirected
              ? "Your chauffeur will be shown the address and will set off when you are ready."
              : "Your chauffeur will be shown the address. Nothing is charged differently for it."}
          </p>
        </>
      )}

      {sending && (
        <p className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-champagne">
          <Loader2 className="w-3 h-3 animate-spin" />
          Telling your chauffeur
        </p>
      )}
    </div>
  );
};

export default WhereTo;
