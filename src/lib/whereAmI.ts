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

/**
 * Follow the phone's position while a job is running.
 *
 * The callback fires on a steady beat rather than on every movement, so the
 * map keeps a fresh time even when the car is sat at lights, and a motorway
 * run does not send hundreds of updates. Returns a function that stops it.
 */
export const followPosition = (
  onFix: (lat: number, lng: number) => void,
  everyMs = 20000
): (() => void) => {
  if (typeof navigator === "undefined" || !navigator.geolocation) return () => {};
  let latest: { lat: number; lng: number } | null = null;

  const watch = navigator.geolocation.watchPosition(
    (position) => {
      latest = { lat: position.coords.latitude, lng: position.coords.longitude };
    },
    () => {
      // A refused or unavailable position is not worth shouting about here:
      // the chauffeur is told once, when they press Wait or Clear
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
  );

  const beat = setInterval(() => {
    if (latest) onFix(latest.lat, latest.lng);
  }, everyMs);

  return () => {
    navigator.geolocation.clearWatch(watch);
    clearInterval(beat);
  };
};
