/**
 * Handing a chauffeur over to a navigation app.
 *
 * Chauffeurs were leaving the app, opening Waze and typing the address in by
 * hand, which is slow at the kerb and gets postcodes wrong. These build the
 * links that start the drive for them, with the destination already set.
 *
 * Which destination depends on where they are in the job: before the
 * passenger is aboard they are driving to the collection, after it they are
 * driving to where the passenger is going.
 */

export type Place = {
  line1?: string | null;
  town?: string | null;
  postcode?: string | null;
} | null;

/**
 * The address as a navigation app wants it.
 *
 * The postcode goes last and is the part that actually does the work in the
 * United Kingdom. The street is still included, because a postcode alone can
 * drop a car at the wrong end of a long road, and because the chauffeur needs
 * to recognise it on screen.
 */
export function destinationQuery(place: Place): string {
  if (!place) return "";
  const parts = [place.line1, place.town, place.postcode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

/**
 * A postcode anywhere in an address, not only in the postcode field.
 *
 * City jobs arrive from the booking system as one run-together line, so the
 * postcode field is empty while the postcode itself is sitting in the middle
 * of the street. The sat nav read the field alone and told a chauffeur stood
 * at Signature Aviation that his job had no postcode, with M90 5NE on the
 * screen in front of him. Look at the whole address and that job navigates.
 */
const POSTCODE_ANYWHERE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

export function postcodeFor(place: Place): string {
  if (!place) return "";
  const own = (place.postcode ?? "").trim();
  if (own) return own;
  const found = [place.line1, place.town]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .match(POSTCODE_ANYWHERE);
  return found ? found[0].trim() : "";
}

/**
 * Where a chauffeur on this job is actually driving to right now.
 *
 * On an hourly hire the passenger says where, in the car, and the chauffeur
 * puts it in. Until they have, there is nowhere to drive to; once they have,
 * it is wherever the passenger named.
 */
export function nextDestination(
  job: { pickup: Place; dropoff: Place; as_directed?: boolean | null },
  driverStatus: string | null,
  chosen?: Place
): { place: Place; what: "pickup" | "dropoff" } | null {
  const collected = driverStatus === "pob" || driverStatus === "waiting";

  if (!collected) {
    return job.pickup ? { place: job.pickup, what: "pickup" } : null;
  }
  if (job.as_directed) {
    return chosen ? { place: chosen, what: "dropoff" } : null;
  }
  if (!job.dropoff) return null;
  return { place: job.dropoff, what: "dropoff" };
}

/*
 * There were link builders here for Waze, Google Maps and Apple Maps, and an
 * opener that pushed them out to the system app.
 *
 * They are gone deliberately. Leaving the app is what suspends it, and a
 * suspended app reports no positions, so the passenger watched a car that
 * never moved for the whole journey. That is the fault the in-app sat nav was
 * built to fix, and a button offering the old way undoes it. If a route will
 * not come, the drive screen asks again rather than sending anybody out.
 */
