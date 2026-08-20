CREATE TABLE IF NOT EXISTS public.tmp_manual_invoke (id bigserial primary key, request_id bigint, created_at timestamptz default now());
GRANT ALL ON public.tmp_manual_invoke TO service_role;
ALTER TABLE public.tmp_manual_invoke ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE rid bigint;
BEGIN
  SELECT net.http_post(
    url := 'https://mzqpvnxtwshjcyzaipea.supabase.co/functions/v1/booking-watch',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')),
    body := '{}'::jsonb
  ) INTO rid;
  INSERT INTO public.tmp_manual_invoke(request_id) VALUES (rid);
END $$;