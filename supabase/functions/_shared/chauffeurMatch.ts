/**
 * Working out which chauffeur a job belongs to.
 *
 * Dispatch never tells us who one of our accounts is. It tells us a name and
 * a mobile number, and the mobile is the only thing both systems hold about
 * the same person. So a job reaches a chauffeur's screen when the number the
 * office typed into Dispatch matches the number on their profile here.
 *
 * This used to be done in one place, in the chauffeur's own screen, and that
 * was the whole trouble: Dispatch answers the same question for a passenger
 * watching their car and for the five minute sweep, and both threw the
 * chauffeur away. Whoever gets the answer now does the matching, so it no
 * longer matters who asked.
 */

/**
 * Two phone numbers are the same person if their last nine digits match.
 * Dispatch stores them however the office typed them: 07700 900123,
 * +447700900123, 44 7700 900123.
 */
export const phoneKey = (raw: string | null | undefined): string => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
};

/** A booking as Dispatch describes it, down to the part we match on. */
export interface DispatchAnswer {
  Reference?: string | null;
  Driver?: { Mobile?: string | null; Name?: string | null } | null;
  Vehicle?: { Registration?: string | null; Description?: string | null } | null;
}

/** One of our chauffeur accounts. */
export interface Chauffeur {
  id: string;
  full_name: string | null;
  phone: string | null;
}

/** A job that has been recognised as somebody's. */
export interface Claim {
  reference: string;
  driver_id: string;
  driver_name: string | null;
}

export interface Matched {
  claims: Claim[];
  /**
   * Allocated by Dispatch to somebody this platform cannot reach: no mobile
   * against the name, a number on nobody's profile, or a number on two. The
   * job is live and the chauffeur will never see it, so it is worth saying
   * out loud even though there is nowhere yet to say it but the log.
   */
  unreachable: { reference: string; name: string; why: string }[];
}

/**
 * Who each job belongs to.
 *
 * `held` is what we already have recorded against each reference, which is
 * both how a pointless write is avoided and how a job we do not hold is
 * left alone. Dispatch is believed over our own record, because the office
 * moving a job to another car is exactly the case the chauffeur must not be
 * the last to know about.
 */
export const matchChauffeurs = (
  answers: DispatchAnswer[],
  chauffeurs: Chauffeur[],
  held: Map<string, string | null>
): Matched => {
  const byNumber = new Map<string, Chauffeur>();
  const shared = new Set<string>();
  for (const person of chauffeurs) {
    const key = phoneKey(person.phone);
    if (!key) continue;
    // Two chauffeurs on one number is somebody's typing mistake. Guessing
    // between them would put a passenger in front of the wrong car.
    if (byNumber.has(key)) shared.add(key);
    byNumber.set(key, person);
  }

  const claims: Claim[] = [];
  const unreachable: Matched["unreachable"] = [];

  for (const answer of answers) {
    const reference = (answer?.Reference ?? "").trim();
    if (!reference || !held.has(reference)) continue;

    const name = (answer.Driver?.Name ?? "").trim();
    const key = phoneKey(answer.Driver?.Mobile);

    if (!key) {
      if (name) unreachable.push({ reference, name, why: "no mobile against the name" });
      continue;
    }
    if (shared.has(key)) {
      unreachable.push({ reference, name, why: "that number is on more than one profile" });
      continue;
    }
    const chauffeur = byNumber.get(key);
    if (!chauffeur) {
      if (name) unreachable.push({ reference, name, why: "that number is on no profile" });
      continue;
    }
    if (held.get(reference) === chauffeur.id) continue;

    claims.push({
      reference,
      driver_id: chauffeur.id,
      driver_name: name || chauffeur.full_name,
    });
  }

  return { claims, unreachable };
};
