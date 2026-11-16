import { useState } from "react";
import ArrivalTime from "@/components/ArrivalTime";
import TrackMap from "@/components/TrackMap";
import type { Place } from "@/lib/navigation";
import type { RoutePoint } from "@/lib/trackMarker";

interface Props {
  reference: string;
  pickup: Place;
  dropoff: Place;
  asDirected: boolean;
  driverStatus: string | null;
  driverLat: number;
  driverLng: number;
  positionAt: string | null;
  etaAt: string | null;
  pickupPostcode?: string;
}

/**
 * When the car is due, and where it is.
 *
 * These two were side by side and knew nothing of each other, which cost the
 * map the one thing it was missing. Working out the arrival time means
 * routing the car to where it is going, so the road is already in hand here;
 * the map only ever had two positions a minute apart to guess a direction
 * from. Holding them together hands the road over at no cost.
 */
const LiveCar = ({ pickupPostcode, ...journey }: Props) => {
  const [road, setRoad] = useState<RoutePoint[] | null>(null);

  return (
    <>
      <ArrivalTime {...journey} onRoute={setRoad} />
      <TrackMap
        lat={journey.driverLat}
        lng={journey.driverLng}
        pickupPostcode={pickupPostcode}
        route={road}
      />
    </>
  );
};

export default LiveCar;
