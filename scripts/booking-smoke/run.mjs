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

const booking = (over = {}) => ({
  name: "Test Member",
  email: "member@example.com",
  phone: "+447700900123",
  travelDate: "10 October 2026",
  travelDateRaw: "10-Oct-2026 14:00",
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

console.log(`\n${cases.length - failures}/${cases.length} passed`);
process.exit(failures > 0 ? 1 : 0);
