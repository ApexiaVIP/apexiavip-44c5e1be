import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/** The address search talks to the server; here it is one button. */
vi.mock("@/components/LocationSearch", () => ({
  default: ({ onSelect }: { onSelect: (p: unknown) => void }) => (
    <button
      onClick={() =>
        onSelect({ label: "", line1: "Spinningfields", line2: "", town: "Manchester", postcode: "M3 3EB", country: "GB" })
      }
    >
      search for an address
    </button>
  ),
}));

import DestinationBox from "@/components/DestinationBox";

const onPick = vi.fn();
const onChange = vi.fn();
beforeEach(() => {
  onPick.mockReset();
  onChange.mockReset();
});

describe("asking where an hourly hire is going", () => {
  it("asks plainly when the passenger has not said yet", () => {
    render(<DestinationBox chosen={null} changing={false} onChange={onChange} onPick={onPick} />);
    expect(screen.getByText(/where has the passenger asked for/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search for an address/i })).toBeInTheDocument();
  });

  it("hands the chosen address up, so it reaches the office", () => {
    render(<DestinationBox chosen={null} changing={false} onChange={onChange} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /search for an address/i }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ postcode: "M3 3EB" }));
  });

  it("shows where they are heading once it is in", () => {
    render(
      <DestinationBox
        chosen="Spinningfields, Manchester, M3 3EB"
        changing={false}
        onChange={onChange}
        onPick={onPick}
      />
    );
    expect(screen.getByText("Heading for")).toBeInTheDocument();
    expect(screen.getByText("Spinningfields, Manchester, M3 3EB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /search for an address/i })).toBeNull();
  });

  it("lets the chauffeur change it when the passenger changes their mind", () => {
    render(
      <DestinationBox
        chosen="Spinningfields, Manchester, M3 3EB"
        changing={false}
        onChange={onChange}
        onPick={onPick}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    expect(onChange).toHaveBeenCalled();
  });

  it("goes back to the search while they are changing it", () => {
    render(
      <DestinationBox
        chosen="Spinningfields, Manchester, M3 3EB"
        changing
        onChange={onChange}
        onPick={onPick}
      />
    );
    expect(screen.getByRole("button", { name: /search for an address/i })).toBeInTheDocument();
  });

  /**
   * A chauffeur looking for a Drive button that is not there needs to know
   * why, rather than deciding the app is broken.
   */
  it("says why the sat nav cannot take them to a place with no postcode", () => {
    render(
      <DestinationBox
        chosen="Old Trafford, Manchester"
        changing={false}
        onChange={onChange}
        onPick={onPick}
      />
    );
    expect(screen.getByText(/no postcode/i)).toBeInTheDocument();
  });

  it("says nothing of the sort when there is a postcode", () => {
    render(
      <DestinationBox
        chosen="Spinningfields, Manchester, M3 3EB"
        changing={false}
        onChange={onChange}
        onPick={onPick}
      />
    );
    expect(screen.queryByText(/no postcode/i)).toBeNull();
  });
});
