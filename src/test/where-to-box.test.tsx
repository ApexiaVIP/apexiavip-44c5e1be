import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const sent = vi.hoisted(() => ({ calls: [] as { reference: string; place: string }[], fail: "" }));
vi.mock("@/lib/mfa", () => ({
  tellChauffeur: async (reference: string, place: string) => {
    if (sent.fail) throw new Error(sent.fail);
    sent.calls.push({ reference, place });
  },
}));

/** The search box is its own thing, already covered; this stands in for it. */
vi.mock("@/components/LocationSearch", () => ({
  default: ({
    onSelect,
    placeholder,
  }: {
    onSelect: (s: { line1: string; town: string; postcode: string }) => void;
    placeholder?: string;
  }) => (
    <button
      type="button"
      aria-label={placeholder}
      onClick={() => onSelect({ line1: "Australasia", town: "Manchester", postcode: "M3 3AP" })}
    >
      pick
    </button>
  ),
}));

const toasted = vi.hoisted(() => ({ shown: [] as { title?: string; description?: string }[] }));
vi.mock("@/hooks/use-toast", () => ({
  toast: (t: { title?: string; description?: string }) => toasted.shown.push(t),
}));

import WhereTo from "@/components/WhereTo";

beforeEach(() => {
  sent.calls = [];
  sent.fail = "";
  toasted.shown = [];
});

describe("the passenger saying where they would like to go", () => {
  it("asks plainly on an hourly hire, where there is no destination yet", () => {
    render(<WhereTo reference="APX-1" asDirected />);
    expect(screen.getByText(/where would you like to go/i)).toBeInTheDocument();
  });

  it("asks differently on a booked journey, which already has one", () => {
    render(<WhereTo reference="APX-1" asDirected={false} />);
    expect(screen.getByText(/somewhere else/i)).toBeInTheDocument();
  });

  /**
   * Street, town, postcode, in that order. The chauffeur's sat nav reads the
   * postcode off the end of this line, so the order is not cosmetic.
   */
  it("passes the address on the way the sat nav reads it", async () => {
    render(<WhereTo reference="APX-1" asDirected />);
    fireEvent.click(screen.getByRole("button", { name: /search a place/i }));
    await waitFor(() => expect(sent.calls.length).toBe(1));
    expect(sent.calls[0]).toEqual({
      reference: "APX-1",
      place: "Australasia, Manchester, M3 3AP",
    });
  });

  it("shows the passenger it was passed on, so they are not left guessing", async () => {
    render(<WhereTo reference="APX-1" asDirected />);
    fireEvent.click(screen.getByRole("button", { name: /search a place/i }));
    expect(await screen.findByText(/passed to your chauffeur at/i)).toBeInTheDocument();
    expect(screen.getByText("Australasia, Manchester, M3 3AP")).toBeInTheDocument();
  });

  it("lets them change their mind again", async () => {
    render(<WhereTo reference="APX-1" asDirected />);
    fireEvent.click(screen.getByRole("button", { name: /search a place/i }));
    fireEvent.click(await screen.findByRole("button", { name: /somewhere else/i }));
    expect(screen.getByRole("button", { name: /search a place/i })).toBeInTheDocument();
  });

  /**
   * A passenger who believes the chauffeur has been told, when they have not,
   * sits in a car going the wrong way. So a refusal says so, and says what to
   * do instead.
   */
  it("says so when it could not be passed on, and never pretends it was", async () => {
    sent.fail = "Your chauffeur has not started this journey yet.";
    render(<WhereTo reference="APX-1" asDirected />);
    fireEvent.click(screen.getByRole("button", { name: /search a place/i }));
    await waitFor(() => expect(toasted.shown.length).toBe(1));
    expect(toasted.shown[0].title).toMatch(/could not pass that on/i);
    expect(toasted.shown[0].description).toMatch(/has not started/i);
    expect(screen.queryByText(/passed to your chauffeur/i)).not.toBeInTheDocument();
  });
});
