/**
 * Signing in when we cannot text the member's country.
 *
 * A member abroad whose network we are not permitted to text must still be
 * able to get in. Being told "please try again" forever is a locked door.
 *
 *   npm run test:signin
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "signin-")), "fn.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "..", "supabase", "functions", "phone-login", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "stub-server.ts") }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "stub-supabase.ts") }));
  }}],
});

globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc",
  TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15550001111",
  RESEND_API_KEY: "re_test",
})[k] } };

const MEMBER = { id: "u1", phone: "+971501234567", email: "member@example.com", status: "active" };
globalThis.__tables = { profiles: [MEMBER], rate_limits: [], mfa_codes: [] };

let twilio = { ok: true, body: "{}" };
let lastEmailTo = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("api.twilio.com")) {
    return twilio.ok
      ? Response.json({ sid: "SM1" })
      : new Response(twilio.body, { status: 400 });
  }
  if (u.includes("api.resend.com")) {
    lastEmailTo = JSON.parse(init.body).to[0];
    return Response.json({ id: "em1" });
  }
  throw new Error("unexpected fetch " + u);
};

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

const start = async () => {
  lastEmailTo = null;
  const res = await handler(new Request("https://x/phone-login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", phone: MEMBER.phone }),
  }));
  return { status: res.status, payload: await res.json() };
};

let bad = 0;
const is = (label, got, want) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
};

// Normally the code goes by text
twilio = { ok: true };
let r = await start();
is("a number we can text gets a text", r.payload.channel, "sms");
is("and no email is sent", lastEmailTo, null);

// A country we are not permitted to text, which is what a UAE number hits
twilio = { ok: false, body: JSON.stringify({ code: 21408, message: "Permission to send an SMS has not been enabled for the region" }) };
r = await start();
is("a country we cannot text still gets in", r.status, 200);
is("by email instead", r.payload.channel, "email");
is("to the address we hold", lastEmailTo, MEMBER.email);
is("and the member is told why", String(r.payload.note).includes("cannot text"), true);

// Other permanent refusals behave the same way
for (const code of [21211, 21214, 21606, 21610, 21612, 21614]) {
  twilio = { ok: false, body: JSON.stringify({ code }) };
  r = await start();
  is(`refusal ${code} falls back to email`, r.payload.channel, "email");
}

// A passing fault is not a reason to send the code somewhere else
twilio = { ok: false, body: JSON.stringify({ code: 20503, message: "Internal server error" }) };
r = await start();
is("a temporary fault is reported, not rerouted", r.status, 502);
is("and nothing is emailed", lastEmailTo, null);

// Without an address there is nowhere to fall back to
globalThis.__tables.profiles = [{ ...MEMBER, email: "" }];
twilio = { ok: false, body: JSON.stringify({ code: 21408 }) };
r = await start();
is("with no email on file we say so rather than pretend", r.status, 502);

console.log(bad === 0 ? "\na member abroad can still sign in" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
