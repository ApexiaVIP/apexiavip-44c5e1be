import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const profile = {
  address_line1: "1 Water Street",
  address_line2: "",
  town: "Manchester",
  postcode: "M3 4JQ",
};

const auth = { user: { id: "m-1" }, profile } as { user: { id: string }; profile: typeof profile | null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

/** The address search talks to the server; here it is one button. */
vi.mock("@/components/LocationSearch", () => ({
  default: ({ onSelect }: { onSelect: (p: unknown) => void }) => (
    <button
      onClick={() =>
        onSelect({ label: "", line1: "Spinningfields", line2: "", town: "Manchester", postcode: "M3 3EB", country: "" })
      }
    >
      search for an address
    </button>
  ),
}));

// Hoisted, because the mock factory below runs before anything else in the file
const db = vi.hoisted(() => ({
  listAddresses: vi.fn(),
  saveAddress: vi.fn(),
  removeAddress: vi.fn(),
}));
const { listAddresses, saveAddress, removeAddress } = db;
vi.mock("@/lib/addressBook", async () => {
  const real = await vi.importActual<typeof import("@/lib/addressBook")>("@/lib/addressBook");
  return { ...real, ...db };
});

import AddressBook from "@/components/AddressBook";

const home = {
  id: "a-1",
  label: "Home",
  line1: "1 Water Street",
  line2: "",
  town: "Manchester",
  postcode: "M3 4JQ",
  country: "United Kingdom",
  is_home: true,
};

const show = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddressBook />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listAddresses.mockReset().mockResolvedValue([]);
  saveAddress.mockReset().mockResolvedValue(undefined);
  removeAddress.mockReset().mockResolvedValue(undefined);
  auth.profile = profile;
});

describe("the member's address book", () => {
  // Named whatever the member calls it, and still marked as the home one
  it("shows what is saved, with the home one marked", async () => {
    listAddresses.mockResolvedValue([{ ...home, label: "The flat" }]);
    show();
    expect(await screen.findByText("The flat")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("1 Water Street, Manchester, M3 4JQ")).toBeInTheDocument();
  });

  /*
   * The profile already holds one address. Offering it is the difference
   * between a book that fills itself and one that stays empty.
   */
  it("offers the profile address when the book is empty", async () => {
    show();
    const offer = await screen.findByRole("button", { name: /save my home address/i });
    fireEvent.click(offer);
    expect(screen.getByDisplayValue("1 Water Street")).toBeInTheDocument();
    expect(screen.getByDisplayValue("M3 4JQ")).toBeInTheDocument();
  });

  it("does not offer a profile address that no car could be sent to", async () => {
    auth.profile = { address_line1: "", address_line2: "", town: "", postcode: "" };
    show();
    await screen.findByText(/nothing saved yet/i);
    expect(screen.queryByRole("button", { name: /save my home address/i })).toBeNull();
  });

  it("saves what was searched for, under the name given", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    fireEvent.change(screen.getByPlaceholderText("Home"), { target: { value: "The office" } });
    fireEvent.click(screen.getByRole("button", { name: /search for an address/i }));
    fireEvent.click(screen.getByRole("button", { name: /save address/i }));
    await waitFor(() =>
      expect(saveAddress).toHaveBeenCalledWith(
        "m-1",
        expect.objectContaining({
          label: "The office",
          line1: "Spinningfields",
          postcode: "M3 3EB",
          is_home: true,
        }),
      ),
    );
  });

  it("will not save a second address under a name already used", async () => {
    listAddresses.mockResolvedValue([home]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    fireEvent.change(screen.getByPlaceholderText("Home"), { target: { value: "home" } });
    fireEvent.click(screen.getByRole("button", { name: /search for an address/i }));
    expect(screen.getByText(/already have an address called that/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save address/i })).toBeDisabled();
  });

  it("will not save a name with no address under it", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    fireEvent.change(screen.getByPlaceholderText("Home"), { target: { value: "Nowhere" } });
    expect(screen.getByRole("button", { name: /save address/i })).toBeDisabled();
  });

  it("offers to edit an address without preselecting home for it", async () => {
    listAddresses.mockResolvedValue([
      home,
      { ...home, id: "a-2", label: "The office", is_home: false, line1: "Spinningfields" },
    ]);
    show();
    fireEvent.click((await screen.findAllByRole("button", { name: /edit/i }))[1]);
    expect(screen.getByDisplayValue("The office")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});
