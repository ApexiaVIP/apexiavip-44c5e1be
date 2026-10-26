/**
 * The version a chauffeur reads has to be the version they are running.
 *
 * src/lib/release.ts is what the app shows. The iOS project file is what
 * Apple ships and what TestFlight names. If a release bumps one and forgets
 * the other, the number on screen is a lie and the next fault report sends
 * everybody looking at the wrong build.
 */
import { readFileSync } from "node:fs";

let failures = 0;
const ok = (what, got, want) => {
  if (got === want) {
    console.log(`ok    ${what}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${what}: app says ${got}, iOS project says ${want}`);
  }
};

const release = readFileSync("src/lib/release.ts", "utf8");
const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

const said = (text, name) => {
  const found = text.match(new RegExp(`${name} = "?([0-9.]+)"?`));
  return found ? found[1] : "";
};

const marketing = [...project.matchAll(/MARKETING_VERSION = ([0-9.]+)/g)].map((m) => m[1]);
const builds = [...project.matchAll(/CURRENT_PROJECT_VERSION = ([0-9]+)/g)].map((m) => m[1]);

ok("the version on screen matches the one Apple ships", said(release, "VERSION"), marketing[0] ?? "");
ok("the build on screen matches the one Apple ships", said(release, "BUILD"), builds[0] ?? "");
ok("every iOS target carries one version", new Set(marketing).size, 1);
ok("every iOS target carries one build", new Set(builds).size, 1);

console.log(failures === 0 ? "\nthe version on screen is the version shipped" : "");
process.exit(failures === 0 ? 0 : 1);
