import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SavedAddressChips from "@/components/SavedAddressChips";

const address = (label: string, is_home = false) => ({
  id: label,
  label,
  line1: "1 Water Street",
  line2: "",
  town: "Manchester",
  postcode: "M3 4JQ",
  country: "United Kingdom",
  is_home,
});

describe("offering saved addresses on the booking form", () => {
  /*
   * The public website uses the same form, where nobody is signed in. An
   * empty "Saved" heading over nothing would look broken.
   */
  it("shows nothing at all when there is nothing saved", () => {
    const { container } = render(<SavedAddressChips addresses={[]} onPick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hands the chosen address to the form", () => {
    const onPick = vi.fn();
    render(<SavedAddressChips addresses={[address("Home", true)]} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /home/i }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ postcode: "M3 4JQ" }));
  });

  it("says which address each one is, for anybody with two of them", () => {
    render(
      <SavedAddressChips addresses={[address("Home", true), address("The office")]} onPick={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /the office/i })).toHaveAttribute(
      "title",
      "1 Water Street, Manchester, M3 4JQ",
    );
  });
});
