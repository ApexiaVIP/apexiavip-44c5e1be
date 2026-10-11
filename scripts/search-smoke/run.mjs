/**
 * Looking up where someone actually is.
 *
 * The case this exists for: a member types a restaurant the way a person
 * does, with the city and the district after it, and gets nothing at all.
 *
 *   npm run test:search
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "search-")), "fn.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "..", "supabase", "functions", "place-search", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "stub-server.ts") }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "stub-supabase.ts") }));
  }}],
});

globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" })[k] } };

// Photon as it really behaves: it matches on every word it is given
const PLACES = [
  { name: "Spice of Lahore", city: "Manchester", lat: 53.504, lon: -2.238, words: ["spice", "of", "lahore"] },
  { name: "Spice of Lahore", city: "London", lat: 51.52, lon: -0.08, words: ["spice", "of", "lahore"] },
];
const asked = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (!u.host.includes("photon")) return new Response("", { status: 404 });
  const q = (u.searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  asked.push(q.join(" "));
  const hits = PLACES.filter((p) => q.every((w) => p.words.includes(w)));
  return Response.json({
    features: hits.map((p) => ({
      geometry: { coordinates: [p.lon, p.lat] },
      properties: { name: p.name, city: p.city, countrycode: "GB", postcode: "" },
    })),
  });
};

await import(pathToFileURL(out).href);
const handler = globalThis.__handler;

const search = async (query) => {
  asked.length = 0;
  const res = await handler(new Request("https://x/place-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer member-token" },
    body: JSON.stringify({ query }),
  }));
  const body = await res.json();
  return { status: res.status, suggestions: body.suggestions ?? [], asked: [...asked] };
};

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
};

// The way a person actually types it
let r = await search("Spice of Lahore Manchester cheetham hill");
is("a restaurant typed with its district is still found", r.suggestions.length > 0, true);
is("and the nearest one comes first", r.suggestions[0]?.town, "Manchester");

// It should not give up on the first miss, nor flail about forever
is("it drops the extra words one at a time", r.asked.length > 1, true);
is("and stops as soon as it finds something", r.asked.at(-1), "spice of lahore");

// Name alone still works, nearest first
r = await search("Spice of Lahore");
is("the name alone works", r.suggestions.length, 2);
is("Manchester above London", r.suggestions[0]?.town, "Manchester");

// Nothing that exists, however few words are left
r = await search("Somewhere That Does Not Exist At All");
is("a place that is not there returns nothing", r.suggestions.length, 0);

console.log(bad === 0 ? "\nthe search finds what a person types" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
