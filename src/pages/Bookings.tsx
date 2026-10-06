import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, MapPin, Phone } from "lucide-react";
import MemberLayout from "@/components/MemberLayout";
import { GET_APP_URL, isInstalledApp } from "@/lib/appLinks";
import TrackMap from "@/components/TrackMap";
import { locationFreshness } from "@/lib/locationAge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cancelBooking, checkBookingStatuses, type LiveBookingStatus } from "@/lib/mfa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

interface StoredAddress {
  line1?: string;
  town?: string;
  postcode?: string;
}

interface BookingRow {
  id: string;
  user_id: string | null;
  reference: string | null;
  vehicle: string;
  travel_date: string;
  collection_at: string | null;
  passengers: number | null;
  bags: number | null;
  pickup: StoredAddress | null;
  dropoff: StoredAddress | null;
  journey_type: string;
  as_directed_hours: number | null;
  via: StoredAddress[] | null;
  status: string;
  notes: string | null;
  children: { age: number }[] | null;
  booking_type: string | null;
  business: { company?: string; department?: string } | null;
  client_car: { make_model?: string; registration?: string; client_travelling?: boolean } | null;
  return_of: string | null;
  subject_to_availability: boolean | null;
  /** Where the chauffeur says they have got to, from their own app */
  driver_status: string | null;
}

const seatFor = (age: number) =>
  age < 1 ? "baby seat" : age < 4 ? "child seat" : age < 12 ? "booster" : null;

