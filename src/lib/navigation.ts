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

/**
 * Waze, which is what Apexia's chauffeurs actually use.
 *
 * `navigate=yes` starts the drive rather than only dropping a pin, so it is
 * one tap from the job to moving.
 */
export function wazeLink(place: Place): string {
  const q = destinationQuery(place);
  return q ? `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes` : "";
}

/**
 * Google Maps, for the ones who prefer it, and as the fallback when Waze is
 * not installed. Live traffic is the default for driving directions.
 */
export function googleMapsLink(place: Place): string {
  const q = destinationQuery(place);
  return q
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`
    : "";
}

/** Apple Maps, since every one of these chauffeurs is carrying an iPhone. */
export function appleMapsLink(place: Place): string {
  const q = destinationQuery(place);
  return q ? `https://maps.apple.com/?daddr=${encodeURIComponent(q)}&dirflg=d` : "";
}

/**
 * Open a navigation app from inside the native shell.
 *
 * A plain anchor would load the map inside our own webview, stranding the
 * chauffeur in a browser with no way back to the job, so this pushes it out
 * to the system which hands it to the real app.
 */
export function openNavigation(url: string): void {
  if (!url) return;
  // The native shell hands "_system" to the real app instead of our webview
  const opened = window.open(url, "_system", "location=yes");
  if (!opened) window.open(url, "_blank");
}
