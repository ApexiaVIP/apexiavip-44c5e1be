/**
 * Where the chauffeur is standing, in words the office can read.
 *
 * Used when a passenger is set down somewhere that was never on the booking,
 * and when a job is cleared. The position is taken from the phone and turned
 * into the nearest street and postcode, which the chauffeur can correct.
 */
export interface Place {
  lat?: number;
  lng?: number;
  place: string;
  /** Why we could not fix a position, if we could not. */
  problem?: string;
}

const POSITION_TIMEOUT_MS = 8000;

const fix = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This device cannot report its position"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: POSITION_TIMEOUT_MS,
      maximumAge: 15000,
    });
  });

/** The nearest street and postcode to a position, or an empty string. */
const describe = async (lat: number, lng: number): Promise<string> => {
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes?lat=${lat}&lon=${lng}&limit=1&radius=2000`
    );
    if (!res.ok) return "";
    const body = await res.json();
    const near = body?.result?.[0];
    if (!near) return "";
    return [near.parish || near.admin_ward, near.postcode].filter(Boolean).join(", ");
  } catch {
    return "";
  }
};

export const currentPlace = async (): Promise<Place> => {
  try {
    const position = await fix();
    const { latitude, longitude } = position.coords;
    return { lat: latitude, lng: longitude, place: await describe(latitude, longitude) };
  } catch (err) {
    const problem =
      err instanceof GeolocationPositionError && err.code === err.PERMISSION_DENIED
        ? "Location is turned off for this app, so type where you are"
        : "Could not fix your position, so type where you are";
    return { place: "", problem };
  }
};
