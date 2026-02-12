
-- Create a rate limiting table for tracking submissions by IP
CREATE TABLE public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  endpoint text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS - only service role can access
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only service role can manage rate limits"
ON public.rate_limits
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_rate_limits_ip_endpoint_created ON public.rate_limits (ip_address, endpoint, created_at DESC);

-- Auto-cleanup old entries (older than 1 hour)
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE created_at < now() - interval '1 hour';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_cleanup_rate_limits
AFTER INSERT ON public.rate_limits
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_old_rate_limits();
