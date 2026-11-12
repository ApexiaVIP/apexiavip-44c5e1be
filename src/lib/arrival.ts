/**
 * How long the drive has left, when our own navigation is not running it.
 *
 * The arrival time on the passenger's screen was worked out by the
 * chauffeur's in-app sat nav and passed along with each position. Drive in
 * Waze instead and there is no sat nav on screen, so the number went blank:
 * the car moved across the map with nothing above it saying when it would
 * get there, which is the one thing a passenger actually wants to know.
 *
 * This asks the same router the sat nav asks, with nothing on screen. It
 * asks sparingly and counts down in between, which is also what reads
 * better: a number that falls steadily as the car gets closer, rather than
 * one that twitches every six seconds.
 */

import { supabase } from "@/integrations/supabase/client";
import { routesFromGoogle, routesFromOsrm } from "@/lib/navRoute";
import { findDoor } from "@/lib/findDoor";
import { destinationQuery, type Place } from "@/lib/navigation";

/** Long enough to be cheap, short enough to catch traffic turning. */
const FRESH_MS = 90_000;

export interface Where {
  lat: number;
  lng: number;
}

/** Seconds for the whole drive from here, or null where there is no answer. */
export type Ask = (from: Where, place: Place) => Promise<number | null>;

const askTheRouter: Ask = async (from, place) => {
  const door = await findDoor(place);
  if (!door) return null;
  const { data, error } = await supabase.functions.invoke("route", {
    body: {
      from,
      to: { lat: door.lat, lng: door.lng },
      address: destinationQuery(place),
      // Nobody is choosing a way here: this is a number, not a drive
      alternatives: false,
    },
  });
  if (error || !data || data.error) return null;
  const ways =
    data.provider === "google"
      ? routesFromGoogle(data.route)
      : routesFromOsrm(data.route, data.withTraffic === true);
  return ways[0]?.seconds ?? null;
};

/**
 * Makes the thing that answers "how long now?" every time it is asked.
 *
 * The answer comes back straight away, from what was last worked out, while
 * a fresh one is fetched behind it when the old one has gone off. A position
 * report cannot wait on a router: the position is what the map needs and it
 * has to go whether or not there is a time to go with it.
 */
export const makeArrival = (ask: Ask = askTheRouter) => {
  let known: { seconds: number; at: number } | null = null;
  let toward = "";
  let asking = false;

  return (from: Where, place: Place): number | null => {
    const where = destinationQuery(place);
    if (!where) return null;
    // Turned round at the collection, or the passenger named somewhere new.
    // The old estimate is to the wrong place and is worse than none.
    if (where !== toward) {
      toward = where;
      known = null;
    }

    const now = Date.now();
    if (!asking && (!known || now - known.at > FRESH_MS)) {
      asking = true;
      const asked = where;
      void ask(from, place)
        .then((seconds) => {
          if (seconds !== null && asked === toward) known = { seconds, at: Date.now() };
        })
        .catch(() => {})
        .finally(() => {
          asking = false;
        });
    }

    if (!known) return null;
    return Math.max(0, Math.round(known.seconds - (now - known.at) / 1000));
  };
};
