import { Suspense, lazy, useMemo } from "react";
import { Loader2 } from "lucide-react";
import TrackMapRaster from "./TrackMapRaster";

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

/** Can this device draw with WebGL? Without it the vector map cannot run. */
const canDrawVector = (): boolean => {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

/**
 * The live chauffeur map: vector where the phone can draw it, which stays
 * sharp at any zoom and pinches smoothly, and dark raster tiles on anything
 * that cannot.
 */
const TrackMap = (props: TrackMapProps) => {
  const vector = useMemo(canDrawVector, []);
  if (!vector) return <TrackMapRaster {...props} />;
  return (
    <Suspense
      fallback={
        <div className="apx-map h-72 sm:h-80 w-full border border-border flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-champagne" />
        </div>
      }
    >
      <TrackMapVector {...props} />
    </Suspense>
  );
};

export default TrackMap;
