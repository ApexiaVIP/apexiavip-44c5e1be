GRANT SELECT ON public.bookings_backup_20260818 TO authenticated;
GRANT ALL ON public.bookings_backup_20260818 TO service_role;

ALTER TABLE public.bookings_backup_20260818 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can read backup" ON public.bookings_backup_20260818 FOR SELECT TO service_role USING (true);
CREATE POLICY "Admins can read backup" ON public.bookings_backup_20260818 FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));