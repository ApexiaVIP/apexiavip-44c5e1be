-- People asking to join. Membership stays invitation only: an application is
-- a request for the office to call back, never an account.
CREATE TABLE IF NOT EXISTS public.membership_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  address_line1 text NOT NULL DEFAULT '',
  address_line2 text NOT NULL DEFAULT '',
  town text NOT NULL DEFAULT '',
  postcode text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'United Kingdom',
  heard_from text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new',
  handled_by uuid REFERENCES auth.users(id),
  handled_at timestamptz,
  notes text
);

ALTER TABLE public.membership_applications
  DROP CONSTRAINT IF EXISTS membership_applications_status_check;
ALTER TABLE public.membership_applications
  ADD CONSTRAINT membership_applications_status_check
  CHECK (status IN ('new', 'contacted', 'accepted', 'declined'));

CREATE INDEX IF NOT EXISTS membership_applications_new_idx
  ON public.membership_applications (created_at DESC)
  WHERE status = 'new';

ALTER TABLE public.membership_applications ENABLE ROW LEVEL SECURITY;

-- The public never reads this table, and never writes to it directly either:
-- applications arrive through the edge function, which uses the service role.
DROP POLICY IF EXISTS "Admins can read applications" ON public.membership_applications;
CREATE POLICY "Admins can read applications"
ON public.membership_applications FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update applications" ON public.membership_applications;
CREATE POLICY "Admins can update applications"
ON public.membership_applications FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.membership_applications IS
  'Enquiries from the public asking to become members; the office contacts them to set up an account';
