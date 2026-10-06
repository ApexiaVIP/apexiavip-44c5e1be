/**
 * The chauffeur's marker, shared by both map implementations.
 *
 * Positions arrive from Dispatch every few seconds at best, so a marker that
 * jumps between them reads as a broken map. The car is walked to each new
 * position instead, and pointed the way it is travelling, which is what makes
 * the difference between "is this working?" and a live map.
 */

/** How long the car takes to glide to a newly reported position. */
export const GLIDE_MS = 1200;

/** Below this many metres a new fix is GPS noise, not a change of direction. */
const HEADING_THRESHOLD_M = 8;

export const CAR_SVG = `
<svg viewBox="0 0 28 28" width="30" height="30" aria-hidden="true">
  <path d="M14 2.6c2.1 0 3.6 1.7 4 4l.6 3.4c.3 1.7.4 3.4.4 5.1v5.2c0 1.3-.5 2.4-1.4 3l-.8.5a1 1 0 0 1-.6.2h-4.4a1 1 0 0 1-.6-.2l-.8-.5c-.9-.6-1.4-1.7-1.4-3v-5.2c0-1.7.1-3.4.4-5.1l.6-3.4c.4-2.3 1.9-4 4-4Z" fill="#c2a468"/>
  <path d="M11.5 7.3h5l.5 2.6a11 11 0 0 0-6 0Z" fill="#17140f"/>
  <path d="M11.2 19.2a13 13 0 0 0 5.6 0l-.3 1.9a12 12 0 0 1-5 0Z" fill="#17140f" opacity="0.85"/>
  <rect x="8.2" y="10.3" width="1.6" height="1.3" rx="0.65" fill="#c2a468"/>
  <rect x="18.2" y="10.3" width="1.6" height="1.3" rx="0.65" fill="#c2a468"/>
</svg>`;

/** The marker element: an outer box the map positions, an inner box we turn. */
export const carElement = (): HTMLDivElement => {
  const el = document.createElement("div");
  el.style.width = "30px";
  el.style.height = "30px";
  el.innerHTML =
    `<div class="apx-car" style="width:30px;height:30px;transform:rotate(0deg);` +
    `transform-origin:50% 50%;filter:drop-shadow(0 0 7px rgba(194,164,104,0.7))">${CAR_SVG}</div>`;
  return el;
};

export const pickupElement = (): HTMLDivElement => {
  const el = document.createElement("div");
  el.style.width = "14px";
  el.style.height = "14px";
  el.innerHTML =
    '<div style="width:14px;height:14px;border-radius:50%;background:rgba(194,164,104,0.18);' +
    'border:2px solid #c2a468;box-shadow:0 0 0 4px rgba(194,164,104,0.12)"></div>';
  return el;
};

/** Metres between two points, near enough for deciding whether the car moved. */
export const metresBetween = (
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number => {
  const toRad = Math.PI / 180;
  const R = 6371000;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Which way the car is pointing, as degrees clockwise from north. */
export const bearing = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const toRad = Math.PI / 180;
  const y = Math.sin((bLng - aLng) * toRad) * Math.cos(bLat * toRad);
  const x =
    Math.cos(aLat * toRad) * Math.sin(bLat * toRad) -
    Math.sin(aLat * toRad) * Math.cos(bLat * toRad) * Math.cos((bLng - aLng) * toRad);
  return (Math.atan2(y, x) / toRad + 360) % 360;
};

export const shouldTurn = (metres: number) => metres > HEADING_THRESHOLD_M;

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Where the pickup postcode sits, so the map can frame both ends. */
export const lookUpPostcode = async (
  postcode: string
): Promise<{ lat: number; lng: number } | null> => {
  try {
    const res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s/g, ""))}`
    );
    if (!res.ok) return null;
    const body = await res.json();
    const result = body?.result;
    if (typeof result?.latitude !== "number") return null;
    return { lat: result.latitude, lng: result.longitude };
  } catch {
    return null;
  }
};
