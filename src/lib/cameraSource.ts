/**
 * Where the cameras come from.
 *
 * They ship inside the app as one small file rather than being fetched per
 * drive. A chauffeur most needs to be told about a camera on the roads where
 * the signal drops, so a warning that depends on a live request is a warning
 * that is missing when it counts. Three and a half thousand cameras pack into
 * well under a hundred kilobytes, which is less than one of our own photographs.
 *
 * The data is OpenStreetMap's, under the ODbL, and the credit for it sits on
 * the drive screen where the cameras are drawn.
 */

import type { Box, SpeedCamera } from "@/lib/speedCameras";

/** Where the packed file sits, served by the app itself. */
const FILE = "/speed-cameras.json";

/** Rows are [lat, lng, kind, limit, direction], scaled to integers. */
type Packed = [number, number, number, number, number];

export interface CameraFile {
  source?: string;
  at?: string;
  cameras?: Packed[];
}

/** Degrees are held as hundred thousandths, which is a metre on the ground. */
const SCALE = 1e5;

/**
 * Turn the packed rows into cameras.
 *
 * Anything malformed is dropped rather than thrown over: a bad row in a data
 * file should cost one camera, not the whole warning system.
 */
export const unpack = (file: unknown): SpeedCamera[] => {
  const rows = (file as CameraFile)?.cameras;
  if (!Array.isArray(rows)) return [];
  const out: SpeedCamera[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const [lat, lng, kind, limit, direction] = row;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    out.push({
      id: `${lat}:${lng}`,
      lat: lat / SCALE,
      lng: lng / SCALE,
      kind: kind === 1 ? "average" : "fixed",
      limitMph: typeof limit === "number" && limit > 0 ? limit : null,
      direction: typeof direction === "number" && direction >= 0 ? direction : null,
    });
  }
  return out;
};

export const inBox = (c: SpeedCamera, box: Box): boolean =>
  c.lat >= box.south && c.lat <= box.north && c.lng >= box.west && c.lng <= box.east;

/**
 * The whole file, read once and kept.
 *
 * Held as the promise rather than the result, so two drives starting together
 * share one request instead of racing each other to fetch the same file.
 */
let held: Promise<SpeedCamera[]> | null = null;

export const allCameras = (): Promise<SpeedCamera[]> => {
  if (!held) {
    held = fetch(FILE)
      .then((r) => (r.ok ? r.json() : null))
      .then(unpack)
      .catch((err) => {
        // No cameras is a quieter screen, not a broken one. Clearing the hold
        // lets the next drive try again, in case this was the tunnel
        console.error("cameras: could not be read", err);
        held = null;
        return [];
      });
  }
  return held;
};

/** The cameras inside a rectangle of road. */
export const camerasIn = async (box: Box | null): Promise<SpeedCamera[]> => {
  if (!box) return [];
  const all = await allCameras();
  return all.filter((c) => inBox(c, box));
};

/** Only for the tests, which must not inherit one another's fetches. */
export const forgetCameras = (): void => {
  held = null;
};
