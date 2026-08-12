import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { ArrowLeft, Car, Check, Copy, Loader2, Plus, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cancelBooking } from "@/lib/mfa";
import { useAuth } from "@/hooks/useAuth";
import apexiaLogo from "@/assets/apexia-logo.jpg";
import mcfcBadge from "@/assets/mcfc-badge.svg";

/**
 * Partner travel desk. Outside: members' unbranded sign-in (SMS code).
 * Inside, for accounts on the club's corporate desk: a fully club-branded
 * travel desk (sky blue, navy, white) with Apexia present only as a discreet
 * operated-by credit. Requests dispatch straight into the booking system.
 */

const SKY = "#6CABDD";
const NAVY = "#1C2C5B";
const DESK = "mcfc";

const GROUP_ORDER = ["First Team", "Management", "Executives"];

const VEHICLES = ["S-Class", "Range Rover", "Viano", "JetClass"];

/** Passenger seats per vehicle (chauffeur excluded); must match the server */
const CAPACITY: Record<string, number> = {
  "S-Class": 2,
  "Range Rover": 3,
  Viano: 6,
  JetClass: 5,
};

interface CarRequest {
  passengers: string[];
  pickup: string;
  destination: string;
  vehicle: string;
  time: string;
  notes: string;
}

interface RecentBooking {
  reference: string | null;
  travel_date: string;
  vehicle: string;
  name: string;
  status: string;
  collection_at: string | null;
  pickup: { line1?: string } | null;
  dropoff: { line1?: string } | null;
}

const emptyCar = (): CarRequest => ({
  passengers: [],
  pickup: "",
  destination: "",
  vehicle: "S-Class",
  time: "",
  notes: "",
});

const lightLabel = "block text-[11px] tracking-[0.18em] uppercase mb-2";
const lightInput =
  "w-full h-11 bg-white border rounded-none px-3 text-sm outline-none transition-colors";
const lightInputStyle = {
  borderColor: "rgba(28,44,91,0.3)",
  color: NAVY,
} as const;

