/**
 * Which membership an application from an existing member belongs to.
 *
 * Used to preselect a row in the admin's picker, never to file anything on
 * its own. The email address is the only thing that identifies somebody for
 * certain, so it is tried first; a matching name is a hint, and a name shared
 * by two members is exactly the case where nobody should be preselected.
 */
export interface Applicant {
  full_name?: string | null;
  email?: string | null;
}

export interface Candidate {
  id: string;
  full_name?: string | null;
  email?: string | null;
}

const tidy = (value?: string | null) => (value ?? "").trim().toLowerCase();

export const guessMember = (applicant: Applicant, people: Candidate[]): string => {
  const email = tidy(applicant.email);
  const byEmail = email ? people.find((m) => tidy(m.email) === email) : undefined;
  if (byEmail) return byEmail.id;

  const name = tidy(applicant.full_name);
  const named = name ? people.filter((m) => tidy(m.full_name) === name) : [];
  return named.length === 1 ? named[0].id : "";
};

/** Everybody whose name, email or number contains what was typed */
export const matchMembers = <T extends Candidate & { phone?: string | null }>(
  people: T[],
  search: string,
): T[] => {
  const term = search.trim().toLowerCase();
  if (!term) return people;
  return people.filter((m) =>
    `${m.full_name ?? ""} ${m.email ?? ""} ${m.phone ?? ""}`.toLowerCase().includes(term),
  );
};
