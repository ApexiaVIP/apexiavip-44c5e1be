/**
 * An hourly hire, where the passenger says where they are going.
 *
 * The chauffeur does not know the destination when the job starts, and there
 * may be several over an afternoon: a meeting, then lunch, then home. The
 * passenger tells them, they put it into the Apexia sat nav, and that is what
 * puts the address on the record for the office and for accounts.
 *
 * The loop is always the same. Aboard, a destination, drive, arrive, wait
 * while the passenger is inside, aboard again, the next destination.
 */

export interface Logged {
  kind: string;
  place: string;
  recorded_at: string;
  booking_reference: string;
  lat?: number | null;
  lng?: number | null;
}

/** A leg is over once the chauffeur has pulled up and is waiting. */
const SPENT_BY = ["waiting", "clear", "set_down"];

/**
 * Where this job is heading right now, if the passenger has said.
 *
 * A destination is spent the moment the chauffeur waits at it, so coming back
 * aboard asks for the next one rather than driving to the place they are
 * already standing outside.
 */
export const destinationNow = (logged: Logged[], reference: string): Logged | null => {
  const mine = logged
    .filter((w) => w.booking_reference === reference)
    .slice()
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));

  let heading: Logged | null = null;
  for (const entry of mine) {
    if (entry.kind === "destination") heading = entry;
    else if (SPENT_BY.includes(entry.kind)) heading = null;

  }
  return heading;
};

/**
 * Whether the chauffeur can be asked where the passenger wants to go.
 *
 * The passenger says it as they open the door, which is while the job still
 * reads "arrived". Asking only once they had been marked aboard meant the one
 * box that takes the address was not on the screen at the moment the address
 * was spoken, so there was nowhere to put it.
 *
 * Before arriving there is nobody in the car to ask, and once the job is
 * cleared it is over, so neither offers the box.
 */
export const canSayWhere = (status: string | null | undefined): boolean =>
  status === "arrived" || status === "pob" || status === "waiting";

/** Every address this job was actually driven to, in order, for the office. */
export const everyDestination = (logged: Logged[], reference: string): string[] =>
  logged
    .filter((w) => w.booking_reference === reference && w.kind === "destination")
    .slice()
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))
    .map((w) => w.place)
    .filter(Boolean);

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/**
 * A recorded destination broken back into parts the sat nav can use.
 *
 * It is written as street, town, postcode, so the postcode is the last part
 * when there is one. Some places Google knows have no postcode at all, and
 * those are still worth recording for the office even though the car cannot
 * be navigated to them.
 */
export const placeFrom = (
  recorded: string
): { line1: string; town: string; postcode: string } => {
  const parts = recorded
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const postcode = UK_POSTCODE.test(last) ? parts.pop()! : "";
  return { line1: parts[0] ?? "", town: parts.slice(1).join(", "), postcode };
};
