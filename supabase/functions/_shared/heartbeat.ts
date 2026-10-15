/**
 * A scheduled job saying it finished, not merely that it was asked to run.
 *
 * pg_cron reports a run as succeeded once the request leaves, so a function
 * refusing every call looked healthy for hours. Writing this on completion
 * gives the health endpoint something to miss.
 *
 * It must never be the reason a job fails: a heartbeat that cannot be written
 * is worth a log line and nothing more.
 */
export interface HeartbeatWriter {
  from: (table: string) => {
    // The client hands back a builder that only settles when awaited, not a
    // Promise, so the value is left as whatever it is and awaited as such
    upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => unknown;
  };
}

export const recordHeartbeat = async (
  admin: HeartbeatWriter,
  job: string,
  detail?: Record<string, unknown>
): Promise<void> => {
  try {
    await admin.from("job_heartbeats").upsert(
      {
        job,
        last_success_at: new Date().toISOString(),
        detail: detail ?? null,
      },
      { onConflict: "job" }
    );
  } catch (error) {
    console.error("Could not record heartbeat for", job, error);
  }
};
