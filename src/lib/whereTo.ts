/**
 * The passenger saying where they would like to go, from their own phone.
 *
 * On an hourly hire the destination only exists once it is spoken in the car,
 * and until now the chauffeur typed it while driving. On a booked journey it
 * is the passenger changing their mind on the way. Neither costs anything to
 * honour: the journey is invoiced on what was actually driven, so there is no
 * quote to redo and no reason to make the passenger ring the office.
 */

/**
 * The job states where there is a chauffeur to tell.
 *
 * Before the car sets off nobody is looking at the driver's screen and the
 * office still owns the journey, so a change then goes through the travel
 * team. Once the job is cleared it is over.
 */
const ON_THE_ROAD = ["en_route", "arrived", "pob", "waiting"];

export const canAskChauffeur = (
  driverStatus: string | null | undefined,
  status: string | null | undefined
): boolean => {
  if ((status ?? "").trim().toLowerCase() === "cancelled") return false;
  return ON_THE_ROAD.includes((driverStatus ?? "").trim());
};

/**
 * An address as it goes onto the record.
 *
 * Written the same way the chauffeur's own app writes it, street then town
 * then postcode, because the sat nav reads the postcode off the end of it.
 */
export const placeLine = (s: {
  line1?: string | null;
  town?: string | null;
  postcode?: string | null;
}): string =>
  [s.line1, s.town, s.postcode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