const McfcPortal = () => {
  const { user, profile, loading, mfaVerified, mfaResolved, signOut } = useAuth();

  const [passengerGroups, setPassengerGroups] = useState<{ group: string; names: string[] }[]>([]);
  const [travelDate, setTravelDate] = useState("");
  const [cars, setCars] = useState<CarRequest[]>([emptyCar()]);
  const [submitted, setSubmitted] = useState<{
    cars: number;
    passengers: number;
    date: string;
    amended: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentBooking[]>([]);
  // Amending an existing car: its reference; Dispatch overwrites on resubmit
  const [amendRef, setAmendRef] = useState<string | null>(null);
  const [cancelConfirmRef, setCancelConfirmRef] = useState<string | null>(null);
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const hasDeskAccess = profile?.corporate === DESK;

  // Approved passenger list, maintained by the operations team
  useEffect(() => {
    if (!hasDeskAccess || !mfaVerified) return;
    let cancelled = false;
    supabase
      .from("corporate_passengers")
      .select("name, grp, sort")
      .eq("corporate", DESK)
      .eq("active", true)
      .order("sort")
      .then(({ data }) => {
        if (cancelled || !data) return;
        const groups = [...new Set(data.map((r) => r.grp))].sort(
          (a, b) =>
            (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99)
        );
        setPassengerGroups(
          groups.map((g) => ({
            group: g,
            names: data.filter((r) => r.grp === g).map((r) => r.name),
          }))
        );
      });
    return () => {
      cancelled = true;
    };
  }, [hasDeskAccess, mfaVerified]);

  const loadRecent = useCallback(() => {
    if (!user || !hasDeskAccess || !mfaVerified) return;
    supabase
      .from("bookings")
      .select("reference, travel_date, vehicle, name, status, collection_at, pickup, dropoff")
      .eq("corporate", DESK)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setRecent((data as RecentBooking[] | null) ?? []));
  }, [user, hasDeskAccess, mfaVerified]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const totalPassengers = useMemo(
    () => cars.reduce((n, c) => n + c.passengers.length, 0),
    [cars]
  );

  const updateCar = (i: number, patch: Partial<CarRequest>) =>
    setCars((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const togglePassenger = (i: number, name: string) =>
    setCars((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        if (c.passengers.includes(name)) {
          return { ...c, passengers: c.passengers.filter((p) => p !== name) };
        }
        // Never seat more passengers than the vehicle holds
        if (c.passengers.length >= (CAPACITY[c.vehicle] ?? 2)) return c;
        return { ...c, passengers: [...c.passengers, name] };
      })
    );

  const copyDestinationToAll = () => {
    const dest = cars[0]?.destination ?? "";
    setCars((prev) => prev.map((c) => ({ ...c, destination: dest })));
  };

  const overCapacity = (c: CarRequest) => c.passengers.length > (CAPACITY[c.vehicle] ?? 2);

  // Load an existing car back into the form; resubmitting overwrites the
  // booking because the reference is reused. Notes are not stored, so they
  // start blank.
  const beginAmend = (b: RecentBooking) => {
    if (!b.reference) return;
    setAmendRef(b.reference);
    setTravelDate(b.collection_at ? b.collection_at.slice(0, 10) : "");
    setCars([
      {
        passengers: b.name ? b.name.split(", ").filter(Boolean) : [],
        pickup: b.pickup?.line1 ?? "",
        destination: b.dropoff?.line1 ?? "",
        vehicle: VEHICLES.includes(b.vehicle) ? b.vehicle : "S-Class",
        time: b.collection_at ? b.collection_at.slice(11, 16) : "",
        notes: "",
      },
    ]);
    setPickerOpen(null);
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const discardAmend = () => {
    setAmendRef(null);
    setCars([emptyCar()]);
    setTravelDate("");
    setSubmitError(null);
  };

  const cancelRequest = async (reference: string) => {
    setCancellingRef(reference);
    setCancelError(null);
    try {
      await cancelBooking(reference);
      if (amendRef === reference) discardAmend();
      loadRecent();
    } catch (err) {
      setCancelError(
        err instanceof Error && err.message !== "Something went wrong"
          ? err.message
          : "We couldn't cancel this booking. Please contact us."
      );
    } finally {
      setCancellingRef(null);
      setCancelConfirmRef(null);
    }
  };

  const canSubmit =
    !submitting &&
    travelDate &&
    cars.length > 0 &&
    cars.every(
      (c) => c.passengers.length > 0 && c.pickup && c.destination && c.time && !overCapacity(c)
    );

  const submitRequest = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("corporate-booking", {
        body: {
          travelDate,
          ...(amendRef ? { amendReference: amendRef } : {}),
          cars: cars.map((c) => ({
            passengers: c.passengers,
            pickup: c.pickup.trim(),
            destination: c.destination.trim(),
            vehicle: c.vehicle,
            time: c.time,
            notes: c.notes.trim(),
          })),
        },
      });
      let message: string | null = null;
      if (error) {
        try {
          const parsed = await (error as { context?: Response }).context?.json();
          message = parsed?.error ?? null;
        } catch {
          message = null;
        }
        if (!message) message = "We couldn't send this request. Please try again.";
      } else if (!data?.success) {
        message = data?.error ?? "We couldn't send this request. Please try again.";
      }
      if (message) {
        setSubmitError(message);
      } else {
        setSubmitted({
          cars: cars.length,
          passengers: totalPassengers,
          date: travelDate,
          amended: !!amendRef,
        });
        setCars([emptyCar()]);
        setTravelDate("");
        setAmendRef(null);
        setPickerOpen(null);
        loadRecent();
      }
    } catch {
      setSubmitError("We couldn't send this request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Access gates (no partner branding visible outside) ----------
  if (loading || (user && (!mfaResolved || !profile))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-smoke" />
      </div>
    );
  }

  if (!user || (mfaResolved && !mfaVerified)) {
    return <Navigate to="/login" state={{ from: "/mcfc" }} replace />;
  }

  if (!hasDeskAccess) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8">
        <Link
          to="/"
          className="absolute top-8 left-8 flex items-center gap-2 text-smoke hover:text-foreground transition-colors duration-500 text-xs tracking-[0.2em] uppercase"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="w-full max-w-md text-center">
          <img src={apexiaLogo} alt="Apexia VIP" className="h-24 w-auto mx-auto mb-10" />
          <p className="text-xs tracking-[0.4em] uppercase mb-4" style={{ color: SKY }}>
            Partner Portal
          </p>
          <h1 className="font-display text-3xl font-light tracking-wider text-foreground mb-4">
            Team Travel Desk
          </h1>
          <p className="text-smoke text-sm font-light leading-relaxed">
            This desk is restricted to authorised operations staff. Your account
            does not have access. If you believe it should, please contact your
            Apexia VIP account manager.
          </p>
        </div>
      </div>
    );
  }

  // ---------- Confirmation (club branded) ----------
  if (submitted) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-8"
        style={{ backgroundColor: SKY }}
      >
        <div className="bg-white max-w-lg w-full text-center px-10 py-14 shadow-xl">
          <div className="flex justify-center mb-6">
            <img src={mcfcBadge} alt="Manchester City FC" className="h-20 w-auto" />
          </div>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: NAVY }}
          >
            <Check className="w-6 h-6 text-white" />
          </div>
          <h2
            className="font-display text-3xl font-light tracking-wider mb-4"
            style={{ color: NAVY }}
          >
            {submitted.amended ? "Booking Amended" : "Request Confirmed"}
          </h2>
          <p className="text-sm leading-relaxed mb-2" style={{ color: `${NAVY}B3` }}>
            {submitted.cars} {submitted.cars === 1 ? "car" : "cars"} for {submitted.passengers}{" "}
            {submitted.passengers === 1 ? "passenger" : "passengers"} on {submitted.date}.
          </p>
          <p className="text-sm leading-relaxed mb-10" style={{ color: `${NAVY}B3` }}>
            {submitted.amended
              ? "The booking has been updated and your travel team notified."
              : "Each car is now with your travel team, who will assign chauffeurs and vehicles. You can follow every request from this desk."}
          </p>
          <button
            onClick={() => setSubmitted(null)}
            className="tracking-[0.2em] uppercase text-xs px-8 py-4 text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: NAVY }}
          >
            Back to the Desk
          </button>
        </div>
      </div>
    );
  }

  // ---------- Travel desk (fully club branded, behind sign-in) ----------
  return (
    <div className="min-h-screen" style={{ backgroundColor: SKY }}>
      <header style={{ backgroundColor: SKY }}>
        <div className="container mx-auto px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <img src={mcfcBadge} alt="Manchester City FC" className="h-16 w-auto" />
            <div>
              <span className="font-display text-3xl tracking-[0.2em] leading-none text-white">
                MANCHESTER CITY
              </span>
              <p className="text-[10px] tracking-[0.35em] uppercase mt-1.5 text-white/80">
                Team Travel Desk
              </p>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <p className="text-white/60 text-[10px] tracking-[0.2em] uppercase hidden md:block">
              Operated by Apexia VIP
            </p>
            <button
              type="button"
              onClick={() => signOut()}
              className="text-white/80 hover:text-white transition-colors text-xs tracking-[0.15em] uppercase"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-8 py-10 max-w-6xl">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
          <div>
            <p
              className="text-xs tracking-[0.4em] uppercase mb-2"
              style={{ color: NAVY }}
            >
              {amendRef ? "Amend Booking" : "New Request"}
            </p>
            <h1
              className="font-display text-4xl font-light tracking-wider"
              style={{ color: "#ffffff" }}
            >
              Arrange Travel
            </h1>
          </div>
          <div className="flex items-center gap-6 text-sm" style={{ color: NAVY }}>
            <span className="inline-flex items-center gap-2 font-medium">
              <Car className="w-4 h-4" />
              {cars.length} {cars.length === 1 ? "car" : "cars"}
            </span>
            <span className="inline-flex items-center gap-2 font-medium">
              <Users className="w-4 h-4" />
              {totalPassengers} {totalPassengers === 1 ? "passenger" : "passengers"}
            </span>
          </div>
        </div>

        {amendRef && (
          <div
            className="p-4 mb-6 flex items-center justify-between flex-wrap gap-3 text-sm"
            style={{ backgroundColor: NAVY, color: "#ffffff" }}
          >
            <span>
              Amending an existing booking. Submitting will update the car with
              your travel team; nothing changes until you submit.
            </span>
            <button
              type="button"
              onClick={discardAmend}
              className="underline underline-offset-4 text-white/80 hover:text-white text-xs tracking-[0.15em] uppercase"
            >
              Discard Changes
            </button>
          </div>
        )}

        <div className="bg-white p-6 shadow-md mb-6 max-w-xl">
          <label className={lightLabel} style={{ color: `${NAVY}99` }}>
            Date of Travel
          </label>
          <input
            type="date"
            value={travelDate}
            onChange={(e) => setTravelDate(e.target.value)}
            className={lightInput}
            style={lightInputStyle}
          />
        </div>

        <div className="space-y-6">
          {cars.map((car, i) => (
            <section key={i} className="bg-white p-6 shadow-md">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm tracking-[0.2em] uppercase font-semibold" style={{ color: NAVY }}>
                  Car {i + 1}
                  <span
                    className={
                      "ml-4 text-xs tracking-normal normal-case font-normal " +
                      (overCapacity(car) ? "text-red-600" : "")
                    }
                    style={overCapacity(car) ? undefined : { color: `${NAVY}80` }}
                  >
                    {car.passengers.length} of {CAPACITY[car.vehicle] ?? 2} seats
                  </span>
                </h2>
                {cars.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove car ${i + 1}`}
                    onClick={() => setCars((prev) => prev.filter((_, idx) => idx !== i))}
                    className="transition-colors hover:opacity-70"
                    style={{ color: `${NAVY}80` }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="mb-5">
                <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                  Passengers
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {car.passengers.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white"
                      style={{ backgroundColor: NAVY }}
                    >
                      {p}
                      <button
                        type="button"
                        aria-label={`Remove ${p}`}
                        onClick={() => togglePassenger(i, p)}
                        className="text-white/60 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(pickerOpen === i ? null : i)}
                    className="inline-flex items-center gap-1.5 border border-dashed px-3 py-1.5 text-sm transition-colors hover:bg-[#6CABDD]/10"
                    style={{ borderColor: `${NAVY}66`, color: NAVY }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add passenger
                  </button>
                </div>

                {pickerOpen === i && (
                  <div
                    className="mt-3 border bg-white p-4 max-h-72 overflow-y-auto"
                    style={{ borderColor: `${NAVY}33` }}
                  >
                    {car.passengers.length >= (CAPACITY[car.vehicle] ?? 2) && (
                      <p className="text-xs mb-3 font-medium" style={{ color: NAVY }}>
                        The {car.vehicle} seats {CAPACITY[car.vehicle] ?? 2}. Choose a larger
                        vehicle or add another car for more passengers.
                      </p>
                    )}
                    {passengerGroups.length === 0 && (
                      <p className="text-xs" style={{ color: `${NAVY}99` }}>
                        Loading the passenger list…
                      </p>
                    )}
                    {passengerGroups.map((g) => (
                      <div key={g.group} className="mb-4 last:mb-0">
                        <p
                          className="text-[11px] tracking-[0.25em] uppercase mb-2 font-semibold"
                          style={{ color: NAVY }}
                        >
                          {g.group}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {g.names.map((name) => {
                            const selected = car.passengers.includes(name);
                            const atCapacity =
                              !selected &&
                              car.passengers.length >= (CAPACITY[car.vehicle] ?? 2);
                            return (
                              <button
                                key={name}
                                type="button"
                                onClick={() => togglePassenger(i, name)}
                                disabled={atCapacity}
                                className="border px-3 py-1.5 text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                style={
                                  selected
                                    ? { borderColor: NAVY, color: "#ffffff", backgroundColor: NAVY }
                                    : { borderColor: `${NAVY}4D`, color: NAVY }
                                }
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Pickup
                  </label>
                  <input
                    placeholder="e.g. Etihad Campus"
                    value={car.pickup}
                    onChange={(e) => updateCar(i, { pickup: e.target.value })}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                </div>
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Destination
                  </label>
                  <input
                    placeholder="e.g. Manchester Airport T3"
                    value={car.destination}
                    onChange={(e) => updateCar(i, { destination: e.target.value })}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                </div>
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Pickup Time
                  </label>
                  <input
                    type="time"
                    value={car.time}
                    onChange={(e) => updateCar(i, { time: e.target.value })}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                </div>
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Vehicle
                  </label>
                  <select
                    value={car.vehicle}
                    onChange={(e) => updateCar(i, { vehicle: e.target.value })}
                    className={lightInput}
                    style={lightInputStyle}
                  >
                    {VEHICLES.map((v) => (
                      <option key={v} value={v}>
                        {v} ({CAPACITY[v]} seats)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {overCapacity(car) && (
                <p className="text-red-600 text-xs mt-3">
                  Too many passengers for the {car.vehicle} ({CAPACITY[car.vehicle] ?? 2} seats).
                  Choose a larger vehicle or move someone to another car.
                </p>
              )}

              <div className="mt-4">
                <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                  Notes for the chauffeur (optional)
                </label>
                <input
                  placeholder="Meeting point, luggage, discretion notes"
                  value={car.notes}
                  onChange={(e) => updateCar(i, { notes: e.target.value })}
                  className={lightInput}
                  style={lightInputStyle}
                />
              </div>
            </section>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-6">
          {!amendRef && (
            <button
              type="button"
              onClick={() => setCars((prev) => [...prev, emptyCar()])}
              className="inline-flex items-center gap-2 border border-dashed bg-white/40 hover:bg-white px-5 py-3 text-xs tracking-[0.2em] uppercase transition-colors"
              style={{ borderColor: NAVY, color: NAVY }}
            >
              <Plus className="w-4 h-4" />
              Add Another Car
            </button>
          )}
          {cars.length > 1 && (
            <button
              type="button"
              onClick={copyDestinationToAll}
              className="inline-flex items-center gap-2 px-2 py-3 text-xs tracking-[0.2em] uppercase transition-opacity hover:opacity-70"
              style={{ color: NAVY }}
            >
              <Copy className="w-4 h-4" />
              Same destination for all cars
            </button>
          )}
        </div>

        <div className="mt-10 flex items-center gap-6 flex-wrap">
          <button
            disabled={!canSubmit}
            onClick={submitRequest}
            className="tracking-[0.2em] uppercase text-xs px-10 py-4 text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
            style={{ backgroundColor: NAVY }}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? "Sending" : amendRef ? "Submit Amendment" : "Submit Request"}
          </button>
          {!canSubmit && !submitting && (
            <p className="text-xs" style={{ color: `${NAVY}B3` }}>
              Each car needs at least one passenger, a pickup, a destination and a time.
            </p>
          )}
          {submitError && <p className="text-xs font-medium text-red-700">{submitError}</p>}
        </div>

        {recent.length > 0 && (
          <section className="mt-14">
            <h2 className="text-sm tracking-[0.2em] uppercase font-semibold mb-4" style={{ color: NAVY }}>
              Recent Requests
            </h2>
            {cancelError && (
              <p className="text-xs font-medium text-red-700 mb-3">{cancelError}</p>
            )}
            <div className="bg-white shadow-md overflow-x-auto">
              <table className="w-full text-sm" style={{ color: NAVY }}>
                <thead>
                  <tr
                    className="text-[11px] tracking-[0.18em] uppercase text-left"
                    style={{ color: `${NAVY}99` }}
                  >
                    <th className="px-4 py-3 font-medium">Travel Date</th>
                    <th className="px-4 py-3 font-medium">Vehicle</th>
                    <th className="px-4 py-3 font-medium">Passengers</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((b, idx) => {
                    const actionable =
                      !!b.reference && b.status !== "Cancelled" && b.status !== "Failed";
                    const confirming = cancelConfirmRef === b.reference;
                    const cancelling = cancellingRef === b.reference;
                    return (
                      <tr
                        key={b.reference ?? idx}
                        className="border-t"
                        style={{ borderColor: "rgba(28,44,91,0.12)" }}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">{b.travel_date}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{b.vehicle}</td>
                        <td className="px-4 py-3">{b.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className="inline-block px-2.5 py-1 text-[11px] tracking-[0.12em] uppercase text-white"
                            style={{
                              backgroundColor:
                                b.status === "Failed" || b.status === "Cancelled"
                                  ? "#b91c1c"
                                  : NAVY,
                            }}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          {actionable && (
                            <span className="inline-flex items-center gap-4 text-[11px] tracking-[0.12em] uppercase">
                              {!confirming && (
                                <button
                                  type="button"
                                  onClick={() => beginAmend(b)}
                                  className="underline underline-offset-4 hover:opacity-70 transition-opacity"
                                  style={{ color: NAVY }}
                                >
                                  Amend
                                </button>
                              )}
                              {confirming ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={cancelling}
                                    onClick={() => cancelRequest(b.reference!)}
                                    className="px-2.5 py-1 text-white disabled:opacity-50"
                                    style={{ backgroundColor: "#b91c1c" }}
                                  >
                                    {cancelling ? "Cancelling…" : "Confirm Cancel"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={cancelling}
                                    onClick={() => setCancelConfirmRef(null)}
                                    className="underline underline-offset-4 hover:opacity-70 transition-opacity"
                                    style={{ color: NAVY }}
                                  >
                                    Keep
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCancelError(null);
                                    setCancelConfirmRef(b.reference);
                                  }}
                                  className="underline underline-offset-4 hover:opacity-70 transition-opacity text-red-700"
                                >
                                  Cancel
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="text-[11px] tracking-[0.1em] mt-14" style={{ color: `${NAVY}80` }}>
          Operated by Apexia VIP. All activity confidential.
        </p>
      </main>
    </div>
  );
};

export default McfcPortal;
