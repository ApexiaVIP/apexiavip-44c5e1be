import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dueFromRoute, whenDue, STALE_AFTER_MS } from "@/lib/eta";
import { destinationQuery, nextDestination, postcodeFor, type Place } from "@/lib/navigation";
import { lookUpPostcode } from "@/lib/trackMarker";
import { fromGoogle, fromOsrm } from "@/lib/navRoute";

/**
 * How often the fallback asks. Every ask is a routing call that costs money,
 * and an arrival time that moves every four seconds reads as a car that
 * cannot make its mind up, so once a minute is both cheaper and calmer.
 */
const ASK_EVERY_MS = 60_000;

interface Props {
  reference: string;
  pickup: Place;
  dropoff: Place;
  asDirected: boolean;
  driverStatus: string | null;
  driverLat: number | null;
  driverLng: number | null;
  positionAt: string | null;
  etaAt: string | null;
}

/**
 * When the passenger's car is due, however the chauffeur is driving.
 *
 * The arrival time used to come only from the chauffeur's own sat nav, which
 * meant it existed only while they were navigating in the app. After the
 * postcode fault stopped City jobs navigating, the chauffeurs were told to
 * ignore the drive button, and every passenger quietly lost their arrival
 * time along with it. Nobody connected the two, and the travel team went back
 * to being rung and asked how long.
 *
 * So the chauffeur's own number is still preferred, because it is the one
 * they are driving to. When there is none, the car's last position is routed
 * to where it is going and the passenger is told that instead.
 */
const ArrivalTime = ({
  reference,
  pickup,
  dropoff,
  asDirected,
  driverStatus,
  driverLat,
  driverLng,
  positionAt,
  etaAt,
}: Props) => {
  /** What the chauffeur's sat nav is working to, where they are using it. */
  const told = whenDue(etaAt, positionAt, driverStatus);

  const heading = nextDestination(
    { pickup, dropoff, as_directed: asDirected },
    driverStatus
  );
  // An hourly hire is heading wherever the passenger last said, which lives
  // on the chauffeur's job rather than here, so there is nothing to route to
  const to = heading?.place ?? null;

  // A position too old to quote an arrival from is too old to route from
  const reported = positionAt ? Date.parse(positionAt) : NaN;
  const fresh = !Number.isNaN(reported) && Date.now() - reported < STALE_AFTER_MS;

  const wanted =
    !told && !!to && fresh && typeof driverLat === "number" && typeof driverLng === "number";

  const { data: worked } = useQuery({
    // Deliberately not keyed on the car's position: this list refreshes every
    // four seconds and each ask costs, so the clock below decides, not the car
    queryKey: ["arrival", reference, destinationQuery(to)],
    enabled: wanted,
    refetchInterval: ASK_EVERY_MS,
    staleTime: ASK_EVERY_MS,
    queryFn: async () => {
      const door = await lookUpPostcode(postcodeFor(to));
      if (!door) return null;
      const { data, error } = await supabase.functions.invoke("route", {
        body: {
          from: { lat: driverLat, lng: driverLng },
          to: door,
          address: destinationQuery(to),
          reference,
        },
      });
      if (error || data?.error) return null;
      const route =
        data.provider === "google"
          ? fromGoogle(data.route)
          : fromOsrm(data.route, data.withTraffic === true);
      // Held against the moment it was worked out, so the time stays put and
      // the minutes count down, rather than the arrival sliding away as the
      // screen refreshes
      return route ? { seconds: route.seconds, at: Date.now() } : null;
    },
  });

  const due = told ?? dueFromRoute(worked, positionAt, driverStatus);
  if (!due) return null;

  return (
    <div className="border border-champagne-muted bg-champagne/5 px-4 py-3">
      <p className="text-champagne text-lg font-light tracking-wide">{due.headline}</p>
      <p className="text-smoke text-xs tracking-[0.1em] mt-0.5">{due.detail}</p>
    </div>
  );
};

export default ArrivalTime;
