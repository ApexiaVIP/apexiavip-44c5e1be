/**
 * The desk switch.
 *
 * Operations run two desks for the same club, and an admin flips between them
 * in the portal rather than holding a second login. Everything the desk shows
 * is keyed on which desk is being worked, so if the request could name its own
 * desk unchecked, one club's people could read the other's journeys. This
 * drives the real handler and asks who is allowed to name a desk.
 *
 *   npm run test:desk
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "desk-")), "fn.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "..", "supabase", "functions", "corporate-booking", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "stub-server.ts") }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "stub-supabase.ts") }));
  }}],
});

globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  RESEND_API_KEY: "resend",
  DISPATCH_TRANSFER_REFERENCE: "TESTREF",
}[k]) } };
globalThis.fetch = async () => Response.json({});

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

const TOKEN = `x.${Buffer.from(JSON.stringify({ session_id: "s1" })).toString("base64url")}.y`;

const call = async (body) => {
  const res = await handler(new Request("https://x/corporate-booking", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

let failures = 0;
const ok = (what, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) failures += 1;
  console.log(`${same ? "ok  " : "FAIL"}  ${what}${same ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};

/** A desk user on the men's desk, and a journey on each desk. */
const setUp = (isAdmin) => {
  globalThis.__isAdmin = isAdmin;
  globalThis.__tables = {
    mfa_sessions: [{ id: "s1", session_id: "s1" }],
    profiles: [{
      id: "user-1", status: "active", corporate: "mcfc", corporate_groups: null,
      full_name: "Desk User", email: "desk@example.com", phone: "+447700900123",
    }],
    corporate_passengers: [
      { id: "p-1", corporate: "mcfc", name: "Erling Haaland", grp: "First Team", active: true },
      { id: "p-2", corporate: "mcfcw", name: "Khadija Shaw", grp: "First Team", active: true },
    ],
    bookings: [
      { reference: "MEN-1", corporate: "mcfc", name: "Erling Haaland", user_id: "user-1", status: "Confirmed" },
      { reference: "WOMEN-1", corporate: "mcfcw", name: "Khadija Shaw", user_id: "user-1", status: "Confirmed" },
    ],
  };
};

const refs = (res) => (res.body.recent ?? []).map((r) => r.reference);

console.log("\nthe desk a request is answered for");

setUp(false);
let res = await call({ action: "recent" });
ok("naming no desk answers for your own", refs(res), ["MEN-1"]);

res = await call({ action: "recent", desk: "mcfc" });
ok("naming your own desk is no different", refs(res), ["MEN-1"]);

res = await call({ action: "recent", desk: "mcfcw" });
ok("a desk user cannot name another desk", res.status, 403);
ok("and is told so plainly", res.body.error, "That desk is not yours to work");

setUp(true);
res = await call({ action: "recent", desk: "mcfcw" });
ok("an admin working the other desk sees that desk", refs(res), ["WOMEN-1"]);
ok("and not their own", refs(res).includes("MEN-1"), false);

res = await call({ action: "recent", desk: "mcfcx" });
ok("a desk with nobody on it is refused", res.status, 400);

/**
 * A limit on the account's own desk is about that desk's groups. Carrying it
 * onto another desk would hide people whose group names simply differ.
 */
globalThis.__tables.profiles[0].corporate_groups = ["Executives"];
res = await call({ action: "recent", desk: "mcfcw" });
ok("a group limit does not follow an admin across", refs(res), ["WOMEN-1"]);

console.log(failures === 0 ? "\nthe switch answers for one desk at a time\n" : `\n${failures} failing\n`);
process.exit(failures === 0 ? 0 : 1);
