import { Capacitor } from "@capacitor/core";

export const APP_STORE_URL = "https://apps.apple.com/gb/app/apexia-vip/id6799735654";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.apexiavip.app";

/** Short link used in texts and emails; resolves to /app on the site. */
export const GET_APP_URL = "https://apexiavip.com/app";

export type AppPlatform = "ios" | "android" | "web";

/**
 * Where this code is running. "ios" and "android" mean one of the store apps:
 * the Capacitor shell on iPhone, or the Android app, which is the site itself
 * opened as a trusted web activity (it reports standalone display mode and an
 * android-app:// referrer).
 */
export const detectPlatform = (): AppPlatform => {
  if (typeof window === "undefined") return "web";

  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === "android" ? "android" : "ios";
  }

  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const fromAndroidApp = document.referrer.startsWith("android-app://");
  if (fromAndroidApp || (standalone && /android/i.test(navigator.userAgent))) {
    return "android";
  }

  return "web";
};

/** True when we are already inside one of the store apps. */
export const isInstalledApp = () => detectPlatform() !== "web";

/** The store this visitor's phone can install from, if we can tell. */
export const storeForDevice = (): "ios" | "android" | null => {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return null;
};
