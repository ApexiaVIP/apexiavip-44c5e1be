/**
 * The coordinate a chauffeur is actually driving to.
 *
 * This used to be the postcode and nothing else. api.postcodes.io answers a
 * postcode with the centroid of the whole unit, which in a town is close
 * enough to the door to be invisible and down a lane is not: a cottage on
 * Donkey Lane sat fifty yards from the centroid of its own postcode, so the
 * car was told it had arrived while it was still short of the gate, and the
 * chauffeur stopped at the wrong entrance. Changing map provider would not
 * have moved it an inch, because the coordinate was ours, not theirs.
 *
 * So: ask Google for the whole address, take the answer only when it is
 * precise and sane, and fall back to the centroid when it is not. The
 * fallback matters. A worse answer than the one we already had is not an
 * improvement, and "The cottage" is a name thousands of houses share.
 */

import { loadGoogleMaps } from "@/lib/googleMaps";
import { lookUpPostcode, metresBetween } from "@/lib/trackMarker";
import { destinationQuery, postcodeFor, type Place } from "@/lib/navigation";

export interface Door {
  lat: number;
  lng: number;
  /** How the coordinate was found, for the screen and for working out faults. */
  precision: "address" | "postcode";
}

/**
 * How far a precise answer is allowed to sit from the centroid of the
 * postcode the office typed.
 *
 * A postcode unit is a handful of doors, so a real match is metres away. Half
 * a mile means Google has matched a different place with the same name in the
 * same county, which is the failure that would put a car in the next village
 * with nothing on screen to say so. Rural units are large, so this is
 * generous rather than tight: it is there to catch a wrong town, not to
 * second guess a long driveway.
 */
const SANITY_M = 800;

/**
 * Answers we trust more than the centroid.
 *
 * ROOFTOP is the building. RANGE_INTERPOLATED is a guess along a street from
 * the numbers either side, which is still the right stretch of the right road
 * and still better than the middle of a postcode. GEOMETRIC_CENTER is the
 * centre of a polyline or polygon, so it is accepted only when the match is a
 * building rather than a road or an area.
 */
const PRECISE = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);
const BUILDING = new Set(["street_address", "premise", "subpremise"]);

const precise = (r: google.maps.GeocoderResult): boolean => {
  const how = r.geometry?.location_type as unknown as string | undefined;
  if (how && PRECISE.has(how)) return true;
  if (how === "GEOMETRIC_CENTER") return r.types.some((t) => BUILDING.has(t));
  return false;
};

/**
 * Where to drive, given everything the booking says about the place.
 *
 * Never throws and never returns nothing when a postcode resolves: the worst
 * case is exactly what the app did before this existed.
 */
export const findDoor = async (place: Place): Promise<Door | null> => {
  const postcode = postcodeFor(place);
  if (!postcode) return null;

  const centroid = await lookUpPostcode(postcode);
  if (!centroid) return null;

  const full = destinationQuery(place);
  // Nothing beyond the postcode to go on, so there is nothing to improve.
  if (!full || full.replace(/\s/g, "") === postcode.replace(/\s/g, "")) {
    return { ...centroid, precision: "postcode" };
  }

  try {
    const maps = await loadGoogleMaps();
    const geocoder = new maps.Geocoder();
    const { results } = await geocoder.geocode({
      address: full,
      componentRestrictions: { country: "GB", postalCode: postcode },
    });

    for (const result of results) {
      if (!precise(result)) continue;
      const at = result.geometry.location;
      const lat = at.lat();
      const lng = at.lng();
      if (metresBetween(centroid.lat, centroid.lng, lat, lng) > SANITY_M) continue;
      return { lat, lng, precision: "address" };
    }
  } catch {
    // Maps would not load, the key is refused, or the address means nothing to
    // Google. None of that is a reason to leave the chauffeur with no route.
  }

  return { ...centroid, precision: "postcode" };
};
