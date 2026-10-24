/**
 * Loading Google's map into the page.
 *
 * The chauffeur's driving screen uses Google's own map rather than an open
 * one. Google's routing and Google's map belong together: it is what their
 * licence expects, and it is the map every driver already recognises.
 *
 * Two settings are needed, both set where the site is built rather than in
 * the code, because the key belongs to the account and not to the repository:
 *
 *   VITE_GOOGLE_MAPS_BROWSER_KEY  a key restricted to the Maps JavaScript API
 *   VITE_GOOGLE_MAPS_MAP_ID       a vector map id, with tilt and rotation on
 *
 * The map id is not optional. Only a vector map can be tilted and turned to
 * face the way the car is going, and a nav screen that will not turn is a
 * paper map with a dot on it.
 */

export const browserKey = (): string =>
  (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined) ?? "";

export const mapId = (): string =>
  (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) ?? "";

/** Whether this build has what it needs to draw Google's map. */
export const googleMapsConfigured = (): boolean => !!browserKey() && !!mapId();

const CALLBACK = "__apexiaMapsReady";
const SCRIPT_ID = "apexia-google-maps";

/** How long to wait before giving up and falling back to the other map. */
const GIVE_UP_MS = 10000;

let loading: Promise<typeof google.maps> | null = null;

export const loadGoogleMaps = (): Promise<typeof google.maps> => {
  if (loading) return loading;

  loading = new Promise<typeof google.maps>((ready, fail) => {
    if (typeof window === "undefined") {
      fail(new Error("no window"));
      return;
    }
    if (window.google?.maps) {
      ready(window.google.maps);
      return;
    }
    const key = browserKey();
    if (!key) {
      fail(new Error("no browser key"));
      return;
    }

    const giveUp = window.setTimeout(() => fail(new Error("maps took too long")), GIVE_UP_MS);

    (window as unknown as Record<string, unknown>)[CALLBACK] = () => {
      window.clearTimeout(giveUp);
      ready(window.google.maps);
    };

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&libraries=marker&language=en-GB&region=GB&loading=async&callback=${CALLBACK}`;
    script.onerror = () => {
      window.clearTimeout(giveUp);
      fail(new Error("maps would not load"));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later attempt try again rather than holding on to the failure
    loading = null;
    throw err;
  });

  return loading;
};

/**
 * A point a given distance ahead on a given bearing.
 *
 * Used to push the car down the screen: the map is centred on a spot in front
 * of it, so what is coming fills the view instead of what has been passed.
 */
export const pointAhead = (
  lat: number,
  lng: number,
  bearingDeg: number,
  metres: number
): { lat: number; lng: number } => {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const d = metres / R;
  const b = bearingDeg * toRad;
  const lat1 = lat * toRad;
  const lng1 = lng * toRad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: lat2 / toRad, lng: ((lng2 / toRad + 540) % 360) - 180 };
};

/**
 * The shorter way round between two compass bearings.
 *
 * Turning from 350 degrees to 10 is twenty degrees to the right, not three
 * hundred and forty to the left, and a map that takes the long way round
 * spins the whole world at every junction.
 */
export const turnTowards = (from: number, to: number): number => {
  const difference = ((to - from + 540) % 360) - 180;
  return from + difference;
};
