/**
 * What the office is told when a chauffeur answers a call on.
 *
 * The desk asked to hear it as it happens rather than watch a screen for it.
 * Kept apart from the sending so the words can be tested, because this is
 * read at six in the morning by somebody deciding whether to ring round.
 *
 * "Up" and "signed on" are not the same thing and have been confused before:
 * a chauffeur can be awake and answering while no timesheet is running, and
 * that is worth saying rather than leaving the office to assume.
 */
export interface CallOnAnswer {
  chauffeur: string;
  reference: string;
  passenger: string;
  collectionAt: string | null;
  /** When their shift began, or null if they are not signed on */
  signedOnAt: string | null;
}

const uk = (iso: string | null): string => {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
};

export const callOnNotice = (answer: CallOnAnswer): { subject: string; lines: string[] } => {
  const who = answer.chauffeur.trim() || "A chauffeur";
  const subject = answer.signedOnAt ? `${who} is up and signed on` : `${who} is up, not signed on`;

  const lines = [`${who} has answered the call on for ${answer.reference}.`];
  if (answer.passenger.trim()) lines.push(`Passenger: ${answer.passenger.trim()}`);
  const collection = uk(answer.collectionAt);
  if (collection) lines.push(`Collection: ${collection}`);
  lines.push(
    answer.signedOnAt
      ? `Signed on at ${uk(answer.signedOnAt)}.`
      : "Not signed on, so no timesheet is running for them yet."
  );
  return { subject, lines };
};
