import { describe, it, expect, vi } from "vitest";
import { pickDate } from "@/lib/pickDate";

describe("pickDate", () => {
  it("passes the date on and closes the calendar", () => {
    const onChange = vi.fn();
    const setOpen = vi.fn();
    const day = new Date("2026-11-05T00:00:00Z");

    pickDate(onChange, setOpen)(day);

    expect(onChange).toHaveBeenCalledWith(day);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("keeps the date when the chosen day is tapped again", () => {
    const onChange = vi.fn();
    const setOpen = vi.fn();

    // react-day-picker reports a deselect as undefined
    pickDate(onChange, setOpen)(undefined);

    expect(onChange).not.toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
  });
});
