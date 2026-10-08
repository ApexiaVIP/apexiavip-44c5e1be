/**
 * Reading cup ties out of the club calendar.
 *
 * The domestic cups are drawn round by round and are not published as a club
 * fixture list anywhere, so they come from the club's calendar, where each tie
 * carries a tag. This checks the parsing, and that a tie keeps its identity
 * when it is moved or listed twice.
 *
 *   npm run test:fixtures
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "fx-")), "f.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "supabase", "functions", "fixtures-sync", "index.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*http\/server\.ts$/ }, () => ({ path: join(here, "..", "scripts", "timesheet-smoke", "stub-server.ts") }));
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: join(here, "..", "scripts", "timesheet-smoke", "stub-supabase.ts") }));
  }}],
});
globalThis.Deno = { env: { get: () => "x" } };
const { calendarRows, numberForTie } = await import(pathToFileURL(out).href);

const DESK = {
  club: "Man City", feedSlug: "man-city",
  calendarUrl: "", calendarClub: "Manchester City", homeVenue: "Etihad Stadium",
  competitions: [],
};
const FROM = new Date(Date.UTC(2026, 7, 1));
const TO = new Date(Date.UTC(2027, 7, 1));

const ev = (uid, summary, start) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART:${start}\r\nEND:VEVENT\r\n`;

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
};

const ics =
  ev("a", "Manchester City - Brighton & Hove Albion FC [LC]", "20261028T193000Z") +
  // The same tie listed again once played, which the calendar really does
  ev("b", "Manchester City - Brighton & Hove Albion FC [LC] (2-1)", "20261028T193000Z") +
  ev("c", "Newcastle United - Manchester City [LC]", "20261216T200000Z") +
  // A two legged tie: the same clubs twice, swapping who is at home
  ev("d", "Manchester City - Arsenal [LC]", "20270106T200000Z") +
  ev("e", "Arsenal - Manchester City [LC]", "20270127T200000Z") +
  ev("f", "Manchester City - Chelsea [FA]", "20270109T150000Z") +
  // Another club's tie, and one from a different season
  ev("g", "Arsenal - Chelsea [LC]", "20261101T200000Z") +
  ev("h", "Manchester City - Everton [LC]", "20250924T184500Z");

const lc = calendarRows(ics, "LC", DESK, FROM, TO);
is("one row per tie, duplicates collapsed", lc.length, 4);
is("the first tie reads correctly", [lc[0].HomeTeam, lc[0].AwayTeam, lc[0].DateUtc, lc[0].Location],
   ["Man City", "Brighton & Hove Albion FC", "2026-10-28T19:30:00.000Z", "Etihad Stadium"]);
is("the club is named as we name it", lc[1].AwayTeam, "Man City");
is("an away tie carries no venue we cannot know", lc[1].Location, "");
is("a two legged tie stays two fixtures",
   [lc[2].HomeTeam, lc[3].HomeTeam], ["Man City", "Arsenal"]);
is("and the two legs are not confused for one", lc[2].MatchNumber === lc[3].MatchNumber, false);
is("another club's tie is ignored", lc.some((r) => r.HomeTeam === "Arsenal" && r.AwayTeam === "Chelsea"), false);
is("last season is ignored", lc.some((r) => r.DateUtc.startsWith("2025")), false);
is("a score in the summary is not part of a team name",
   lc.some((r) => /[()\d]/.test(r.AwayTeam)), false);

const fa = calendarRows(ics, "FA", DESK, FROM, TO);
is("the FA Cup picks up only its own tag", fa.length, 1);
is("and reads correctly", [fa[0].HomeTeam, fa[0].AwayTeam], ["Man City", "Chelsea"]);

// A tie moved to a new date must stay the same fixture, not become a second one
const moved = calendarRows(
  ev("z", "Manchester City - Brighton & Hove Albion FC [LC]", "20261104T200000Z"),
  "LC", DESK, FROM, TO);
is("a moved tie keeps its number, so the move is seen as a change",
   moved[0].MatchNumber, lc[0].MatchNumber);
is("and carries the new kick off", moved[0].DateUtc, "2026-11-04T20:00:00.000Z");

is("no tie is ever numbered zero", numberForTie("") > 0, true);
is("a cup with nothing drawn yields nothing", calendarRows("", "FA", DESK, FROM, TO).length, 0);

console.log(bad === 0 ? "\ncup ties read correctly" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
