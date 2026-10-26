import { Suspense, lazy, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import TrackMapRaster from "./TrackMapRaster";
import { googleMapsConfigured } from "@/lib/googleMaps";

export interface TrackMapProps {
  /** Driver position */
  lat: number;
  lng: number;
  /** Pickup postcode, used to place a destination marker */
  pickupPostcode?: string;
}

// Only fetched when a member actually opens a live map, so the booking
// screens are not carrying a map engine around for the sake of it
const TrackMapVector = lazy(() => import("./TrackMapVector"));
const TrackMapGoogle = lazy(() => import("./TrackMapGoogle"));

/** Can this device draw with WebGL? Without it the vector map cannot run. */
const canDrawVector = (): boolean => {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

const Waiting = () => (
  <div className="apx-map h-72 sm:h-80 w-full border border-border flex items-center justify-center">
    <Loader2 className="w-5 h-5 animate-spin text-champagne" />
  </div>
);

/**
 * The live chauffeur map.
 *
 * Google's where this build has the settings for it, which is the same map
 * the chauffeur is driving by, so a member comparing their screen with the
 * car sees one company rather than two different maps. Without those
 * settings, or if Google will not load, open vector tiles, which stay sharp
 * at any zoom and need no key. Dark raster tiles on a phone too old to draw
 * either.
 */
const TrackMap = (props: TrackMapProps) => {
  const vector = useMemo(canDrawVector, []);
  const google = useMemo(googleMapsConfigured, []);
  /** Set once Google has failed, so the fallback is not torn down and retried. */
  const [googleOut, setGoogleOut] = useState(false);

  if (!vector) return <TrackMapRaster {...props} />;

  if (google && !googleOut) {
    return (
      <Suspense fallback={<Waiting />}>
        <TrackMapGoogle {...props} onUnavailable={() => setGoogleOut(true)} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Waiting />}>
      <TrackMapVector {...props} />
    </Suspense>
  );
};

export default TrackMap;
