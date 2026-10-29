/**
 * Which release this is.
 *
 * Two separate occasions were spent working out which build a chauffeur was
 * holding, because the only place the version existed was inside the iOS
 * project file where nobody on a kerb can read it. It is written here as
 * well, shown at the foot of the chauffeur's screen, and checked against the
 * iOS project by scripts/release.test.mjs so the two cannot drift apart.
 */
export const VERSION = "2.1";

/** The build Apple counts, which is what a crash report is filed against. */
export const BUILD = "16";

export const releaseLine = (): string => `Version ${VERSION} (${BUILD})`;
