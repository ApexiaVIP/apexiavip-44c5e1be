
-- Fix bookings table: drop restrictive policies and create permissive service-role-only policies
DROP POLICY IF EXISTS "Only service role can insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Only service role can read bookings" ON public.bookings;

CREATE POLICY "Service role can insert bookings"
ON public.bookings
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can read bookings"
ON public.bookings
FOR SELECT
TO service_role
USING (true);

-- Fix rate_limits table: drop restrictive policy and create permissive service-role-only policies
DROP POLICY IF EXISTS "Only service role can manage rate limits" ON public.rate_limits;

CREATE POLICY "Service role can manage rate limits"
ON public.rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
