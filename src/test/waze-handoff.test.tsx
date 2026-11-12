/**
 * Handing the drive to Waze, and the one rule that makes it safe.
 *
 * The button only belongs on a phone that keeps reporting its position while
 * another app is in front. Everywhere else, leaving the app still freezes the
 * car on the passenger's map, which is the fault the in-app sat nav was built
 * to fix. So the gate is the thing worth testing: a Waze button drawn on the
 * wrong platform is the exact regression this is meant not to be.
 *
 * The web side of that gate is covered in navigate-row.test.tsx, which runs
 * without these mocks and proves no button appears.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const backgrounds = vi.fn(() => true);
const door = vi.fn(async (_place: unknown) => ({
  lat: 53.32036,
  lng: -2.23,
  precision: "address" as const,
}));

vi.mock("@/lib/positionSource", () => ({
  survivesBackground: () => backgrounds(),
  watchFixes: () => () => {},
}));

vi.mock("@/lib/findDoor", () => ({ findDoor: (place: unknown) => door(place) }));

const { NavigateRow } = await import("@/pages/Driver");

type Job = Parameters<typeof NavigateRow>[0]["job"];

const job = {
  reference: "APEXIA-1",
  name: "Test Passenger",
  vehicle: "S-Class",
  collection_at: null,
  travel_date: "2026-11-12",
  pickup: { line1: "The Cottage, Donkey Lane", town: "Wilmslow", postcode: "SK9 1PX" },
  dropoff: { line1: "The Lowry Hotel", town: "Salford", postcode: "M3 5LH" },
  journey_type: null,
  as_directed_hours: null,
  notes: null,
  children: null,
  passengers: null,
  corporate: null,
  driver_status: null,
  driver_status_at: null,
  job_report_sent_at: null,
  dispatchStatus: null,
  vehicleRegistration: "APX 1",
} as unknown as Job;

const wazeLinkOnScreen = () => screen.queryByRole("link", { name: /waze/i });

beforeEach(() => {
  backgrounds.mockReset().mockReturnValue(true);
  door.mockReset().mockResolvedValue({ lat: 53.32036, lng: -2.23, precision: "address" });
});

describe("the Waze button", () => {
  it("is offered on a phone that keeps reporting in the background", async () => {
    render(<NavigateRow job={job} asDirected={false} onDrive={vi.fn()} />);
    await waitFor(() => expect(wazeLinkOnScreen()).toBeInTheDocument());
  });

  it("is not offered where leaving the app would freeze the car", async () => {
    backgrounds.mockReturnValue(false);
    render(<NavigateRow job={job} asDirected={false} onDrive={vi.fn()} />);
    // Nothing to wait for: it must never appear, not appear and go away
    await waitFor(() => expect(screen.getByRole("button", { name: /drive/i })).toBeTruthy());
    expect(wazeLinkOnScreen()).not.toBeInTheDocument();
  });

  it("does not even look the address up when it will not be offered", async () => {
    backgrounds.mockReturnValue(false);
    render(<NavigateRow job={job} asDirected={false} onDrive={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /drive/i })).toBeTruthy());
    expect(door).not.toHaveBeenCalled();
  });

  it("carries our own corrected coordinate rather than the address", async () => {
    // The whole point. Handed the postcode, Waze lands on the centroid of the
    // unit, which is the fifty yards on Donkey Lane that started this.
    render(<NavigateRow job={job} asDirected={false} onDrive={vi.fn()} />);
    await waitFor(() =>
      expect(wazeLinkOnScreen()).toHaveAttribute(
        "href",
        "https://waze.com/ul?ll=53.32036%2C-2.23&navigate=yes"
      )
    );
  });

  it("still sends them somewhere when the door cannot be found", async () => {
    door.mockResolvedValue(null as never);
    render(<NavigateRow job={job} asDirected={false} onDrive={vi.fn()} />);
    await waitFor(() =>
      expect(wazeLinkOnScreen()).toHaveAttribute(
        "href",
        "https://waze.com/ul?q=The%20Cottage%2C%20Donkey%20Lane%2C%20Wilmslow%2C%20SK9%201PX&navigate=yes"
      )
    );
  });

  it("aims at the destination once the passenger is aboard", async () => {
    render(<NavigateRow job={{ ...job, driver_status: "pob" }} asDirected={false} onDrive={vi.fn()} />);
    await waitFor(() => expect(door).toHaveBeenCalled());
    expect(door).toHaveBeenCalledWith(expect.objectContaining({ line1: "The Lowry Hotel" }));
  });

  it("tells the chauffeur the passenger can still see them", async () => {
    render(<NavigateRow job={job} asDirected={false} onDrive={vi.fn()} />);
    await waitFor(() => expect(wazeLinkOnScreen()).toBeInTheDocument());
    expect(screen.getByText(/still sees the car while you are in Waze/i)).toBeInTheDocument();
  });
});
