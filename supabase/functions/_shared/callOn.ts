/**
 * What the office is told when a chauffeur says they are up.
 *
 * The desk asked to hear it as it happens rather than watch a screen for it.
 * Kept apart from the sending so the words can be tested, because this is
 * read at six in the morning by somebody deciding whether to ring round.
 *
 * "Up" and "signed on" are not the same thing and have been confused before:
 * a chauffeur can be awake and answering while no timesheet is running, and
 * that is worth saying rather than leaving the office to assume.
 */
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

/** What the office is told when a chauffeur says they are up for the day. */
export interface UpAndRunning {
  chauffeur: string;
  /** When their shift began. There is no being up without it. */
  signedOnAt: string | null;
  /** What they have on today, so the desk can see it is covered. */
  jobsToday: { reference: string; passenger: string; collectionAt: string | null }[];
}

export const upAndRunningNotice = (
  answer: UpAndRunning
): { subject: string; lines: string[] } => {
  const who = answer.chauffeur.trim() || "A chauffeur";
  const subject = `${who} is up and signed on`;

  const lines = [`${who} is up and running.`];
  lines.push(
    answer.signedOnAt
      ? `Signed on at ${uk(answer.signedOnAt)}.`
      : "Not signed on, so no timesheet is running for them yet."
  );

  if (answer.jobsToday.length === 0) {
    lines.push("Nothing on their screen yet.");
    return { subject, lines };
  }
  lines.push(
    answer.jobsToday.length === 1 ? "One job on their screen:" : `${answer.jobsToday.length} jobs on their screen:`
  );
  for (const job of answer.jobsToday) {
    const at = uk(job.collectionAt);
    const passenger = job.passenger.trim();
    lines.push(
      [job.reference, passenger, at].filter(Boolean).join(" · ")
    );
  }
  return { subject, lines };
};
