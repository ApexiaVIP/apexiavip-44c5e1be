/**
 * The week a chauffeur can see before they sign on.
 *
 * Faz asked for this on 20 November: he had Khaldoon the next morning and had
 * to sign on to see the detail he needed to prepare. Signing on is the
 * timesheet, so the fix had to show the week without letting anyone work it.
 *
 * That is the rule worth testing. The list is informative, and a chauffeur
 * reading Saturday's airport run on a Monday must not be able to start it from
 * here: no buttons, no links, nothing to press.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

const { WeekAhead } = await import("@/pages/Driver");

type Diary = Parameters<typeof WeekAhead>[0]["diary"];

const entry = (over: Partial<Diary[number]> = {}): Diary[number] => ({
  reference: "APEXIA-MCFC-1",
  name: "Khaldoon Al Mubarak",
  vehicle: "Executive V Class",
  collection_at: "2026-11-21T06:00:00Z",
  pickup: { line1: "The Lowry Hotel", town: "Salford" },
  dropoff: { line1: "Manchester Airport T2", town: "Manchester" },
  journey_type: "destination",
  as_directed_hours: null,
  notes: null,
  passengers: 3,
  bags: 2,
  ...over,
});

describe("what a chauffeur sees before signing on", () => {
  it("says nothing at all when the week is empty", () => {
    const { container } = render(<WeekAhead diary={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("names the passenger and when they are being collected", () => {
    render(<WeekAhead diary={[entry()]} />);
    expect(screen.getByText("Your week ahead")).toBeTruthy();
    expect(screen.getByText(/Khaldoon Al Mubarak/)).toBeTruthy();
    expect(screen.getByText(/Sat 21 Nov/)).toBeTruthy();
  });

  it("gives them what they need to prepare: the car, the party and the bags", () => {
    render(<WeekAhead diary={[entry()]} />);
    expect(screen.getByText(/Executive V Class/)).toBeTruthy();
    expect(screen.getByText(/3 up/)).toBeTruthy();
    expect(screen.getByText(/2 bags/)).toBeTruthy();
  });

  it("counts one bag singly", () => {
    render(<WeekAhead diary={[entry({ bags: 1 })]} />);
    expect(screen.getByText(/1 bag(?!s)/)).toBeTruthy();
  });

  it("does not claim a luggage count nobody recorded", () => {
    render(<WeekAhead diary={[entry({ bags: 0, passengers: null })]} />);
    expect(screen.queryByText(/0 bags/)).toBeNull();
    expect(screen.queryByText(/up/)).toBeNull();
  });

  it("reads an hourly hire as the hours it is booked for, not a destination", () => {
    render(
      <WeekAhead
        diary={[entry({ journey_type: "hourly", as_directed_hours: 3, dropoff: null })]}
      />
    );
    expect(screen.getByText(/as directed, 3 hours/)).toBeTruthy();
  });

  it("carries the office notes, which is the preparing Faz asked for", () => {
    render(<WeekAhead diary={[entry({ notes: "Flight QR0021, meet at nameboard" })]} />);
    expect(screen.getByText(/Flight QR0021, meet at nameboard/)).toBeTruthy();
  });

  it("lists a whole week in the order it happens", () => {
    render(
      <WeekAhead
        diary={[
          entry({ reference: "A", collection_at: "2026-11-21T06:00:00Z" }),
          entry({ reference: "B", collection_at: "2026-11-24T19:30:00Z" }),
        ]}
      />
    );
    const days = screen.getAllByText(/Nov/);
    expect(days).toHaveLength(2);
    expect(days[0].textContent).toMatch(/21 Nov/);
    expect(days[1].textContent).toMatch(/24 Nov/);
  });

  /** The rule the whole feature rests on. */
  it("offers nothing to press, so the week can be read but never worked", () => {
    const { container } = render(
      <WeekAhead diary={[entry({ reference: "A" }), entry({ reference: "B" })]} />
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("[onclick]")).toHaveLength(0);
  });
});