/** "2 children (ages 2 and 7), 1 child seat, 1 booster" */
const childrenLine = (children: { age: number }[]) => {
  const ages = children.map((c) => c.age);
  const seats = new Map<string, number>();
  for (const a of ages) {
    const seat = seatFor(a);
    if (seat) seats.set(seat, (seats.get(seat) ?? 0) + 1);
  }
  const seatText = [...seats.entries()].map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`).join(", ");
  return `${children.length} ${children.length === 1 ? "child" : "children"} (age${ages.length > 1 ? "s" : ""} ${ages.join(", ")})${
    seatText ? `, ${seatText}` : ""
  }`;
};

/** Statuses where the journey is over */
const FINAL_STATUSES = ["Clear/Completed", "Completed", "Cancelled", "No Show", "Invoice", "Failed"];
/** Statuses meaning a driver is actively working the job */
const ACTIVE_STATUSES = ["Dispatched", "En route to pickup", "At Pickup", "Passenger on board", "Soon to clear"];

// What the chauffeur presses in their own app, said in the same words Dispatch
// uses. Their app reports in seconds, where Dispatch is polled, so when the
// chauffeur has told us something it is the newer answer and it wins.
const DRIVER_STATUS_AS_DISPATCH: Record<string, string> = {
  en_route: "En route to pickup",
  arrived: "At Pickup",
  pob: "Passenger on board",
  waiting: "Passenger on board",
  clear: "Clear/Completed",
};

const statusVariant = (status: string): "secondary" | "outline" | "destructive" => {
  if (status === "Cancelled" || status === "No Show" || status === "Failed") return "destructive";
  if (ACTIVE_STATUSES.includes(status)) return "outline";
  return "secondary";
};

// "Confirmed" is reserved for a chauffeur actually being assigned. Before
// that the booking has only been received, and inside the hour it is
// subject to availability.
const displayStatus = (status: string, provisional = false) => {
  if (status === "Pending" || status === "Requested" || status === "Confirmed") {
    return provisional ? "Awaiting availability" : "Received";
  }
  if (status === "Amendment requested") return "Change requested";
  // Our record is complete; the office is entering it in Dispatch by hand
  if (status === "Awaiting office") return provisional ? "Awaiting availability" : "Received";
  if (status === "Dispatched") return "Confirmed";
  if (status === "En route to pickup") return "On the way";
  if (status === "At Pickup") return "Arrived";
  if (status === "Passenger on board") return "On board";
  if (status === "Clear/Completed" || status === "Clear") return "Completed";
  if (status === "Invoice") return "Completed";
  return status;
};

const formatWhen = (b: BookingRow) => {
  if (!b.collection_at) return b.travel_date;
  const d = new Date(b.collection_at);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }) + ` · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

const addressLine = (a: StoredAddress | null) =>
  a ? [a.line1, a.town].filter(Boolean).join(", ") : "";

const Bookings = () => {
  const { user, mfaVerified, mfaResolved, loading } = useAuth();
  const queryClient = useQueryClient();

  const cancel = useMutation({
    mutationFn: (reference: string) => cancelBooking(reference),
    onSuccess: (outcome) => {
      toast({
        title: outcome.handedToOps ? "Cancellation requested" : "Booking cancelled",
        description:
          outcome.message ??
          "Your booking has been cancelled. Charges may still apply.",
      });
      queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Cancellation failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["my-bookings"],
    queryFn: async () => {
      const columns =
        "id, user_id, reference, vehicle, travel_date, collection_at, passengers, bags, pickup, dropoff, journey_type, as_directed_hours, via, status";
      const ask = (select: string) =>
        supabase
          .from("bookings")
          .select(select)
          .order("collection_at", { ascending: false, nullsFirst: false });

      // The chauffeur column arrives with its migration, which lands after the
      // site does. Until then the member's bookings must still open.
      let { data, error } = await ask(`${columns}, driver_status`);
      if (error) {
        ({ data, error } = await ask(columns));
      }
      if (error) throw error;
      return data as unknown as BookingRow[];
    },
    enabled: !!user && mfaVerified,
    // The chauffeur's app reports progress here, so the member sees "on the
    // way" without having to pull the screen down
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  // Names for family members' bookings (visible to the primary account holder)
  const { data: familyNames } = useQuery({
    queryKey: ["family-names"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone")
        .eq("primary_member_id", user!.id);
      if (error) throw error;
      return new Map((data ?? []).map((p) => [p.id, p.full_name || p.phone]));
    },
    enabled: !!user && mfaVerified,
  });

  const now = Date.now();
  const upcoming = (bookings ?? []).filter(
    (b) =>
      !FINAL_STATUSES.includes(b.status) &&
      (!b.collection_at || new Date(b.collection_at).getTime() > now - 6 * 60 * 60 * 1000)
  );
  const past = (bookings ?? []).filter((b) => !upcoming.includes(b));

  // A journey is "live" from 90 minutes before pickup until it finishes
  const liveRefs = upcoming
    .filter((b) => {
      if (!b.reference) return false;
      if (ACTIVE_STATUSES.includes(b.status)) return true;
      if (!b.collection_at) return false;
      const t = new Date(b.collection_at).getTime();
      return t - now < 90 * 60 * 1000 && t > now - 6 * 60 * 60 * 1000;
    })
    .map((b) => b.reference as string);

  const checkRefs = upcoming.map((b) => b.reference).filter(Boolean) as string[];

  const { data: liveStatuses, isFetching: refreshing, refetch } = useQuery({
    queryKey: ["booking-statuses", checkRefs.join(",")],
    queryFn: () => checkBookingStatuses(checkRefs.slice(0, 10)),
    enabled: !!user && mfaVerified && checkRefs.length > 0,
    // Every 15s while a driver is actively on a job, which is exactly when
    // the map is on screen, and every 30s in the run up to a pickup. Asking
    // more often than this gains nothing: the ceiling is how often Dispatch
    // refreshes the chauffeur's position, which the age under the map shows.
    refetchInterval: (query) => {
      const anyActive = (query.state.data ?? []).some(
        (s) => s.bookingStatus && ACTIVE_STATUSES.includes(s.bookingStatus)
      );
      if (anyActive) return 15_000;
      return liveRefs.length > 0 ? 30_000 : false;
    },
    // Coming back to the app should show the current position, not the one
    // from when it was last put down
    refetchOnWindowFocus: true,
  });

  const liveFor = (reference: string | null): LiveBookingStatus | undefined =>
    liveStatuses?.find((s) => s.reference === reference);

  if (loading || (user && !mfaResolved)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-champagne" />
      </div>
    );
  }
  if (!user || !mfaVerified) {
    return <Navigate to="/login" state={{ from: "/bookings" }} replace />;
  }

  const renderCard = (b: BookingRow, isUpcoming: boolean) => {
    const live = isUpcoming ? liveFor(b.reference) : undefined;
    const fromChauffeur = b.driver_status ? DRIVER_STATUS_AS_DISPATCH[b.driver_status] : undefined;
    const effectiveStatus = fromChauffeur ?? live?.bookingStatus ?? b.status;
    const driverVisible = isUpcoming && live && (live.driver?.name || live.vehicle?.description);
    const isOwn = b.user_id === user.id;
    const familyName = !isOwn && b.user_id ? familyNames?.get(b.user_id) : undefined;
    const driverLat = live?.latitude ? parseFloat(live.latitude) : NaN;
    const driverLng = live?.longitude ? parseFloat(live.longitude) : NaN;
    const mapVisible =
      isUpcoming &&
      ACTIVE_STATUSES.includes(effectiveStatus) &&
      Number.isFinite(driverLat) &&
      Number.isFinite(driverLng);
    return (
      <div key={b.id} className="border border-border p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-foreground text-lg font-light tracking-wide">{b.vehicle}</p>
            <p className="text-smoke text-sm">{formatWhen(b)}</p>
            {familyName && (
              <p className="text-champagne text-xs tracking-[0.15em] uppercase mt-1">
                For {familyName}
              </p>
            )}
            {b.subject_to_availability && !ACTIVE_STATUSES.includes(effectiveStatus) && !FINAL_STATUSES.includes(effectiveStatus) && (
              <p className="text-smoke text-xs mt-1 max-w-sm">
                Subject to availability. We will text you as soon as a chauffeur is assigned.
              </p>
            )}
            {b.return_of && (
              <p className="text-champagne text-xs tracking-[0.15em] uppercase mt-1">
                Return journey
              </p>
            )}
          </div>
          <Badge
            variant={statusVariant(effectiveStatus)}
            className={
              ACTIVE_STATUSES.includes(effectiveStatus)
                ? "text-champagne border-champagne"
                : undefined
            }
          >
            {displayStatus(effectiveStatus, b.subject_to_availability === true && !ACTIVE_STATUSES.includes(effectiveStatus))}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-sm text-smoke flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-champagne" />
            {addressLine(b.pickup) || "Pickup"}
          </span>
          {b.journey_type === "hourly" ? (
            <span className="text-champagne">
              At your direction &#183; {b.as_directed_hours ?? "?"} hours
            </span>
          ) : (
            <>
              {(b.via ?? []).map((stop, i) => (
                <span key={i} className="inline-flex items-center gap-3">
                  <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{addressLine(stop)}</span>
                </span>
              ))}
              <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{addressLine(b.dropoff) || "Dropoff"}</span>
            </>
          )}
        </div>

        {(b.client_car || (b.children?.length ?? 0) > 0 || b.booking_type === "business" || b.notes) && (
          <div className="text-xs text-smoke space-y-1 border-t border-border pt-3">
            {b.client_car && (
              <p>
                <span className="text-champagne tracking-[0.15em] uppercase mr-2">Your car</span>
                {b.client_car.make_model} {b.client_car.registration}
                {b.client_car.client_travelling === false ? " (moved for you)" : ""}
              </p>
            )}
            {(b.children?.length ?? 0) > 0 && (
              <p>
                <span className="text-champagne tracking-[0.15em] uppercase mr-2">Children</span>
                {childrenLine(b.children!)}
              </p>
            )}
            {b.booking_type === "business" && b.business?.company && (
              <p>
                <span className="text-champagne tracking-[0.15em] uppercase mr-2">Business</span>
                {b.business.company}
                {b.business.department ? `, ${b.business.department}` : ""}
              </p>
            )}
            {b.notes && (
              <p className="whitespace-pre-wrap">
                <span className="text-champagne tracking-[0.15em] uppercase mr-2">Notes</span>
                {b.notes}
              </p>
            )}
          </div>
        )}

        {isUpcoming && isOwn && b.reference && b.status !== "Failed" && (
          <div className="flex items-center gap-3 flex-wrap">
            <Link to={`/book?edit=${encodeURIComponent(b.reference)}`}>
              <Button variant="outline" size="sm" className="tracking-[0.15em] uppercase">
                Amend
              </Button>
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cancel.isPending}
                  className="tracking-[0.15em] uppercase text-smoke"
                >
                  Cancel Booking
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {b.vehicle} on {formatWhen(b)}. Depending on timing, the
                    journey may still be chargeable.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                  <AlertDialogAction onClick={() => cancel.mutate(b.reference!)}>
                    Cancel Booking
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {driverVisible && (
          <div className="border-t border-border pt-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              {live?.driver?.photoUrl ? (
                <img
                  src={live.driver.photoUrl}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-charcoal border border-border" />
              )}
              <div>
                <p className="text-foreground text-sm">
                  {live?.driver?.name ? `Your chauffeur: ${live.driver.name}` : "Chauffeur assigned"}
                </p>
                <p className="text-smoke text-xs">
                  {[live?.vehicle?.description, live?.vehicle?.registration]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {live?.driver?.mobile && (
                <a
                  href={`tel:${live.driver.mobile}`}
                  className="inline-flex items-center gap-1.5 text-smoke hover:text-foreground transition-colors text-xs tracking-[0.15em] uppercase"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Call
                </a>
              )}
              {live?.trackDriverUrl && (
                <a href={live.trackDriverUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" className="tracking-[0.15em] uppercase">
                    Track Driver
                  </Button>
                </a>
              )}
            </div>
          </div>
        )}

        {isUpcoming &&
          ACTIVE_STATUSES.includes(effectiveStatus) &&
          !mapVisible && (
            <p className="text-smoke/70 text-xs tracking-[0.1em] border border-border px-4 py-3">
              Your chauffeur is on the way. The map appears once their phone reports its position;
              if it does not, they are still coming and you can call them above.
            </p>
          )}

        {mapVisible && (
          <div className="space-y-2">
            <TrackMap
              lat={driverLat}
              lng={driverLng}
              pickupPostcode={b.pickup?.postcode}
            />
            {(() => {
              const fresh = locationFreshness(live?.locationDateTime ?? null);
              return (
                <p
                  className={`text-xs tracking-[0.1em] ${
                    fresh.stale ? "text-champagne" : "text-smoke/70"
                  }`}
                >
                  Live driver location
                  {fresh.text ? ` · ${fresh.text}` : ""}
                  {fresh.stale
                    ? " · your chauffeur's phone may have lost signal"
                    : " · refreshes automatically"}
                </p>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  return (
    <MemberLayout>
      <div className="container mx-auto px-8 pb-16 max-w-3xl">
        <div className="flex items-end justify-between mb-10 gap-4 flex-wrap">
          <div>
            <p className="text-champagne text-xs tracking-[0.4em] uppercase mb-3">My Account</p>
            <h1 className="font-display text-3xl font-light tracking-wider text-foreground">
              My Bookings
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {checkRefs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={refreshing}
                className="tracking-[0.15em] uppercase"
              >
                {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
              </Button>
            )}
            <Link to="/book">
              <Button size="sm" className="tracking-[0.15em] uppercase">
                New Booking
              </Button>
            </Link>
          </div>
        </div>

        {!isInstalledApp() && (
          <p className="text-smoke text-xs tracking-wider mb-8 -mt-4">
            Follow your chauffeur live on the day with the Apexia VIP app.{" "}
            <a href={GET_APP_URL} className="text-champagne hover:text-foreground transition-colors underline underline-offset-4">
              Get the app
            </a>
          </p>
        )}

        {isLoading ? (
          <div className="py-20 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-champagne mx-auto" />
          </div>
        ) : (bookings ?? []).length === 0 ? (
          <div className="text-center py-16 border border-border">
            <p className="text-smoke text-sm font-light mb-6">
              You have no bookings yet.
            </p>
            <Link
              to="/book"
              className="inline-block border border-champagne text-champagne hover:bg-champagne hover:text-background transition-colors duration-500 text-xs tracking-[0.2em] uppercase px-10 py-4"
            >
              Make an Enquiry
            </Link>
          </div>
        ) : (
          <div className="space-y-12">
            {upcoming.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-smoke text-xs tracking-[0.3em] uppercase">Upcoming</h2>
                {upcoming.map((b) => renderCard(b, true))}
              </section>
            )}
            {past.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-smoke text-xs tracking-[0.3em] uppercase">Past</h2>
                {past.map((b) => renderCard(b, false))}
              </section>
            )}
          </div>
        )}
      </div>
    </MemberLayout>
  );
};

export default Bookings;
