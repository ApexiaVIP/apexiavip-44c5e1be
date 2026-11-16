/**
 * What the office reads when a chauffeur says they are up.
 *
 * This is read at six in the morning by somebody deciding whether to start
 * ringing round, so the subject line has to answer the question on its own.
 */
import { describe, it, expect } from "vitest";
import { upAndRunningNotice } from "../../supabase/functions/_shared/callOn.ts";

const job = (reference: string, passenger = "Mr Khan", collectionAt = "2026-11-16T09:30:00Z") => ({
  reference,
  passenger,
  collectionAt,
});

describe("upAndRunningNotice", () => {
  it("says who, in the subject, so nothing has to be opened", () => {
    const { subject } = upAndRunningNotice({
      chauffeur: "Jimmy Acton",
      signedOnAt: "2026-11-16T06:00:00Z",
      jobsToday: [job("APX-1")],
    });
    expect(subject).toBe("Jimmy Acton is up and signed on");
  });

  it("still reads properly for a chauffeur with no name on file", () => {
    const { subject } = upAndRunningNotice({ chauffeur: "  ", signedOnAt: null, jobsToday: [] });
    expect(subject).toBe("A chauffeur is up and signed on");
  });

  it("gives the time they signed on", () => {
    const { lines } = upAndRunningNotice({
      chauffeur: "Jimmy",
      signedOnAt: "2026-11-16T06:00:00Z",
      jobsToday: [],
    });
    expect(lines.join(" ")).toContain("06:00");
  });

  it("says plainly when no timesheet is running", () => {
    const { lines } = upAndRunningNotice({ chauffeur: "Jimmy", signedOnAt: null, jobsToday: [] });
    expect(lines.join(" ")).toContain("no timesheet");
  });

  it("counts the day's work, and counts one as one", () => {
    const one = upAndRunningNotice({
      chauffeur: "Jimmy",
      signedOnAt: "2026-11-16T06:00:00Z",
      jobsToday: [job("APX-1")],
    });
    expect(one.lines.join(" ")).toContain("One job");

    const three = upAndRunningNotice({
      chauffeur: "Jimmy",
      signedOnAt: "2026-11-16T06:00:00Z",
      jobsToday: [job("APX-1"), job("APX-2"), job("APX-3")],
    });
    expect(three.lines.join(" ")).toContain("3 jobs");
  });

  it("says when there is nothing on their screen, rather than saying nothing", () => {
    const { lines } = upAndRunningNotice({
      chauffeur: "Jimmy",
      signedOnAt: "2026-11-16T06:00:00Z",
      jobsToday: [],
    });
    expect(lines.join(" ")).toContain("Nothing on their screen");
  });

  it("lists each job without leaving a gap where a blank passenger was", () => {
    const { lines } = upAndRunningNotice({
      chauffeur: "Jimmy",
      signedOnAt: "2026-11-16T06:00:00Z",
      jobsToday: [job("APX-1", ""), job("APX-2", "Mr Khan", null)],
    });
    expect(lines).toContain("APX-1 · Mon 16 Nov, 09:30");
    expect(lines).toContain("APX-2 · Mr Khan");
  });
});
