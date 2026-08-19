import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  UserCog,
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

type StopType = "pickup" | "dropoff";

interface Stop {
  type: StopType;
  address: string;
  /** Who boards, or who alights; empty on a drop off means everyone aboard */
  passengers: string[];
  /** How many people an entry stands for, where it represents a party */
  counts?: Record<string, number>;
  /** Match-day front-entrance drop-off */
  greyTarmac: boolean;
}

interface CarRequest {
  /** An ordered run: first stop collects, last stop sets down */
  stops: Stop[];
  vehicle: string;
  time: string;
  notes: string;
  /** Car stays at the passenger's disposal rather than ending somewhere */
  asDirected: boolean;
  asDirectedHours: number;
}

/** Everyone the car carries at some point, in boarding order. */
const manifestOf = (car: CarRequest) => {
  const seen: string[] = [];
  car.stops.forEach((s) => {
    if (s.type !== "pickup") return;
    s.passengers.forEach((p) => {
      if (!seen.includes(p)) seen.push(p);
    });
  });
  return seen;
};

/** How many seats an entry takes at the stop that collected it. */
const seatsFor = (car: CarRequest, name: string) => {
  for (const s of car.stops) {
    if (s.type === "pickup" && s.passengers.includes(name)) {
      return Math.max(1, Math.floor(s.counts?.[name] ?? 1));
    }
  }
  return 1;
};

/** Who is in the car as it arrives at the given stop. */
const aboardAt = (car: CarRequest, index: number) => {
  let aboard: string[] = [];
  car.stops.slice(0, index).forEach((s) => {
    if (s.type === "pickup") {
      s.passengers.forEach((p) => {
        if (!aboard.includes(p)) aboard.push(p);
      });
    } else {
      const leaving = s.passengers.length > 0 ? s.passengers : [...aboard];
      aboard = aboard.filter((p) => !leaving.includes(p));
    }
  });
  return aboard;
};

/** The most people in the car at once, which is what has to fit the seats. */
const peakOf = (car: CarRequest) => {
  let aboard: string[] = [];
  let peak = 0;
  const seats = (list: string[]) => list.reduce((n, p) => n + seatsFor(car, p), 0);
  car.stops.forEach((s) => {
    if (s.type === "pickup") {
      s.passengers.forEach((p) => {
        if (!aboard.includes(p)) aboard.push(p);
      });
      peak = Math.max(peak, seats(aboard));
    } else {
      const leaving = s.passengers.length > 0 ? s.passengers : [...aboard];
      aboard = aboard.filter((p) => !leaving.includes(p));
    }
  });
  return peak;
};

/** What still needs fixing before this car can be sent, in plain words. */
const carIssues = (car: CarRequest): string[] => {
  const issues: string[] = [];
  const capacity = CAPACITY[car.vehicle] ?? 2;
  if (car.stops.length < (car.asDirected ? 1 : 2)) {
    issues.push(
      car.asDirected ? "Add where the car collects." : "Add at least a pick up and a drop off."
    );
  }
  if (car.stops[0]?.type !== "pickup") issues.push("The first stop must be a pick up.");
  if (!car.asDirected && car.stops[car.stops.length - 1]?.type !== "dropoff") {
    issues.push("The last stop must be a drop off.");
  }
  if (car.stops.some((s) => !s.address.trim())) issues.push("Every stop needs an address.");
  if (car.stops.some((s) => s.type === "pickup" && s.passengers.length === 0)) {
    issues.push("Every pick up needs at least one passenger.");
  }
  if (manifestOf(car).length === 0) issues.push("Choose who is travelling.");
  if (peakOf(car) > capacity) {
    issues.push(`Too many passengers at once for the ${car.vehicle} (${capacity} seats).`);
  }
  car.stops.forEach((s, idx) => {
    if (s.type !== "dropoff") return;
    const aboard = aboardAt(car, idx);
    const stranded = s.passengers.filter((p) => !aboard.includes(p));
    if (stranded.length > 0) {
      issues.push(`Stop ${idx + 1}: ${stranded.join(", ")} is not in the car yet.`);
    }
  });
  // An as-directed car keeps its passengers, so nobody is left behind
  const leftAboard = aboardAt(car, car.stops.length);
  if (!car.asDirected && leftAboard.length > 0) {
    issues.push(`${leftAboard.join(", ")} is not dropped off anywhere.`);
  }
  if (!car.time) issues.push("Set the first pick up time.");
  return issues;
};

interface Passenger {
  id: string;
  name: string;
  grp: string;
  /** Stands for a party (guests, family) rather than one person */
  is_group: boolean;
  phone: string;
  email: string;
  notify_sms: boolean;
  notify_email: boolean;
  notify_target: string;
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
  via: { line1?: string }[] | null;
  stops: Stop[] | null;
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
  via: { line1?: string }[] | null;
  stops: Stop[] | null;
  journey_type: string | null;
  as_directed_hours: number | null;
}

const emptyStop = (type: StopType): Stop => ({
  type,
  address: "",
  passengers: [],
  greyTarmac: false,
});

