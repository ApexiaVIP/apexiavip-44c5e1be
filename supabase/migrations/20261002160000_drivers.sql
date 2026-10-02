-- Chauffeurs on the app. A driver signs in exactly like a member, with their
-- mobile and a code, and is recognised by this flag. Jobs are matched to them
-- by the mobile number Dispatch reports for the assigned driver, so none of
-- this depends on anything new from Dever.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_driver boolean NOT NULL DEFAULT false;

-- Drivers cannot promote themselves, the same as desk access
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.id := OLD.id;
    NEW.phone := OLD.phone;
    NEW.status := OLD.status;
    NEW.primary_member_id := OLD.primary_member_id;
    NEW.invited_by := OLD.invited_by;
    NEW.created_at := OLD.created_at;
    NEW.corporate := OLD.corporate;
    NEW.corporate_groups := OLD.corporate_groups;
    NEW.is_driver := OLD.is_driver;
    NEW.app_platform := OLD.app_platform;
    NEW.app_last_seen_at := OLD.app_last_seen_at;
    NEW.app_nudged_at := OLD.app_nudged_at;
  END IF;
  RETURN NEW;
END;
$$;

-- When a chauffeur was working. Ours alone: Dispatch has no notion of a shift,
-- which is what makes this the timesheet the back office asked for.
CREATE TABLE IF NOT EXISTS public.driver_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One open shift per driver, so signing on twice cannot happen
CREATE UNIQUE INDEX IF NOT EXISTS driver_shifts_one_open_idx
  ON public.driver_shifts (driver_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS driver_shifts_driver_started_idx
  ON public.driver_shifts (driver_id, started_at DESC);

-- What happened during a job. Dispatch's statuses run once per booking, so an
-- as-directed day where the passenger is set down and collected again several
-- times cannot be recorded there at all. It is recorded here instead.
CREATE TABLE IF NOT EXISTS public.booking_waypoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference text NOT NULL,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  place text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_waypoints
  DROP CONSTRAINT IF EXISTS booking_waypoints_kind_check;
ALTER TABLE public.booking_waypoints
  ADD CONSTRAINT booking_waypoints_kind_check
  CHECK (kind IN ('set_down', 'collected', 'waiting', 'note'));

CREATE INDEX IF NOT EXISTS booking_waypoints_reference_idx
  ON public.booking_waypoints (booking_reference, recorded_at);

ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_waypoints ENABLE ROW LEVEL SECURITY;

-- A driver sees their own record; an admin sees everyone's. Writes go through
-- the driver function on the service role, so neither table is written here.
DROP POLICY IF EXISTS "Drivers read own shifts" ON public.driver_shifts;
CREATE POLICY "Drivers read own shifts"
ON public.driver_shifts FOR SELECT TO authenticated
USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Drivers read own waypoints" ON public.booking_waypoints;
CREATE POLICY "Drivers read own waypoints"
ON public.booking_waypoints FOR SELECT TO authenticated
USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.booking_waypoints IS
  'Stops within a job, chiefly as-directed set downs and collections, which Dispatch cannot record';
