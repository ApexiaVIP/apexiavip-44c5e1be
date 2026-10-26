/**
 * The applicant who is already a member.
 *
 * Somebody who already holds a membership fills in the website's enquiry
 * form. Approving would try to build a second membership on an email address
 * that already has one. Declining tells a real client we do not want them.
 * So the application sat in the queue with nothing the desk could safely do.
 *
 * This covers filing it against the membership it belongs to: what gets
 * filled in, what must never be overwritten, and what happens when there is
 * no membership to file it against.
 *
 *   npm run test:admin
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "admin-")), "fn.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "..", "supabase", "functions", "admin-users", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "stub-server.ts") }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "stub-supabase.ts") }));
  }}],
});

globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc",
}[k]) } };
globalThis.fetch = async () => Response.json({});

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

/** A token the function can read a session id out of, as a real one carries. */
const TOKEN = `x.${Buffer.from(JSON.stringify({ session_id: "s1" })).toString("base64url")}.y`;

const call = async (body) => {
  const res = await handler(new Request("https://x/admin-users", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

const APPLICATION = {
  id: "app-1",
  full_name: "Mike Jones",
  email: "Mike.Jones@Example.com",
  phone: "07700 900 123",
  address_line1: "12 Broad Walk",
  town: "Wilmslow",
  postcode: "SK9 5PJ",
  message: "Please call me about a standing Thursday run.",
  status: "new",
};

let failures = 0;
const ok = (what, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failures += 1;
  console.log(`${same ? "ok  " : "FAIL"}  ${what}${same ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};

/** A membership with nothing on it, so each test fills in only what it means to */
const MEMBER = {
  id: "u-mike",
  full_name: "Mike Jones",
  email: "mike.jones@example.com",
  phone: "",
  address_line1: "",
  address_line2: "",
  town: "",
  postcode: "",
  country: "",
};
const member = (over = {}) => ({ ...MEMBER, ...over });

const setUp = (profiles, application = {}) => {
  globalThis.__tables = {
    mfa_sessions: [{ id: "s1", session_id: "s1" }],
    membership_applications: [{ ...APPLICATION, ...application }],
    profiles,
    user_roles: [{ user_id: "admin-1", role: "admin" }],
  };
  globalThis.__writes.length = 0;
};

const writesTo = (table, op) => globalThis.__writes.filter((w) => w.table === table && w.op === op);

console.log("\nfiling an application against the membership it belongs to\n");

{
  // The everyday case: the membership has no phone number on it, the
  // application does, and the desk should not have to rekey it.
  setUp([member()]);
  const { status, body } = await call({ action: "link_application", application_id: "app-1" });
  ok("it answers 200", status, 200);
  ok("it finds the membership on a differently cased email", body.member_id, "u-mike");
  ok("it names who it filed against", body.member_name, "Mike Jones");
  ok("it fills in everything that was missing", body.filled, [
    "phone",
    "address_line1",
    "town",
    "postcode",
  ]);
  ok("it reports nothing in disagreement", body.differs, []);
  const filled = writesTo("profiles", "update")[0];
  ok("it writes the phone without the spaces", filled?.payload?.phone, "07700900123");
  ok("and the address they gave", filled?.payload?.address_line1, "12 Broad Walk");
  ok("and writes it to that member", filled?.filters, [{ op: "eq", column: "id", value: "u-mike" }]);
}

{
  // The one that matters. A number the desk has corrected must not be
  // replaced by whatever somebody typed into a form months later.
  setUp([
    member({
      phone: "+447700111222",
      address_line1: "12 Broad Walk",
      town: "Wilmslow",
      postcode: "SK9 5PJ",
    }),
  ]);
  const { body } = await call({ action: "link_application", application_id: "app-1" });
  ok("it fills nothing when nothing is missing", body.filled, []);
  ok("it reports the phone as different instead", body.differs, ["phone"]);
  ok("it writes nothing to the membership", writesTo("profiles", "update").length, 0);
}

{
  setUp([
    member({
      full_name: "",
      phone: "07700900123",
      address_line1: "The Old Rectory",
      town: "Wilmslow",
      postcode: "SK9 5PJ",
    }),
  ]);
  const { body } = await call({ action: "link_application", application_id: "app-1" });
  ok("it fills a missing name", body.filled, ["full_name"]);
  ok("it does not call the same phone number a difference", body.differs.includes("phone"), false);
  ok("it leaves an address the desk already holds alone", body.differs, ["address_line1"]);
}

{
  setUp([member({ id: "u-other", full_name: "Someone Else", email: "someone@example.com" })]);
  const { status, body } = await call({ action: "link_application", application_id: "app-1" });
  ok("it refuses when no membership uses that email", status, 400);
  ok("and says what to do instead", /Choose the member from the list/.test(body.error), true);
  ok("and leaves the application in the queue", writesTo("membership_applications", "update").length, 0);
  ok("and touches no membership", writesTo("profiles", "update").length, 0);
}

{
  // The desk knows better than the email address when the two differ
  setUp([member(), member({ id: "u-chosen", full_name: "M Jones", email: "mj@example.com" })]);
  const { body } = await call({
    action: "link_application",
    application_id: "app-1",
    member_id: "u-chosen",
  });
  ok("an explicit member wins over the email match", body.member_id, "u-chosen");
}

{
  // The desk picked somebody who has since been removed
  setUp([member()]);
  const { status, body } = await call({
    action: "link_application",
    application_id: "app-1",
    member_id: "u-gone",
  });
  ok("it refuses a membership that is not there", status, 400);
  ok("and says to reload", /no longer exists/.test(body.error), true);
  ok("and leaves the application alone", writesTo("membership_applications", "update").length, 0);
  ok("and does not fall back to the email match", writesTo("profiles", "update").length, 0);
}

{
  // Filed by hand against a membership on a different address. The email is
  // their sign-in, so it is reported and never written.
  setUp([member({ email: "mj@example.com" })]);
  const { body } = await call({
    action: "link_application",
    application_id: "app-1",
    member_id: "u-mike",
  });
  ok("it reports the different email", body.differs, ["email"]);
  ok("it fills the missing phone", body.filled.includes("phone"), true);
  const filled = writesTo("profiles", "update")[0];
  ok("and writes no email onto the membership", "email" in (filled?.payload ?? {}), false);
}

{
  setUp([member()], { status: "accepted" });
  const { status, body } = await call({ action: "link_application", application_id: "app-1" });
  ok("it refuses one already dealt with", status, 400);
  ok("and says so", /already been dealt with/.test(body.error), true);
}

{
  setUp([member()]);
  await call({ action: "link_application", application_id: "app-1" });
  const closed = writesTo("membership_applications", "update")[0];
  ok("it takes the application off the queue as accepted", closed?.payload?.status, "accepted");
  ok("it records who dealt with it", closed?.payload?.handled_by, "admin-1");
  ok("it records when", typeof closed?.payload?.handled_at, "string");
  ok("it never declines anybody", JSON.stringify(globalThis.__writes).includes("declined"), false);
  ok("it deletes nothing at all", globalThis.__writes.some((w) => w.op === "delete"), false);
}

{
  setUp([member()]);
  const { status } = await call({ action: "link_application", application_id: "" });
  ok("it refuses without an application", status, 400);
}

console.log("\nfilling a membership from an application already dealt with\n");

{
  // Mike's own case: filed months ago, with the address never copied across
  setUp([member({ phone: "+447700900123" })], { status: "accepted" });
  const { status, body } = await call({
    action: "fill_from_application",
    application_id: "app-1",
    member_id: "u-mike",
  });
  ok("it fills one already dealt with", status, 200);
  ok("it fills only the blanks", body.filled, ["address_line1", "town", "postcode"]);
  ok("it leaves the application as it found it", writesTo("membership_applications", "update").length, 0);
}

{
  // Running it twice must be as harmless as running it once
  setUp([
    member({ phone: "+447700900123", address_line1: "12 Broad Walk", town: "Wilmslow", postcode: "SK9 5PJ" }),
  ], { status: "accepted" });
  const { body } = await call({
    action: "fill_from_application",
    application_id: "app-1",
    member_id: "u-mike",
  });
  ok("a second run fills nothing", body.filled, []);
  ok("and writes nothing", writesTo("profiles", "update").length, 0);
}

{
  setUp([member()], { status: "accepted" });
  const { status, body } = await call({ action: "fill_from_application", application_id: "app-1" });
  ok("it will not fill without being told who", status, 400);
  ok("and says so", /Choose the member/.test(body.error), true);
  ok("and writes nothing", writesTo("profiles", "update").length, 0);
}

console.log("\nreading back an application the desk has already handled\n");

{
  setUp([member()], { status: "accepted" });
  const { body } = await call({ action: "list_applications", handled: true });
  ok("a handled application can be read again", body.applications.length, 1);
  ok("and its address is still on it", body.applications[0].address_line1, "12 Broad Walk");
}

{
  setUp([member()], { status: "accepted" });
  const { body } = await call({ action: "list_applications" });
  ok("the queue holds only those still waiting", body.applications.length, 0);
}

console.log(failures === 0
  ? "\na member who applies again is filed, not declined\n"
  : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