const emptyCar = (): CarRequest => ({
  stops: [emptyStop("pickup"), emptyStop("dropoff")],
  vehicle: "S-Class",
  time: "",
  notes: "",
  asDirected: false,
  asDirectedHours: 4,
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

  const [view, setView] = useState<"desk" | "fixtures" | "people" | "addresses" | "schedule">(
    "desk"
  );
  const [passengerGroups, setPassengerGroups] = useState<{ group: string; names: string[] }[]>([]);
  const [passengerOptions, setPassengerOptions] = useState<Passenger[]>([]);
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
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentBooking[]>([]);
  // Amending an existing car: its reference; Dispatch overwrites on resubmit
  const [amendRef, setAmendRef] = useState<string | null>(null);
  const [cancelConfirmRef, setCancelConfirmRef] = useState<string | null>(null);
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Person editor
  const [personId, setPersonId] = useState<string | null>(null);
  const [personPhone, setPersonPhone] = useState("");
  const [personEmail, setPersonEmail] = useState("");
  const [personSms, setPersonSms] = useState(false);
  const [personEmailOn, setPersonEmailOn] = useState(false);
  const [personTarget, setPersonTarget] = useState<"passenger" | "booker">("passenger");
  const [personSaving, setPersonSaving] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [personSaved, setPersonSaved] = useState(false);
  const [personAddrLabel, setPersonAddrLabel] = useState("");
  const [personAddrText, setPersonAddrText] = useState("");
  const [personName, setPersonName] = useState("");
  const [personRemoving, setPersonRemoving] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonGroup, setNewPersonGroup] = useState("");
  const [newPersonError, setNewPersonError] = useState<string | null>(null);
  const [newPersonGroupEntry, setNewPersonGroupEntry] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [personIsGroup, setPersonIsGroup] = useState(false);

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
  const [scheduleDateTo, setScheduleDateTo] = useState(todayStr());
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleTitleTouched, setScheduleTitleTouched] = useState(false);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);

  const hasDeskAccess = profile?.corporate === DESK;
  // Groups this account may work with; empty means the whole desk
  const scopeKey = (profile?.corporate_groups ?? []).join("|");
  const scopeGroups = useMemo(
    () => (scopeKey ? scopeKey.split("|") : []),
    [scopeKey]
  );

  // Approved passenger list, maintained by the operations team. Limited
  // assistants only receive their own groups, enforced by the database.
  const loadPassengers = useCallback(() => {
    if (!hasDeskAccess || !mfaVerified) return;
    supabase
      .from("corporate_passengers")
      .select(
        "id, name, grp, sort, phone, email, notify_sms, notify_email, notify_target, is_group"
      )
      .eq("corporate", DESK)
      .eq("active", true)
      .order("sort")
      .then(({ data: all }) => {
        if (!all) return;
        // Admins can read every group, so apply the profile's own scope here
        // too: the directory and picker must match what can actually be booked
        const data = scopeGroups.length > 0
          ? all.filter((r) => scopeGroups.includes(r.grp))
          : all;
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
            data
              .filter((r) => r.grp === g)
              .map((r) => ({
                id: r.id,
                name: r.name,
                grp: g,
                is_group: r.is_group === true,
                phone: r.phone ?? "",
                email: r.email ?? "",
                notify_sms: r.notify_sms === true,
                notify_email: r.notify_email === true,
                notify_target: r.notify_target ?? "passenger",
              }))
          )
        );
      });
  }, [hasDeskAccess, mfaVerified, scopeGroups]);

  useEffect(() => {
    loadPassengers();
  }, [loadPassengers]);

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
      .select(
        "reference, travel_date, vehicle, name, status, collection_at, pickup, dropoff, via, stops, journey_type, as_directed_hours"
      )
      .eq("corporate", DESK)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setRecent((data as unknown as RecentBooking[] | null) ?? []));
  }, [user, hasDeskAccess, mfaVerified]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const totalPassengers = useMemo(
    () => cars.reduce((n, c) => n + manifestOf(c).length, 0),
    [cars]
  );

  const updateCar = (i: number, patch: Partial<CarRequest>) =>
    setCars((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const updateStop = (carIdx: number, stopIdx: number, patch: Partial<Stop>) =>
    setCars((prev) =>
      prev.map((c, idx) =>
        idx !== carIdx
          ? c
          : { ...c, stops: c.stops.map((s, k) => (k === stopIdx ? { ...s, ...patch } : s)) }
      )
    );

  /** New stops land before the final set down, which is where they belong. */
  const addStop = (carIdx: number, type: StopType) =>
    setCars((prev) =>
      prev.map((c, idx) => {
        if (idx !== carIdx) return c;
        const next = [...c.stops];
        next.splice(Math.max(next.length - 1, 1), 0, emptyStop(type));
        return { ...c, stops: next };
      })
    );

  const removeStop = (carIdx: number, stopIdx: number) =>
    setCars((prev) =>
      prev.map((c, idx) =>
        idx !== carIdx ? c : { ...c, stops: c.stops.filter((_, k) => k !== stopIdx) }
      )
    );

  const moveStop = (carIdx: number, stopIdx: number, delta: number) =>
    setCars((prev) =>
      prev.map((c, idx) => {
        if (idx !== carIdx) return c;
        const target = stopIdx + delta;
        if (target < 0 || target >= c.stops.length) return c;
        const next = [...c.stops];
        [next[stopIdx], next[target]] = [next[target], next[stopIdx]];
        return { ...c, stops: next };
      })
    );

  const toggleStopPassenger = (carIdx: number, stopIdx: number, name: string) =>
    setCars((prev) =>
      prev.map((c, idx) => {
        if (idx !== carIdx) return c;
        const stop = c.stops[stopIdx];
        const selected = stop.passengers.includes(name);
        if (!selected && stop.type === "pickup") {
          // Never seat more people at once than the vehicle holds
          const used =
            aboardAt(c, stopIdx).reduce((n, p) => n + seatsFor(c, p), 0) +
            stop.passengers.reduce((n, p) => n + Math.max(1, stop.counts?.[p] ?? 1), 0);
          if (used >= (CAPACITY[c.vehicle] ?? 2)) return c;
        }
        const passengers = selected
          ? stop.passengers.filter((p) => p !== name)
          : [...stop.passengers, name];
        const counts = { ...(stop.counts ?? {}) };
        if (selected) delete counts[name];
        return {
          ...c,
          stops: c.stops.map((s, k) => (k === stopIdx ? { ...s, passengers, counts } : s)),
        };
      })
    );

  /** Send every car to wherever the first one finishes. */
  const copyDestinationToAll = () => {
    const first = cars[0];
    const dest = first?.stops[first.stops.length - 1]?.address ?? "";
    if (!dest) return;
    setCars((prev) =>
      prev.map((c) => ({
        ...c,
        stops: c.stops.map((s, k) => (k === c.stops.length - 1 ? { ...s, address: dest } : s)),
      }))
    );
  };

  const selectedPerson = passengerOptions.find((p) => p.id === personId) ?? null;
  // Global addresses, plus personal ones belonging to people in scope
  const visibleAddresses = addresses.filter(
    (a) => !a.passenger_id || passengerOptions.some((p) => p.id === a.passenger_id)
  );
  const personAddresses = addresses.filter((a) => a.passenger_id === personId);
  // Assistants limited to one group see it named on the tab
  const longDay = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const fixturesInRange = fixtures
    .filter((f) => {
      const d = ukDateKey(f.kickoff_utc);
      return d >= scheduleDate && d <= scheduleDateTo;
    })
    .sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc));
  const fixtureOnDay = (d: string) =>
    fixturesInRange.find((f) => ukDateKey(f.kickoff_utc) === d) ?? null;
  const scheduleRangeLabel =
    scheduleDate === scheduleDateTo
      ? longDay(scheduleDate)
      : `${longDay(scheduleDate)} to ${longDay(scheduleDateTo)}`;
  // Over a multi-day operation the sheet is broken up day by day
  const scheduleDays = [
    ...new Set(
      scheduleRows.map((r) => (r.collection_at ? ukDateKey(r.collection_at) : "")).filter(Boolean)
    ),
  ].sort();

  const addableGroups =
    profile?.corporate_groups && profile.corporate_groups.length > 0
      ? profile.corporate_groups
      : GROUP_ORDER;
  const peopleLabel =
    profile?.corporate_groups && profile.corporate_groups.length === 1
      ? profile.corporate_groups[0]
      : "People";

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
      manifestOf(car).map((n) => passengerIdByName.get(n)).filter(Boolean) as string[]
    );
    return visibleAddresses.filter((a) => !a.passenger_id || ids.has(a.passenger_id));
  };

  const homeFixtureOn = (date: string) =>
    fixtures.find((f) => f.is_home && ukDateKey(f.kickoff_utc) === date);

  const greyAddressForStop = (stop: Stop) =>
    addresses.find((a) => a.grey_tarmac && a.address === stop.address);

  /**
   * Grey tarmac is a home match-day arrangement: the stop must set down at a
   * saved front-entrance address and the travel date must be a home fixture.
   * Before the fixture list is loaded we cannot tell, so the tick still shows.
   */
  const greyAvailableForStop = (stop: Stop) =>
    stop.type === "dropoff" && (fixtures.length === 0 || !!homeFixtureOn(travelDate));

  /** Best saved address for a fixture's ground, else the ground's name. */
  const venueAddressFor = (f: Fixture) => {
    const venue = f.venue.trim();
    const matches = addresses.filter(
      (a) =>
        venue &&
        (a.address.toLowerCase().includes(venue.toLowerCase()) ||
          a.label.toLowerCase().includes(venue.toLowerCase()))
    );
    // On a home match day the front-entrance address is the useful one
    const saved = f.is_home ? matches.find((a) => a.grey_tarmac) ?? matches[0] : matches[0];
    return saved?.address ?? venue;
  };

  /** The fixture the current travel date falls on, if any. */
  const fixtureForDate = fixtures.find((f) => ukDateKey(f.kickoff_utc) === travelDate);

  const selectFixture = (id: string) => {
    const f = fixtures.find((fx) => fx.id === id);
    if (!f) {
      setTravelDate("");
      return;
    }
    const destination = venueAddressFor(f);
    setTravelDate(ukDateKey(f.kickoff_utc));
    // Fill only the final set down where it is still blank, never overwrite one
    // the desk has already set (some cars run from the ground, not to it)
    setCars((prev) =>
      prev.map((c) => {
        const last = c.stops.length - 1;
        if (last < 0 || c.stops[last].address.trim()) return c;
        return {
          ...c,
          stops: c.stops.map((s, k) => (k === last ? { ...s, address: destination } : s)),
        };
      })
    );
  };

  const openPerson = (person: Passenger) => {
    setPersonId(person.id);
    setPersonName(person.name);
    setPersonPhone(person.phone);
    setPersonEmail(person.email);
    setPersonIsGroup(person.is_group);
    setPersonSms(person.notify_sms);
    setPersonEmailOn(person.notify_email);
    setPersonTarget(person.notify_target === "booker" ? "booker" : "passenger");
    setPersonError(null);
    setPersonSaved(false);
    setPersonAddrLabel("");
    setPersonAddrText("");
  };

  const savePerson = async () => {
    if (!personId) return;
    setPersonSaving(true);
    setPersonError(null);
    setPersonSaved(false);
    try {
      await invokeDesk({
        action: "passenger_update",
        id: personId,
        name: personName.trim(),
        isGroup: personIsGroup,
        phone: personPhone.trim(),
        email: personEmail.trim(),
        notifySms: personSms,
        notifyEmail: personEmailOn,
        notifyTarget: personTarget,
      });
      setPersonSaved(true);
      loadPassengers();
    } catch (err) {
      setPersonError(err instanceof Error ? err.message : "We couldn't save these details.");
    } finally {
      setPersonSaving(false);
    }
  };

  const addPerson = async () => {
    setAddingPerson(true);
    setNewPersonError(null);
    try {
      const grp =
        newPersonGroup ||
        (profile?.corporate_groups?.length === 1 ? profile.corporate_groups[0] : "");
      const data = await invokeDesk({
        action: "passenger_add",
        name: newPersonName.trim(),
        grp,
        isGroup: newPersonGroupEntry,
      });
      setNewPersonName("");
      setNewPersonGroupEntry(false);
      loadPassengers();
      if (typeof data.id === "string") setPersonId(data.id);
    } catch (err) {
      setNewPersonError(err instanceof Error ? err.message : "We couldn't add this person.");
    } finally {
      setAddingPerson(false);
    }
  };

  const removePerson = async () => {
    if (!personId) return;
    setPersonRemoving(true);
    setPersonError(null);
    try {
      await invokeDesk({ action: "passenger_remove", id: personId });
      setPersonId(null);
      loadPassengers();
    } catch (err) {
      setPersonError(err instanceof Error ? err.message : "We couldn't remove this person.");
    } finally {
      setPersonRemoving(false);
    }
  };

  const [saveAddrFor, setSaveAddrFor] = useState<string | null>(null);
  const [saveAddrLabel, setSaveAddrLabel] = useState("");
  const [saveAddrPerson, setSaveAddrPerson] = useState("");
  const [saveAddrBusy, setSaveAddrBusy] = useState(false);

  /** Keep an address typed while booking, without leaving the form. */
  const saveStopAddress = async (address: string) => {
    setSaveAddrBusy(true);
    try {
      await invokeDesk({
        action: "address_add",
        label: saveAddrLabel.trim(),
        address: address.trim(),
        ...(saveAddrPerson ? { passengerId: saveAddrPerson } : {}),
        greyTarmac: false,
      });
      setSaveAddrFor(null);
      setSaveAddrLabel("");
      setSaveAddrPerson("");
      loadAddresses();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "We couldn't save this address.");
    } finally {
      setSaveAddrBusy(false);
    }
  };

  const addPersonAddress = async () => {
    if (!personId) return;
    setPersonSaving(true);
    setPersonError(null);
    try {
      await invokeDesk({
        action: "address_add",
        label: personAddrLabel.trim(),
        address: personAddrText.trim(),
        passengerId: personId,
        greyTarmac: false,
      });
      setPersonAddrLabel("");
      setPersonAddrText("");
      loadAddresses();
    } catch (err) {
      setPersonError(err instanceof Error ? err.message : "We couldn't save this address.");
    } finally {
      setPersonSaving(false);
    }
  };

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
    const car = emptyCar();
    car.stops[car.stops.length - 1].address = venueAddressFor(f);
    setTravelDate(ukDateKey(f.kickoff_utc));
    setCars([car]);
    setAmendRef(null);
    setSubmitError(null);
    setPickerOpen(null);
    setView("desk");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (scheduleDateTo < scheduleDate) setScheduleDateTo(scheduleDate);
  }, [scheduleDate, scheduleDateTo]);

  // The printed schedule names the fixture unless the desk has typed its own
  useEffect(() => {
    if (scheduleTitleTouched) return;
    const inRange = fixtures.filter((fx) => {
      const d = ukDateKey(fx.kickoff_utc);
      return d >= scheduleDate && d <= scheduleDateTo;
    });
    // With several games in the period the fixtures are listed under the
    // heading instead, so the sheet is not titled after only one of them
    setScheduleTitle(inRange.length === 1 ? fixtureTitle(inRange[0]) : "");
  }, [scheduleDate, scheduleDateTo, fixtures, scheduleTitleTouched]);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const data = await invokeDesk({
        action: "schedule",
        date: scheduleDate,
        dateTo: scheduleDateTo,
      });
      setScheduleRows(Array.isArray(data.schedule) ? data.schedule : []);
      setScheduleLoaded(true);
    } catch (err) {
      setScheduleError(
        err instanceof Error ? err.message : "We couldn't load the schedule. Please try again."
      );
    } finally {
      setScheduleLoading(false);
    }
  }, [scheduleDate, scheduleDateTo]);

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
    const everyone = b.name ? b.name.split(", ").filter(Boolean) : [];
    // Bookings made with the full journey keep it; older ones rebuild from the
    // first and last address plus anything en route
    const stops: Stop[] = Array.isArray(b.stops) && b.stops.length >= 2
      ? b.stops.map((s) => ({
          type: s?.type === "dropoff" ? "dropoff" : "pickup",
          address: s?.address ?? "",
          passengers: Array.isArray(s?.passengers) ? s.passengers : [],
          counts: s?.counts ?? {},
          greyTarmac: s?.greyTarmac === true,
        }))
      : [
          { type: "pickup", address: b.pickup?.line1 ?? "", passengers: everyone, greyTarmac: false },
          ...(Array.isArray(b.via)
            ? b.via.map((v) => ({
                type: "dropoff" as StopType,
                address: v?.line1 ?? "",
                passengers: [],
                greyTarmac: false,
              }))
            : []),
          {
            type: "dropoff" as StopType,
            address: b.dropoff?.line1 ?? "",
            passengers: [],
            greyTarmac: b.dropoff?.grey_tarmac === true,
          },
        ];
    setCars([
      {
        stops,
        vehicle: VEHICLES.includes(b.vehicle) ? b.vehicle : "S-Class",
        time: b.collection_at ? b.collection_at.slice(11, 16) : "",
        notes: "",
        asDirected: b.journey_type === "hourly",
        asDirectedHours: b.as_directed_hours ?? 4,
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
      const outcome = await cancelBooking(reference);
      if (amendRef === reference) discardAmend();
      if (outcome.handedToOps) {
        setCancelError(
          outcome.message ??
            "Your travel team has been asked to cancel this journey and will confirm shortly."
        );
      }
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
    !!travelDate &&
    cars.length > 0 &&
    cars.every((c) => carIssues(c).length === 0);

  const submitRequest = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("corporate-booking", {
        body: {
          travelDate,
          ...(amendRef ? { amendReference: amendRef } : {}),
          cars: cars.map((c) => {
            const stops = c.stops.map((s) => ({
              type: s.type,
              address: s.address.trim(),
              passengers: s.passengers,
              counts: s.counts ?? {},
              greyTarmac: s.greyTarmac && greyAvailableForStop(s),
            }));
            const lastDrop = [...stops].reverse().find((s) => s.type === "dropoff");
            return {
              stops,
              vehicle: c.vehicle,
              time: c.time,
              notes: c.notes.trim(),
              asDirected: c.asDirected,
              asDirectedHours: c.asDirectedHours,
              // Single-leg fields for older deployments of the booking function
              passengers: manifestOf(c),
              pickup: stops[0]?.address ?? "",
              destination: lastDrop?.address ?? "",
              greyTarmac: lastDrop?.greyTarmac ?? false,
            };
          }),
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
      } else if (data?.handedToOps) {
        // The change is with the ops team rather than applied automatically
        setSubmitError(
          data.message ??
            "Your travel team has been asked to make this change and will confirm shortly."
        );
        setAmendRef(null);
        loadRecent();
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
            { key: "people", label: peopleLabel, icon: UserCog },
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

        <div className="bg-white p-6 shadow-md mb-6 max-w-3xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fixtures.length > 0 && (
              <div>
                <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                  Booking For
                </label>
                <select
                  value={fixtureForDate?.id ?? ""}
                  onChange={(e) => selectFixture(e.target.value)}
                  className={lightInput}
                  style={lightInputStyle}
                >
                  <option value="">No fixture (general travel)</option>
                  {fixtures.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.home_team} v {f.away_team} ({f.is_home ? "H" : "A"}),{" "}
                      {ukDateLong(f.kickoff_utc)}, KO {ukTime(f.kickoff_utc)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
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
          </div>
          {fixtureForDate && (
            <p className="text-xs mt-3" style={{ color: `${NAVY}99` }}>
              <strong style={{ color: NAVY }}>
                {fixtureForDate.is_home ? "Home" : "Away"} fixture:
              </strong>{" "}
              {fixtureForDate.home_team} v {fixtureForDate.away_team} at {fixtureForDate.venue},
              kick off {ukTime(fixtureForDate.kickoff_utc)}.
              {fixtureForDate.is_home
                ? " Grey Tarmac drop off can be selected on cars going to the ground."
                : ""}
            </p>
          )}
        </div>

        <div className="space-y-6">
          {cars.map((car, i) => {
            const capacity = CAPACITY[car.vehicle] ?? 2;
            const peak = peakOf(car);
            const manifest = manifestOf(car);
            const issues = carIssues(car);
            return (
            <section key={i} className="bg-white p-6 shadow-md">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm tracking-[0.2em] uppercase font-semibold" style={{ color: NAVY }}>
                  Car {i + 1}
                  <span
                    className={
                      "ml-4 text-xs tracking-normal normal-case font-normal " +
                      (peak > capacity ? "text-red-600" : "")
                    }
                    style={peak > capacity ? undefined : { color: `${NAVY}80` }}
                  >
                    {peak} of {capacity} seats
                    {manifest.length > peak ? `, ${manifest.length} carried in total` : ""}
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

              <div
                className="flex flex-wrap items-center gap-4 mb-4 px-3 py-2.5"
                style={{ backgroundColor: "rgba(28,44,91,0.06)" }}
              >
                <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: NAVY }}>
                  <input
                    type="checkbox"
                    checked={car.asDirected}
                    onChange={(e) => updateCar(i, { asDirected: e.target.checked })}
                    className="w-4 h-4 accent-[#1C2C5B]"
                  />
                  As directed (car stays with them)
                </label>
                {car.asDirected && (
                  <label className="flex items-center gap-2 text-sm" style={{ color: NAVY }}>
                    for
                    <select
                      value={car.asDirectedHours}
                      onChange={(e) =>
                        updateCar(i, { asDirectedHours: Number(e.target.value) })
                      }
                      className="h-9 bg-white border rounded-none px-2 text-sm outline-none"
                      style={lightInputStyle}
                    >
                      {Array.from({ length: 24 }, (_, n) => n + 1).map((h) => (
                        <option key={h} value={h}>
                          {h} {h === 1 ? "hour" : "hours"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {car.asDirected && (
                  <span className="text-xs" style={{ color: `${NAVY}99` }}>
                    No fixed destination needed. Add a set down only where one is known,
                    such as a Grey Tarmac drop.
                  </span>
                )}
              </div>

              <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                Journey
              </label>
              <div className="space-y-3">
                {car.stops.map((stop, s) => {
                  const isPickup = stop.type === "pickup";
                  const aboard = aboardAt(car, s);
                  const pickerKey = `${i}:${s}`;
                  const seatsUsed = aboard.length + (isPickup ? stop.passengers.length : 0);
                  return (
                    <div
                      key={s}
                      className="border p-4"
                      style={{
                        borderColor: `${NAVY}26`,
                        backgroundColor: isPickup ? "rgba(108,171,221,0.07)" : "rgba(28,44,91,0.03)",
                      }}
                    >
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        <span
                          className="w-6 h-6 flex items-center justify-center text-[11px] font-semibold text-white"
                          style={{ backgroundColor: NAVY }}
                        >
                          {s + 1}
                        </span>
                        <select
                          value={stop.type}
                          aria-label={`Stop ${s + 1} type`}
                          onChange={(e) =>
                            updateStop(i, s, {
                              type: e.target.value as StopType,
                              passengers: [],
                              greyTarmac: false,
                            })
                          }
                          className="h-9 bg-white border rounded-none px-2 text-xs uppercase tracking-[0.12em] outline-none"
                          style={lightInputStyle}
                        >
                          <option value="pickup">Pick up</option>
                          <option value="dropoff">Drop off</option>
                        </select>
                        <span className="text-xs" style={{ color: `${NAVY}80` }}>
                          {isPickup
                            ? `${aboard.length} on board on arrival`
                            : aboard.length > 0
                              ? `${aboard.length} on board`
                              : "nobody on board"}
                        </span>
                        <span className="ml-auto flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Move stop ${s + 1} earlier`}
                            disabled={s === 0}
                            onClick={() => moveStop(i, s, -1)}
                            className="px-2 py-1 text-xs border disabled:opacity-25"
                            style={{ borderColor: `${NAVY}40`, color: NAVY }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move stop ${s + 1} later`}
                            disabled={s === car.stops.length - 1}
                            onClick={() => moveStop(i, s, 1)}
                            className="px-2 py-1 text-xs border disabled:opacity-25"
                            style={{ borderColor: `${NAVY}40`, color: NAVY }}
                          >
                            ↓
                          </button>
                          {car.stops.length > 2 && (
                            <button
                              type="button"
                              aria-label={`Remove stop ${s + 1}`}
                              onClick={() => removeStop(i, s)}
                              className="transition-colors hover:opacity-70"
                              style={{ color: `${NAVY}80` }}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </span>
                      </div>

                      <input
                        placeholder={
                          isPickup ? "Collection address" : "Set down address"
                        }
                        value={stop.address}
                        onChange={(e) =>
                          updateStop(i, s, { address: e.target.value, greyTarmac: false })
                        }
                        className={lightInput}
                        style={lightInputStyle}
                      />
                      {stop.address.trim() &&
                        !addresses.some((a) => a.address === stop.address.trim()) && (
                          saveAddrFor === pickerKey ? (
                            <div
                              className="mt-2 p-3 border"
                              style={{ borderColor: `${NAVY}33` }}
                            >
                              <input
                                placeholder="Save as, e.g. Home"
                                value={saveAddrLabel}
                                onChange={(e) => setSaveAddrLabel(e.target.value)}
                                maxLength={80}
                                className={lightInput}
                                style={lightInputStyle}
                              />
                              <select
                                value={saveAddrPerson}
                                aria-label="Save this address for"
                                onChange={(e) => setSaveAddrPerson(e.target.value)}
                                className="w-full mt-2 h-9 bg-white border rounded-none px-2 text-xs outline-none"
                                style={lightInputStyle}
                              >
                                <option value="">Everyone (global address)</option>
                                {passengerOptions.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                              <div className="flex items-center gap-3 mt-2">
                                <button
                                  type="button"
                                  disabled={saveAddrBusy || !saveAddrLabel.trim()}
                                  onClick={() => saveStopAddress(stop.address)}
                                  className="px-4 py-2 text-[11px] tracking-[0.12em] uppercase text-white disabled:opacity-40"
                                  style={{ backgroundColor: NAVY }}
                                >
                                  {saveAddrBusy ? "Saving…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSaveAddrFor(null)}
                                  className="text-[11px] tracking-[0.12em] uppercase underline underline-offset-4"
                                  style={{ color: `${NAVY}99` }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSaveAddrFor(pickerKey);
                                setSaveAddrLabel("");
                                setSaveAddrPerson("");
                              }}
                              className="mt-2 text-[11px] tracking-[0.12em] uppercase underline underline-offset-4 hover:opacity-70"
                              style={{ color: NAVY }}
                            >
                              Save this address
                            </button>
                          )
                        )}
                      {addressChoicesFor(car).length > 0 && (
                        <select
                          value=""
                          aria-label={`Saved addresses for stop ${s + 1}`}
                          onChange={(e) => {
                            if (e.target.value)
                              updateStop(i, s, { address: e.target.value, greyTarmac: false });
                          }}
                          className="w-full mt-2 h-9 bg-white border rounded-none px-2 text-xs outline-none"
                          style={lightInputStyle}
                        >
                          <option value="">Saved addresses…</option>
                          {addressChoicesFor(car).map((a) => (
                            <option key={a.id} value={a.address}>
                              {a.label}
                              {a.passenger_id
                                ? ` (${passengerNameById(a.passenger_id) ?? ""})`
                                : ""}
                              {a.grey_tarmac ? " - Grey Tarmac available" : ""}
                            </option>
                          ))}
                        </select>
                      )}

                      <div className="mt-3">
                        <p
                          className="text-[11px] tracking-[0.18em] uppercase mb-2"
                          style={{ color: `${NAVY}99` }}
                        >
                          {isPickup ? "Picking up" : "Dropping off"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {stop.passengers.map((p) => {
                            const party = passengerOptions.find((o) => o.name === p)?.is_group;
                            const seatsLeft =
                              capacity -
                              aboardAt(car, s).reduce((n, x) => n + seatsFor(car, x), 0) -
                              stop.passengers
                                .filter((x) => x !== p)
                                .reduce((n, x) => n + Math.max(1, stop.counts?.[x] ?? 1), 0);
                            return (
                              <span
                                key={p}
                                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-white"
                                style={{ backgroundColor: NAVY }}
                              >
                                {p}
                                {party && isPickup && (
                                  <select
                                    value={stop.counts?.[p] ?? 1}
                                    aria-label={`How many for ${p}`}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) =>
                                      updateStop(i, s, {
                                        counts: {
                                          ...(stop.counts ?? {}),
                                          [p]: Number(e.target.value),
                                        },
                                      })
                                    }
                                    className="bg-white text-[#1C2C5B] text-xs px-1 py-0.5 outline-none"
                                  >
                                    {Array.from(
                                      { length: Math.max(1, seatsLeft) },
                                      (_, n) => n + 1
                                    ).map((n) => (
                                      <option key={n} value={n}>
                                        {n}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                {party && !isPickup && (stop.counts?.[p] ?? 0) > 1 && (
                                  <span className="text-xs text-white/80">
                                    x{stop.counts?.[p]}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Remove ${p}`}
                                  onClick={() => toggleStopPassenger(i, s, p)}
                                  className="text-white/60 hover:text-white"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            );
                          })}
                          {!isPickup && stop.passengers.length === 0 && (
                            <span className="text-sm" style={{ color: `${NAVY}99` }}>
                              Everyone on board
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setPickerOpen(pickerOpen === pickerKey ? null : pickerKey)
                            }
                            className="inline-flex items-center gap-1.5 border border-dashed px-3 py-1.5 text-sm transition-colors hover:bg-[#6CABDD]/10"
                            style={{ borderColor: `${NAVY}66`, color: NAVY }}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {isPickup ? "Add passenger" : "Choose who gets out"}
                          </button>
                        </div>

                        {pickerOpen === pickerKey && (
                          <div
                            className="mt-3 border bg-white p-4 max-h-72 overflow-y-auto"
                            style={{ borderColor: `${NAVY}33` }}
                          >
                            {isPickup ? (
                              <>
                                {seatsUsed >= capacity && (
                                  <p className="text-xs mb-3 font-medium" style={{ color: NAVY }}>
                                    The {car.vehicle} seats {capacity}. Drop someone off first,
                                    choose a larger vehicle, or add another car.
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
                                        const selected = stop.passengers.includes(name);
                                        const elsewhere =
                                          !selected && manifest.includes(name);
                                        const full = !selected && seatsUsed >= capacity;
                                        return (
                                          <button
                                            key={name}
                                            type="button"
                                            onClick={() => toggleStopPassenger(i, s, name)}
                                            disabled={elsewhere || full}
                                            title={
                                              elsewhere
                                                ? "Already picked up at another stop"
                                                : undefined
                                            }
                                            className="border px-3 py-1.5 text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                            style={
                                              selected
                                                ? {
                                                    borderColor: NAVY,
                                                    color: "#ffffff",
                                                    backgroundColor: NAVY,
                                                  }
                                                : { borderColor: `${NAVY}4D`, color: NAVY }
                                            }
                                          >
                                            {name}
                                            {passengerOptions.find((o) => o.name === name)
                                              ?.is_group
                                              ? " (party)"
                                              : ""}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </>
                            ) : aboard.length === 0 ? (
                              <p className="text-xs" style={{ color: `${NAVY}99` }}>
                                Nobody is in the car at this point. Add a pick up first.
                              </p>
                            ) : (
                              <>
                                <p className="text-xs mb-3" style={{ color: `${NAVY}99` }}>
                                  Leave all unselected to drop everyone who is on board.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {aboard.map((name) => {
                                    const selected = stop.passengers.includes(name);
                                    return (
                                      <button
                                        key={name}
                                        type="button"
                                        onClick={() => toggleStopPassenger(i, s, name)}
                                        className="border px-3 py-1.5 text-sm transition-colors"
                                        style={
                                          selected
                                            ? {
                                                borderColor: NAVY,
                                                color: "#ffffff",
                                                backgroundColor: NAVY,
                                              }
                                            : { borderColor: `${NAVY}4D`, color: NAVY }
                                        }
                                      >
                                        {name}
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {greyAvailableForStop(stop) ? (
                        <label
                          className="mt-3 inline-flex items-center gap-3 text-sm cursor-pointer px-3 py-2"
                          style={{
                            backgroundColor: stop.greyTarmac ? "#FFF59D" : "rgba(28,44,91,0.06)",
                            color: NAVY,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={stop.greyTarmac}
                            onChange={(e) => updateStop(i, s, { greyTarmac: e.target.checked })}
                            className="w-4 h-4 accent-[#1C2C5B]"
                          />
                          Grey Tarmac drop off (front entrance on match day)
                        </label>
                      ) : (
                        !isPickup && (
                          <p className="text-xs mt-3" style={{ color: `${NAVY}99` }}>
                            Grey Tarmac drop off applies on home match days only.
                            {travelDate
                              ? " There is no home fixture on the selected date."
                              : " Choose the fixture or travel date first."}
                          </p>
                        )
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => addStop(i, "pickup")}
                  className="inline-flex items-center gap-1.5 border border-dashed px-4 py-2 text-xs tracking-[0.15em] uppercase transition-colors hover:bg-[#6CABDD]/10"
                  style={{ borderColor: `${NAVY}66`, color: NAVY }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Pick Up
                </button>
                <button
                  type="button"
                  onClick={() => addStop(i, "dropoff")}
                  className="inline-flex items-center gap-1.5 border border-dashed px-4 py-2 text-xs tracking-[0.15em] uppercase transition-colors hover:bg-[#6CABDD]/10"
                  style={{ borderColor: `${NAVY}66`, color: NAVY }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Drop Off
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
                <div>
                  <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                    First Pick Up Time
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

              {issues.length > 0 && (
                <ul className="mt-4 space-y-1">
                  {issues.map((issue) => (
                    <li key={issue} className="text-xs text-red-700">
                      {issue}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            );
          })}
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
                              // Movements around a big fixture start days out
                              const day = Date.parse(ukDateKey(f.kickoff_utc));
                              setScheduleDate(new Date(day - 2 * 86400000).toISOString().slice(0, 10));
                              setScheduleDateTo(new Date(day + 86400000).toISOString().slice(0, 10));
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

        {view === "people" && (
          <>
            <div className="mb-8">
              <p className="text-xs tracking-[0.4em] uppercase mb-2" style={{ color: NAVY }}>
                Directory
              </p>
              <h1 className="font-display text-4xl font-light tracking-wider text-white">
                {peopleLabel}
              </h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-white shadow-md overflow-hidden">
                <div className="max-h-[36rem] overflow-y-auto">
                  {passengerGroups.map((g) => (
                    <div key={g.group}>
                      <p
                        className="px-4 py-2 text-[11px] tracking-[0.25em] uppercase font-semibold sticky top-0"
                        style={{ color: NAVY, backgroundColor: "rgba(108,171,221,0.18)" }}
                      >
                        {g.group}
                      </p>
                      {g.names.map((name) => {
                        const person = passengerOptions.find((p) => p.name === name);
                        if (!person) return null;
                        const on = person.notify_sms || person.notify_email;
                        return (
                          <button
                            key={person.id}
                            type="button"
                            onClick={() => openPerson(person)}
                            className="w-full text-left px-4 py-3 border-t flex items-center justify-between gap-2 transition-colors hover:bg-[#6CABDD]/10"
                            style={{
                              borderColor: "rgba(28,44,91,0.12)",
                              backgroundColor:
                                personId === person.id ? "rgba(28,44,91,0.08)" : undefined,
                              color: NAVY,
                            }}
                          >
                            <span className="text-sm">{person.name}</span>
                            <span
                              className="text-[10px] tracking-[0.12em] uppercase"
                              style={{ color: on ? NAVY : `${NAVY}66` }}
                            >
                              {on ? (person.notify_target === "booker" ? "To PA" : "Confirms") : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {passengerGroups.length === 0 && (
                    <p className="px-4 py-8 text-center text-sm" style={{ color: `${NAVY}99` }}>
                      Loading…
                    </p>
                  )}
                </div>
                <div className="border-t p-4" style={{ borderColor: "rgba(28,44,91,0.12)" }}>
                  <p
                    className="text-[11px] tracking-[0.18em] uppercase mb-2"
                    style={{ color: `${NAVY}99` }}
                  >
                    Add someone
                  </p>
                  <input
                    placeholder="Full name"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    maxLength={80}
                    className={lightInput}
                    style={lightInputStyle}
                  />
                  {addableGroups.length > 1 && (
                    <select
                      value={newPersonGroup || addableGroups[0]}
                      aria-label="Group"
                      onChange={(e) => setNewPersonGroup(e.target.value)}
                      className="w-full mt-2 h-10 bg-white border rounded-none px-2 text-sm outline-none"
                      style={lightInputStyle}
                    >
                      {addableGroups.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  )}
                  <label
                    className="flex items-center gap-2 text-xs mt-2 cursor-pointer"
                    style={{ color: NAVY }}
                  >
                    <input
                      type="checkbox"
                      checked={newPersonGroupEntry}
                      onChange={(e) => setNewPersonGroupEntry(e.target.checked)}
                      className="w-3.5 h-3.5 accent-[#1C2C5B]"
                    />
                    A party, such as guests or family
                  </label>
                  <button
                    type="button"
                    disabled={addingPerson || !newPersonName.trim()}
                    onClick={addPerson}
                    className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs tracking-[0.15em] uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ backgroundColor: NAVY }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                  {newPersonError && (
                    <p className="text-xs font-medium text-red-700 mt-2">{newPersonError}</p>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2">
                {!selectedPerson ? (
                  <div className="bg-white p-8 shadow-md text-sm" style={{ color: `${NAVY}99` }}>
                    Choose someone from the list to edit their contact details, confirmations and
                    saved addresses.
                  </div>
                ) : (
                  <div className="bg-white p-6 shadow-md">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div className="flex-1">
                        <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                          Name
                        </label>
                        <input
                          value={personName}
                          onChange={(e) => setPersonName(e.target.value)}
                          maxLength={80}
                          className={lightInput}
                          style={lightInputStyle}
                        />
                        <p className="text-xs mt-1.5" style={{ color: `${NAVY}80` }}>
                          {selectedPerson.grp}. Renaming does not change journeys already booked.
                        </p>
                        <label
                          className="flex items-center gap-2 text-xs mt-2 cursor-pointer"
                          style={{ color: NAVY }}
                        >
                          <input
                            type="checkbox"
                            checked={personIsGroup}
                            onChange={(e) => setPersonIsGroup(e.target.checked)}
                            className="w-3.5 h-3.5 accent-[#1C2C5B]"
                          />
                          A party: ask how many are travelling when booking
                        </label>
                      </div>
                      <button
                        type="button"
                        disabled={personRemoving}
                        onClick={removePerson}
                        className="mt-7 shrink-0 underline underline-offset-4 hover:opacity-70 text-[11px] tracking-[0.12em] uppercase text-red-700 disabled:opacity-50"
                      >
                        {personRemoving ? "Removing…" : "Remove"}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                          Mobile
                        </label>
                        <input
                          placeholder="+447700900123"
                          value={personPhone}
                          onChange={(e) => setPersonPhone(e.target.value)}
                          className={lightInput}
                          style={lightInputStyle}
                        />
                      </div>
                      <div>
                        <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                          Email
                        </label>
                        <input
                          type="email"
                          placeholder="name@cityfootball.com"
                          value={personEmail}
                          onChange={(e) => setPersonEmail(e.target.value)}
                          className={lightInput}
                          style={lightInputStyle}
                        />
                      </div>
                    </div>

                    <p
                      className="text-[11px] tracking-[0.18em] uppercase mt-6 mb-3"
                      style={{ color: `${NAVY}99` }}
                    >
                      Booking confirmations
                    </p>
                    <div className="flex flex-wrap items-center gap-5">
                      <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: NAVY }}>
                        <input
                          type="checkbox"
                          checked={personSms}
                          onChange={(e) => setPersonSms(e.target.checked)}
                          className="w-4 h-4 accent-[#1C2C5B]"
                        />
                        By SMS
                      </label>
                      <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: NAVY }}>
                        <input
                          type="checkbox"
                          checked={personEmailOn}
                          onChange={(e) => setPersonEmailOn(e.target.checked)}
                          className="w-4 h-4 accent-[#1C2C5B]"
                        />
                        By email
                      </label>
                      <select
                        value={personTarget}
                        aria-label="Send confirmations to"
                        onChange={(e) => setPersonTarget(e.target.value as "passenger" | "booker")}
                        className="h-10 bg-white border rounded-none px-2 text-sm outline-none"
                        style={lightInputStyle}
                      >
                        <option value="passenger">Send to {selectedPerson.name}</option>
                        <option value="booker">Send to me instead</option>
                      </select>
                    </div>
                    <p className="text-xs mt-3" style={{ color: `${NAVY}99` }}>
                      {!personSms && !personEmailOn
                        ? "Confirmations are off. Nothing is sent when a car is booked."
                        : personTarget === "booker"
                          ? "Confirmations for this person come to you, not to them."
                          : `Confirmations go directly to ${selectedPerson.name}.`}
                    </p>

                    <div className="mt-6 flex items-center gap-4 flex-wrap">
                      <button
                        type="button"
                        disabled={personSaving}
                        onClick={savePerson}
                        className="tracking-[0.2em] uppercase text-xs px-8 py-3.5 text-white transition-opacity hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-3"
                        style={{ backgroundColor: NAVY }}
                      >
                        {personSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save Details
                      </button>
                      {personSaved && (
                        <span className="text-xs" style={{ color: NAVY }}>
                          Saved.
                        </span>
                      )}
                      {personError && (
                        <span className="text-xs font-medium text-red-700">{personError}</span>
                      )}
                    </div>

                    <div className="mt-8 pt-6 border-t" style={{ borderColor: "rgba(28,44,91,0.12)" }}>
                      <p
                        className="text-[11px] tracking-[0.18em] uppercase mb-3"
                        style={{ color: `${NAVY}99` }}
                      >
                        Favourite addresses
                      </p>
                      {personAddresses.length > 0 ? (
                        <ul className="mb-4 space-y-2">
                          {personAddresses.map((a) => (
                            <li
                              key={a.id}
                              className="flex items-start justify-between gap-3 text-sm"
                              style={{ color: NAVY }}
                            >
                              <span>
                                <strong>{a.label}</strong>
                                <span style={{ color: `${NAVY}99` }}> {a.address}</span>
                              </span>
                              <button
                                type="button"
                                disabled={addrDeletingId === a.id}
                                onClick={() => deleteAddress(a.id)}
                                className="shrink-0 underline underline-offset-4 hover:opacity-70 text-[11px] tracking-[0.12em] uppercase text-red-700 disabled:opacity-50"
                              >
                                {addrDeletingId === a.id ? "Removing…" : "Remove"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm mb-4" style={{ color: `${NAVY}99` }}>
                          None saved yet. Their home address only ever appears on cars they are
                          travelling in.
                        </p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                          placeholder="Name, e.g. Home"
                          value={personAddrLabel}
                          onChange={(e) => setPersonAddrLabel(e.target.value)}
                          maxLength={80}
                          className={lightInput}
                          style={lightInputStyle}
                        />
                        <input
                          placeholder="Full address including postcode"
                          value={personAddrText}
                          onChange={(e) => setPersonAddrText(e.target.value)}
                          maxLength={240}
                          className={lightInput}
                          style={lightInputStyle}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={
                          personSaving || !personAddrLabel.trim() || !personAddrText.trim()
                        }
                        onClick={addPersonAddress}
                        className="mt-3 inline-flex items-center gap-2 border border-dashed px-5 py-2.5 text-xs tracking-[0.15em] uppercase transition-colors hover:bg-[#6CABDD]/10 disabled:opacity-40"
                        style={{ borderColor: `${NAVY}66`, color: NAVY }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Address
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
                  {visibleAddresses.map((a) => (
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
                  {visibleAddresses.length === 0 && (
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lightLabel} style={{ color: `${NAVY}99` }}>
                      From
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
                      To
                    </label>
                    <input
                      type="date"
                      min={scheduleDate}
                      value={scheduleDateTo}
                      onChange={(e) => setScheduleDateTo(e.target.value)}
                      className={lightInput}
                      style={lightInputStyle}
                    />
                  </div>
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
                    {scheduleRangeLabel}
                    {" - Operated by Apexia VIP"}
                  </p>
                  {fixturesInRange.length > 1 && (
                    <ul className="mt-2 space-y-0.5">
                      {fixturesInRange.map((f) => (
                        <li key={f.id} className="text-xs" style={{ color: NAVY }}>
                          <strong>{ukDateLong(f.kickoff_utc)}</strong>
                          {": "}
                          {f.home_team} v {f.away_team}, KO {ukTime(f.kickoff_utc)},{" "}
                          {f.venue} ({f.is_home ? "Home" : "Away"})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {scheduleLoading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: NAVY }} />
                </div>
              ) : scheduleRows.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: `${NAVY}99` }}>
                  {scheduleLoaded
                    ? "No cars are booked in this period."
                    : "Choose dates to load the schedule."}
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
                        const day = r.collection_at ? ukDateKey(r.collection_at) : "";
                        // Label the day whenever the sheet covers more than one,
                        // so every car is clearly under its own date
                        const firstOfDay =
                          (scheduleDays.length > 1 || scheduleDate !== scheduleDateTo) &&
                          scheduleRows.findIndex(
                            (x) => (x.collection_at ? ukDateKey(x.collection_at) : "") === day
                          ) === idx;
                        return (
                          <Fragment key={r.reference ?? idx}>
                          {firstOfDay && (
                            <tr>
                              <td
                                colSpan={8}
                                className="px-3 py-2 text-[11px] tracking-[0.18em] uppercase font-semibold"
                                style={{
                                  backgroundColor: "rgba(108,171,221,0.25)",
                                  color: NAVY,
                                  borderTop: "2px solid rgba(28,44,91,0.3)",
                                }}
                              >
                                {longDay(day)}
                                {(() => {
                                  const f = fixtureOnDay(day);
                                  return f
                                    ? ` - ${f.home_team} v ${f.away_team}, KO ${ukTime(
                                        f.kickoff_utc
                                      )} (${f.is_home ? "Home" : "Away"})`
                                    : "";
                                })()}
                              </td>
                            </tr>
                          )}
                          <tr
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
                              {/* Anything picked up or set down en route */}
                              {Array.isArray(r.stops) && r.stops.length > 2 ? (
                                <span className="block mt-1" style={{ color: `${NAVY}99` }}>
                                  {r.stops
                                    .slice(1, -1)
                                    .map(
                                      (s) =>
                                        `${s.type === "pickup" ? "+ pick up" : "+ drop"}${
                                          s.passengers?.length ? ` ${s.passengers.join(", ")}` : ""
                                        } at ${s.address}`
                                    )
                                    .join("; ")}
                                </span>
                              ) : Array.isArray(r.via) && r.via.length > 0 ? (
                                <span className="block mt-1" style={{ color: `${NAVY}99` }}>
                                  via {r.via.map((v) => v?.line1 ?? "").filter(Boolean).join("; ")}
                                </span>
                              ) : null}
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
                          </Fragment>
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
