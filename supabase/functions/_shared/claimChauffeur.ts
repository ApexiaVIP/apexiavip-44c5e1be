import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchChauffeurs, type DispatchAnswer } from "./chauffeurMatch.ts";

/**
 * The client as it is actually built, not as the library defaults it.
 * ReturnType<typeof createClient> instantiates the default generics, which
 * type every table as never, so nothing read through it could be used.
 */
const adminClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

interface HeldRow {
  reference: string;
  driver_id: string | null;
  vehicle_registration: string | null;
  driver_mobile: string | null;
}

interface ChauffeurRow {
  id: string;
  full_name: string | null;
  phone: string | null;
}

/**
 * Keep the registration of the car Dispatch has put on each job, so a screen
 * held back from Dispatch, refused, or met with silence can still show it
 * rather than TBC. One write per registration. Only vehicle_registration is
 * written: a car is not a chauffeur and must never hand a job to anybody.
 */
const recordRegistrations = async (
  admin: ReturnType<typeof adminClient>,
  withCar: DispatchAnswer[],
  held: HeldRow[]
) => {
  const saved = new Map(held.map((row) => [row.reference, row.vehicle_registration]));
  const byRegistration = new Map<string, string[]>();
  for (const answer of withCar) {
    const reference = (answer.Reference ?? "").trim();
    const registration = (answer.Vehicle?.Registration ?? "").trim();
    if (!reference || !registration || !saved.has(reference)) continue;
    if (saved.get(reference) === registration) continue;
    const references = byRegistration.get(registration) ?? [];
    if (!references.includes(reference)) references.push(reference);
    byRegistration.set(registration, references);
  }
  for (const [registration, references] of byRegistration) {
    const { error } = await admin
      .from("bookings")
      .update({ vehicle_registration: registration })
      .in("reference", references);
    if (error) console.error("could not record vehicle registration", references.join(", "), error.message);
  }
};

/**
 * Keep the chauffeur's number Dispatch has given, for the same reason as the
 * registration: the match day schedule is printed before the jobs are
 * dispatched, and Dispatch sends no Driver object until they are. Held once,
 * the number is on the sheet whatever Dispatch says at the moment it is
 * printed.
 */
const recordMobiles = async (
  admin: ReturnType<typeof adminClient>,
  named: DispatchAnswer[],
  held: HeldRow[]
) => {
  const saved = new Map(held.map((row) => [row.reference, row.driver_mobile]));
  const byMobile = new Map<string, string[]>();
  for (const answer of named) {
    const reference = (answer.Reference ?? "").trim();
    const mobile = (answer.Driver?.Mobile ?? "").trim();
    if (!reference || !mobile || !saved.has(reference)) continue;
    if (saved.get(reference) === mobile) continue;
    const references = byMobile.get(mobile) ?? [];
    if (!references.includes(reference)) references.push(reference);
    byMobile.set(mobile, references);
  }
  for (const [mobile, references] of byMobile) {
    const { error } = await admin
      .from("bookings")
      .update({ driver_mobile: mobile })
      .in("reference", references);
    if (error) console.error("could not record chauffeur number", references.join(", "), error.message);
  }
};

/**
 * Put every job Dispatch has named a chauffeur on into that chauffeur's hands.
 *
 * Called by whoever happens to have asked Dispatch, because Dispatch will
 * only answer about a booking once every thirty seconds and there are three
 * of us asking. Before this, the passenger's own screen watching their car
 * was enough to keep a chauffeur from ever being given the job.
 *
 * Nothing here is allowed to fail the caller. The caller asked about a
 * booking's status and that answer is still good whatever happens in here.
 */
export const claimForChauffeurs = async (answers: DispatchAnswer[]): Promise<number> => {
  const named = (answers ?? []).filter(
    (a) => a?.Reference && (a.Driver?.Mobile || a.Driver?.Name)
  );
  // Dispatch can name a car with nobody on it yet, or with a chauffeur who is
  // none of ours, so the registration is its own question, not the driver's
  const withCar = (answers ?? []).filter(
    (a) => a?.Reference && (a.Vehicle?.Registration ?? "").trim()
  );
  if (named.length === 0 && withCar.length === 0) return 0;

  try {
    const admin = adminClient();
    const references = [
      ...new Set([...named, ...withCar].map((a) => (a.Reference as string).trim())),
    ];

    const { data: held } = await admin
      .from("bookings")
      .select("reference, driver_id, vehicle_registration, driver_mobile")
      .in("reference", references)
      .returns<HeldRow[]>();

    await recordRegistrations(admin, withCar, held ?? []);
    await recordMobiles(admin, named, held ?? []);
    if (named.length === 0) return 0;

    const { data: chauffeurs } = await admin
      .from("profiles")
      .select("id, full_name, phone")
      .eq("is_driver", true)
      .returns<ChauffeurRow[]>();

    const { claims, unreachable } = matchChauffeurs(
      named,
      chauffeurs ?? [],
      new Map((held ?? []).map((row) => [row.reference, row.driver_id]))
    );

    for (const job of unreachable) {
      console.error(
        `Dispatch allocated ${job.reference} to ${job.name || "a chauffeur"} but ${job.why}, so it reaches nobody`
      );
    }

    // One write per chauffeur rather than one per job: a chauffeur picking up
    // a day's work is the ordinary case, not the exception.
    const together = new Map<string, { name: string | null; references: string[] }>();
    for (const claim of claims) {
      const group = together.get(claim.driver_id) ?? { name: claim.driver_name, references: [] };
      group.references.push(claim.reference);
      together.set(claim.driver_id, group);
    }
    for (const [driverId, group] of together) {
      const { error } = await admin
        .from("bookings")
        .update({ driver_id: driverId, driver_name: group.name })
        .in("reference", group.references);
      if (error) console.error("could not hand over", group.references.join(", "), error.message);
    }

    // A chauffeur we cannot reach is still a chauffeur on the job, and for
    // the desk's work, driven by Dispatch's own drivers, it is the ordinary
    // case. Keep the name, because it is the only thing a screen held back
    // from Dispatch can show. The name only, never driver_id: a chauffeur we
    // could not match must not have the job handed to anybody.
    const namedOnly = new Map<string, string[]>();
    for (const job of unreachable) {
      if (!job.name) continue;
      const references = namedOnly.get(job.name) ?? [];
      references.push(job.reference);
      namedOnly.set(job.name, references);
    }
    for (const [name, references] of namedOnly) {
      const { error } = await admin
        .from("bookings")
        .update({ driver_name: name })
        .in("reference", references);
      if (error) console.error("could not record chauffeur name", references.join(", "), error.message);
    }
    return claims.length;
  } catch (e) {
    console.error("chauffeur matching failed:", e);
    return 0;
  }
};
