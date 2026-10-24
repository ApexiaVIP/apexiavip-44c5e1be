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
 * run does not send hundreds of updates. The phone is already tracking
 * continuously either way, so a shorter beat costs battery nothing and only
 * adds a small request. Returns a function that stops it.
 */
export const followPosition = (
  onFix: (lat: number, lng: number) => void,
  everyMs = 6000
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

/**
 * Keep the screen awake while a job is running.
 *
 * The app only reports where the car is while it is actually on screen: the
 * phone suspends it the moment it is locked or put away, and the passenger's
 * map then freezes on the last position until the job ends. Holding the
 * screen on keeps a mounted phone reporting for the whole journey.
 *
 * The lock is dropped by the phone whenever the app goes to the background,
 * so it is taken again each time the app comes back. Returns a function that
 * releases it.
 */
export const keepScreenAwake = (): (() => void) => {
  interface Sentinel {
    release: () => Promise<void>;
  }
  const lock = (navigator as unknown as {
    wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
  }).wakeLock;
  if (!lock) return () => {};

  let held: Sentinel | null = null;
  let stopped = false;

  const take = async () => {
    if (stopped || held || document.visibilityState !== "visible") return;
    try {
      held = await lock.request("screen");
      // The phone drops it on its own when the app is backgrounded
      (held as unknown as { onrelease?: () => void }).onrelease = () => {
        held = null;
      };
    } catch {
      // A phone that will not hold the screen on is not a reason to fail
    }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void take();
  };

  void take();
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    void held?.release().catch(() => {});
    held = null;
  };
};

/** A single fix, for working out a route from where the car is standing. */
export interface Fix {
  lat: number;
  lng: number;
  /** Which way the car is pointing, where the phone can tell. */
  heading: number | null;
  /** Metres per second, where the phone can tell. */
  speed: number | null;
}

export const currentFix = async (): Promise<Fix | null> => {
  try {
    const position = await fix();
    const { latitude, longitude, heading, speed } = position.coords;
    return {
      lat: latitude,
      lng: longitude,
      heading: typeof heading === "number" && !Number.isNaN(heading) ? heading : null,
      speed: typeof speed === "number" && !Number.isNaN(speed) ? speed : null,
    };
  } catch {
    return null;
  }
};

/**
 * Follow the phone closely, for navigating by.
 *
 * Every fix is passed on as it arrives rather than on a beat, because the
 * countdown to a turn has to be right at the turn, not up to six seconds
 * stale. Returns a function that stops it.
 */
export const watchDriving = (
  onFix: (fix: Fix) => void,
  onRefused?: () => void
): (() => void) => {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onRefused?.();
    return () => {};
  }
  const watch = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, heading, speed } = position.coords;
      onFix({
        lat: latitude,
        lng: longitude,
        heading: typeof heading === "number" && !Number.isNaN(heading) ? heading : null,
        speed: typeof speed === "number" && !Number.isNaN(speed) ? speed : null,
      });
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) onRefused?.();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
  return () => navigator.geolocation.clearWatch(watch);
};
