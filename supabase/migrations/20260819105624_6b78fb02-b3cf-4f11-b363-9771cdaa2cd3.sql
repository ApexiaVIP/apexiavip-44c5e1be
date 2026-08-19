CREATE TABLE IF NOT EXISTS public.bookings_backup_20260818 AS
SELECT * FROM public.bookings WHERE corporate = 'mcfc';

DELETE FROM public.bookings WHERE corporate = 'mcfc';

SELECT count(*) AS backed_up FROM public.bookings_backup_20260818;

SELECT count(*) AS mcfc_remaining FROM public.bookings WHERE corporate = 'mcfc';