/**
 * Hand a chosen date to the form and shut the calendar.
 *
 * The calendar used to stay open after a date was tapped, so the only way out
 * was to tap some unrelated part of the screen and hope. It now closes itself.
 *
 * Tapping the day that is already chosen makes the picker report nothing
 * chosen at all. That was survivable while the calendar stayed open and the
 * field visibly emptied in front of you. Closing on the same tap would leave a
 * member with no date and nothing to explain it, so a second tap on a day is
 * taken to mean what the first one meant: keep it, and close.
 */
export const pickDate =
  (onChange: (date: Date) => void, setOpen: (open: boolean) => void) =>
  (date: Date | undefined): void => {
    if (date) onChange(date);
    setOpen(false);
  };
