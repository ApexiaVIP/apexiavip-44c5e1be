
-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Service role can insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Service role can read bookings" ON public.bookings;

-- Create proper policies that restrict to service_role only
CREATE POLICY "Only service role can insert bookings"
ON public.bookings
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Only service role can read bookings"
ON public.bookings
FOR SELECT
TO service_role
USING (true);
