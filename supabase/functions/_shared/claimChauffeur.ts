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
}

interface ChauffeurRow {
  id: string;
  full_name: string | null;
  phone: string | null;
}

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
  if (named.length === 0) return 0;

  try {
    const admin = adminClient();
    const references = named.map((a) => a.Reference as string);

    const { data: held } = await admin
      .from("bookings")
      .select("reference, driver_id")
      .in("reference", references)
      .returns<HeldRow[]>();

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
    if (claims.length === 0) return 0;

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
    return claims.length;
  } catch (e) {
    console.error("chauffeur matching failed:", e);
    return 0;
  }
};
