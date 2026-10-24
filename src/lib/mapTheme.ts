/**
 * Whether the driving map is drawn light or dark.
 *
 * Dark is right at five in the morning and wrong at midday, when a bright
 * windscreen makes a dark screen unreadable. A chauffeur should not have to
 * squint at it, so it starts on whatever their phone is set to and they can
 * flip it in one tap from the drive.
 */

export type MapTheme = "light" | "dark";

const REMEMBERED = "apx.drive.map";

/** What the phone itself is set to, which is usually already right. */
export const deviceTheme = (): MapTheme => {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
};

/**
 * The map the chauffeur gets.
 *
 * Their own choice if they have made one, otherwise the phone's, which on
 * most handsets already turns dark at night by itself.
 */
export const preferredMapTheme = (): MapTheme => {
  try {
    const held = localStorage.getItem(REMEMBERED);
    if (held === "light" || held === "dark") return held;


  } catch {
    // A phone that will not keep settings still gets a readable map
  }
  return deviceTheme();
};

export const rememberMapTheme = (theme: MapTheme): void => {
  try {
    localStorage.setItem(REMEMBERED, theme);
  } catch {
    /* nothing to be done, and nothing worth saying about it */
  }
};

export const otherTheme = (theme: MapTheme): MapTheme => (theme === "dark" ? "light" : "dark");

/** The open map's styles, which stand in when Google will not draw. */
export const openMapStyle = (theme: MapTheme): string =>
  theme === "light"
    ? "https://tiles.openfreemap.org/styles/positron"
    : "https://tiles.openfreemap.org/styles/dark";

/**
 * The route line, which has to be seen against whatever is underneath it.
 *
 * Champagne reads beautifully on a dark map and all but vanishes on a pale
 * one, so the light map gets a darker line and a pale casing instead.
 */
export const routeColours = (theme: MapTheme) =>
  theme === "light"
    ? { done: "#b9b2a4", casing: "#ffffff", line: "#8a7441" }
    : { done: "#534d41", casing: "#0b0a08", line: "#cdbb95" };
