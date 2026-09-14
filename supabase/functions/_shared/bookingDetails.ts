// The extra detail a booking can carry beyond the journey itself: notes,
// children (whose ages decide the seats we fit), who is paying, and the
// client's own car when we are sending a chauffeur rather than a car.
// Parsed here once so the member form and the club desk agree on the rules
// and the office reads the same wording from either.

export interface Child {
  age: number;
}

export interface BusinessDetails {
  company: string;
  department: string;
  clients: string;
  pa_name: string;
  pa_contact: string;
  invoice_address: string;
}

export interface ClientCar {
  make_model: string;
  registration: string;
  client_travelling: boolean;
}

export const MAX_NOTES = 1000;
export const MAX_CHILDREN = 8;

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export const parseNotes = (v: unknown): string | null => {
  const s = str(v, MAX_NOTES);
  return s ? s : null;
};

/** Ages only; anything that is not a whole number 0-17 is dropped. */
export const parseChildren = (v: unknown): Child[] => {
  if (!Array.isArray(v)) return [];
  const out: Child[] = [];
  for (const c of v.slice(0, MAX_CHILDREN)) {
    const age = typeof c === "number" ? c : (c as { age?: unknown })?.age;
    if (typeof age === "number" && Number.isInteger(age) && age >= 0 && age <= 17) {
      out.push({ age });
    }
  }
  return out;
};

export const parseBusiness = (v: unknown): BusinessDetails | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const b: BusinessDetails = {
    company: str(o.company, 120),
    department: str(o.department, 120),
    clients: str(o.clients, 300),
    pa_name: str(o.pa_name, 120),
    pa_contact: str(o.pa_contact, 200),
    invoice_address: str(o.invoice_address, 400),
  };
  return b.company ? b : null;
};

export const parseClientCar = (v: unknown): ClientCar | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const car: ClientCar = {
    make_model: str(o.make_model, 80),
    registration: str(o.registration, 20).toUpperCase(),
    client_travelling: o.client_travelling === true,
  };
  return car.make_model && car.registration ? car : null;
};

/**
 * What we fit for a child of this age. Under 4 gets a full child seat (a
 * baby seat under 1); 4 to 11 a booster; from 12 the adult belt is fine.
 */
export const seatFor = (age: number): "baby seat" | "child seat" | "booster" | null => {
  if (age < 1) return "baby seat";
  if (age < 4) return "child seat";
  if (age < 12) return "booster";
  return null;
};

/** "2 children (ages 2 and 7): 1 child seat, 1 booster" */
export const describeChildren = (children: Child[]): string => {
  if (children.length === 0) return "";
  const ages = children.map((c) => c.age);
  const agesText =
    ages.length === 1 ? `age ${ages[0]}` : `ages ${ages.slice(0, -1).join(", ")} and ${ages[ages.length - 1]}`;
  const counts = new Map<string, number>();
  for (const a of ages) {
    const seat = seatFor(a);
    if (seat) counts.set(seat, (counts.get(seat) ?? 0) + 1);
  }
  const seats = [...counts.entries()].map(([seat, n]) => `${n} ${seat}${n > 1 ? "s" : ""}`);
  return `${children.length} ${children.length === 1 ? "child" : "children"} (${agesText}): ${
    seats.length > 0 ? seats.join(", ") : "no seats needed"
  }`;
};

export const describeClientCar = (car: ClientCar): string =>
  `CLIENT'S OWN CAR: ${car.make_model}, reg ${car.registration}. ${
    car.client_travelling ? "Client travelling in the car." : "Vehicle move only, client not travelling."
  } Chauffeur only, no Apexia vehicle required.`;

export const describeBusiness = (b: BusinessDetails): string => {
  const parts = [`BUSINESS: ${b.company}`];
  if (b.department) parts.push(`Dept ${b.department}`);
  if (b.clients) parts.push(`Clients: ${b.clients}`);
  if (b.pa_name || b.pa_contact) parts.push(`PA: ${[b.pa_name, b.pa_contact].filter(Boolean).join(", ")}`);
  if (b.invoice_address) parts.push(`Invoice to: ${b.invoice_address}`);
  return parts.join(". ");
};

/** Lines for Dispatch's BookingNotes, in the order the dispatcher needs them. */
export const detailLines = (d: {
  children: Child[];
  clientCar: ClientCar | null;
  business: BusinessDetails | null;
  notes: string | null;
}): string[] => {
  const lines: string[] = [];
  if (d.clientCar) lines.push(describeClientCar(d.clientCar));
  if (d.children.length > 0) lines.push(`CHILDREN: ${describeChildren(d.children)}.`);
  if (d.business) lines.push(`${describeBusiness(d.business)}.`);
  if (d.notes) lines.push(`NOTES: ${d.notes}`);
  return lines;
};
