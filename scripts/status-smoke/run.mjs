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

globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  DISPATCH_TRANSFER_REFERENCE: "REF",
})[k] } };

// Which references Dispatch was asked about, and what it chose to answer
let asked = [];
let dispatchHttp = 200;
let answerFor = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("deversoftware")) {
    asked = JSON.parse(init.body).Bookings.map((b) => b.Reference);
    if (dispatchHttp !== 200) {
      return new Response("Too many requests. Please wait 30 seconds.", { status: dispatchHttp });
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
is("a refused request answers 502", r.status, 502);
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

console.log(bad === 0 ? "\nevery booking asked about is recorded as asked" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
