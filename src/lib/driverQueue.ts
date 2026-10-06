/**
 * Which job a chauffeur is working, and which are behind it.
 *
 * Only ever one job is workable at a time. A finished job drops out of the
 * queue for good: a refresh that has not caught up with the server must never
 * hand a cleared job back with its buttons live again.
 */
export interface QueueJob {
  reference: string;
  driver_status: string | null;
}

export const FINISHED = "clear";

export const splitJobs = <T extends QueueJob>(jobs: T[], clearedHere: string[] = []) => {
  const finished = (job: T) =>
    job.driver_status === FINISHED || clearedHere.includes(job.reference);
  const live = jobs.filter((j) => !finished(j));
  return {
    /** The only job the chauffeur may act on */
    current: live[0] ?? null,
    /** Visible, but not workable until its turn */
    queue: live.slice(1),
    done: jobs.filter(finished),
  };
};

/** Nothing can be pressed on a job that is not the one in hand. */
export const isWorkable = <T extends QueueJob>(
  job: T,
  jobs: T[],
  clearedHere: string[] = []
): boolean => splitJobs(jobs, clearedHere).current?.reference === job.reference;
