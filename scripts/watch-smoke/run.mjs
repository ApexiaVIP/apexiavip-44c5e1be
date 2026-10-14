/**
 * Telling a passenger their chauffeur is confirmed.
 *
 * The case this exists for: the passenger opens their bookings before the
 * watcher's next run, their app records the new status, and the watcher then
 * sees nothing to do. They lose their own confirmation by being keen.
 *
 *   npm run test:watch
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "watch-")), "fn.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "..", "supabase", "functions", "booking-watch", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "stub-server.ts") }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "stub-supabase.ts") }));
  }}],
});

const KEY = "svc";
globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY,
  DISPATCH_TRANSFER_REFERENCE: "REF",
  TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15550001111",
})[k] } };

let dispatchStatus = "Dispatched";
const texts = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("deversoftware")) {
    return Response.json({ Result: [{ Bookings: [{
      Reference: "APEXIA-1", BookingStatus: dispatchStatus,
      Driver: { Name: "Faz Hussain" }, Vehicle: { Description: "S-Class", Registration: "AB12 CDE" },
    }] }] });
  }
  if (u.includes("api.twilio.com")) {
    texts.push(new URLSearchParams(init.body).get("Body"));
    return Response.json({ sid: "SM1" });
  }
  throw new Error("unexpected fetch " + u);
};

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

const run = async (booking) => {
  texts.length = 0;
  globalThis.__tables = {
    bookings: [{
      reference: "APEXIA-1", user_id: null, corporate: null, name: "A Member",
      phone: "+447700900123", collection_at: new Date(Date.now() + 3600e3).toISOString(),
      vehicle: "S-Class", subject_to_availability: false, driver_moment: null,
      ...booking,
    }],
    profiles: booking.__profiles ?? [], corporate_passengers: [],
  };
  const res = await handler(new Request("https://x/booking-watch", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: "{}",
  }));
  return { status: res.status, payload: await res.json(), texts: [...texts] };
};

let bad = 0;
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
};

// The bug: the member's own app had already written the new status
let r = await run({ status: "Dispatched", notified_status: null });
is("a passenger whose app recorded the change is still told", r.texts.length, 1);
is("and the message names their chauffeur", r.texts[0]?.includes("Faz Hussain"), true);

// The ordinary case, where we see the change first
r = await run({ status: "Pending", notified_status: null });
is("a change we see first is told as well", r.texts.length, 1);

// Having told them, we do not tell them again
r = await run({ status: "Dispatched", notified_status: "Dispatched" });
is("the same status is never texted twice", r.texts.length, 0);

// The chauffeur's own app already said they were on the way
dispatchStatus = "On Route";
r = await run({ status: "On Route", notified_status: null, driver_moment: "onroute" });
is("the chauffeur's app having said it stops us repeating it", r.texts.length, 0);

// A status worth nothing to a passenger
dispatchStatus = "Passenger On Board";
r = await run({ status: "Passenger On Board", notified_status: null });
is("a status a passenger gains nothing from is not texted", r.texts.length, 0);

// Cancellation still reaches them
dispatchStatus = "Cancelled";
r = await run({ status: "Cancelled", notified_status: null });
is("a cancellation is always told", r.texts.length, 1);

// The follow link only appears once the chauffeur is on the way
dispatchStatus = "On Route";

// A travel desk assistant works in the partner portal, not the member app
r = await run({
  status: "Pending", notified_status: null, corporate: "mcfc",
  user_id: "assistant-1", name: "A Guest",
  __profiles: [{ id: "assistant-1", phone: "+447700900999" }],
});
is("a desk booking links to the partner portal", r.texts[0]?.includes("mcfc.apexiavip.com"), true);
is("and not to the members' page", r.texts[0]?.includes("www.apexiavip.com/bookings"), false);

r = await run({ status: "Pending", notified_status: null, corporate: null });
is("a member booking still links to their own bookings", r.texts[0]?.includes("www.apexiavip.com/bookings"), true);

console.log(bad === 0 ? "\na confirmation reaches the passenger" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
