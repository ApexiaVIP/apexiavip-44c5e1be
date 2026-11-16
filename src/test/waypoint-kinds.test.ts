/**
 * What a waypoint is allowed to be.
 *
 * The app wrote a kind the database did not allow for weeks, and every write
 * was refused. The chauffeur was told the address would not save and the
 * passenger got something generic, so it read as a connection problem rather
 * than a fault, and an hourly hire could not record where it went by any
 * route at all.
 *
 * Nothing in TypeScript can see a CHECK constraint, so this reads the last
 * one in the migrations and holds it against the kinds the code actually
 * writes. It is a cheap guard against a whole feature failing in silence.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** The kinds the live constraint allows, from the last migration to set it. */
const allowed = (): string[] => {
  const touching = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
    .filter((sql) => sql.includes("booking_waypoints_kind_check"));
  const last = touching[touching.length - 1];
  expect(last, "no migration defines booking_waypoints_kind_check").toBeTruthy();

  const check = last.slice(last.lastIndexOf("ADD CONSTRAINT booking_waypoints_kind_check"));
  const list = check.slice(check.indexOf("("), check.indexOf(")", check.indexOf("(")));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

/** Every kind the edge functions insert, read off the inserts themselves. */
const written = (): string[] => {
  const functions = join(process.cwd(), "supabase", "functions");
  const kinds = new Set<string>();
  for (const folder of readdirSync(functions, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    let source: string;
    try {
      source = readFileSync(join(functions, folder.name, "index.ts"), "utf8");
    } catch {
      continue;
    }
    let at = source.indexOf('from("booking_waypoints").insert(');
    while (at !== -1) {
      const body = source.slice(at, at + 500);
      const kind = /kind:\s*"([a-z_]+)"/.exec(body);
      if (kind) kinds.add(kind[1]);
      at = source.indexOf('from("booking_waypoints").insert(', at + 1);
    }
  }
  return [...kinds];
};

describe("booking waypoint kinds", () => {
  it("allows every kind the edge functions write", () => {
    const permitted = allowed();
    for (const kind of written()) {
      expect(permitted, `the database refuses waypoints of kind "${kind}"`).toContain(kind);
    }
  });

  it("allows where an hourly hire was asked to go", () => {
    expect(allowed()).toContain("destination");
  });

  it("allows every step of a job, so a day can be reconstructed", () => {
    const permitted = allowed();
    for (const step of ["en_route", "arrived", "pob", "waiting", "clear", "note"]) {
      expect(permitted).toContain(step);
    }
  });

  it("actually found the inserts, rather than passing on an empty list", () => {
    expect(written().length).toBeGreaterThanOrEqual(2);
    expect(written()).toContain("destination");
  });
});
