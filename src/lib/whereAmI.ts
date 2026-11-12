/**
 * Where the chauffeur is standing, in words the office can read.
 *
 * Used when a passenger is set down somewhere that was never on the booking,
 * and when a job is cleared. The position is taken from the phone and turned
 * into the nearest street and postcode, which the chauffeur can correct.
 */
import { watchFixes, type Fix } from "@/lib/positionSource";

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

/**
 * Somewhere a person would recognise, out of what the lookup gives back.
 *
 * It led on the parish, which in a city is the words "unparished area". A
 * chauffeur waiting by the Etihad had "Manchester, unparished area" written
 * against his job, which went to the office looking like a fault and told
 * nobody where the car was. The ward is the name people use, so a parish is
 * only taken when it is a real one, and the district catches the rest.
 */
export const placeName = (near: {
  parish?: string | null;
  admin_ward?: string | null;
  admin_district?: string | null;
  postcode?: string | null;
}): string => {
  const parish = (near.parish ?? "").trim();
  const real = parish && !/unparished/i.test(parish) ? parish : "";
  const area = real || (near.admin_ward ?? "").trim() || (near.admin_district ?? "").trim();
  return [area, (near.postcode ?? "").trim()].filter(Boolean).join(", ");
};

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
    return placeName(near);
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
 * Sending is tied to the fixes themselves, not to a timer, and that is the
 * whole thing. A backgrounded app keeps receiving fixes from the operating
 * system, because the native watcher calls into this code to deliver them,
 * but its timers are suspended the moment it is not the app on screen. So a
 * beat that sent the position stopped sending it the second the chauffeur
 * opened Waze: the fixes arrived and nobody posted them, and the passenger
 * watched a parked car while the chauffeur drove to them.
 *
 * The beat is still here, because a car sat at lights should keep the
 * arrival time fresh, and because a watch that goes quiet has to be noticed.
 * Both routes go through the same gate, so the rate is unchanged either way.
 * Returns a function that stops it.
 */
/** Past this with no fix, the car on the passenger's map has stopped moving. */
const REPORTING_STALE_MS = 90_000;

export const followPosition = (
  onFix: (lat: number, lng: number) => void,
  everyMs = 6000,
  /**
   * Called when the phone stops giving positions, and again with null once
   * it starts.
   *
   * This used to be swallowed on the grounds that a chauffeur hears about it
   * when they press Wait or Clear. That is the end of the job. In between, a
   * passenger watched a car sat still on Donkey Lane for eighteen minutes
   * and the chauffeur driving it had no idea anything was wrong.
   */
  onTrouble?: (why: string | null) => void
): (() => void) => {
  let latest: { lat: number; lng: number } | null = null;
  let lastAt = 0;
  let sentAt = 0;
  let troubled = false;

  /** At most one report per beat, wherever the prompt to send came from. */
  const send = () => {
    if (!latest) return;
    const now = Date.now();
    if (now - sentAt < everyMs) return;
    sentAt = now;
    onFix(latest.lat, latest.lng);
  };

  const trouble = (why: string | null) => {
    const now = why !== null;
    if (now === troubled) return;
    troubled = now;
    onTrouble?.(why);
  };

  const stopWatching = watchFixes(
    (position) => {
      latest = { lat: position.lat, lng: position.lng };
      lastAt = Date.now();
      trouble(null);
      send();
    },
    (why) =>
      trouble(
        why === "denied"
          ? "Location is off for this app, so your passenger cannot see the car."
          : "Your phone is not giving a position, so your passenger cannot see the car."
      )
  );

  const beat = setInterval(() => {
    // A watch that simply goes quiet raises no error at all. On a phone that
    // now means a tunnel or an underground car park, because the operating
    // system keeps the watcher alive in the background. In a browser it still
    // means the tab is not in front.
    if (!lastAt || Date.now() - lastAt > REPORTING_STALE_MS) {
      trouble("Your phone has stopped reporting where you are.");
      return;
    }
    send();
  }, everyMs);

  return () => {
    stopWatching();
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
export type { Fix } from "@/lib/positionSource";

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
): (() => void) =>
  watchFixes(onFix, (why) => {
    if (why === "denied") onRefused?.();
  });
