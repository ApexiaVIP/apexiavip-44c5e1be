/**
 * Smoke test for the booking edge function.
 *
 * The functions under supabase/functions are Deno, so the project's
 * typechecker never looks at them and a mistake like using a const before it
 * is declared reaches production and fails every booking. This bundles the
 * function for node, stubs the Deno runtime and the network, and drives the
 * real handler through every journey type plus the ways the outside world can
 * let us down. Run it before asking for a redeploy:
 *
 *   npm run test:booking
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fn = join(here, "..", "..", "supabase", "functions", "send-booking", "index.ts");
const out = join(await mkdtemp(join(tmpdir(), "booking-smoke-")), "fn.mjs");

await esbuild.build({
  entryPoints: [fn],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  plugins: [
    {
      name: "deno-stubs",
      setup(build) {
        build.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({
          path: join(here, "stub-server.ts"),
        }));
        build.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({
          path: join(here, "stub-supabase.ts"),
        }));
      },
    },
  ],
});

// Rows the stubbed database answers with. The stub applies the filters the
// function gives it, so these have to carry the columns it actually asks for.
globalThis.__tables = {
  mfa_sessions: [{ id: "mfa-1", session_id: "session-1" }],
  profiles: [
    { id: "user-1", status: "active", primary_member_id: null, full_name: "A Member", phone: "+447700900123" },
  ],
  rate_limits: [],
  bookings: [],
};

globalThis.Deno = {
  env: {
    get: (key) =>
      ({
        RESEND_API_KEY: "test-key",
        DISPATCH_TRANSFER_REFERENCE: "TESTREF",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      })[key],
  },
};

// The two outside services, each able to fail the way it fails in real life
const net = { dispatch: "ok", resend: "ok" };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("deversoftware")) {
    if (net.dispatch === "http500") return new Response("upstream error", { status: 500 });
    if (net.dispatch === "refused") {
      return Response.json({ Result: [{ TransferStatus: "Failed", Message: "Account not permitted" }] });
    }
    const refs = JSON.parse(init.body).Bookings.map((b) => b.Reference);
    return Response.json({
      Result: [
        {
          TransferStatus: "Success",
          Bookings: refs.map((reference, i) => ({ Reference: reference, Status: "Success", BookingId: 3000 + i })),
        },
      ],
    });
  }
  if (u.includes("api.resend.com")) {
    if (net.resend === "fail") {
      return new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 });
    }
    return Response.json({ id: "email-1" });
  }
  throw new Error(`The function reached an unexpected address: ${u}`);
};

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;
if (typeof handler !== "function") throw new Error("The function did not register a handler");

const token = `x.${Buffer.from(JSON.stringify({ session_id: "session-1" })).toString("base64url")}.y`;
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

// The app sends the typed wall clock alongside the instant, and the server
// now trusts the wall clock, so a fixture must keep the two in step or it is
// describing a booking no form could produce
const ukRaw = (iso) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g("day")}-${g("month")}-${g("year")} ${g("hour")}:${g("minute")}`;
};

const booking = (over = {}) => ({
  name: "Test Member",
  email: "member@example.com",
  phone: "+447700900123",
  travelDate: "10 October 2026",
  travelDateRaw: ukRaw(over.collectionAt ?? inHours(24)),
  collectionAt: inHours(24),
  vehicle: "S-Class",
  passengers: 2,
  bags: 1,
  pickupAddress: { line1: "1 Deansgate", town: "Manchester", postcode: "M3 2AA", country: "United Kingdom" },
  dropoffAddress: { line1: "Terminal 2", town: "Manchester", postcode: "M90 1QX", country: "United Kingdom" },
  journeyType: "destination",
  viaStops: [],
  notes: "",
  children: [],
  bookingType: "personal",
  ...over,
});

const cases = [
  ["a journey to a destination", booking(), {}, true],
  ["an as-directed hire of three hours", booking({ journeyType: "hourly", asDirectedHours: 3, dropoffAddress: undefined, collectionAt: inHours(4) }), {}, true],
  ["a journey with a return leg", booking({ returnJourney: true, returnTravelDate: "12 October 2026", returnCollectionAt: inHours(48) }), {}, true],
  ["the client's own car", booking({ journeyType: "client_car", vehicle: undefined, clientCar: { make_model: "Bentley Flying Spur", registration: "AB12CDE", client_travelling: true } }), {}, true],
  ["children, notes and business details", booking({ bookingType: "business", business: { company: "Example Ltd" }, children: [{ age: 3 }], notes: "Ring on arrival" }), {}, true],
  ["a journey with stops", booking({ viaStops: [{ line1: "Spinningfields", town: "Manchester", postcode: "M3 3AQ" }] }), {}, true],
  ["the booking system refusing the transfer", booking(), { dispatch: "refused" }, true],
  ["the booking system being down", booking(), { dispatch: "http500" }, true],
  ["the office email failing on a placed booking", booking(), { resend: "fail" }, true],
  ["a pickup inside the notice period", booking({ collectionAt: inHours(0.05) }), {}, false],
  ["an as-directed hire under the minimum", booking({ journeyType: "hourly", asDirectedHours: 1, dropoffAddress: undefined, collectionAt: inHours(4) }), {}, false],
];

let failures = 0;
for (const [label, body, flags, expectSuccess] of cases) {
  Object.assign(net, { dispatch: "ok", resend: "ok" }, flags);
  let line;
  try {
    const res = await handler(
      new Request("https://example.test/send-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
    );
    const payload = await res.json();
    const ok = payload.success === true;
    // A refusal is a pass when it is the refusal we intended; a 500 never is
    const pass = ok === expectSuccess && res.status !== 500;
    if (!pass) failures++;
    line = `${pass ? "ok  " : "FAIL"}  ${label}: HTTP ${res.status} ${JSON.stringify(payload).slice(0, 110)}`;
  } catch (err) {
    failures++;
    line = `FAIL  ${label}: threw ${err?.message ?? err}`;
  }
  console.log(line);
}

// --- A family member books on the account holder's account ---
globalThis.__tables.profiles = [
  { id: "user-1", status: "active", primary_member_id: "holder-1", full_name: "Aleena Hussain", phone: "+447483222299" },
  { id: "holder-1", status: "active", primary_member_id: null, full_name: "Faz Hussain", phone: "+447770995665" },
];
let familyMail = null;
const realFetch2 = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.resend.com")) familyMail = JSON.parse(init.body);
  return realFetch2(url, init);
};
Object.assign(net, { dispatch: "ok", resend: "ok" });
await handler(
  new Request("https://example.test/send-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(booking()),
  })
);
if (!(familyMail && familyMail.subject.includes("for Faz Hussain"))) failures++;
console.log(
  familyMail && familyMail.subject.includes("for Faz Hussain")
    ? "ok    the office is told whose account it is, in the subject"
    : "FAIL  the subject does not name the account holder"
);
if (!(familyMail && familyMail.html.includes("Faz Hussain") && familyMail.html.includes("+447770995665"))) failures++;
console.log(
  familyMail && familyMail.html.includes("Faz Hussain") && familyMail.html.includes("+447770995665")
    ? "ok    and in the booking itself"
    : "FAIL  the email does not name the account holder"
);

// --- A typed time means the time here, wherever the member is ---
globalThis.__tables.profiles = [
  { id: "user-1", status: "active", primary_member_id: null, full_name: "A Member", phone: "+447700900123" },
];
let stored = null;
const realFetch3 = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("deversoftware")) {
    stored = JSON.parse(init.body).Bookings[0];
  }
  return realFetch3(url, init);
};
Object.assign(net, { dispatch: "ok", resend: "ok" });
await handler(
  new Request("https://example.test/send-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(
      booking({
        // Summer, so a UK clock is an hour ahead of UTC
        travelDateRaw: "14-Jul-2027 05:30",
        travelDate: "14 July 2027",
        // What a phone in Dubai would have worked out, which is wrong
        collectionAt: "2027-07-14T01:30:00.000Z",
      })
    ),
  })
);
// The one this test just made, not the first of the day
const inserts = (globalThis.__writes ?? []).filter((w) => w.table === "bookings" && w.op === "insert");
const wrote = inserts[inserts.length - 1];
const row = Array.isArray(wrote?.payload) ? wrote.payload[0] : wrote?.payload;
if (row?.collection_at !== "2027-07-14T04:30:00.000Z") failures++;
console.log(
  row?.collection_at === "2027-07-14T04:30:00.000Z"
    ? "ok    a 05:30 pickup is stored as 04:30 UTC, not the phone's guess"
    : `FAIL  pickup stored as ${row?.collection_at}, wanted 2027-07-14T04:30:00.000Z`
);

console.log(`\n${cases.length + 3 - failures}/${cases.length + 3} passed`);
process.exit(failures > 0 ? 1 : 0);
