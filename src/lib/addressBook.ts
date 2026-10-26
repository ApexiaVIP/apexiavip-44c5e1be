import { supabase } from "@/integrations/supabase/client";
import type { PlaceSuggestion } from "@/lib/mfa";

/** One place a member is collected from or taken to */
export interface SavedAddress {
  id: string;
  label: string;
  line1: string;
  line2: string;
  town: string;
  postcode: string;
  country: string;
  is_home: boolean;
}

/** The address fields a booking asks for, without the label */
export type AddressFields = Omit<SavedAddress, "id" | "label" | "is_home">;

export const blankAddress = (): AddressFields => ({
  line1: "",
  line2: "",
  town: "",
  postcode: "",
  country: "United Kingdom",
});

/** What a saved address reads as in a list or on a chip */
export const addressLine = (a: Pick<SavedAddress, "line1" | "line2" | "town" | "postcode">) =>
  [a.line1, a.line2, a.town, a.postcode].map((p) => (p ?? "").trim()).filter(Boolean).join(", ");

/**
 * Home first, then alphabetical.
 *
 * Home is where most journeys start, so it is worth a fixed place in the list
 * rather than wherever its name happens to fall.
 */
export const sortAddresses = <T extends { label: string; is_home: boolean }>(rows: T[]): T[] =>
  rows.slice().sort((a, b) => {
    if (a.is_home !== b.is_home) return a.is_home ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

/** Whether this name is already in the book, ignoring the one being edited */
export const labelTaken = (
  rows: Pick<SavedAddress, "id" | "label">[],
  label: string,
  exceptId?: string,
) => {
  const want = label.trim().toLowerCase();
  if (!want) return false;
  return rows.some((r) => r.id !== exceptId && r.label.trim().toLowerCase() === want);
};

/** An address is only worth saving if a car could be sent to it */
export const addressUsable = (a: AddressFields) =>
  !!a.line1.trim() && !!(a.town.trim() || a.postcode.trim());

export const fromPlace = (s: PlaceSuggestion): AddressFields => ({
  line1: s.line1 ?? "",
  line2: s.line2 ?? "",
  town: s.town ?? "",
  postcode: s.postcode ?? "",
  country: s.country || "United Kingdom",
});

const FIELDS = "id, label, line1, line2, town, postcode, country, is_home";

/*
 * An empty book rather than an error, for the minutes between the app
 * reaching the members and the table being there.
 *
 * Postgres answers 42P01 for a table that does not exist. A member opening
 * their profile in that window has nothing saved, which is true, and should
 * not be shown a database error to tell them so.
 */
export const isMissingTable = (error: { code?: string } | null) => error?.code === "42P01";

export const listAddresses = async (memberId: string): Promise<SavedAddress[]> => {
  const { data, error } = await supabase
    .from("saved_addresses")
    .select(FIELDS)
    .eq("member_id", memberId);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return sortAddresses((data ?? []) as SavedAddress[]);
};

/*
 * Only one address can be the home one, which the database enforces, so the
 * old home is stood down before the new one is written. Doing it the other
 * way round would be refused.
 */
const standDownHome = async (memberId: string, exceptId?: string) => {
  let q = supabase
    .from("saved_addresses")
    .update({ is_home: false })
    .eq("member_id", memberId)
    .eq("is_home", true);
  if (exceptId) q = q.neq("id", exceptId);
  const { error } = await q;
  if (error) throw error;
};

export interface AddressInput extends AddressFields {
  id?: string;
  label: string;
  is_home: boolean;
}

export const saveAddress = async (memberId: string, input: AddressInput) => {
  if (input.is_home) await standDownHome(memberId, input.id);

  const row = {
    member_id: memberId,
    label: input.label.trim(),
    line1: input.line1.trim(),
    line2: input.line2.trim(),
    town: input.town.trim(),
    postcode: input.postcode.trim().toUpperCase(),
    country: input.country.trim() || "United Kingdom",
    is_home: input.is_home,
  };

  if (input.id) {
    const { error } = await supabase
      .from("saved_addresses")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("member_id", memberId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("saved_addresses").insert(row);
  if (error) throw error;
};

export const removeAddress = async (memberId: string, id: string) => {
  const { error } = await supabase
    .from("saved_addresses")
    .delete()
    .eq("id", id)
    .eq("member_id", memberId);
  if (error) throw error;
};
