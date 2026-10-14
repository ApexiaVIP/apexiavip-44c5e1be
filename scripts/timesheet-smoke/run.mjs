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
    { id: "driver-1", full_name: "Faz Hussain", phone: "+447700900111", is_driver: true },
    { id: "driver-2", full_name: "Arshad Khan", phone: "+447700900222", is_driver: true },
    { id: "driver-3", full_name: "Nobody Worked", phone: "+447700900333", is_driver: true },
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
      driver_id: "driver-1", reference: "APEXIA-ANCIENT", name: "Last Week",
      collection_at: uk("09:00"), pickup: null, dropoff: null,
      journey_type: "destination", as_directed_hours: null, vehicle: "S-Class",
      driver_status: "clear", corporate: null, notes: "",
      driver_status_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
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
check("jobs are counted and cleared jobs separated", !!faz && faz.html.includes("4 assigned, 3 cleared"));
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
check("a job cleared days ago is not dredged up as new",
  !finished.sent.some((e) => e.html.includes("APEXIA-ANCIENT")));
check("it goes to the back office", jobMail?.to[0] === "accounts@apexiavip.com");
check("the subject flags that there is something to charge", jobMail?.subject.includes("TO CHARGE"), jobMail?.subject);
check("what the chauffeur laid out is spelled out", jobMail?.html.includes("takeaway for the passenger, 24.50"));
check("so is the chauffeur", jobMail?.html.includes("Faz Hussain"));
check("and the passenger", jobMail?.html.includes("Cleared Passenger"));
check("the job is marked as reported so it is not sent twice",
  (globalThis.__writes ?? []).some((w) => w.table === "bookings" && w.op === "update" && w.payload?.job_report_sent_at));

// --- The day's wrap up waits for the last chauffeur, but not for ever ---
// Somebody signed on two hours ago and has not signed off: they are out
// working, so the night waits for them.
const shiftsBefore = globalThis.__tables.driver_shifts;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
globalThis.__tables.driver_shifts = [
  { driver_id: "driver-1", started_at: uk("07:00"), ended_at: uk("15:30") },
  { driver_id: "driver-2", started_at: hoursAgo(2), ended_at: null },
];
globalThis.__writes.length = 0;
const early = await call({ mode: "daily" });
check("with someone still on duty, the wrap up holds", early.sent.length === 0, `sent ${early.sent.length}`);
check("and says why", String(early.payload.note).includes("still working"), early.payload.note);
check("and nothing is recorded as sent", !(globalThis.__writes ?? []).some((w) => w.table === "timesheet_runs"));

// A shift nobody ever closed is a forgotten sign off, not somebody working.
// It used to hold the wrap up open for every night after it, for everybody,
// which is why no timesheet had ever reached the back office.
const bookingsBefore = globalThis.__tables.bookings;
globalThis.__tables.driver_shifts = [
  { driver_id: "driver-1", started_at: uk("07:00"), ended_at: uk("15:30") },
  { driver_id: "driver-2", started_at: hoursAgo(30), ended_at: null },
];
globalThis.__writes.length = 0;
const stale = await call({ mode: "daily" });
check("a shift left open yesterday does not hold tonight", stale.sent.length > 0, `sent ${stale.sent.length}`);
check("and the night is recorded as sent",
  (globalThis.__writes ?? []).some((w) => w.table === "timesheet_runs"));

// A twenty hour day is not a forgotten sign off. Faz signs on before dawn and
// is still carrying guests at midnight: the night waits for him.
globalThis.__tables.bookings = [
  { driver_id: "driver-2", reference: "APEXIA-LATE", name: "Very Important",
    collection_at: uk("22:00"), pickup: null, dropoff: null, via: null, stops: null,
    journey_type: "hourly", as_directed_hours: 6, vehicle: "Viano",
    driver_status: "pob", corporate: "mcfc" },
];
globalThis.__writes.length = 0;
const longDay = await call({ mode: "daily" });
check("a chauffeur still carrying guests holds the night", longDay.sent.length === 0, `sent ${longDay.sent.length}`);
check("however long ago they signed on", String(longDay.payload.note).includes("still working"), longDay.payload.note);

globalThis.__tables.bookings = bookingsBefore;
globalThis.__tables.driver_shifts = shiftsBefore;

// Asking for a named day is someone asking on purpose, and is never held back
const forced = await call({ mode: "daily", date: DAY });
check("a named day is sent whatever else is happening", forced.sent.length === 2, `sent ${forced.sent.length}`);

