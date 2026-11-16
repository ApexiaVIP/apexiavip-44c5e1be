-- Let an hourly hire record where it is actually going.
--
-- A hire booked by the hour has no destination when it starts: the passenger
-- says where as the afternoon goes on, and both the chauffeur's screen and
-- the passenger's own write that down as a waypoint of kind 'destination'.
-- That kind was never added to the list this column allows, so every one of
-- those writes has been refused by the database since the feature shipped.
--
-- It failed quietly in two different ways. The chauffeur was told the address
-- would not save and to tell the office, which reads like a connection
-- problem rather than a fault. The passenger's side threw, so they got
-- something generic. Nobody could have got an address in by any route.
--
-- The whole list is restated rather than appended to, because a CHECK
-- constraint cannot be added to in place, and because it is the only record
-- anywhere of what this column is allowed to hold.
ALTER TABLE public.booking_waypoints
  DROP CONSTRAINT IF EXISTS booking_waypoints_kind_check;
ALTER TABLE public.booking_waypoints
  ADD CONSTRAINT booking_waypoints_kind_check
  CHECK (
    kind IN (
      'en_route',
      'arrived',
      'pob',
      'waiting',
      'clear',
      'set_down',
      'collected',
      'note',
      'destination'
    )
  );

COMMENT ON COLUMN public.booking_waypoints.kind IS
  'What happened. The progress steps, a chauffeur note, or where an hourly hire was asked to go.';
