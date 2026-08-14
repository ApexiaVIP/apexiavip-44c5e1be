-- Full journey detail for multi-stop corporate bookings.
-- pickup/dropoff/via still hold the first, last and intermediate addresses so
-- existing screens keep working; this column keeps who boards and alights at
-- each stop, which those columns cannot express.
ALTER TABLE public.bookings ADD COLUMN stops jsonb;