// --- A chauffeur who forgot to sign off over a weekend ---
globalThis.__tables.driver_shifts = [
  // Started Friday, not closed until Sunday: the Saturday in between would
  // otherwise report a flat twenty four hours as though it were worked
  { driver_id: "driver-1", started_at: "2026-10-10T15:10:00.000Z", ended_at: "2026-10-12T08:48:00.000Z" },
];
const saturday = await call({ mode: "daily", date: "2026-10-11" });
const sat = saturday.sent.find((e) => e.subject.includes("Faz"));
check("a day inside a forgotten shift is not billed as 24 hours", !!sat && !sat.html.includes("24h 00m"), sat?.html.match(/>(\d+h [0-9]+m)</)?.[1]);
check("it is capped at the longest a shift can be", !!sat && sat.html.includes("14h 00m"));
check("and the office is told not to pay it blind", !!sat && sat.html.includes("not a day's work"));

// --- A job written up after the event, which is what Arshad did ---
globalThis.__tables.driver_shifts = [
  { driver_id: "driver-1", started_at: uk("07:00"), ended_at: uk("15:30") },
];
globalThis.__tables.booking_waypoints = [
  { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "en_route", place: "", note: "", recorded_at: uk("12:15") },
  { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "arrived", place: "", note: "", recorded_at: uk("12:15") },
  { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "pob", place: "", note: "", recorded_at: uk("12:15") },
];
const afterwards = await call({ mode: "daily", date: DAY });
const catchUp = afterwards.sent.find((e) => e.subject.includes("Faz"));
check("a job filled in all at once is called out", !!catchUp && catchUp.html.includes("written up afterwards"));
check("and the office is told the times are not real", !!catchUp && catchUp.html.includes("not when anything happened"));

// A job worked as it happened is left alone
globalThis.__tables.booking_waypoints = [
  { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "en_route", place: "", note: "", recorded_at: uk("08:40") },
  { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "arrived", place: "", note: "", recorded_at: uk("08:55") },
  { driver_id: "driver-1", booking_reference: "APEXIA-1", kind: "pob", place: "", note: "", recorded_at: uk("09:02") },
];
const properly = await call({ mode: "daily", date: DAY });
const normal = properly.sent.find((e) => e.subject.includes("Faz"));
check("a job worked as it happened is not accused", !!normal && !normal.html.includes("written up afterwards"));

const weekly = await call({ mode: "weekly", date: "2026-10-09" });
check("the weekly summary is a single email", weekly.sent.length === 1, `sent ${weekly.sent.length}`);
check("it says which week it covers", weekly.sent[0]?.subject.includes("week to Friday 9 October"), weekly.sent[0]?.subject);
check("both working chauffeurs appear", weekly.sent[0]?.html.includes("Faz Hussain") && weekly.sent[0]?.html.includes("Arshad Khan"));
check("the chauffeur who never worked is left out", !weekly.sent[0]?.html.includes("Nobody Worked"));
check("the week shows each day", weekly.sent[0]?.html.includes("Sat 3") && weekly.sent[0]?.html.includes("Fri 9"));
check("a fleet total is given", weekly.sent[0]?.html.includes("across the fleet"));

const quiet = await call({ mode: "daily", date: "2026-09-01" });
check("a day with activity still reports (filtering is the database's job)", quiet.payload.success === true);


// --- A shift never signed off must not bill fourteen hours a day for ever ---
// Arshad signed on on the 12th and never signed off. Reporting the 14th used
// to count him from midnight to midnight, capped at fourteen hours, and would
// have done so every day after that too.
globalThis.__tables.driver_shifts = [
  { driver_id: "driver-1", started_at: "2026-10-12T07:48:00.000Z", ended_at: null },
];
const laterDay = await call({ mode: "daily", date: "2026-10-14" });
const later = laterDay.sent.find((e) => e.subject.includes("Faz"));
check("a shift left open on an earlier day earns nothing later",
  !!later && later.html.includes(">0h<"), later?.html.match(/<strong[^>]*>([^<]+)<\/strong>/)?.[1]);
check("and it is not passed off as a capped day",
  !!later && !later.html.includes("not a day's work"));
check("but the office is told to close it",
  !!later && later.html.includes("never signed off"));

// The day it actually started is still reported, capped as before
const ownDay = await call({ mode: "daily", date: "2026-10-12" });
const own = ownDay.sent.find((e) => e.subject.includes("Faz"));
check("the day it began still reports its hours",
  !!own && own.html.includes("14h 00m"), own?.html.match(/>(\d+h [0-9]+m)</)?.[1]);

console.log(bad === 0 ? "\nall checks passed" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
