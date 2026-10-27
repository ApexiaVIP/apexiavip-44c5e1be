/**
 * The order of stops in a journey. A desk builds a job up as it happens:
 * collect, set down, collect again, set down again. These two rules keep the
 * run in that order and keep "where the car finishes" meaning the right stop
 * while the run is still half built.
 */

type StopType = "pickup" | "dropoff";

/** A stop, as far as ordering is concerned. */
interface Ordered {
  type: StopType;
}

/**
 * A new stop goes on the end, after everything already in the run. Added
 * before the final set down it reads as part of the leg that is already
 * finished, which is not what the desk meant when it pressed add. Anything
 * that does belong earlier can still be moved up with the arrows.
 */
export const appendStop = <T extends Ordered>(stops: T[], stop: T): T[] => [...stops, stop];

/**
 * Where the car finishes: the last set down in the run. A run being built up
 * can end on a collection, so this is not simply the final stop, and a
 * destination written into a collection would send the car to the wrong place.
 * -1 when the run does not end anywhere yet.
 */
export const lastSetDown = (stops: Ordered[]): number => {
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i].type === "dropoff") return i;
  }
  return -1;
};
