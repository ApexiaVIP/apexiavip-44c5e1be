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
  it("offers Waze and Maps", () => {
    render(<NavigateRow job={job} asDirected={false} />);
    expect(screen.getByRole("button", { name: /waze/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maps/i })).toBeInTheDocument();
  });

  it("says it is heading for the collection before anybody is aboard", () => {
    render(<NavigateRow job={job} asDirected={false} />);
    expect(screen.getByText(/drive to the collection/i)).toBeInTheDocument();
  });

  it("says it is heading for the destination once they are in", () => {
    render(<NavigateRow job={{ ...job, driver_status: "pob" }} asDirected={false} />);
    expect(screen.getByText(/drive to the destination/i)).toBeInTheDocument();
  });

  it("sends Waze the collection, out of the app rather than inside it", () => {
    render(<NavigateRow job={job} asDirected={false} />);
    fireEvent.click(screen.getByRole("button", { name: /waze/i }));
    const [url, target] = opened.mock.calls[0];
    expect(url).toContain(encodeURIComponent("SK10 4TW"));
    expect(url).toContain("navigate=yes");
    expect(target).toBe("_system");
  });

  it("sends Maps the destination once the passenger is aboard", () => {
    render(<NavigateRow job={{ ...job, driver_status: "pob" }} asDirected={false} />);
    fireEvent.click(screen.getByRole("button", { name: /maps/i }));
    expect(opened.mock.calls[0][0]).toContain(encodeURIComponent("M3 5LH"));
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
