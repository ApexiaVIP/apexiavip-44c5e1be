import TrackMapRaster from "./TrackMapRaster";

export interface TrackMapProps {
  /** Driver position */
  lat: number;
  lng: number;
  /** Pickup postcode, used to place a destination marker */
  pickupPostcode?: string;
}

/** Live chauffeur map for a booking card. */
const TrackMap = (props: TrackMapProps) => <TrackMapRaster {...props} />;

export default TrackMap;
