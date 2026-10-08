/**
 * When a journey stops being tracked.
 *
 * The case that matters most: an as-directed hire that runs over must keep
 * being tracked until the chauffeur clears it.
 *
 *   npm run test:live
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "live-")), "l.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "src", "lib", "bookingLive.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
});
const { stillRunning, effectiveStatus, chauffeurPosition } = await import(pathToFileURL(out).href);

const NOW = Date.parse("2026-10-08T20:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

let bad = 0;
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  (got ${got}, wanted ${want})`}`);
};

const hire = (hours, over) => ({
  status: "Requested", driver_status: "pob", journey_type: "hourly",
  as_directed_hours: hours, collection_at: hoursAgo(hours + over),
});

// The question Faz asked
is("a 3 hour hire, one hour over, still tracked", stillRunning(hire(3, 1), NOW), true);
is("a 3 hour hire, four hours over, still tracked", stillRunning(hire(3, 4), NOW), true);
is("a 12 hour hire, ten hours in, still tracked", stillRunning({ ...hire(12, 0), collection_at: hoursAgo(10) }, NOW), true);
is("a 12 hour hire, two hours over, still tracked", stillRunning(hire(12, 2), NOW), true);

// The old rule would have dropped all of the above at six hours
const oldRule = (b) => new Date(b.collection_at).getTime() > NOW - 6 * 3600 * 1000;
is("the old rule dropped the 3 hour hire at four hours over", oldRule(hire(3, 4)), false);
is("the old rule dropped the 12 hour hire halfway", oldRule({ ...hire(12, 0), collection_at: hoursAgo(10) }), false);

// Clearing is what ends it
is("cleared, it stops", stillRunning({ ...hire(3, 1), driver_status: "clear" }, NOW), false);
is("cancelled, it stops", stillRunning({ ...hire(3, 1), driver_status: null, status: "Cancelled" }, NOW), false);

// A chauffeur working Dispatch rather than our app
is("Dispatch says on board, still tracked past the old cutoff", stillRunning(
  { status: "Passenger on board", driver_status: null, journey_type: "hourly", as_directed_hours: 3, collection_at: hoursAgo(9) }, NOW), true);

// Ordinary journeys keep the behaviour they had
is("an ordinary journey an hour ago is live", stillRunning({ status: "Requested", collection_at: hoursAgo(1) }, NOW), true);
is("an ordinary journey five hours ago is live", stillRunning({ status: "Requested", collection_at: hoursAgo(5) }, NOW), true);
is("an ordinary journey seven hours ago is not", stillRunning({ status: "Requested", collection_at: hoursAgo(7) }, NOW), false);
is("a booking with no time is live", stillRunning({ status: "Requested", collection_at: null }, NOW), true);

// Nothing runs forever, however a status sticks
is("a job left on board for two days is let go", stillRunning(
  { status: "Requested", driver_status: "pob", collection_at: hoursAgo(48) }, NOW), false);
is("a 12 hour hire left on board is let go eventually", stillRunning(
  { ...hire(12, 0), collection_at: hoursAgo(60) }, NOW), false);
is("but not before its own hours are up", stillRunning({ ...hire(12, 5) }, NOW), true);

is("the chauffeur's word beats a stale Dispatch status", effectiveStatus(
  { status: "Dispatched", driver_status: "pob" }, "Dispatched"), "Passenger on board");

// --- Where the car is drawn ---
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const dispatch = { latitude: "53.4000", longitude: "-2.9000" };
const ours = (m) => ({ driver_lat: 53.48, driver_lng: -2.24, driver_position_at: minsAgo(m) });

is("a fresh position of ours is used", chauffeurPosition(ours(0.5), dispatch, NOW).fromOurApp, true);
is("and it is our coordinates", chauffeurPosition(ours(0.5), dispatch, NOW).lat, 53.48);
is("a stale one of ours gives way to Dispatch", chauffeurPosition(ours(30), dispatch, NOW).fromOurApp, false);
is("with Dispatch's coordinates", chauffeurPosition(ours(30), dispatch, NOW).lat, 53.4);
is("a stale one of ours still beats nothing", chauffeurPosition(ours(30), null, NOW).fromOurApp, true);
is("Dispatch alone is used when we have none", chauffeurPosition({}, dispatch, NOW).fromOurApp, false);
is("nothing anywhere draws nothing", chauffeurPosition({}, null, NOW), null);
is("a half written position is ignored", chauffeurPosition({ driver_lat: 53.48, driver_position_at: minsAgo(0.1) }, dispatch, NOW).fromOurApp, false);
is("the age of ours is reported", Math.round(chauffeurPosition(ours(1), dispatch, NOW).ageMs / 1000), 60);

console.log(bad === 0 ? "\nposition source chosen correctly" : `\n${bad} FAILED`);
console.log(bad === 0 ? "\ntracking and position source hold" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
