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
 * Handing the drive to Waze.
 *
 * This was taken out once, and the reason was sound: leaving the app
 * suspended it, a suspended app reported no positions, and the passenger
 * watched a car that never moved for the whole journey. The in-app sat nav
 * existed to stop that happening.
 *
 * It is back because that reason no longer holds. The app now takes its
 * fixes from the operating system rather than the browser, so the car keeps
 * moving on the passenger's map while Waze is in front and while the phone is
 * locked. The button is offered only where that is true, which is why it is
 * gated on survivesBackground() rather than simply drawn. On anything that
 * still reports from the browser, there is no button, because there the old
 * fault is still the fault.
 */

/**
 * The Waze link for a destination.
 *
 * Coordinates where we have them, and that matters more than it looks. Handed
 * a postcode, Waze geocodes it the same way everyone else does and lands on
 * the centroid of the unit, which is the fifty yards that started all of
 * this. Handing it the door we worked out ourselves carries the corrected
 * position across, so the chauffeur arrives where the passenger is standing
 * rather than where the Post Office draws the postcode.
 *
 * A https://waze.com/ul link opens the app when it is installed and the
 * website when it is not, so there is nothing to detect and no dead end.
 */
export function wazeLink(at: { lat: number; lng: number } | null, place: Place): string | null {
  if (at) return `https://waze.com/ul?ll=${at.lat}%2C${at.lng}&navigate=yes`;
  const query = destinationQuery(place);
  return query ? `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes` : null;
}

/**
 * The same destination as a link into the Waze app itself.
 *
 * The https link is the documented one and it does open Waze, but on iOS it
 * arrives through Safari and the universal link handler, and the destination
 * is dropped on the way: the app opens on the map with no journey set, which
 * is exactly what a chauffeur reported. The app's own scheme is handed
 * straight to Waze by the operating system, with nothing in between to lose
 * the parameters.
 *
 * No ul in the path. waze://ul?... is the form that does nothing.
 */
export function wazeAppLink(at: { lat: number; lng: number } | null, place: Place): string | null {
  if (at) return `waze://?ll=${at.lat},${at.lng}&navigate=yes`;
  const query = destinationQuery(place);
  return query ? `waze://?q=${encodeURIComponent(query)}&navigate=yes` : null;
}
