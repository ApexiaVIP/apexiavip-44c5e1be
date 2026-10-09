/**
 * Smoke test for the chauffeur timesheet emails.
 *
 * These go to the back office and feed pay, so the figures and the wording are
 * checked here rather than in anyone's inbox. Nothing is sent: the Resend call
 * is intercepted and the emails are inspected.
 *
 *   npm run test:timesheets
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fn = join(here, "..", "..", "supabase", "functions", "driver-timesheets", "index.ts");
const out = join(await mkdtemp(join(tmpdir(), "timesheet-smoke-")), "fn.mjs");

const SERVICE_KEY = "service-role-key";
const DAY = "2026-10-06"; // a Tuesday, during British Summer Time

// 09:00 UK on the day is 08:00 UTC while the clocks are forward
const uk = (hhmm) => `${DAY}T${String(Number(hhmm.slice(0, 2)) - 1).padStart(2, "0")}:${hhmm.slice(3)}:00.000Z`;

globalThis.__tables = {
  profiles: [
    { id: "driver-1", full_name: "Faz Hussain", phone: "+447700900111" },
    { id: "driver-2", full_name: "Arshad Khan", phone: "+447700900222" },
    { id: "driver-3", full_name: "Nobody Worked", phone: "+447700900333" },
  ],
  driver_shifts: [
    { driver_id: "driver-1", started_at: uk("07:00"), ended_at: uk("15:30") },
    // Left on duty: the sheet must say so rather than invent an end
    { driver_id: "driver-2", started_at: uk("11:19"), ended_at: null },
  ],
  bookings: [
    {
      driver_id: "driver-1", reference: "APEXIA-1", name: "A Passenger", collection_at: uk("09:00"),
      pickup: { line1: "1 Deansgate", town: "Manchester", postcode: "M3 2AA" },
      dropoff: { line1: "Terminal 2", town: "Manchester", postcode: "M90 1QX" },
      journey_type: "destination", as_directed_hours: null, vehicle: "S-Class",
      driver_status: "clear", corporate: null,
    },
    {
      driver_id: "driver-1", reference: "APEXIA-2", name: "Another Passenger", collection_at: uk("13:00"),
      pickup: { line1: "Spinningfields", town: "Manchester", postcode: "M3 3AQ" },
      dropoff: null, journey_type: "hourly", as_directed_hours: 3, vehicle: "Range Rover",
      driver_status: "pob", corporate: "Manchester City",
    },
    {
      driver_id: "driver-1", reference: "APEXIA-DONE", name: "Cleared Passenger",
      collection_at: uk("16:00"),
      pickup: { line1: "Deansgate", town: "Manchester", postcode: "M3 2AA" },
      dropoff: { line1: "Hale", town: "Altrincham", postcode: "WA15 9SA" },
      journey_type: "destination", as_directed_hours: null, vehicle: "S-Class",
      driver_status: "clear", corporate: null, notes: "",
      driver_status_at: new Date(Date.now() - 45 * 60000).toISOString(),
    },
    {
      driver_id: "driver-2", reference: "APEXIA-3", name: "Third Passenger", collection_at: uk("12:00"),
      pickup: { line1: "Piccadilly", town: "Manchester", postcode: "M1 2AP" },
      dropoff: { line1: "Hale", town: "Altrincham", postcode: "WA15 9SA" },
      journey_type: "destination", as_directed_hours: null, vehicle: "Viano",
      driver_status: null, corporate: null,
    },
  ],
  timesheet_runs: [],
  booking_waypoints: [
    { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "en_route", place: "", note: "", recorded_at: uk("08:40") },
    { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "arrived", place: "", note: "", recorded_at: uk("08:55") },
    { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "pob", place: "", note: "", recorded_at: uk("09:02") },
    { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "clear", place: "Terminal 2, M90 1QX", note: "", recorded_at: uk("09:48") },
    { driver_id: "driver-1", booking_reference: "APEXIA-2", kind: "waiting", place: "Spinningfields, M3 3AQ", note: "", recorded_at: uk("14:10") },
    { driver_id: "driver-1", booking_reference: "APEXIA-DONE", kind: "en_route", place: "", note: "", recorded_at: uk("15:40") },
    { driver_id: "driver-1", booking_reference: "APEXIA-DONE", kind: "clear", place: "Hale, WA15 9SA", note: "Blanket from the boot, and a takeaway for the passenger, 24.50", recorded_at: uk("16:55") },
  ],
};

await esbuild.build({
  entryPoints: [fn], bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{
    name: "deno-stubs",
    setup(build) {
      build.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ },
        () => ({ path: join(here, "stub-server.ts") }));
      build.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ },
        () => ({ path: join(here, "stub-supabase.ts") }));
    },
  }],
});

globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, RESEND_API_KEY: "test-key" })[k] },
};

const outbox = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) {
    outbox.push(JSON.parse(init.body));
    return Response.json({ id: "email-1" });
  }
  throw new Error(`unexpected fetch: ${url}`);
};

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

const call = async (body, key = SERVICE_KEY) => {
  outbox.length = 0;
  const res = await handler(new Request("https://example.test/driver-timesheets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  }));
  return { status: res.status, payload: await res.json(), sent: [...outbox] };
};

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
};

// Nobody but the scheduled job may run this
const stranger = await call({ mode: "daily", date: DAY }, "not-the-key");
check("a caller without the service key is refused", stranger.status === 401);

const daily = await call({ mode: "daily", date: DAY });
check("one email per chauffeur who worked, and none for the one who did not", daily.sent.length === 2, `sent ${daily.sent.length}`);
check("all of it goes to the back office", daily.sent.every((e) => e.to[0] === "accounts@apexiavip.com"));

const faz = daily.sent.find((e) => e.subject.includes("Faz"));
const arshad = daily.sent.find((e) => e.subject.includes("Arshad"));
check("the subject names the chauffeur and the day", !!faz && faz.subject.includes("Tuesday 6 October"), faz?.subject);
check("a full shift is counted correctly", !!faz && faz.html.includes("8h 30m"), "07:00 to 15:30 is 8h 30m");
check("sign on and sign off times appear", !!faz && faz.html.includes("07:00") && faz.html.includes("15:30"));
check("jobs are counted and cleared jobs separated", !!faz && faz.html.includes("3 assigned, 2 cleared"));
check("the history of each step is listed", !!faz && faz.html.includes("En route") && faz.html.includes("Cleared"));
check("where a job was cleared is recorded", !!faz && faz.html.includes("Terminal 2, M90 1QX"));
check("an as directed hire is described as one", !!faz && faz.html.includes("As directed, 3 hours"));
check("a job left part way through is flagged", !!faz && faz.html.includes("never cleared") && faz.html.includes("APEXIA-2"));
check("a chauffeur still on duty is not given an invented sign off", !!arshad && arshad.html.includes("still on duty"));
check("and that is flagged rather than left to be spotted", !!arshad && arshad.html.includes("Did not sign off"));
check("a job with no buttons pressed at all is flagged", !!arshad && arshad.html.includes("no buttons pressed"));
check("a corporate passenger shows the desk", !!faz && faz.html.includes("Manchester City"));

// --- A job finished: the office is told within the hour, for charging ---
const finished = await call({ mode: "cleared" });
check("a finished job is reported on its own", finished.sent.length >= 1, `sent ${finished.sent.length}`);
// The stub does not filter, so pick out the job we actually finished
const jobMail = finished.sent.find((e) => e.html.includes("APEXIA-DONE"));
check("the finished job is among them", !!jobMail);
check("it goes to the back office", jobMail?.to[0] === "accounts@apexiavip.com");
check("the subject flags that there is something to charge", jobMail?.subject.includes("TO CHARGE"), jobMail?.subject);
check("what the chauffeur laid out is spelled out", jobMail?.html.includes("takeaway for the passenger, 24.50"));
check("so is the chauffeur", jobMail?.html.includes("Faz Hussain"));
check("and the passenger", jobMail?.html.includes("Cleared Passenger"));
check("the job is marked as reported so it is not sent twice",
  (globalThis.__writes ?? []).some((w) => w.table === "bookings" && w.op === "update" && w.payload?.job_report_sent_at));

// --- The day's wrap up waits for the last chauffeur ---
globalThis.__writes.length = 0;
const early = await call({ mode: "daily" });
check("with someone still on duty, the wrap up holds", early.sent.length === 0, `sent ${early.sent.length}`);
check("and says why", String(early.payload.note).includes("still working"), early.payload.note);
check("and nothing is recorded as sent", !(globalThis.__writes ?? []).some((w) => w.table === "timesheet_runs"));

// Asking for a named day is someone asking on purpose, and is never held back
const forced = await call({ mode: "daily", date: DAY });
check("a named day is sent whatever else is happening", forced.sent.length === 2, `sent ${forced.sent.length}`);

const weekly = await call({ mode: "weekly", date: "2026-10-09" });
check("the weekly summary is a single email", weekly.sent.length === 1, `sent ${weekly.sent.length}`);
check("it says which week it covers", weekly.sent[0]?.subject.includes("week to Friday 9 October"), weekly.sent[0]?.subject);
check("both working chauffeurs appear", weekly.sent[0]?.html.includes("Faz Hussain") && weekly.sent[0]?.html.includes("Arshad Khan"));
check("the chauffeur who never worked is left out", !weekly.sent[0]?.html.includes("Nobody Worked"));
check("the week shows each day", weekly.sent[0]?.html.includes("Sat 3") && weekly.sent[0]?.html.includes("Fri 9"));
check("a fleet total is given", weekly.sent[0]?.html.includes("across the fleet"));

const quiet = await call({ mode: "daily", date: "2026-09-01" });
check("a day with activity still reports (filtering is the database's job)", quiet.payload.success === true);

console.log(bad === 0 ? "\nall checks passed" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
