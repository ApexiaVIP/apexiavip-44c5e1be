/**
 * Asking Dispatch where a car is, on the member's behalf.
 *
 * The case that matters: Dispatch refuses a second check on a booking inside
 * thirty seconds and refuses the WHOLE request when it does. The five minute
 * sweep avoids that by stepping around anything recently checked, which it
 * reads from status_checked_at. So this function has to record every booking
 * it asks about, including the ones Dispatch says nothing about, or the sweep
 * is blind to them and loses entire runs.
 *
 *   npm run test:status
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "status-")), "s.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "..", "supabase", "functions", "booking-status", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "stub-server.ts") }));
      b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "stub-supabase.ts") }));
    },
  }],
});

// Read live, so a test can change what is configured between calls
const env = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  DISPATCH_TRANSFER_REFERENCE: "REF",
};
globalThis.Deno = { env: { get: (k) => env[k] } };

// Which references Dispatch was asked about, and what it chose to answer
let asked = [];
let sentAuth = "";
let lastUrl = "";
let dispatchHttp = 200;
let answerFor = [];
// Set to a message to have Dispatch refuse the whole request, the way it does:
// HTTP 200, CheckStatus Failed, no bookings
let refuseWith = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("deversoftware")) {
    lastUrl = u;
    asked = JSON.parse(init.body).Bookings.map((b) => b.Reference);
    sentAuth = init.headers.Authorization;
    if (dispatchHttp !== 200) {
      return new Response("Too many requests. Please wait 30 seconds.", { status: dispatchHttp });
    }
    if (refuseWith) {
      return Response.json({ Result: [{ CheckStatus: "Failed", Message: refuseWith, Bookings: [] }] });
    }
    return Response.json({ Result: [{ Bookings: answerFor }] });
  }
  throw new Error("unexpected fetch " + u);
};

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `h.${b64url({ session_id: "sess-1" })}.sig`;

let bad = 0;
const is = (what, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${ok ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
};

globalThis.__user = { id: "member-1" };
globalThis.__admins = [];

const ask = async (references) => {
  asked = [];
  globalThis.__writes.length = 0;
  globalThis.__tables = {
    mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
    profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }],
    rate_limits: [],
    bookings: references.map((r) => ({
      reference: r, user_id: "member-1", corporate: null, name: "A Member",
    })),
  };
  const res = await handler(new Request("https://x/booking-status", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ references }),
  }));
  const stamps = (globalThis.__writes ?? []).filter(
    (w) => w.table === "bookings" && w.payload?.status_checked_at
  );
  return { status: res.status, body: await res.json(), stamps };
};

// Dispatch answers about one of the two: the other is the orphaned kind it no
// longer recognises, which is what happened to a real booking on 14 Oct.
answerFor = [{ Reference: "APEXIA-1", BookingStatus: "Dispatched", Driver: { Name: "A Chauffeur" } }];
let r = await ask(["APEXIA-1", "APEXIA-ORPHAN"]);

is("both bookings are asked about", asked.join(","), "APEXIA-1,APEXIA-ORPHAN");
is("only the one Dispatch knows comes back", r.body.statuses.length, 1);
is("and it carries the chauffeur", r.body.statuses[0].driver.name, "A Chauffeur");

// The point of the whole exercise: the orphan Dispatch said nothing about
// must still be recorded as asked, or the sweep cannot see it and loses runs.
const stamped = new Set(
  r.stamps.flatMap((w) =>
    (w.filters ?? []).flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value]))
  )
);
is("the booking Dispatch answered for is recorded as asked", stamped.has("APEXIA-1"), true);
is("and so is the one it said nothing about", stamped.has("APEXIA-ORPHAN"), true);
is("in a single write rather than one per booking", r.stamps.length, 1);

// A refusal is not a check, so it must leave no stamp: stamping it would have
// the sweep step around a booking nobody actually asked about
dispatchHttp = 429;
r = await ask(["APEXIA-1"]);
is("a request Dispatch told to wait still answers 200", r.status, 200);
is("and records no check", r.stamps.length, 0);
dispatchHttp = 200;

// Somebody else's booking is never asked about at all
globalThis.__tables = null;
answerFor = [];
const stranger = async () => {
  asked = [];
  globalThis.__writes.length = 0;
  globalThis.__tables = {
    mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
    profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }],
    rate_limits: [],
    bookings: [{ reference: "APEXIA-THEIRS", user_id: "someone-else", corporate: null, name: "Not Me" }],
  };
  const res = await handler(new Request("https://x/booking-status", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ references: ["APEXIA-THEIRS"] }),
  }));
  return { status: res.status, body: await res.json() };
};
const other = await stranger();
is("another member's booking returns nothing", other.body.statuses.length, 0);
is("and Dispatch is never asked about it", asked.length, 0);

// An admin switching to a client desk must still be told where that desk's
// cars are. Before the admin rule, a booking on the mcfc desk owned by a desk
// colleague came back as a bare { statuses: [] } to an admin tagged to no
// desk, and the desk screen showed allocated jobs as "Not yet assigned".
{
  const deskCheck = async () => {
    asked = [];
    globalThis.__writes.length = 0;
    globalThis.__tables = {
      mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
      profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }],
      rate_limits: [],
      bookings: [{ reference: "APEXIA-MCFC-1", user_id: "desk-user", corporate: "mcfc", name: "A Desk Passenger" }],
    };
    const res = await handler(new Request("https://x/booking-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ references: ["APEXIA-MCFC-1"] }),
    }));
    return { status: res.status, body: await res.json() };
  };
  answerFor = [{ Reference: "APEXIA-MCFC-1", BookingStatus: "Dispatched", Driver: { Name: "A Chauffeur" } }];

  globalThis.__admins = [];
  let d = await deskCheck();
  is("a non-admin on no desk is not asked about another desk's booking", asked.length, 0);
  is("and is told nothing about it", d.body.statuses?.length, 0);

  globalThis.__admins = ["member-1"];
  d = await deskCheck();
  is("an admin is asked about a client desk's booking", asked.join(","), "APEXIA-MCFC-1");
  is("and is told who the chauffeur is", d.body.statuses?.[0]?.driver?.name, "A Chauffeur");
  is("and the reply says which bookings were asked about", (d.body.asked ?? []).includes("APEXIA-MCFC-1"), true);

  globalThis.__admins = [];
  answerFor = [];
}

// Dispatch refuses the WHOLE request when any one booking in it was asked
// about inside thirty seconds, and says so as HTTP 200 with CheckStatus
// Failed. A screen refreshed just after the sweep used to lose every
// chauffeur name at once, and then kept them blank by stamping again. So a
// booking asked about moments ago is held back, and not re-stamped.
{
  const checkWith = async (checked) => {
    asked = [];
    globalThis.__writes.length = 0;
    globalThis.__tables = {
      mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
      profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }],
      rate_limits: [],
      bookings: Object.entries(checked).map(([reference, status_checked_at]) => ({
        reference, user_id: "member-1", corporate: null, name: "A Member", status_checked_at,
      })),
    };
    const res = await handler(new Request("https://x/booking-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ references: Object.keys(checked) }),
    }));
    const stamps = (globalThis.__writes ?? []).filter(
      (w) => w.table === "bookings" && w.payload?.status_checked_at
    );
    const stamped = new Set(
      stamps.flatMap((w) =>
        (w.filters ?? []).flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value]))
      )
    );
    return { status: res.status, body: await res.json(), stamped };
  };
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  answerFor = [
    { Reference: "APEXIA-JUST-ASKED", BookingStatus: "Dispatched", Driver: { Name: "First Chauffeur" } },
    { Reference: "APEXIA-NOT-ASKED", BookingStatus: "Dispatched", Driver: { Name: "Second Chauffeur" } },
  ];

  let h = await checkWith({ "APEXIA-JUST-ASKED": ago(5_000), "APEXIA-NOT-ASKED": null });
  is("a booking asked about 5 seconds ago is held back from Dispatch", asked.join(","), "APEXIA-NOT-ASKED");
  is("and comes back in the held list", (h.body.held ?? []).join(","), "APEXIA-JUST-ASKED");
  is("while the other still carries its chauffeur",
    h.body.statuses?.find((x) => x.reference === "APEXIA-NOT-ASKED")?.driver?.name, "Second Chauffeur");
  is("and the held booking is not re-stamped", h.stamped.has("APEXIA-JUST-ASKED"), false);

  h = await checkWith({ "APEXIA-JUST-ASKED": null, "APEXIA-NOT-ASKED": null });
  is("both are asked about when neither has ever been checked", asked.join(","), "APEXIA-JUST-ASKED,APEXIA-NOT-ASKED");

  h = await checkWith({ "APEXIA-JUST-ASKED": ago(35_000), "APEXIA-NOT-ASKED": null });
  is("a booking last asked 35 seconds ago is never held back", asked.join(","), "APEXIA-JUST-ASKED,APEXIA-NOT-ASKED");
  is("so nothing is held", (h.body.held ?? []).length, 0);

  answerFor = [];
}

// A booking held back from Dispatch used to come back with nothing at all, so
// every screen blanked its chauffeur until the next refresh. It now comes back
// from what we saved on the row, marked fromSaved so nobody mistakes it for a
// live answer, and a live answer always wins for a booking that was asked.
{
  const checkRows = async (rows) => {
    asked = [];
    globalThis.__writes.length = 0;
    globalThis.__tables = {
      mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
      profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }],
      rate_limits: [],
      bookings: rows.map((row) => ({ user_id: "member-1", corporate: null, name: "A Member", driver_id: null, ...row })),
    };
    const res = await handler(new Request("https://x/booking-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ references: rows.map((row) => row.reference) }),
    }));
    return { status: res.status, body: await res.json() };
  };
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  answerFor = [{ Reference: "APEXIA-ASKED", BookingStatus: "Dispatched", Driver: { Name: "Live Chauffeur" } }];

  let s = await checkRows([
    { reference: "APEXIA-HELD-NAMED", status_checked_at: ago(5_000), status: "Dispatched", driver_name: "Saved Chauffeur" },
    { reference: "APEXIA-HELD-BLANK", status_checked_at: ago(5_000), status: "Confirmed", driver_name: null },
    { reference: "APEXIA-ASKED", status_checked_at: null, status: "Dispatched", driver_name: "Old Saved Name" },
  ]);
  const by = (ref) => (s.body.statuses ?? []).filter((x) => x.reference === ref);
  is("only the booking not held back is asked about", asked.join(","), "APEXIA-ASKED");
  is("a held booking with a saved chauffeur comes back in statuses", by("APEXIA-HELD-NAMED").length, 1);
  is("carrying the saved chauffeur's name", by("APEXIA-HELD-NAMED")[0]?.driver?.name, "Saved Chauffeur");
  is("marked as a saved answer", by("APEXIA-HELD-NAMED")[0]?.fromSaved, true);
  is("with the status saved on the booking", by("APEXIA-HELD-NAMED")[0]?.status, "Dispatched");
  is("and no vehicle", by("APEXIA-HELD-NAMED")[0]?.vehicle, null);
  is("a held booking with no saved chauffeur is not dropped", by("APEXIA-HELD-BLANK").length, 1);
  is("it comes back with driver null", by("APEXIA-HELD-BLANK")[0]?.driver, null);
  is("the booking that was asked comes back once", by("APEXIA-ASKED").length, 1);
  is("carrying the live chauffeur, not the saved one", by("APEXIA-ASKED")[0]?.driver?.name, "Live Chauffeur");
  is("and is not marked as saved", by("APEXIA-ASKED")[0]?.fromSaved, undefined);

  // Everything held: Dispatch is not asked, and the saved answer still comes back
  s = await checkRows([
    { reference: "APEXIA-HELD-NAMED", status_checked_at: ago(5_000), status: "Dispatched", driver_name: "Saved Chauffeur" },
  ]);
  is("when every booking is held, Dispatch is not asked", asked.length, 0);
  is("and the held booking still carries its saved chauffeur", by("APEXIA-HELD-NAMED")[0]?.driver?.name, "Saved Chauffeur");

  answerFor = [];
}

// Being told to wait, or Dispatch falling over, is not knowing, and neither
// is a reason to wipe the screen. Every booking asked about comes back from
// what we saved, nothing is stamped (we got no answer, and a stamp would hold
// the next real attempt back), and the HTTP status reaches the logs and the
// reply so a wait can be told apart from an outage.
for (const code of [429, 500]) {
  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); realError(...args); };
  asked = [];
  globalThis.__writes.length = 0;
  globalThis.__tables = {
    mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
    profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }],
    rate_limits: [],
    bookings: [
      { reference: "APEXIA-WAIT-1", user_id: "member-1", corporate: null, name: "A Member", status_checked_at: null, status: "Dispatched", driver_id: null, driver_name: "Saved Chauffeur" },
      { reference: "APEXIA-WAIT-2", user_id: "member-1", corporate: null, name: "A Member", status_checked_at: null, status: "Confirmed", driver_id: null, driver_name: null },
    ],
  };
  dispatchHttp = code;
  const res = await handler(new Request("https://x/booking-status", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ references: ["APEXIA-WAIT-1", "APEXIA-WAIT-2"] }),
  }));
  const body = await res.json();
  dispatchHttp = 200;
  console.error = realError;
  const one = (ref) => (body.statuses ?? []).find((x) => x.reference === ref);
  const stamps = globalThis.__writes.filter((w) => w.table === "bookings" && w.payload?.status_checked_at);

  is(`HTTP ${code}: both bookings were asked about`, asked.join(","), "APEXIA-WAIT-1,APEXIA-WAIT-2");
  is(`HTTP ${code}: answers 200, not 502`, res.status, 200);
  is(`HTTP ${code}: an entry for every booking asked about`, (body.statuses ?? []).length, 2);
  is(`HTTP ${code}: carrying the saved chauffeur's name`, one("APEXIA-WAIT-1")?.driver?.name, "Saved Chauffeur");
  is(`HTTP ${code}: marked as a saved answer`, one("APEXIA-WAIT-1")?.fromSaved, true);
  is(`HTTP ${code}: with the saved status`, one("APEXIA-WAIT-1")?.status, "Dispatched");
  is(`HTTP ${code}: no saved chauffeur comes back as driver null`, one("APEXIA-WAIT-2")?.driver, null);
  is(`HTTP ${code}: and is still marked as saved`, one("APEXIA-WAIT-2")?.fromSaved, true);
  is(`HTTP ${code}: the reply says Failed`, body.dispatch?.checkStatus, "Failed");
  is(`HTTP ${code}: the reply's message carries the code`, String(body.dispatch?.message ?? "").includes(`(${code})`), true);
  is(`HTTP ${code}: nothing is stamped`, stamps.length, 0);
  is(`HTTP ${code}: the status reaches the logs`,
    errors.some((e) => e.startsWith(`Dispatch status HTTP ${code}`)), true);
}

// A hard refusal is the one case where we most certainly have no answer, so
// it must not be shown as one. Every booking asked about comes back from what
// we saved, marked fromSaved, and the refusal is still said out loud.
{
  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); realError(...args); };
  asked = [];
  globalThis.__writes.length = 0;
  globalThis.__tables = {
    mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
    profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }],
    rate_limits: [],
    bookings: [
      { reference: "APEXIA-REFUSED-1", user_id: "member-1", corporate: null, name: "A Member", status_checked_at: null, status: "Dispatched", driver_id: null, driver_name: "Saved Chauffeur" },
      { reference: "APEXIA-REFUSED-2", user_id: "member-1", corporate: null, name: "A Member", status_checked_at: null, status: "Confirmed", driver_id: null, driver_name: null },
    ],
  };
  refuseWith = "Too many requests. Please wait 30 seconds since the last status check for this booking.";
  const res = await handler(new Request("https://x/booking-status", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ references: ["APEXIA-REFUSED-1", "APEXIA-REFUSED-2"] }),
  }));
  const body = await res.json();
  refuseWith = null;
  console.error = realError;
  const one = (ref) => (body.statuses ?? []).find((x) => x.reference === ref);

  is("both bookings were asked about", asked.join(","), "APEXIA-REFUSED-1,APEXIA-REFUSED-2");
  is("a refused request still answers 200", res.status, 200);
  is("a refused request returns an entry for every booking asked about", (body.statuses ?? []).length, 2);
  is("carrying the saved chauffeur's name", one("APEXIA-REFUSED-1")?.driver?.name, "Saved Chauffeur");
  is("marked as a saved answer", one("APEXIA-REFUSED-1")?.fromSaved, true);
  is("with the status saved on the booking", one("APEXIA-REFUSED-1")?.status, "Dispatched");
  is("a refused booking with no saved chauffeur comes back with driver null", one("APEXIA-REFUSED-2")?.driver, null);
  is("and is still marked as saved", one("APEXIA-REFUSED-2")?.fromSaved, true);
  is("the reply still says Dispatch refused", body.dispatch?.checkStatus, "Failed");
  is("the refusal is still recorded in the logs",
    errors.some((e) => e.startsWith("Dispatch refused the status check:") && e.includes("APEXIA-REFUSED-1")), true);
}

// Dispatch's own chauffeurs are not profiles of ours, so they can never be
// handed a job here. Their name is still worth keeping, because it is the only
// thing a held booking can show. The name only: setting driver_id for a
// chauffeur we could not match would hand the job to the wrong person.
{
  answerFor = [
    { Reference: "APEXIA-T1", BookingStatus: "Dispatched", Driver: { Name: "Dispatch Own Chauffeur", Mobile: "07700 900999" } },
    { Reference: "APEXIA-T2", BookingStatus: "Dispatched", Driver: { Name: "Dispatch Own Chauffeur", Mobile: "07700 900999" } },
    { Reference: "APEXIA-T3", BookingStatus: "Dispatched", Driver: { Name: "No Mobile Chauffeur" } },
  ];
  await ask(["APEXIA-T1", "APEXIA-T2", "APEXIA-T3"]);
  const named = globalThis.__writes.filter(
    (w) => w.table === "bookings" && w.op === "update" && w.payload && "driver_name" in w.payload
  );
  const refsFor = (name) =>
    named
      .filter((w) => w.payload.driver_name === name)
      .flatMap((w) => (w.filters ?? []).flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value])))
      .sort()
      .join(",");
  is("a chauffeur whose number is on no profile has their name recorded", refsFor("Dispatch Own Chauffeur"), "APEXIA-T1,APEXIA-T2");
  is("in one write for both of their jobs", named.filter((w) => w.payload.driver_name === "Dispatch Own Chauffeur").length, 1);
  is("a chauffeur with no mobile has their name recorded too", refsFor("No Mobile Chauffeur"), "APEXIA-T3");
  is("and driver_id is never set for a chauffeur we could not match", named.some((w) => "driver_id" in w.payload), false);
  answerFor = [];
}

// The car's registration is the other half of what a screen shows, and it
// was never kept, so the moment Dispatch was silent, held back or could not
// find the booking, the desk read TBC. It is now saved whenever Dispatch
// names a vehicle, whoever is or is not driving it, and it never hands the
// job to anybody: driver_id is not part of that write.
{
  const run = async (rows, answers, extraProfiles = []) => {
    asked = [];
    answerFor = answers;
    globalThis.__writes.length = 0;
    globalThis.__tables = {
      mfa_sessions: [{ id: "s1", session_id: "sess-1" }],
      profiles: [{ id: "member-1", status: "active", corporate: null, corporate_groups: null }, ...extraProfiles],
      rate_limits: [],
      bookings: rows.map((row) => ({ user_id: "member-1", corporate: null, name: "A Member", driver_id: null, status_checked_at: null, ...row })),
    };
    const res = await handler(new Request("https://x/booking-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ references: rows.map((row) => row.reference) }),
    }));
    const body = await res.json();
    answerFor = [];
    const regWrites = globalThis.__writes.filter(
      (w) => w.table === "bookings" && w.op === "update" && w.payload && "vehicle_registration" in w.payload
    );
    const regFor = (reg) =>
      regWrites
        .filter((w) => w.payload.vehicle_registration === reg)
        .flatMap((w) => (w.filters ?? []).flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value])))
        .sort()
        .join(",");
    return { body, regWrites, regFor, writes: [...globalThis.__writes] };
  };
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  // Dispatch names a car with nobody on it yet
  let v = await run(
    [{ reference: "APEXIA-CAR-ONLY" }],
    [{ Reference: "APEXIA-CAR-ONLY", BookingStatus: "Confirmed", Vehicle: { Registration: "S40 APX", Description: "S-Class" } }]
  );
  is("a registration is saved when Dispatch names a vehicle with no driver", v.regFor("S40 APX"), "APEXIA-CAR-ONLY");
  is("and nothing at all writes driver_id when there is no driver",
    v.writes.some((w) => w.table === "bookings" && w.payload && "driver_id" in w.payload), false);

  // Dispatch's own chauffeur, whose number is on no profile of ours
  v = await run(
    [{ reference: "APEXIA-CAR-EXT" }],
    [{ Reference: "APEXIA-CAR-EXT", BookingStatus: "Dispatched", Driver: { Name: "Outside Chauffeur", Mobile: "07700 900888" }, Vehicle: { Registration: "V27 APX" } }]
  );
  is("a registration is saved when the chauffeur matches no profile", v.regFor("V27 APX"), "APEXIA-CAR-EXT");

  // A chauffeur who is one of ours: the hand-over writes driver_id, the
  // registration write must not carry it
  v = await run(
    [{ reference: "APEXIA-CAR-OURS" }],
    [{ Reference: "APEXIA-CAR-OURS", BookingStatus: "Dispatched", Driver: { Name: "Our Chauffeur", Mobile: "07700 900123" }, Vehicle: { Registration: "R1 APX" } }],
    [{ id: "driver-9", is_driver: true, full_name: "Our Chauffeur", phone: "+447700900123" }]
  );
  is("a registration is saved for one of our own chauffeurs too", v.regFor("R1 APX"), "APEXIA-CAR-OURS");
  is("driver_id is never set by the registration write", v.regWrites.some((w) => "driver_id" in w.payload), false);
  is("nor driver_name", v.regWrites.some((w) => "driver_name" in w.payload), false);

  // Nothing new to say: the registration already saved is not written again
  v = await run(
    [{ reference: "APEXIA-CAR-SAME", vehicle_registration: "S40 APX" }],
    [{ Reference: "APEXIA-CAR-SAME", BookingStatus: "Dispatched", Vehicle: { Registration: "S40 APX" } }]
  );
  is("an unchanged registration is not written again", v.regWrites.length, 0);

  // A booking we do not hold is left alone
  v = await run(
    [{ reference: "APEXIA-CAR-MINE" }],
    [{ Reference: "APEXIA-NOT-OURS", Vehicle: { Registration: "X1 APX" } }]
  );
  is("a registration for a booking we do not hold is not written", v.regWrites.length, 0);

  // Held back: answers from the saved registration
  v = await run(
    [{ reference: "APEXIA-CAR-HELD", status_checked_at: ago(5_000), status: "Dispatched", driver_name: "Irfan Siddiqui", vehicle_registration: "S40 APX" }],
    []
  );
  const held = (v.body.statuses ?? []).find((x) => x.reference === "APEXIA-CAR-HELD");
  is("a held booking returns the saved registration", held?.vehicle?.registration, "S40 APX");
  is("still marked as a saved answer", held?.fromSaved, true);

  // Asked, and Dispatch describes the car: the live answer wins
  v = await run(
    [{ reference: "APEXIA-CAR-LIVE", status: "Dispatched", driver_name: "Saved", vehicle_registration: "OLD APX" }],
    [{ Reference: "APEXIA-CAR-LIVE", BookingStatus: "Dispatched", Driver: { Name: "Live" }, Vehicle: { Registration: "NEW APX", Description: "S-Class" } }]
  );
  const live = (v.body.statuses ?? []).filter((x) => x.reference === "APEXIA-CAR-LIVE");
  is("the asked booking comes back once", live.length, 1);
  is("a live answer beats the saved registration", live[0]?.vehicle?.registration, "NEW APX");
  is("and is not marked as saved", live[0]?.fromSaved, undefined);

  // Dispatch refuses: the asked booking answers from the saved registration
  refuseWith = "Too many requests.";
  v = await run([{ reference: "APEXIA-CAR-REFUSED", status: "Pending", vehicle_registration: "S40 APX" }], []);
  refuseWith = null;
  is("a refused booking returns the saved registration",
    (v.body.statuses ?? []).find((x) => x.reference === "APEXIA-CAR-REFUSED")?.vehicle?.registration, "S40 APX");
}

/*
 * How we prove who we are to Dispatch.
 *
 * Dever moved the password from the transfer reference to a per company
 * transfer API key in October 2026, and still accept the old one for now. The
 * key is used the moment it is configured, and until then nothing changes.
 */
{
  await ask(["APEXIA-1"]);
  is("it signs in with the reference while no key is configured", sentAuth, `Basic ${Buffer.from("TRANSFERAPIUSER:REF").toString("base64")}`);

  env.DISPATCH_TRANSFER_API_KEY = "KEY-9";
  await ask(["APEXIA-1"]);
  is("it uses the transfer API key as soon as there is one", sentAuth, `Basic ${Buffer.from("TRANSFERAPIUSER:KEY-9").toString("base64")}`);
  is("and still addresses the company by its reference", lastUrl.includes("TransferToReference=REF"), true);
  delete env.DISPATCH_TRANSFER_API_KEY;
}

console.log(bad === 0 ? "\nevery booking asked about is recorded as asked" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
