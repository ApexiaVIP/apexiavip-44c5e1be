-- Richer bookings: free-text notes, children (ages drive the seats we fit),
-- a personal/business flag with the business block, and the client's own
-- car for drive-my-car jobs. Written by the booking functions (service
-- role); read back for My Bookings and for amendments.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS children jsonb,        -- [{ "age": 3 }, ...]
  ADD COLUMN IF NOT EXISTS booking_type text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS business jsonb,        -- { company, department, clients, pa_name, pa_contact, invoice_address }
  ADD COLUMN IF NOT EXISTS client_car jsonb;      -- { make_model, registration, client_travelling }

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_booking_type_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_type_check
  CHECK (booking_type IN ('personal', 'business'));

-- The last business details a member used, so they are not retyped
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_defaults jsonb;

-- Members may keep their own business defaults; it is their data
COMMENT ON COLUMN public.profiles.business_defaults IS
  'Last business details used on a booking: company, department, clients, pa_name, pa_contact, invoice_address';