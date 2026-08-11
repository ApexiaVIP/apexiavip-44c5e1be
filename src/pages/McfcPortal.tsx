import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Car, Check, Copy, Plus, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import apexiaLogo from "@/assets/apexia-logo.jpg";

/**
 * Partner travel desk (preview build). Outside: unbranded sign-in in Apexia
 * dark. Inside: a fully club-branded travel desk (sky blue, navy, white) with
 * Apexia present only as a discreet operated-by credit.
 */

const SKY = "#6CABDD";
const NAVY = "#1C2C5B";
const DEMO_CODE = "MCFC2026";

const PASSENGERS: { group: string; names: string[] }[] = [
  {
    group: "First Team",
    names: [
      "Gianluigi Donnarumma",
      "James Trafford",
      "Marcus Bettinelli",
      "Rúben Dias",
      "John Stones",
      "Josko Gvardiol",
      "Nathan Aké",
      "Rayan Aït-Nouri",
      "Rico Lewis",
      "Abdukodir Khusanov",
      "Vitor Reis",
      "Matheus Nunes",
      "Rodri",
      "Bernardo Silva",
      "Phil Foden",
      "Mateo Kovacic",
      "Nico González",
      "Tijjani Reijnders",
      "Rayan Cherki",
      "Erling Haaland",
      "Omar Marmoush",
      "Jérémy Doku",
      "Savinho",
      "Oscar Bobb",
    ],
  },
  {
    group: "Management",
    names: ["Pep Guardiola", "Assistant Manager", "First Team Coach", "Head of Performance"],
  },
  {
    group: "Executives",
    names: ["Chief Executive", "Director of Football", "Club Secretary", "Executive Guest"],
  },
];

const VEHICLES = ["S-Class", "Range Rover", "Viano", "JetClass"];

/** Passenger seats per vehicle (chauffeur excluded) */
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

const emptyCar = (): CarRequest => ({
  passengers: [],
  pickup: "",
  destination: "",
  vehicle: "S-Class",
  time: "",
  notes: "",
});

/* Club-lettered roundel; the official crest replaces this when rights land */
const Roundel = ({ size = 64 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-label="MCFC">
    <circle cx="50" cy="50" r="48" fill="#ffffff" />
    <circle cx="50" cy="50" r="46.5" fill="none" stroke={NAVY} strokeWidth="3" />
    <circle cx="50" cy="50" r="37" fill="none" stroke={SKY} strokeWidth="2.5" />
    <text
      x="50"
      y="56.5"
      textAnchor="middle"
      fontFamily="Georgia, 'Times New Roman', serif"
      fontSize="23"
      letterSpacing="1.5"
      fill={NAVY}
    >
      MCFC
    </text>
  </svg>
);

const darkInput =
  "bg-transparent border-border focus:border-[#6CABDD] rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm";

const lightLabel = "block text-[11px] tracking-[0.18em] uppercase mb-2";
const lightInput =
  "w-full h-11 bg-white border rounded-none px-3 text-sm outline-none transition-colors";
const lightInputStyle = {
  borderColor: "rgba(28,44,91,0.3)",
  color: NAVY,
} as const;

const McfcPortal = () => {
  const [authed, setAuthed] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);

  const [travelDate, setTravelDate] = useState("");
  const [cars, setCars] = useState<CarRequest[]>([emptyCar()]);
  const [submitted, setSubmitted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);

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

  const canSubmit =
    travelDate &&
    cars.length > 0 &&
    cars.every(
      (c) => c.passengers.length > 0 && c.pickup && c.destination && c.time && !overCapacity(c)
    );

  // ---------- Sign-in (no partner branding visible) ----------
  if (!authed) {
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
          <p className="text-smoke text-sm font-light leading-relaxed mb-10">
            Restricted access for authorised operations staff. Enter your access
            code to continue.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim().toUpperCase() === DEMO_CODE) {
                setAuthed(true);
              } else {
                setCodeError(true);
              }
            }}
            className="space-y-4"
          >
            <Input
              type="password"
              placeholder="Access code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError(false);
              }}
              className={darkInput + " text-center tracking-[0.3em]"}
            />
            {codeError && (
              <p className="text-destructive text-sm">That code is not recognised.</p>
            )}
            <Button
              type="submit"
              className="w-full tracking-[0.2em] uppercase"
              style={{ backgroundColor: SKY, color: "#0b0a08" }}
            >
              Enter
            </Button>
          </form>
          <p className="text-smoke/60 text-xs font-light mt-12">
            Access is provisioned by Apexia VIP. All activity is confidential.
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
            <Roundel size={72} />
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
            Request Received
          </h2>
          <p className="text-sm leading-relaxed mb-2" style={{ color: `${NAVY}B3` }}>
            {cars.length} {cars.length === 1 ? "car" : "cars"} for {totalPassengers}{" "}
            {totalPassengers === 1 ? "passenger" : "passengers"} on {travelDate}.
          </p>
          <p className="text-sm leading-relaxed mb-10" style={{ color: `${NAVY}B3` }}>
            Your travel team will confirm each chauffeur and vehicle shortly.
          </p>
          <button
            onClick={() => {
              setCars([emptyCar()]);
              setSubmitted(false);
            }}
            className="tracking-[0.2em] uppercase text-xs px-8 py-4 text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: NAVY }}
          >
            New Request
          </button>
        </div>
      </div>
    );
  }

  // ---------- Travel desk (fully club branded, behind sign-in) ----------
  return (
    <div className="min-h-screen" style={{ backgroundColor: SKY }}>
      <header style={{ backgroundColor: NAVY }}>
        <div className="container mx-auto px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Roundel size={56} />
            <div>
              <span className="font-display text-3xl tracking-[0.25em] leading-none text-white">
                MCFC
              </span>
              <p
                className="text-[10px] tracking-[0.35em] uppercase mt-1.5"
                style={{ color: SKY }}
              >
                Team Travel Desk
              </p>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <p className="text-white/40 text-[10px] tracking-[0.2em] uppercase hidden md:block">
              Operated by Apexia VIP
            </p>
            <button
              type="button"
              onClick={() => setAuthed(false)}
              className="text-white/70 hover:text-white transition-colors text-xs tracking-[0.15em] uppercase"
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
              New Request
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
                    {PASSENGERS.map((g) => (
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
          <button
            type="button"
            onClick={() => setCars((prev) => [...prev, emptyCar()])}
            className="inline-flex items-center gap-2 border border-dashed bg-white/40 hover:bg-white px-5 py-3 text-xs tracking-[0.2em] uppercase transition-colors"
            style={{ borderColor: NAVY, color: NAVY }}
          >
            <Plus className="w-4 h-4" />
            Add Another Car
          </button>
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
            onClick={() => setSubmitted(true)}
            className="tracking-[0.2em] uppercase text-xs px-10 py-4 text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: NAVY }}
          >
            Submit Request
          </button>
          {!canSubmit && (
            <p className="text-xs" style={{ color: `${NAVY}B3` }}>
              Each car needs at least one passenger, a pickup, a destination and a time.
            </p>
          )}
        </div>

        <p className="text-[11px] tracking-[0.1em] mt-14" style={{ color: `${NAVY}80` }}>
          Operated by Apexia VIP. All activity confidential. Preview build:
          requests are not yet dispatched from this portal.
        </p>
      </main>
    </div>
  );
};

export default McfcPortal;
