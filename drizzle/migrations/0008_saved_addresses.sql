-- A member's own address book.
--
-- Every booking started with typing an address that had not changed since the
-- last one. These are the places a member is collected from and taken to, so
-- the booking form can offer them instead.

CREATE TABLE IF NOT EXISTS public.saved_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- What the member calls it: Home, The office, Mum's
  label text NOT NULL,
  line1 text NOT NULL DEFAULT '',
  line2 text NOT NULL DEFAULT '',
  town text NOT NULL DEFAULT '',
  postcode text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'United Kingdom',
  -- Offered first on the booking form, rather than filled in for them
  is_home boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_addresses ENABLE ROW LEVEL SECURITY;

/*
 * A member's address book is their own.
 *
 * It is deliberately not shared with the other accounts on the same
 * membership. A home address is not something to hand to somebody else
 * because they happen to be on the same account, and if a household wants
 * that later it should be asked for rather than assumed.
 */
CREATE POLICY "Members read their own addresses"
ON public.saved_addresses FOR SELECT
TO authenticated
USING (member_id = auth.uid());

CREATE POLICY "Members add their own addresses"
ON public.saved_addresses FOR INSERT
TO authenticated
WITH CHECK (member_id = auth.uid());

CREATE POLICY "Members change their own addresses"
ON public.saved_addresses FOR UPDATE
TO authenticated
USING (member_id = auth.uid())
WITH CHECK (member_id = auth.uid());

CREATE POLICY "Members remove their own addresses"
ON public.saved_addresses FOR DELETE
TO authenticated
USING (member_id = auth.uid());

-- The office needs to see them to take a booking over the telephone
CREATE POLICY "Admins read all saved addresses"
ON public.saved_addresses FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- One home address per member, enforced here rather than hoped for in the app
CREATE UNIQUE INDEX IF NOT EXISTS saved_addresses_one_home
  ON public.saved_addresses (member_id)
  WHERE is_home;

-- Two addresses with the same name are indistinguishable in a dropdown
CREATE UNIQUE INDEX IF NOT EXISTS saved_addresses_label
  ON public.saved_addresses (member_id, lower(label));

COMMENT ON TABLE public.saved_addresses IS
  'A member''s own saved pickup and destination addresses, offered when booking';