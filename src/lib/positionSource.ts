/**
 * Where position fixes come from.
 *
 * The browser's own geolocation stops the moment the page is not in front.
 * In a web page that is a sensible rule. In a chauffeur's hand it means the
 * passenger's map freezes the second the phone locks or the driver opens
 * anything else, and nothing on either screen says so. That is the whole
 * reason chauffeurs were kept inside the app rather than sent to a proper
 * sat nav: not preference, a limitation.
 *
 * On a phone, fixes come from the operating system instead, through a
 * watcher that keeps running while the app is in the background. iOS shows
 * the blue bar while it does, Android shows a notification, and both of those
 * are wanted: the chauffeur can see at a glance that the car is being shown
 * to the passenger, which is something they could never tell before.
 *
 * On the web, nothing changes.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

/**
 * The package ships type definitions and no JavaScript: the plugin is bound
 * to its native half by name, which is how Capacitor plugins without a web
 * implementation are meant to be wired. Registering costs nothing and does
 * not touch the device, so it is safe at module load in a browser. Calling
 * it there is not, which is what isNativePlatform guards below.
 */
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  "BackgroundGeolocation"
);

export interface Fix {
  lat: number;
  lng: number;
  /** Which way the car is pointing, where the phone can tell. */
  heading: number | null;
  /** Metres per second, where the phone can tell. */
  speed: number | null;
}

/** Why the fixes stopped, in the only two flavours worth telling apart. */
export type Refusal = "denied" | "unavailable";

const number = (v: unknown): number | null =>
  typeof v === "number" && !Number.isNaN(v) ? v : null;

/**
 * What the chauffeur sees while their position is being shared.
 *
 * Android requires a notification to keep the watcher alive and this is its
 * text. It is written for the driver, not for the operating system: it says
 * what is happening and why, so nobody turns it off thinking it is a stray
 * app draining the battery.
 */
const NOTICE = {
  backgroundTitle: "Apexia VIP",
  backgroundMessage: "Showing your passenger where the car is.",
};

const watchNative = (onFix: (fix: Fix) => void, onRefused?: (why: Refusal) => void) => {
  let id: string | null = null;
  let abandoned = false;

  BackgroundGeolocation.addWatcher(
    { ...NOTICE, requestPermissions: true, stale: false, distanceFilter: 0 },
    (position, error) => {
      if (error) {
        onRefused?.(error.code === "NOT_AUTHORIZED" ? "denied" : "unavailable");
        return;
      }
      if (!position) return;
      onFix({
        lat: position.latitude,
        lng: position.longitude,
        heading: number(position.bearing),
        speed: number(position.speed),
      });
    }
  )
    .then((made) => {
      // Stopped while the watcher was still being set up, which happens when
      // a chauffeur clears a job the moment it opens. Take it straight back
      // off, or it runs for the rest of the day with nobody listening.
      if (abandoned) return BackgroundGeolocation.removeWatcher({ id: made });
      id = made;
    })
    .catch(() => onRefused?.("unavailable"));

  return () => {
    abandoned = true;
    if (!id) return;
    const going = id;
    id = null;
    void BackgroundGeolocation.removeWatcher({ id: going });
  };
};

const watchBrowser = (onFix: (fix: Fix) => void, onRefused?: (why: Refusal) => void) => {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onRefused?.("unavailable");
    return () => {};
  }
  const watch = navigator.geolocation.watchPosition(
    ({ coords }) =>
      onFix({
        lat: coords.latitude,
        lng: coords.longitude,
        heading: number(coords.heading),
        speed: number(coords.speed),
      }),
    (err) => onRefused?.(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
  return () => navigator.geolocation.clearWatch(watch);
};

/**
 * Follow the phone. Returns a function that stops it.
 *
 * Every fix is passed on as it arrives rather than on a beat, because the
 * countdown to a turn has to be right at the turn.
 */
export const watchFixes = (
  onFix: (fix: Fix) => void,
  onRefused?: (why: Refusal) => void
): (() => void) =>
  Capacitor.isNativePlatform() ? watchNative(onFix, onRefused) : watchBrowser(onFix, onRefused);

/** Whether fixes will keep coming once the app is not the one on screen. */
export const survivesBackground = (): boolean => Capacitor.isNativePlatform();
