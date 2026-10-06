/**
 * The chauffeur queue rules. A cleared job coming back with its buttons live
 * is the bug this guards against, so it is checked from several directions.
 *
 *   npm run test:queue
 */
import * as esbuild from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(await mkdtemp(join(tmpdir(), "queue-")), "q.mjs");
await esbuild.build({
  entryPoints: [join(here, "..", "src", "lib", "driverQueue.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out,
});
const { splitJobs, isWorkable } = await import(pathToFileURL(out).href);

let bad = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
};
const job = (reference, driver_status = null) => ({ reference, driver_status });

const three = [job("A", "clear"), job("B", "pob"), job("C")];
const s = splitJobs(three);
is("a finished job is not the job in hand", s.current.reference, "B");
is("the ones behind it wait their turn", s.queue.map((j) => j.reference), ["C"]);
is("the finished one is kept, out of the way", s.done.map((j) => j.reference), ["A"]);

is("only the job in hand can be worked", isWorkable(three[1], three), true);
is("the one behind it cannot", isWorkable(three[2], three), false);
is("and a finished one certainly cannot", isWorkable(three[0], three), false);

// The reported bug: clear the job, and it must not come back offering "en route"
const one = [job("A", "pob")];
is("before clearing, the single job is in hand", splitJobs(one).current.reference, "A");
const stale = splitJobs(one, ["A"]);
is("cleared here, it leaves the queue even if the server has not caught up", stale.current, null);
is("and it shows as finished instead", stale.done.map((j) => j.reference), ["A"]);
is("so its buttons are dead", isWorkable(one[0], one, ["A"]), false);

// Once the server agrees, the local note changes nothing
const agreed = [job("A", "clear")];
is("server and local agree", splitJobs(agreed, ["A"]).done.length, 1);
is("no double counting", splitJobs(agreed, ["A"]).current, null);

// Clearing the first of several hands over to the next, not back to the start
const two = [job("A", "pob"), job("B")];
is("clearing the first promotes the second", splitJobs(two, ["A"]).current.reference, "B");
is("the finished one does not reappear in the queue", splitJobs(two, ["A"]).queue.length, 0);

is("an empty day has nothing in hand", splitJobs([]).current, null);
is("a day of only finished jobs has nothing in hand", splitJobs([job("A", "clear")]).current, null);

console.log(bad === 0 ? "\nall queue rules hold" : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
