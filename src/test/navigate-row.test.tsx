import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavigateRow } from "@/pages/Driver";

type Job = Parameters<typeof NavigateRow>[0]["job"];

/** The screen a chauffeur is looking at on the kerb, so it has to render. */
const job: Job = {
  reference: "APEXIA-1",
  name: "Test Passenger",
  vehicle: "S-Class",
  collection_at: null,
  travel_date: "2026-10-24",
  pickup: { line1: "Alderley Mill Cottage", town: "Macclesfield", postcode: "SK10 4TW" },
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
};

const opened = vi.fn();

beforeEach(() => {
  opened.mockReset();
  vi.stubGlobal("open", opened);
});

describe("the navigate row on a job", () => {
  /**
   * The chauffeur leaving for another app is the whole problem this app was
   * built to fix: the phone suspends it, positions stop going up, and the
   * passenger watches a parked car for the length of their journey. So there
   * is nothing on the job to tap but our own drive.
   */
  it("offers nothing but our own drive, so nobody leaves the app", () => {
    render(<NavigateRow job={job} asDirected={false} onDrive={vi.fn()} />);
    expect(screen.getByRole("button", { name: /drive/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /waze/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /maps/i })).not.toBeInTheDocument();
  });

  it("never opens another app, however the row is pressed", () => {
    const onDrive = vi.fn();
    render(<NavigateRow job={job} asDirected={false} onDrive={onDrive} />);
    for (const button of screen.getAllByRole("button")) fireEvent.click(button);
    expect(onDrive).toHaveBeenCalledWith("pickup");
    expect(opened).not.toHaveBeenCalled();
  });

  it("says it is heading for the collection before anybody is aboard", () => {
    render(<NavigateRow job={job} asDirected={false} />);
    expect(screen.getByText(/drive to the collection/i)).toBeInTheDocument();
  });

  it("says it is heading for the destination once they are in", () => {
    render(<NavigateRow job={{ ...job, driver_status: "pob" }} asDirected={false} />);
    expect(screen.getByText(/drive to the destination/i)).toBeInTheDocument();
  });

  it("shows nothing on an as directed hire, where there is nowhere to send them", () => {
    const { container } = render(
      <NavigateRow job={{ ...job, driver_status: "pob" }} asDirected />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the office recorded no address", () => {
    const { container } = render(
      <NavigateRow job={{ ...job, pickup: null, dropoff: null }} asDirected={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
