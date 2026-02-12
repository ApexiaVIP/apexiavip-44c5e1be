
CREATE TABLE public.bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  travel_date TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Allow the service role (edge functions) to insert
CREATE POLICY "Service role can insert bookings"
  ON public.bookings FOR INSERT
  WITH CHECK (true);

-- Allow service role to read all bookings
CREATE POLICY "Service role can read bookings"
  ON public.bookings FOR SELECT
  USING (true);
