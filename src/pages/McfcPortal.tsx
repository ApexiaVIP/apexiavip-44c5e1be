import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Car,
  Check,
  Copy,
  Loader2,
  MapPin,
  Plus,
  Printer,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
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
  /** Match-day front-entrance drop-off */
  greyTarmac: boolean;
}

interface CorporateAddress {
  id: string;
  label: string;
  address: string;
  passenger_id: string | null;
  grey_tarmac: boolean;
}

interface Fixture {
  id: string;
  kickoff_utc: string;
  home_team: string;
  away_team: string;
  opponent: string;
  is_home: boolean;
  venue: string;
  round_number: number | null;
  competition: string;
}

interface FixtureChange {
  id: string;
  field: string;
  old_value: string;
  new_value: string;
  detected_at: string;
}

interface ScheduleRow {
  reference: string | null;
  name: string;
  vehicle: string;
  passengers: number | null;
  collection_at: string | null;
  pickup: { line1?: string } | null;
  dropoff: { line1?: string; grey_tarmac?: boolean } | null;
  status: string;
  live: {
    bookingStatus: string | null;
    driverName: string;
    driverMobile: string;
    vehicleDescription: string;
    vehicleRegistration: string;
  } | null;
}

interface RecentBooking {
  reference: string | null;
  travel_date: string;
  vehicle: string;
  name: string;
  status: string;
  collection_at: string | null;
  pickup: { line1?: string } | null;
  dropoff: { line1?: string; grey_tarmac?: boolean } | null;
}

const emptyCar = (): CarRequest => ({
  passengers: [],
  pickup: "",
  destination: "",
  vehicle: "S-Class",
  time: "",
  notes: "",
  greyTarmac: false,
});

/** Kickoffs are stored in UTC; the desk works in UK time. */
const ukDateKey = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

const ukTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });

const ukDateLong = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const fixtureTitle = (f: Fixture) =>
  `${f.home_team} v ${f.away_team} - KICK OFF ${ukTime(f.kickoff_utc)}`;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

