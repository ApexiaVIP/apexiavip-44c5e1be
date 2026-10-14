/**
 * Whether the scheduled work is actually happening.
 *
 * On 14 October 2026 three scheduled functions answered 401 on every run for
 * at least six hours. pg_cron reported each run as succeeded, because it only
 * knows the request was sent, and nothing anywhere recorded a success. The
 * outage surfaced when somebody happened to mention that the back office had
 * never received a timesheet.
 *
 * So this endpoint exists to be asked, from outside, whether each job has
 * reported in lately. Two things matter about it:
 *
 *   It shares no secret with the jobs it watches. The three of them gate on
 *   matching the service role key, which is exactly what drifted, so a fourth
 *   function behind the same gate would have gone down with them and the
 *   alarm would have been as silent as the fault.
 *
 *   It needs no authentication at all. It reveals nothing but our own job
 *   names and when they last ran, and anything that must be unlocked to be
 *   read is something an uptime monitor cannot watch.
 *
 * 503 when anything is overdue, so a monitor that understands nothing but
 * status codes still raises the alarm.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * How long each job may stay quiet before something is wrong.
 *
 * Generous against its schedule, because the alarm has to mean something when
 * it sounds. booking-watch runs every five minutes, so twenty is four missed
 * runs in a row. The weekly sheet has a day's grace on top of its week.
 */
const EXPECTED: Record<string, { everyMinutes: number; what: string }> = {
  "booking-watch": { everyMinutes: 20, what: "Status checks and passenger texts" },
  "driver-timesheets:cleared": { everyMinutes: 40, what: "Job reports to the back office" },
  "driver-timesheets:daily": { everyMinutes: 60 * 26, what: "The nightly wrap up" },
  "driver-timesheets:weekly": { everyMinutes: 60 * 24 * 8, what: "The weekly fleet summary" },
  "fixtures-sync": { everyMinutes: 60 * 24 * 8, what: "The fixture calendar" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await admin
      .from("job_heartbeats")
      .select("job, last_success_at");
    if (error) throw error;

    const seen = new Map(
      (data ?? []).map((r) => [r.job as string, r.last_success_at as string])
    );
    const now = Date.now();

    const jobs = Object.entries(EXPECTED).map(([job, { everyMinutes, what }]) => {
      const last = seen.get(job);
      const ageMinutes = last ? Math.round((now - Date.parse(last)) / 60000) : null;
      return {
        job,
        what,
        lastSuccessAt: last ?? null,
        ageMinutes,
        expectedWithinMinutes: everyMinutes,
        // Never having reported is as bad as having stopped, and is what a
        // newly deployed job looks like until its first run completes
        overdue: ageMinutes === null || ageMinutes > everyMinutes,
      };
    });

    const overdue = jobs.filter((j) => j.overdue);
    return json(overdue.length === 0 ? 200 : 503, {
      ok: overdue.length === 0,
      checkedAt: new Date(now).toISOString(),
      summary:
        overdue.length === 0
          ? "Every scheduled job has reported in"
          : `Not running: ${overdue.map((j) => j.job).join(", ")}`,
      jobs,
    });
  } catch (error) {
    console.error("health error:", error);
    // Unable to answer is itself a fault worth waking somebody for
    return json(503, { ok: false, summary: "Could not read the job heartbeats" });
  }
});
