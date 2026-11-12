/**
 * Leaving for another app, without stranding anybody who has not got it.
 *
 * A link into an app's own scheme is the only form that reliably carries a
 * destination, but it fails silently: on a phone without that app the
 * operating system does nothing at all, with no error and no app, and the
 * chauffeur is left looking at a button that did not work. There is no way to
 * ask the phone beforehand whether the app is there.
 *
 * So the app is tried first and the web link follows, but only if we are
 * still on screen a moment later. Where the app did open, this phone is
 * already in Waze and the follow-up never fires.
 */

/** Long enough for the operating system to switch apps, short enough to feel broken otherwise. */
const AFTER_MS = 1500;

export interface HandOff {
  go: (url: string) => void;
  /** Whether this app is still the one in front, meaning nothing opened. */
  stillHere: () => boolean;
}

const byPhone: HandOff = {
  go: (url) => {
    window.location.href = url;
  },
  stillHere: () => document.visibilityState === "visible" && document.hasFocus(),
};

/** Returns a way to call off the follow-up, for a screen that goes away. */
export const handOffTo = (
  appLink: string,
  webLink: string | null,
  how: HandOff = byPhone
): (() => void) => {
  how.go(appLink);
  if (!webLink) return () => {};
  const timer = setTimeout(() => {
    if (how.stillHere()) how.go(webLink);
  }, AFTER_MS);
  return () => clearTimeout(timer);
};
