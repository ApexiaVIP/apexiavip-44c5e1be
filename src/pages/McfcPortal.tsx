import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Car, Check, Copy, Plus, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import apexiaLogo from "@/assets/apexia-logo.jpg";

/**
 * Partner travel desk (preview build). Outside: unbranded sky-accent sign-in.
 * Inside: co-branded multi-car request desk for team operations staff.
 */

const SKY = "#6CABDD";
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

const label = "text-smoke text-[11px] tracking-[0.18em] uppercase block mb-2";
const inputCls =
  "bg-transparent border-border focus:border-[#6CABDD] rounded-none h-11 text-foreground placeholder:text-muted-foreground text-sm";

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
      prev.map((c, idx) =>
        idx === i
          ? {
              ...c,
              passengers: c.passengers.includes(name)
                ? c.passengers.filter((p) => p !== name)
                : [...c.passengers, name],
            }
          : c
      )
    );

  const copyDestinationToAll = () => {
    const dest = cars[0]?.destination ?? "";
    setCars((prev) => prev.map((c) => ({ ...c, destination: dest })));
  };

  const canSubmit =
    travelDate &&
    cars.length > 0 &&
    cars.every((c) => c.passengers.length > 0 && c.pickup && c.destination && c.time);

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
              className={inputCls + " text-center tracking-[0.3em]"}
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

  // ---------- Confirmation ----------
  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-8">
        <div className="max-w-lg text-center">
          <div
            className="w-14 h-14 rounded-full border flex items-center justify-center mx-auto mb-8"
            style={{ borderColor: SKY }}
          >
            <Check className="w-6 h-6" style={{ color: SKY }} />
          </div>
          <h2 className="font-display text-3xl font-light tracking-wider text-foreground mb-4">
            Request Received
          </h2>
          <p className="text-smoke text-sm font-light leading-relaxed mb-2">
            {cars.length} {cars.length === 1 ? "car" : "cars"} for {totalPassengers}{" "}
            {totalPassengers === 1 ? "passenger" : "passengers"} on {travelDate}.
          </p>
          <p className="text-smoke text-sm font-light leading-relaxed mb-10">
            Your travel team will confirm each chauffeur and vehicle shortly.
          </p>
          <Button
            onClick={() => {
              setCars([emptyCar()]);
              setSubmitted(false);
            }}
            variant="outline"
            className="tracking-[0.2em] uppercase"
          >
            New Request
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Travel desk (co-branded, behind sign-in) ----------
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <img src={apexiaLogo} alt="Apexia VIP" className="h-14 w-auto" />
            <span className="text-smoke text-lg font-light">×</span>
            <span
              className="font-display text-2xl tracking-[0.25em]"
              style={{ color: SKY }}
            >
              MCFC
            </span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-smoke text-xs tracking-[0.15em] uppercase hidden md:inline">
              Team Travel Desk
            </span>
            <button
              type="button"
              onClick={() => setAuthed(false)}
              className="text-smoke hover:text-foreground transition-colors text-xs tracking-[0.15em] uppercase"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-8 py-10 max-w-6xl">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
          <div>
            <p className="text-xs tracking-[0.4em] uppercase mb-2" style={{ color: SKY }}>
              New Request
            </p>
            <h1 className="font-display text-3xl font-light tracking-wider text-foreground">
              Arrange Travel
            </h1>
          </div>
          <div className="flex items-center gap-6 text-smoke text-sm">
            <span className="inline-flex items-center gap-2">
              <Car className="w-4 h-4" style={{ color: SKY }} />
              {cars.length} {cars.length === 1 ? "car" : "cars"}
            </span>
            <span className="inline-flex items-center gap-2">
              <Users className="w-4 h-4" style={{ color: SKY }} />
              {totalPassengers} {totalPassengers === 1 ? "passenger" : "passengers"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 max-w-xl">
          <div className="md:col-span-2">
            <label className={label}>Date of Travel</label>
            <Input
              type="date"
              value={travelDate}
              onChange={(e) => setTravelDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="space-y-6">
          {cars.map((car, i) => (
            <section key={i} className="border border-border p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-foreground text-sm tracking-[0.2em] uppercase">
                  Car {i + 1}
                </h2>
                {cars.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove car ${i + 1}`}
                    onClick={() => setCars((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-smoke hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="mb-5">
                <label className={label}>Passengers</label>
                <div className="flex flex-wrap items-center gap-2">
                  {car.passengers.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-2 border px-3 py-1.5 text-sm text-foreground"
                      style={{ borderColor: SKY }}
                    >
                      {p}
                      <button
                        type="button"
                        aria-label={`Remove ${p}`}
                        onClick={() => togglePassenger(i, p)}
                        className="text-smoke hover:text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(pickerOpen === i ? null : i)}
                    className="inline-flex items-center gap-1.5 border border-dashed border-border hover:border-[#6CABDD] text-smoke hover:text-foreground px-3 py-1.5 text-sm transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add passenger
                  </button>
                </div>

                {pickerOpen === i && (
                  <div className="mt-3 border border-border bg-charcoal p-4 max-h-72 overflow-y-auto">
                    {PASSENGERS.map((g) => (
                      <div key={g.group} className="mb-4 last:mb-0">
                        <p
                          className="text-[11px] tracking-[0.25em] uppercase mb-2"
                          style={{ color: SKY }}
                        >
                          {g.group}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {g.names.map((name) => {
                            const selected = car.passengers.includes(name);
                            return (
                              <button
                                key={name}
                                type="button"
                                onClick={() => togglePassenger(i, name)}
                                className="border px-3 py-1.5 text-sm transition-colors"
                                style={
                                  selected
                                    ? { borderColor: SKY, color: "#0b0a08", backgroundColor: SKY }
                                    : { borderColor: "#2a251d", color: "#93897a" }
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
                  <label className={label}>Pickup</label>
                  <Input
                    placeholder="e.g. Etihad Campus"
                    value={car.pickup}
                    onChange={(e) => updateCar(i, { pickup: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={label}>Destination</label>
                  <Input
                    placeholder="e.g. Manchester Airport T3"
                    value={car.destination}
                    onChange={(e) => updateCar(i, { destination: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={label}>Pickup Time</label>
                  <Input
                    type="time"
                    value={car.time}
                    onChange={(e) => updateCar(i, { time: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={label}>Vehicle</label>
                  <select
                    value={car.vehicle}
                    onChange={(e) => updateCar(i, { vehicle: e.target.value })}
                    className="w-full h-11 bg-transparent border border-border focus:border-[#6CABDD] text-foreground text-sm px-3 outline-none"
                  >
                    {VEHICLES.map((v) => (
                      <option key={v} value={v} className="bg-charcoal">
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <label className={label}>Notes for the chauffeur (optional)</label>
                <Input
                  placeholder="Meeting point, luggage, discretion notes"
                  value={car.notes}
                  onChange={(e) => updateCar(i, { notes: e.target.value })}
                  className={inputCls}
                />
              </div>
            </section>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-6">
          <button
            type="button"
            onClick={() => setCars((prev) => [...prev, emptyCar()])}
            className="inline-flex items-center gap-2 border border-dashed border-border hover:border-[#6CABDD] text-smoke hover:text-foreground px-5 py-3 text-xs tracking-[0.2em] uppercase transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Another Car
          </button>
          {cars.length > 1 && (
            <button
              type="button"
              onClick={copyDestinationToAll}
              className="inline-flex items-center gap-2 text-smoke hover:text-foreground px-2 py-3 text-xs tracking-[0.2em] uppercase transition-colors"
            >
              <Copy className="w-4 h-4" />
              Same destination for all cars
            </button>
          )}
        </div>

        <div className="mt-10 flex items-center gap-6">
          <Button
            disabled={!canSubmit}
            onClick={() => setSubmitted(true)}
            className="tracking-[0.2em] uppercase px-10"
            style={{ backgroundColor: SKY, color: "#0b0a08" }}
          >
            Submit Request
          </Button>
          {!canSubmit && (
            <p className="text-smoke/70 text-xs">
              Each car needs at least one passenger, a pickup, a destination and a time.
            </p>
          )}
        </div>

        <p className="text-smoke/50 text-[11px] tracking-[0.1em] mt-14">
          Preview build. Requests are not yet dispatched from this portal.
        </p>
      </main>
    </div>
  );
};

export default McfcPortal;
