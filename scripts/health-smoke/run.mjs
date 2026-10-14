/**
 * Whether the alarm sounds.
 *
 * The outage this endpoint exists for was invisible because everything
 * reported success. So the thing worth testing is that it reports failure:
 * a job that has stopped, and a job that has never once run.
 *
 *   npm run test:health
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "health-")), "h.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "..", "supabase", "functions", "health", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "stub-server.ts") }));
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "stub-supabase.ts") }));
    },
  }],
});

globalThis.Deno = { env: { get: () => "x" } };
await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

let bad = 0;
const is = (what, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${ok ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
};

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

const ALL_JOBS = [
  "booking-watch",
  "driver-timesheets:cleared",
  "driver-timesheets:daily",
  "driver-timesheets:weekly",
  "fixtures-sync",
];

const ask = async (rows) => {
  globalThis.__tables = { job_heartbeats: rows };
  const res = await handler(new Request("https://x/health"));
  return { status: res.status, body: await res.json() };
};

const allFresh = ALL_JOBS.map((job) => ({ job, last_success_at: minsAgo(1) }));

// Everything reporting in
let r = await ask(allFresh);
is("all jobs fresh answers 200", r.status, 200);
is("and says so", r.body.ok, true);
is("with a plain summary", r.body.summary, "Every scheduled job has reported in");

// The exact outage this was built for: the sweep stops, everything else fine
r = await ask(allFresh.map((h) => h.job === "booking-watch" ? { ...h, last_success_at: minsAgo(45) } : h));
is("a sweep that stopped 45 minutes ago answers 503", r.status, 503);
is("and is not ok", r.body.ok, false);
is("and names the job", r.body.summary.includes("booking-watch"), true);
is("and nothing else is blamed", r.body.jobs.filter((j) => j.overdue).length, 1);

// Four missed runs is the threshold; one is not
r = await ask(allFresh.map((h) => h.job === "booking-watch" ? { ...h, last_success_at: minsAgo(6) } : h));
is("a single missed sweep is not an alarm", r.status, 200);

// A job that has never run at all, which is also how a new deploy looks
r = await ask(allFresh.filter((h) => h.job !== "driver-timesheets:daily"));
is("a job that has never reported is overdue", r.status, 503);
is("and is named", r.body.summary.includes("driver-timesheets:daily"), true);
const never = r.body.jobs.find((j) => j.job === "driver-timesheets:daily");
is("with no age rather than a wrong one", never.ageMinutes, null);
is("and no last success", never.lastSuccessAt, null);

// The nightly sheet has a day's grace, so an evening with nobody working is fine
r = await ask(allFresh.map((h) => h.job === "driver-timesheets:daily" ? { ...h, last_success_at: minsAgo(60 * 25) } : h));
is("a wrap up 25 hours ago is still within grace", r.status, 200);
r = await ask(allFresh.map((h) => h.job === "driver-timesheets:daily" ? { ...h, last_success_at: minsAgo(60 * 27) } : h));
is("but a missed night is an alarm", r.status, 503);

// Empty table: nothing has ever run
r = await ask([]);
is("no heartbeats at all is an alarm", r.status, 503);
is("and every job is named", ALL_JOBS.every((j) => r.body.summary.includes(j)), true);

// Unable to answer must not read as healthy
globalThis.__readFails = true;
r = await ask(allFresh);
is("a database it cannot read is an alarm, not a pass", r.status, 503);
is("and it says why", r.body.summary, "Could not read the job heartbeats");
globalThis.__readFails = false;

console.log(bad === 0 ? "\nthe alarm sounds when it should" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