/** Invoke the desk's edge function, surfacing the server's error message. */
const invokeDesk = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("corporate-booking", { body });
  if (error) {
    let message = "Something went wrong. Please try again.";
    try {
      const parsed = await (error as { context?: Response }).context?.json();
      if (parsed?.error) message = parsed.error;
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  if (!data?.success) throw new Error(data?.error ?? "Something went wrong. Please try again.");
  return data;
};

const lightLabel = "block text-[11px] tracking-[0.18em] uppercase mb-2";
const lightInput =
  "w-full h-11 bg-white border rounded-none px-3 text-sm outline-none transition-colors";
const lightInputStyle = {
  borderColor: "rgba(28,44,91,0.3)",
  color: NAVY,
} as const;

const McfcPortal = () => {
  const { user, profile, loading, mfaVerified, mfaResolved, signOut } = useAuth();

  const [view, setView] = useState<"desk" | "fixtures" | "addresses" | "schedule">("desk");
  const [passengerGroups, setPassengerGroups] = useState<{ group: string; names: string[] }[]>([]);
  const [passengerOptions, setPassengerOptions] = useState<
    { id: string; name: string; grp: string }[]
  >([]);
  const [addresses, setAddresses] = useState<CorporateAddress[]>([]);
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

  // Address book form
  const [addrLabel, setAddrLabel] = useState("");
  const [addrText, setAddrText] = useState("");
  const [addrPersonId, setAddrPersonId] = useState("");
  const [addrGrey, setAddrGrey] = useState(false);
  const [addrSaving, setAddrSaving] = useState(false);
  const [addrError, setAddrError] = useState<string | null>(null);
  const [addrDeletingId, setAddrDeletingId] = useState<string | null>(null);

  // Fixtures
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fixtureChanges, setFixtureChanges] = useState<FixtureChange[]>([]);
  const [fixturesSyncing, setFixturesSyncing] = useState(false);
  const [fixturesError, setFixturesError] = useState<string | null>(null);

  // Match-day schedule
  const [scheduleDate, setScheduleDate] = useState(todayStr());
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleTitleTouched, setScheduleTitleTouched] = useState(false);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);

  const hasDeskAccess = profile?.corporate === DESK;

  // Approved passenger list, maintained by the operations team
  useEffect(() => {
    if (!hasDeskAccess || !mfaVerified) return;
    let cancelled = false;
    supabase
      .from("corporate_passengers")
      .select("id, name, grp, sort")
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
        setPassengerOptions(
          groups.flatMap((g) =>
            data.filter((r) => r.grp === g).map((r) => ({ id: r.id, name: r.name, grp: g }))
          )
        );
      });
    return () => {
      cancelled = true;
    };
  }, [hasDeskAccess, mfaVerified]);

  const loadFixtures = useCallback(() => {
    if (!hasDeskAccess || !mfaVerified) return;
    // Yesterday onwards: a fixture stays useful while its cars are running
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    supabase
      .from("fixtures")
      .select(
        "id, kickoff_utc, home_team, away_team, opponent, is_home, venue, round_number, competition"
      )
      .eq("corporate", DESK)
      .gte("kickoff_utc", from)
      .order("kickoff_utc")
      .then(({ data }) => setFixtures(data ?? []));
    supabase
      .from("fixture_changes")
      .select("id, field, old_value, new_value, detected_at")
      .eq("corporate", DESK)
      .gte("detected_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .order("detected_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setFixtureChanges(data ?? []));
  }, [hasDeskAccess, mfaVerified]);

  useEffect(() => {
    loadFixtures();
  }, [loadFixtures]);

  const syncFixtures = async () => {
    setFixturesSyncing(true);
    setFixturesError(null);
    try {
      const { data, error } = await supabase.functions.invoke("fixtures-sync", { body: {} });
      if (error) throw new Error("We couldn't refresh the fixtures. Please try again.");
      if (!data?.success) throw new Error(data?.error ?? "We couldn't refresh the fixtures.");
      loadFixtures();
    } catch (err) {
      setFixturesError(
        err instanceof Error ? err.message : "We couldn't refresh the fixtures. Please try again."
      );
    } finally {
      setFixturesSyncing(false);
    }
  };

  const loadAddresses = useCallback(() => {
    if (!hasDeskAccess || !mfaVerified) return;
    supabase
      .from("corporate_addresses")
      .select("id, label, address, passenger_id, grey_tarmac")
      .eq("corporate", DESK)
      .order("label")
      .then(({ data }) => setAddresses(data ?? []));
  }, [hasDeskAccess, mfaVerified]);

  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

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

  const passengerIdByName = useMemo(() => {
    const m = new Map<string, string>();
    passengerOptions.forEach((p) => m.set(p.name, p.id));
    return m;
  }, [passengerOptions]);

  const passengerNameById = (id: string | null) =>
    passengerOptions.find((p) => p.id === id)?.name ?? null;

  // Saved addresses relevant to this car: globals plus the personal addresses
  // of whoever is seated in it
  const addressChoicesFor = (car: CarRequest) => {
    const ids = new Set(
      car.passengers.map((n) => passengerIdByName.get(n)).filter(Boolean) as string[]
    );
    return addresses.filter((a) => !a.passenger_id || ids.has(a.passenger_id));
  };

  // Grey tarmac is offered when the destination is a saved address flagged
  // for front-entrance drop-off
  const greyAvailableFor = (car: CarRequest) =>
    addresses.some((a) => a.grey_tarmac && a.address === car.destination);

  const addAddress = async () => {
    setAddrSaving(true);
    setAddrError(null);
    try {
      await invokeDesk({
        action: "address_add",
        label: addrLabel.trim(),
        address: addrText.trim(),
        ...(addrPersonId ? { passengerId: addrPersonId } : {}),
        greyTarmac: addrGrey,
      });
      setAddrLabel("");
      setAddrText("");
      setAddrPersonId("");
      setAddrGrey(false);
      loadAddresses();
    } catch (err) {
      setAddrError(err instanceof Error ? err.message : "We couldn't save this address.");
    } finally {
      setAddrSaving(false);
    }
  };

  const deleteAddress = async (id: string) => {
    setAddrDeletingId(id);
    setAddrError(null);
    try {
      await invokeDesk({ action: "address_delete", id });
      loadAddresses();
    } catch (err) {
      setAddrError(err instanceof Error ? err.message : "We couldn't remove this address.");
    } finally {
      setAddrDeletingId(null);
    }
  };

  /** Start a booking for a fixture: date and destination prefilled. */
  const bookForFixture = (f: Fixture) => {
    const venue = f.venue.trim();
    const matches = addresses.filter(
      (a) =>
        venue &&
        (a.address.toLowerCase().includes(venue.toLowerCase()) ||
          a.label.toLowerCase().includes(venue.toLowerCase()))
    );
    // On a match day the front-entrance address is the useful one
    const saved = matches.find((a) => a.grey_tarmac) ?? matches[0];
    setTravelDate(ukDateKey(f.kickoff_utc));
    setCars([{ ...emptyCar(), destination: saved?.address ?? venue }]);
    setAmendRef(null);
    setSubmitError(null);
    setPickerOpen(null);
    setView("desk");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // The printed schedule names the fixture unless the desk has typed its own
  useEffect(() => {
    if (scheduleTitleTouched) return;
    const f = fixtures.find((fx) => ukDateKey(fx.kickoff_utc) === scheduleDate);
    setScheduleTitle(f ? fixtureTitle(f) : "");
  }, [scheduleDate, fixtures, scheduleTitleTouched]);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const data = await invokeDesk({ action: "schedule", date: scheduleDate });
      setScheduleRows(Array.isArray(data.schedule) ? data.schedule : []);
      setScheduleLoaded(true);
    } catch (err) {
      setScheduleError(
        err instanceof Error ? err.message : "We couldn't load the schedule. Please try again."
      );
    } finally {
      setScheduleLoading(false);
    }
  }, [scheduleDate]);

  useEffect(() => {
    if (view !== "schedule" || !hasDeskAccess || !mfaVerified) return;
    loadSchedule();
  }, [view, loadSchedule, hasDeskAccess, mfaVerified]);

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
        greyTarmac: b.dropoff?.grey_tarmac === true,
      },
    ]);
    setView("desk");
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
            greyTarmac: c.greyTarmac && greyAvailableFor(c),
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

      <nav className="container mx-auto px-8 pt-2 pb-0 flex items-center gap-2 no-print">
        {(
          [
            { key: "desk", label: "Travel Desk", icon: Car },
            { key: "fixtures", label: "Fixtures", icon: CalendarDays },
            { key: "addresses", label: "Address Book", icon: MapPin },
            { key: "schedule", label: "Match Day Schedule", icon: Printer },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs tracking-[0.18em] uppercase transition-colors"
            style={
              view === t.key
                ? { backgroundColor: NAVY, color: "#ffffff" }
                : { color: NAVY, backgroundColor: "rgba(255,255,255,0.45)" }
            }
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </nav>

      <main className="container mx-auto px-8 py-10 max-w-6xl">
        {view === "desk" && (
          <>
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
                  {addressChoicesFor(car).length > 0 && (
                    <select
                      value=""
                      aria-label="Saved pickup addresses"
                      onChange={(e) => {
                        if (e.target.value) updateCar(i, { pickup: e.target.value });
                      }}
                      className="w-full mt-2 h-9 bg-white border rounded-none px-2 text-xs outline-none"
                      style={lightInputStyle}
                    >
                      <option value="">Saved addresses…</option>
                      {addressChoicesFor(car).map((a) => (
                        <option key={a.id} value={a.address}>
                          {a.label}
                          {a.passenger_id ? ` (${passengerNameById(a.passenger_id) ?? ""})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Destination
                  </label>
                  <input
                    placeholder="e.g. Manchester Airport T3"
                    value={car.destination}
                    onChange={(e) =>
                      updateCar(i, { destination: e.target.value, greyTarmac: false })
                    }
                    className={lightInput}
                    style={lightInputStyle}
                  />
                  {addressChoicesFor(car).length > 0 && (
                    <select
                      value=""
                      aria-label="Saved destination addresses"
                      onChange={(e) => {
                        if (e.target.value)
                          updateCar(i, { destination: e.target.value, greyTarmac: false });
                      }}
                      className="w-full mt-2 h-9 bg-white border rounded-none px-2 text-xs outline-none"
                      style={lightInputStyle}
                    >
                      <option value="">Saved addresses…</option>
                      {addressChoicesFor(car).map((a) => (
                        <option key={a.id} value={a.address}>
                          {a.label}
                          {a.passenger_id ? ` (${passengerNameById(a.passenger_id) ?? ""})` : ""}
                          {a.grey_tarmac ? " - Grey Tarmac available" : ""}
                        </option>
                      ))}
                    </select>
                  )}
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

              {greyAvailableFor(car) && (
                <label
                  className="mt-4 inline-flex items-center gap-3 text-sm cursor-pointer px-3 py-2"
                  style={{ backgroundColor: car.greyTarmac ? "#FFF59D" : "rgba(28,44,91,0.06)", color: NAVY }}
                >
                  <input
                    type="checkbox"
                    checked={car.greyTarmac}
                    onChange={(e) => updateCar(i, { greyTarmac: e.target.checked })}
                    className="w-4 h-4 accent-[#1C2C5B]"
                  />
                  Grey Tarmac drop off (front entrance on match day)
                </label>
              )}

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

          </>
        )}

        {view === "fixtures" && (
          <>
            <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
              <div>
                <p className="text-xs tracking-[0.4em] uppercase mb-2" style={{ color: NAVY }}>
                  Season Calendar
                </p>
                <h1 className="font-display text-4xl font-light tracking-wider text-white">
                  Fixtures
                </h1>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <button
                  type="button"
                  onClick={syncFixtures}
                  disabled={fixturesSyncing}
                  className="inline-flex items-center gap-2 px-5 py-3 text-xs tracking-[0.18em] uppercase transition-opacity hover:opacity-80 disabled:opacity-40 border bg-white/40"
                  style={{ borderColor: NAVY, color: NAVY }}
                >
                  <RefreshCw
                    className={"w-3.5 h-3.5" + (fixturesSyncing ? " animate-spin" : "")}
                  />
                  {fixturesSyncing ? "Checking" : "Check for changes"}
                </button>
              </div>
            </div>

            {fixturesError && (
              <p className="text-xs font-medium text-red-700 mb-4">{fixturesError}</p>
            )}

            {fixtureChanges.length > 0 && (
              <section className="bg-white p-5 shadow-md mb-6 border-l-4" style={{ borderColor: "#b91c1c" }}>
                <h2
                  className="text-sm tracking-[0.2em] uppercase font-semibold mb-3"
                  style={{ color: NAVY }}
                >
                  Recent Changes
                </h2>
                <ul className="space-y-1.5 text-sm" style={{ color: NAVY }}>
                  {fixtureChanges.map((c) => (
                    <li key={c.id}>
                      {c.field === "kickoff" ? (
                        <>
                          Kick off moved from <strong>{ukDateLong(c.old_value)} {ukTime(c.old_value)}</strong>{" "}
                          to <strong>{ukDateLong(c.new_value)} {ukTime(c.new_value)}</strong>
                        </>
                      ) : c.field === "venue" ? (
                        <>
                          Venue changed from <strong>{c.old_value || "unset"}</strong> to{" "}
                          <strong>{c.new_value || "unset"}</strong>
                        </>
                      ) : (
                        <>Fixture added: <strong>{c.new_value}</strong></>
                      )}
                      <span className="text-xs" style={{ color: `${NAVY}80` }}>
                        {" "}
                        (spotted {ukDateLong(c.detected_at)})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs mt-3" style={{ color: `${NAVY}99` }}>
                  Check any cars already booked around these dates.
                </p>
              </section>
            )}

            <div className="bg-white shadow-md overflow-x-auto">
              <table className="w-full text-sm" style={{ color: NAVY }}>
                <thead>
                  <tr
                    className="text-[11px] tracking-[0.18em] uppercase text-left"
                    style={{ color: `${NAVY}99` }}
                  >
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Kick Off</th>
                    <th className="px-4 py-3 font-medium">Fixture</th>
                    <th className="px-4 py-3 font-medium">Home / Away</th>
                    <th className="px-4 py-3 font-medium">Venue</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {fixtures.map((f) => (
                    <tr
                      key={f.id}
                      className="border-t"
                      style={{ borderColor: "rgba(28,44,91,0.12)" }}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">{ukDateLong(f.kickoff_utc)}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium">
                        {ukTime(f.kickoff_utc)}
                      </td>
                      <td className="px-4 py-3">
                        {f.home_team} v {f.away_team}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className="inline-block px-2.5 py-1 text-[11px] tracking-[0.12em] uppercase font-semibold"
                          style={
                            f.is_home
                              ? { backgroundColor: SKY, color: "#ffffff" }
                              : { backgroundColor: "rgba(28,44,91,0.1)", color: NAVY }
                          }
                        >
                          {f.is_home ? "Home" : "Away"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{f.venue}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-4 text-[11px] tracking-[0.12em] uppercase">
                          <button
                            type="button"
                            onClick={() => bookForFixture(f)}
                            className="underline underline-offset-4 hover:opacity-70 transition-opacity"
                            style={{ color: NAVY }}
                          >
                            Book Travel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setScheduleDate(ukDateKey(f.kickoff_utc));
                              setScheduleTitle(fixtureTitle(f));
                              setScheduleTitleTouched(false);
                              setView("schedule");
                            }}
                            className="underline underline-offset-4 hover:opacity-70 transition-opacity"
                            style={{ color: NAVY }}
                          >
                            Schedule
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {fixtures.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-center" colSpan={6} style={{ color: `${NAVY}99` }}>
                        No fixtures loaded yet. Use "Check for changes" to pull the published
                        schedule.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] mt-4" style={{ color: `${NAVY}99` }}>
              Times shown in UK time. The published schedule is checked automatically every Monday
              and any moved fixture is flagged here and emailed to your travel team.
            </p>
          </>
        )}

        {view === "addresses" && (
          <>
            <div className="mb-8">
              <p className="text-xs tracking-[0.4em] uppercase mb-2" style={{ color: NAVY }}>
                Address Book
              </p>
              <h1 className="font-display text-4xl font-light tracking-wider text-white">
                Saved Addresses
              </h1>
            </div>

            <section className="bg-white p-6 shadow-md mb-8">
              <h2
                className="text-sm tracking-[0.2em] uppercase font-semibold mb-5"
                style={{ color: NAVY }}
              >
                Add an Address
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Name
                  </label>
                  <input
                    placeholder="e.g. Etihad Stadium - Match Day"
                    value={addrLabel}
                    onChange={(e) => setAddrLabel(e.target.value)}
                    maxLength={80}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                </div>
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Address
                  </label>
                  <input
                    placeholder="Full address including postcode"
                    value={addrText}
                    onChange={(e) => setAddrText(e.target.value)}
                    maxLength={240}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                </div>
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Linked To
                  </label>
                  <select
                    value={addrPersonId}
                    onChange={(e) => setAddrPersonId(e.target.value)}
                    className={lightInput}
                    style={lightInputStyle}
                  >
                    <option value="">Everyone (global address)</option>
                    {passengerOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.grp})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label
                    className="flex items-center gap-3 text-sm cursor-pointer"
                    style={{ color: NAVY }}
                  >
                    <input
                      type="checkbox"
                      checked={addrGrey}
                      onChange={(e) => setAddrGrey(e.target.checked)}
                      className="w-4 h-4 accent-[#1C2C5B]"
                    />
                    Grey Tarmac drop off available (match-day front entrance)
                  </label>
                </div>
              </div>
              <div className="mt-5 flex items-center gap-4 flex-wrap">
                <button
                  type="button"
                  disabled={addrSaving || !addrLabel.trim() || !addrText.trim()}
                  onClick={addAddress}
                  className="tracking-[0.2em] uppercase text-xs px-8 py-3.5 text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-3"
                  style={{ backgroundColor: NAVY }}
                >
                  {addrSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Address
                </button>
                {addrError && <p className="text-xs font-medium text-red-700">{addrError}</p>}
              </div>
            </section>

            <div className="bg-white shadow-md overflow-x-auto">
              <table className="w-full text-sm" style={{ color: NAVY }}>
                <thead>
                  <tr
                    className="text-[11px] tracking-[0.18em] uppercase text-left"
                    style={{ color: `${NAVY}99` }}
                  >
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium">Linked To</th>
                    <th className="px-4 py-3 font-medium">Grey Tarmac</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addresses.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t"
                      style={{ borderColor: "rgba(28,44,91,0.12)" }}
                    >
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{a.label}</td>
                      <td className="px-4 py-3">{a.address}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {a.passenger_id ? passengerNameById(a.passenger_id) ?? "…" : "Everyone"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {a.grey_tarmac ? (
                          <span
                            className="inline-block px-2.5 py-1 text-[11px] tracking-[0.12em] uppercase font-semibold"
                            style={{ backgroundColor: "#FFF59D", color: NAVY }}
                          >
                            Available
                          </span>
                        ) : (
                          <span style={{ color: `${NAVY}66` }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={addrDeletingId === a.id}
                          onClick={() => deleteAddress(a.id)}
                          className="underline underline-offset-4 hover:opacity-70 transition-opacity text-[11px] tracking-[0.12em] uppercase text-red-700 disabled:opacity-50"
                        >
                          {addrDeletingId === a.id ? "Removing…" : "Remove"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {addresses.length === 0 && (
                    <tr>
                      <td
                        className="px-4 py-8 text-center"
                        colSpan={5}
                        style={{ color: `${NAVY}99` }}
                      >
                        No saved addresses yet. Add the first one above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {view === "schedule" && (
          <>
            <style>{`
              @media print {
                body * { visibility: hidden; }
                .print-area, .print-area * { visibility: visible; }
                .print-area { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 16px; background: #ffffff; box-shadow: none; }
                .no-print { display: none !important; }
                .print-area * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
            `}</style>
            <div className="mb-8 no-print">
              <p className="text-xs tracking-[0.4em] uppercase mb-2" style={{ color: NAVY }}>
                Match Day
              </p>
              <h1 className="font-display text-4xl font-light tracking-wider text-white">
                Travel Schedule
              </h1>
            </div>

            <section className="bg-white p-6 shadow-md mb-6 no-print">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                </div>
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    Fixture / Title (shown on the printout)
                  </label>
                  <input
                    placeholder="e.g. MCFC vs Arsenal - KICK OFF 16:30"
                    value={scheduleTitle}
                    onChange={(e) => {
                      setScheduleTitle(e.target.value);
                      setScheduleTitleTouched(true);
                    }}
                    maxLength={80}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <button
                    type="button"
                    onClick={loadSchedule}
                    disabled={scheduleLoading}
                    className="tracking-[0.2em] uppercase text-xs px-6 py-3.5 transition-opacity hover:opacity-80 disabled:opacity-40 border"
                    style={{ borderColor: NAVY, color: NAVY }}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    disabled={scheduleRows.length === 0}
                    className="tracking-[0.2em] uppercase text-xs px-6 py-3.5 text-white transition-opacity hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
                    style={{ backgroundColor: NAVY }}
                  >
                    <Printer className="w-4 h-4" />
                    Print
                  </button>
                </div>
              </div>
              {scheduleError && (
                <p className="text-xs font-medium text-red-700 mt-4">{scheduleError}</p>
              )}
            </section>

            <section className="print-area bg-white p-6 shadow-md">
              <div
                className="flex items-center gap-4 pb-4 mb-4 border-b-2"
                style={{ borderColor: SKY }}
              >
                <img src={mcfcBadge} alt="Manchester City FC" className="h-14 w-auto" />
                <div>
                  <p
                    className="text-sm tracking-[0.2em] uppercase font-semibold"
                    style={{ color: NAVY }}
                  >
                    {scheduleTitle.trim() || "Team Travel Schedule"}
                  </p>
                  <p className="text-xs mt-1" style={{ color: `${NAVY}99` }}>
                    {new Date(`${scheduleDate}T00:00:00`).toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                    {" - Operated by Apexia VIP"}
                  </p>
                </div>
              </div>
              {scheduleLoading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: NAVY }} />
                </div>
              ) : scheduleRows.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: `${NAVY}99` }}>
                  {scheduleLoaded
                    ? "No cars are booked for this date."
                    : "Choose a date to load the schedule."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ color: NAVY }}>
                    <thead>
                      <tr
                        className="text-[10px] tracking-[0.15em] uppercase text-left text-white"
                        style={{ backgroundColor: NAVY }}
                      >
                        <th className="px-3 py-2.5 font-semibold">Guest Name</th>
                        <th className="px-3 py-2.5 font-semibold">Pick Up Location</th>
                        <th className="px-3 py-2.5 font-semibold">Pick Up Time</th>
                        <th className="px-3 py-2.5 font-semibold">Destination</th>
                        <th className="px-3 py-2.5 font-semibold">Driver Name</th>
                        <th className="px-3 py-2.5 font-semibold">Driver Number</th>
                        <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                        <th className="px-3 py-2.5 font-semibold">Reg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleRows.map((r, idx) => {
                        const grey = r.dropoff?.grey_tarmac === true;
                        return (
                          <tr
                            key={r.reference ?? idx}
                            className="border-t"
                            style={{
                              borderColor: "rgba(28,44,91,0.15)",
                              backgroundColor: grey ? "#FFF59D" : undefined,
                            }}
                          >
                            <td className="px-3 py-2.5 font-medium">{r.name}</td>
                            <td className="px-3 py-2.5">{r.pickup?.line1 ?? ""}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {r.collection_at ? r.collection_at.slice(11, 16) : ""}
                            </td>
                            <td className="px-3 py-2.5">
                              {r.dropoff?.line1 ?? ""}
                              {grey ? " (GREY TARMAC)" : ""}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {r.live?.driverName || "TBC"}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {r.live?.driverMobile || ""}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {r.live?.vehicleDescription || r.vehicle}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {r.live?.vehicleRegistration || "TBC"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-[10px] mt-3" style={{ color: `${NAVY}99` }}>
                    Rows highlighted yellow are Grey Tarmac front-entrance drop-offs. Driver and
                    vehicle details show TBC until allocated by the travel team.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        <p className="text-[11px] tracking-[0.1em] mt-14 no-print" style={{ color: `${NAVY}80` }}>
          Operated by Apexia VIP. All activity confidential.
        </p>
      </main>
    </div>
  );
};

export default McfcPortal;
