/**
 * Pack the OpenStreetMap camera nodes into the file the app ships with.
 *
 * The cameras travel inside the app rather than being asked for mid drive,
 * because the warning is worth most in exactly the places with no signal. Rows
 * are integers to keep it small: a hundredth of a second of arc is a metre on
 * the ground, which is finer than any camera is mapped to.
 *
 * Usage: node scripts/pack-cameras.mjs <dir of overpass json> [out file]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const out = process.argv[3] ?? "public/speed-cameras.json";
if (!dir) {
  console.error("Give me the directory holding the Overpass json");
  process.exit(1);
}

/** Only an explicit mph limit is believed. */
const limitOf = (tags) => {
  const raw = tags.maxspeed ?? "";
  const mph = /^(\d{1,2})\s*mph$/i.exec(raw.trim());
  if (!mph) return 0;
  const n = Number(mph[1]);
  return n >= 5 && n <= 80 ? n : 0;
};

/**
 * Only a bearing in degrees is believed.
 *
 * "forward" and "backward" describe the way the camera's own road was drawn,
 * which we do not have here, so those cameras are kept but unfiltered rather
 * than guessed at and hidden from the chauffeur who needed them.
 */
const directionOf = (tags) => {
  const raw = String(tags.direction ?? "").trim();
  if (!/^\d{1,3}(\.\d+)?$/.test(raw)) return -1;
  const n = Number(raw);
  return n >= 0 && n < 360 ? Math.round(n) : -1;
};

const kindOf = (tags) =>
  tags.enforcement === "average_speed" || tags["highway"] !== "speed_camera" ? 1 : 0;

const seen = new Set();
const rows = [];
let files = 0;

for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith(".json") || name === "uk-cameras.json") continue;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch {
    console.warn(`skipped ${name}, which is not readable json`);
    continue;
  }
  const elements = Array.isArray(parsed) ? parsed : (parsed.elements ?? []);
  files++;
  for (const el of elements) {
    if (el.type !== "node" || typeof el.lat !== "number" || typeof el.lon !== "number") continue;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    const tags = el.tags ?? {};
    rows.push([
      Math.round(el.lat * 1e5),
      Math.round(el.lon * 1e5),
      kindOf(tags),
      limitOf(tags),
      directionOf(tags),
    ]);
  }
}

// North to south, so a drive reads the rows it wants from one run of the file
rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const packed = {
  source: "OpenStreetMap contributors, ODbL",
  at: new Date().toISOString().slice(0, 10),
  count: rows.length,
  cameras: rows,
};

writeFileSync(out, JSON.stringify(packed));
const withLimit = rows.filter((r) => r[3] > 0).length;
const average = rows.filter((r) => r[2] === 1).length;
console.log(`${files} files -> ${rows.length} cameras`);
console.log(`  ${average} average speed, ${withLimit} with a known limit`);
console.log(`  ${(JSON.stringify(packed).length / 1024).toFixed(0)} KB at ${out}`);
