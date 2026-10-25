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

const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" };
globalThis.Deno = { env: { get: (k) => env[k] } };

// Photon as it really behaves: it matches on every word it is given
const PLACES = [
  { name: "Spice of Lahore", city: "Manchester", lat: 53.504, lon: -2.238, words: ["spice", "of", "lahore"] },
  { name: "Spice of Lahore", city: "London", lat: 51.52, lon: -0.08, words: ["spice", "of", "lahore"] },
];
/**
 * Royal Mail's address file, as the two providers really answer.
 *
 * Shapes taken from their own documentation: getAddress.io splits a building
 * across line_1 to line_4 with town_or_city beside it, Ideal Postcodes uses
 * line_1 to line_3 and shouts the post town.
 */
const DOORS_GETADDRESS = {
  addresses: [
    { line_1: "Flat 2", line_2: "Broad Walk House", line_3: "", line_4: "", town_or_city: "Wilmslow" },
    { line_1: "5 Broad Walk", line_2: "", line_3: "", line_4: "", town_or_city: "Wilmslow" },
    { line_1: "7 Broad Walk", line_2: "", line_3: "", line_4: "", town_or_city: "Wilmslow" },
    { line_1: "", line_2: "", line_3: "", line_4: "", town_or_city: "Wilmslow" },
  ],
};
const DOORS_IDEAL = {
  result: [
    { line_1: "5 Broad Walk", line_2: "", line_3: "", post_town: "WILMSLOW", postcode: "SK9 5PN" },
    { line_1: "7 Broad Walk", line_2: "", line_3: "", post_town: "WILMSLOW", postcode: "SK9 5PN" },
  ],
};

const asked = [];
/** Which providers the run is allowed to reach, so a test can refuse one. */
let providerFails = { getaddress: false, ideal: false };
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));

  if (u.host.includes("getaddress.io")) {
    asked.push(`getaddress:${decodeURIComponent(u.pathname.replace("/find/", ""))}`);
    if (providerFails.getaddress) return new Response("no", { status: 401 });
    return Response.json(DOORS_GETADDRESS);
  }
  if (u.host.includes("ideal-postcodes")) {
    asked.push(`ideal:${decodeURIComponent(u.pathname.split("/").pop())}`);
    if (providerFails.ideal) return new Response("no", { status: 402 });
    return Response.json(DOORS_IDEAL);
  }
  if (u.host.includes("postcodes.io")) {
    asked.push("postcodes.io");
    return Response.json({
      result: { postcode: "SK9 5PN", parish: "Wilmslow", admin_district: "Cheshire East" },
    });
  }
  if (u.host.includes("places.googleapis.com")) {
    asked.push("google");
    // Google answers a postcode with the postcode, which is the whole reason
    // an address file is needed. It does know the post town
    return Response.json({
      places: [
        {
          displayName: { text: "SK9 5PN" },
          formattedAddress: "SK9 5PN, Broad Walk, Wilmslow SK9 5PN",
          addressComponents: [
            { types: ["postal_town"], longText: "Wilmslow" },
            { types: ["route"], longText: "Broad Walk" },
            { types: ["postal_code"], longText: "SK9 5PN" },
          ],
        },
      ],
    });
  }

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

/*
 * Typing a postcode.
 *
 * What a member expects, and what every UK checkout does: the doors at that
 * postcode, to scroll and pick from. Only Royal Mail's address file can give
 * that, so this covers both the day there is a key and the day there is not.
 */
env.GOOGLE_MAPS_API_KEY = "google-key";

// No address file configured, which is where this starts
r = await search("SK9 5PN");
is("with no address file, a postcode gives exactly one row", r.suggestions.length, 1);
is("and it carries the post town, not the council", r.suggestions[0]?.town, "Wilmslow");
is("with the building left for the member to type", r.suggestions[0]?.line1, "");
is("and it says so on the row", /postcode only/.test(r.suggestions[0]?.label ?? ""), true);
is("it never offers a postcode as an address line", r.suggestions.some((s) => /^SK9 5PN$/.test(s.line1)), false);
is("no provider was called, so nothing was billed", r.asked.some((a) => a.startsWith("getaddress:") || a.startsWith("ideal:")), false);

// The key goes in. Nothing else changes, and no app release is involved
env.GETADDRESS_API_KEY = "paf-key";
r = await search("SK9 5PN");
is("with a key, the doors come back to scroll", r.suggestions.length, 3);
is("the postcode was the thing looked up", r.asked.includes("getaddress:SK9 5PN"), true);
is("a flat reads as a flat", r.suggestions[0]?.line1, "Flat 2, Broad Walk House");
is("a house reads as a house", r.suggestions[1]?.line1, "5 Broad Walk");
is("every door carries the postcode", r.suggestions.every((s) => s.postcode === "SK9 5PN"), true);
is("and the town", r.suggestions.every((s) => s.town === "Wilmslow"), true);
is("an entry with no building at all is dropped", r.suggestions.some((s) => !s.line1), false);

// The other provider, so either account works
delete env.GETADDRESS_API_KEY;
env.IDEAL_POSTCODES_API_KEY = "paf-key-2";
r = await search("SK9 5PN");
is("the other provider works just the same", r.suggestions.length, 2);
is("and its shouted post town is written properly", r.suggestions[0]?.town, "Wilmslow");
is("with the building first", r.suggestions[0]?.line1, "5 Broad Walk");

/*
 * A provider that refuses, which is the case that must not strand anybody:
 * out of lookups, a lapsed card, their outage. The postcode still has to
 * resolve or a member cannot finish booking a car.
 */
env.GETADDRESS_API_KEY = "paf-key";
delete env.IDEAL_POSTCODES_API_KEY;
providerFails = { getaddress: true, ideal: false };
r = await search("SK9 5PN");
is("a refused address file still leaves a usable postcode", r.suggestions.length, 1);
is("with the right town on it", r.suggestions[0]?.town, "Wilmslow");

// Both configured, first one refusing: fall through rather than give up
env.IDEAL_POSTCODES_API_KEY = "paf-key-2";
r = await search("SK9 5PN");
is("it falls through to the second provider", r.suggestions.length, 2);
is("having tried the first", r.asked.includes("getaddress:SK9 5PN"), true);
providerFails = { getaddress: false, ideal: false };

console.log(bad === 0 ? "\nthe search finds what a person types" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
