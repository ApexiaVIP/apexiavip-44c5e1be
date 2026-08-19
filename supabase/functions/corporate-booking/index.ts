import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_REQUESTS_PER_HOUR = 20;
const MAX_CARS = 10;

// Seats available per vehicle (must match the portal UI)
const CAPACITY: Record<string, number> = {
  "S-Class": 2,
  "Range Rover": 3,
  "Viano": 6,
  "JetClass": 5,
};

const vehicleToBookingClass: Record<string, string> = {
  "Range Rover": "Executive",
  "S-Class": "Executive",
  "Viano": "VIP",
  "JetClass": "VIP",
};

const dispatchMonthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The instant London-local midnight falls on for a given date. Stored times are
 * UTC, and in summer that is 23:00 the day before, so a schedule filtered on
 * plain UTC days puts late-night cars on the wrong sheet.
 */
const londonMidnightUtc = (dateStr: string) => {
  const naive = Date.parse(`${dateStr}T00:00:00Z`);
  for (const offsetMinutes of [0, -60]) {
    const guess = new Date(naive + offsetMinutes * 60000);
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(guess);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(guess);
    if (day === dateStr && time === "00:00") return guess.toISOString();
  }
  return new Date(naive).toISOString();
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitize = (str: string) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Dispatch carries the first and last address plus up to 10 stops en route. */
const MAX_STOPS = 12;

interface Stop {
  type: "pickup" | "dropoff";
  address: string;
  /** Who boards, or who alights; empty on a drop off means everyone aboard */
  passengers: string[];
  /** Match-day front-entrance drop-off */
  greyTarmac: boolean;
}

interface CarRequest {
  stops?: Stop[];
  vehicle: string;
  time: string;
  notes: string;
  /** Car stays at the passenger's disposal; the journey has no fixed end */
  asDirected?: boolean;
  asDirectedHours?: number;
  // Legacy single-leg shape, still accepted
  passengers?: string[];
  pickup?: string;
  destination?: string;
  greyTarmac?: boolean;
}

/** A car is an ordered run of stops; this walks it, checking it makes sense. */
const walkStops = (
  stops: Stop[],
  capacity: number,
  openEnded = false
): { error: string } | { manifest: string[]; peak: number } => {
  const aboard: string[] = [];
  const manifest: string[] = [];
  let peak = 0;

  for (const [idx, stop] of stops.entries()) {
    const at = `Stop ${idx + 1}`;
    if (stop.type === "pickup") {
      if (stop.passengers.length === 0) {
        return { error: `${at}: choose who is being picked up` };
      }
      for (const p of stop.passengers) {
        if (manifest.includes(p)) return { error: `${at}: ${p} is picked up twice` };
        aboard.push(p);
        manifest.push(p);
      }
      peak = Math.max(peak, aboard.length);
      if (peak > capacity) {
        return { error: `${at}: more passengers than the vehicle seats (${capacity})` };
      }
    } else {
      const leaving = stop.passengers.length > 0 ? stop.passengers : [...aboard];
      if (leaving.length === 0) {
        return { error: `${at}: nobody is in the car to drop off` };
      }
      for (const p of leaving) {
        const k = aboard.indexOf(p);
        if (k === -1) return { error: `${at}: ${p} is not in this car` };
        aboard.splice(k, 1);
      }
    }
  }

  // An as-directed car keeps its passengers: the chauffeur stays with them
  if (aboard.length > 0 && !openEnded) {
    return {
      error: `${aboard.join(", ")} ${aboard.length === 1 ? "is" : "are"} not dropped off anywhere`,
    };
  }
  return { manifest, peak };
};

/** Best-effort SMS; a failure never blocks a booking. */
const trySendSms = async (to: string, message: string) => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !authToken || !from || !to) return;
  try {
    const params = new URLSearchParams({ To: to, Body: message });
    params.append(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${sid}:${authToken}`)}`,
        },
        body: params.toString(),
      }
    );
    if (!res.ok) console.error("Confirmation SMS failed:", res.status, await res.text());
  } catch (err) {
    console.error("Confirmation SMS failed:", err);
  }
};

const stopsFallback = (j: { stops: Stop[] }) => j.stops[0]?.address ?? "";

/** Human route line for the chauffeur and the ops team. */
const describeRoute = (stops: Stop[]) =>
  stops
    .map((s, idx) => {
      const who = s.passengers.length > 0
        ? s.passengers.join(", ")
        : s.type === "dropoff"
          ? "all remaining"
          : "";
      return `${idx + 1}) ${s.type === "pickup" ? "PICK UP" : "DROP OFF"}${
        who ? ` ${who}` : ""
      } at ${s.address}${s.greyTarmac ? " [GREY TARMAC]" : ""}`;
    })
    .join("; ");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    const DISPATCH_TRANSFER_REFERENCE = Deno.env.get("DISPATCH_TRANSFER_REFERENCE");
    if (!DISPATCH_TRANSFER_REFERENCE) throw new Error("DISPATCH_TRANSFER_REFERENCE is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Corporate desk users only: authenticated, 2FA-verified, active profile
    // carrying a corporate tag
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return json(401, { success: false, error: "Sign in required" });
    }
    let sessionId: string | null = null;
    try {
      const payload = JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
      );
      sessionId = payload?.session_id ?? null;
    } catch {
      sessionId = null;
    }
    const { data: verifiedSession } = sessionId
      ? await supabase.from("mfa_sessions").select("id").eq("session_id", sessionId).maybeSingle()
      : { data: null };
    if (!verifiedSession) {
      return json(403, { success: false, error: "Two-factor verification required" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("status, corporate, corporate_groups, full_name, email, phone")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!profile || profile.status !== "active") {
      return json(403, { success: false, error: "Membership not active" });
    }
    if (!profile.corporate) {
      return json(403, { success: false, error: "No corporate desk access" });
    }
    const corporate = profile.corporate;
    // Some assistants are limited to certain groups (for example executives
    // only). Null means the whole desk.
    const groupScope: string[] | null = Array.isArray(profile.corporate_groups)
      ? (profile.corporate_groups as string[])
      : null;

    /** Passengers this caller is allowed to see and book for. */
    const scopedPassengers = async (columns: string, includeRetired = false) => {
      let q = supabase
        .from("corporate_passengers")
        .select(columns)
        .eq("corporate", corporate);
      if (!includeRetired) q = q.eq("active", true);
      if (groupScope && groupScope.length > 0) q = q.in("grp", groupScope);
      const { data } = await q;
      return (data ?? []) as unknown as Record<string, unknown>[];
    };

    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "submit";

    // --- Address book management (personal and global addresses) ---
    if (action === "address_add") {
      const label = typeof body.label === "string" ? body.label.trim() : "";
      const address = typeof body.address === "string" ? body.address.trim() : "";
      const greyTarmac = body.greyTarmac === true;
      const passengerId =
        typeof body.passengerId === "string" && body.passengerId ? body.passengerId : null;
      if (!label || label.length > 80) {
        return json(400, { success: false, error: "Please give the address a short name" });
      }
      if (!address || address.length > 240) {
        return json(400, { success: false, error: "Please enter the address" });
      }
      if (passengerId) {
        const visible = await scopedPassengers("id");
        if (!visible.some((r) => r.id === passengerId)) {
          return json(400, { success: false, error: "Unknown passenger" });
        }
      }
      const { data: row, error: addError } = await supabase
        .from("corporate_addresses")
        .insert({
          corporate,
          label,
          address,
          passenger_id: passengerId,
          grey_tarmac: greyTarmac,
        })
        .select()
        .single();
      if (addError) throw addError;
      return json(200, { success: true, address: row });
    }

    if (action === "passenger_add") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const grp = typeof body.grp === "string" ? body.grp.trim() : "";
      if (!name || name.length > 80) {
        return json(400, { success: false, error: "Enter a name" });
      }
      if (!grp) return json(400, { success: false, error: "Choose a group" });
      // A limited assistant can only add into their own groups
      if (groupScope && groupScope.length > 0 && !groupScope.includes(grp)) {
        return json(403, { success: false, error: "You cannot add someone to that group" });
      }
      const { data: existing } = await supabase
        .from("corporate_passengers")
        .select("id, active")
        .eq("corporate", corporate)
        .eq("name", name)
        .maybeSingle();
      if (existing) {
        if (existing.active) {
          return json(400, { success: false, error: `${name} is already on the list` });
        }
        // Someone previously removed comes back rather than duplicating
        const { error: reviveError } = await supabase
          .from("corporate_passengers")
          .update({ active: true, grp })
          .eq("id", existing.id);
        if (reviveError) throw reviveError;
        return json(200, { success: true, id: existing.id, restored: true });
      }
      const { data: last } = await supabase
        .from("corporate_passengers")
        .select("sort")
        .eq("corporate", corporate)
        .eq("grp", grp)
        .order("sort", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: created, error: addError } = await supabase
        .from("corporate_passengers")
        .insert({
          corporate,
          name,
          grp,
          sort: ((last?.sort as number) ?? 0) + 1,
          active: true,
        })
        .select("id")
        .single();
      if (addError) throw addError;
      return json(200, { success: true, id: created?.id });
    }

    if (action === "passenger_remove") {
      const id = typeof body.id === "string" && body.id ? body.id : "";
      const visible = await scopedPassengers("id");
      if (!id || !visible.some((r) => r.id === id)) {
        return json(400, { success: false, error: "Unknown passenger" });
      }
      // Retire rather than delete, so past journeys keep their names
      const { error: remError } = await supabase
        .from("corporate_passengers")
        .update({ active: false })
        .eq("id", id)
        .eq("corporate", corporate);
      if (remError) throw remError;
      return json(200, { success: true });
    }

    if (action === "passenger_update") {
      const id = typeof body.id === "string" && body.id ? body.id : "";
      const visible = await scopedPassengers("id");
      if (!id || !visible.some((r) => r.id === id)) {
        return json(400, { success: false, error: "Unknown passenger" });
      }
      const phone = typeof body.phone === "string" ? body.phone.replace(/[\s\-()]/g, "") : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
        return json(400, {
          success: false,
          error: "Enter the mobile in international format, for example +447700900123",
        });
      }
      if (email && (!email.includes("@") || email.length > 255)) {
        return json(400, { success: false, error: "Enter a valid email address" });
      }
      const notifyTarget = body.notifyTarget === "booker" ? "booker" : "passenger";
      const notifySms = body.notifySms === true;
      const notifyEmail = body.notifyEmail === true;
      // Confirmations to the passenger need somewhere to send them
      if (notifyTarget === "passenger" && notifySms && !phone) {
        return json(400, { success: false, error: "Add a mobile number to send confirmations by SMS" });
      }
      if (notifyTarget === "passenger" && notifyEmail && !email) {
        return json(400, { success: false, error: "Add an email address to send confirmations by email" });
      }
      const newName = typeof body.name === "string" ? body.name.trim() : "";
      if (body.name != null && (!newName || newName.length > 80)) {
        return json(400, { success: false, error: "Enter a name" });
      }
      const newGrp = typeof body.grp === "string" ? body.grp.trim() : "";
      if (newGrp && groupScope && groupScope.length > 0 && !groupScope.includes(newGrp)) {
        return json(403, { success: false, error: "You cannot move someone to that group" });
      }
      if (newName) {
        const { data: clash } = await supabase
          .from("corporate_passengers")
          .select("id")
          .eq("corporate", corporate)
          .eq("name", newName)
          .neq("id", id)
          .maybeSingle();
        if (clash) return json(400, { success: false, error: `${newName} is already on the list` });
      }
      const { error: updError } = await supabase
        .from("corporate_passengers")
        .update({
          ...(newName ? { name: newName } : {}),
          ...(newGrp ? { grp: newGrp } : {}),
          phone,
          email,
          notify_sms: notifySms,
          notify_email: notifyEmail,
          notify_target: notifyTarget,
        })
        .eq("id", id)
        .eq("corporate", corporate);
      if (updError) throw updError;
      return json(200, { success: true });
    }

    if (action === "address_delete") {
      const id = typeof body.id === "string" && body.id ? body.id : "";
      if (!id) return json(400, { success: false, error: "Invalid address" });
      const { error: delError } = await supabase
        .from("corporate_addresses")
        .delete()
        .eq("id", id)
        .eq("corporate", corporate);
      if (delError) throw delError;
      return json(200, { success: true });
    }

    // --- Match-day schedule: every desk booking for a date, with live
    // driver and vehicle details from Dispatch where allocated ---
    if (action === "schedule") {
      const d = typeof body.date === "string" ? body.date.trim() : "";
      const dTo = typeof body.dateTo === "string" && body.dateTo.trim() ? body.dateTo.trim() : d;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(dTo)) {
        return json(400, { success: false, error: "Invalid date" });
      }
      if (dTo < d) {
        return json(400, { success: false, error: "The end date is before the start date" });
      }
      const spanDays = Math.round((Date.parse(dTo) - Date.parse(d)) / 86400000) + 1;
      if (spanDays > 31) {
        return json(400, { success: false, error: "Choose a range of 31 days or fewer" });
      }
      const dayStart = londonMidnightUtc(d);
      const dayEnd = londonMidnightUtc(
        new Date(Date.parse(dTo) + 86400000).toISOString().slice(0, 10)
      );
      const { data: rows, error: schedError } = await supabase
        .from("bookings")
        .select(
          "reference, name, vehicle, passengers, collection_at, pickup, dropoff, via, stops, status"
        )
        .eq("corporate", corporate)
        .gte("collection_at", dayStart)
        .lt("collection_at", dayEnd)
        .order("collection_at");
      if (schedError) throw schedError;
      let active = (rows ?? []).filter(
        (r) => r.status !== "Failed" && r.status !== "Cancelled"
      );

      // A limited assistant sees only journeys made up of their own people
      if (groupScope && groupScope.length > 0) {
        const visible = new Set(
          (await scopedPassengers("name", true)).map((r) => r.name as string)
        );
        active = active.filter((r) => {
          const names = String(r.name ?? "")
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);
          return names.length > 0 && names.every((n) => visible.has(n));
        });
      }

      const live: Record<string, unknown> = {};
      const refs = active.map((r) => r.reference as string).filter(Boolean);
      if (refs.length > 0) {
        try {
          const statusAuth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);
          const statusRes = await fetch(
            `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=${encodeURIComponent(DISPATCH_TRANSFER_REFERENCE)}&CheckBookingStatus=true`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${statusAuth}`,
              },
              body: JSON.stringify({ Bookings: refs.map((reference) => ({ Reference: reference })) }),
            }
          );
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            const statusResult = Array.isArray(statusData?.Result) ? statusData.Result[0] : statusData;
            for (const b of Array.isArray(statusResult?.Bookings) ? statusResult.Bookings : []) {
              if (!b?.Reference) continue;
              live[b.Reference] = {
                bookingStatus: b?.BookingStatus ?? null,
                driverName: b?.Driver?.Name ?? "",
                driverMobile: b?.Driver?.Mobile ?? "",
                vehicleDescription: b?.Vehicle?.Description ?? "",
                vehicleRegistration: b?.Vehicle?.Registration ?? "",
              };
            }
          }
        } catch (statusErr) {
          console.error("Schedule status enrich failed:", statusErr);
        }
      }

      return json(200, {
        success: true,
        schedule: active.map((r) => ({ ...r, live: live[r.reference as string] ?? null })),
      });
    }

    if (action !== "submit") {
      return json(400, { success: false, error: "Unknown action" });
    }

    // Rate limiting (submissions only)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("cf-connecting-ip") || "unknown";
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("endpoint", "corporate-booking")
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR) {
      return json(429, { success: false, error: "Too many requests. Please try again later." });
    }
    await supabase.from("rate_limits").insert({ ip_address: ip, endpoint: "corporate-booking" });

    // --- Validate the request ---
    const travelDate = typeof body.travelDate === "string" ? body.travelDate.trim() : "";
    const dateMatch = travelDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return json(400, { success: false, error: "Invalid travel date" });
    }
    const [, year, month, day] = dateMatch;
    const monthName = dispatchMonthNames[Number(month) - 1];
    if (!monthName) {
      return json(400, { success: false, error: "Invalid travel date" });
    }

    const cars: CarRequest[] = Array.isArray(body.cars) ? body.cars : [];
    if (cars.length < 1 || cars.length > MAX_CARS) {
      return json(400, { success: false, error: `Requests must contain 1 to ${MAX_CARS} cars` });
    }

    // Amending? Reuse the original reference so Dispatch overwrites the
    // booking. Amendments are per car: exactly one car, owned by the caller.
    const amendReference =
      typeof body.amendReference === "string" && body.amendReference ? body.amendReference : null;
    if (amendReference) {
      if (cars.length !== 1) {
        return json(400, { success: false, error: "Amendments cover one car at a time" });
      }
      const { data: existing } = await supabase
        .from("bookings")
        .select("reference, user_id, corporate, status")
        .eq("reference", amendReference)
        .maybeSingle();
      if (!existing || existing.user_id !== userData.user.id || existing.corporate !== corporate) {
        return json(403, { success: false, error: "Booking not found" });
      }
      if (existing.status === "Cancelled") {
        return json(400, { success: false, error: "This booking is cancelled. Please request a new car." });
      }
    }

    // Passenger names must come from this desk's approved list
    const allowedRows = await scopedPassengers("name");
    const allowedNames = new Set(allowedRows.map((r) => r.name as string));

    // Each car becomes an ordered stop list, whether the desk sent the
    // multi-stop shape or the older single-leg one
    const journeys: {
      stops: Stop[];
      manifest: string[];
      peak: number;
      asDirected: boolean;
      asDirectedHours: number;
    }[] = [];

    for (const [i, car] of cars.entries()) {
      const label = `Car ${i + 1}`;
      if (!car || typeof car !== "object") {
        return json(400, { success: false, error: `${label}: invalid` });
      }
      const capacity = CAPACITY[car.vehicle];
      if (!capacity) {
        return json(400, { success: false, error: `${label}: invalid vehicle` });
      }
      if (typeof car.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(car.time)) {
        return json(400, { success: false, error: `${label}: invalid pickup time` });
      }
      if (car.notes != null && (typeof car.notes !== "string" || car.notes.length > 500)) {
        return json(400, { success: false, error: `${label}: notes too long` });
      }

      const asDirected = car.asDirected === true;
      const asDirectedHours = asDirected ? Number(car.asDirectedHours) : 0;
      if (asDirected && (!Number.isFinite(asDirectedHours) || asDirectedHours < 1 || asDirectedHours > 24)) {
        return json(400, { success: false, error: `${label}: choose how many hours the car is needed for` });
      }

      const rawStops: unknown[] = Array.isArray(car.stops) && car.stops.length > 0
        ? car.stops
        : [
            { type: "pickup", address: car.pickup, passengers: car.passengers, greyTarmac: false },
            { type: "dropoff", address: car.destination, passengers: [], greyTarmac: car.greyTarmac === true },
          ];

      const minStops = asDirected ? 1 : 2;
      if (rawStops.length < minStops || rawStops.length > MAX_STOPS) {
        return json(400, {
          success: false,
          error: asDirected
            ? `${label}: an as directed car needs at least a collection`
            : `${label}: a journey needs 2 to ${MAX_STOPS} stops`,
        });
      }

      const stops: Stop[] = [];
      for (const [s, raw] of rawStops.entries()) {
        const at = `${label}, stop ${s + 1}`;
        const r = raw as Record<string, unknown>;
        if (!r || typeof r !== "object") {
          return json(400, { success: false, error: `${at}: invalid` });
        }
        const address = typeof r.address === "string" ? r.address.trim() : "";
        if (!address || address.length > 200) {
          return json(400, { success: false, error: `${at}: enter an address` });
        }
        const passengers = Array.isArray(r.passengers) ? r.passengers : [];
        for (const p of passengers) {
          if (typeof p !== "string" || !allowedNames.has(p)) {
            return json(400, { success: false, error: `${at}: unrecognised passenger` });
          }
        }
        if (new Set(passengers as string[]).size !== passengers.length) {
          return json(400, { success: false, error: `${at}: duplicate passenger` });
        }
        if (r.greyTarmac != null && typeof r.greyTarmac !== "boolean") {
          return json(400, { success: false, error: `${at}: invalid grey tarmac flag` });
        }
        stops.push({
          type: r.type === "dropoff" ? "dropoff" : "pickup",
          address,
          passengers: passengers as string[],
          greyTarmac: r.greyTarmac === true,
        });
      }

      if (stops[0].type !== "pickup") {
        return json(400, { success: false, error: `${label}: the first stop must be a pick up` });
      }
      if (!asDirected && stops[stops.length - 1].type !== "dropoff") {
        return json(400, { success: false, error: `${label}: the last stop must be a drop off` });
      }
      if (stops.some((s) => s.greyTarmac && s.type !== "dropoff")) {
        return json(400, {
          success: false,
          error: `${label}: Grey Tarmac applies to a drop off, not a pick up`,
        });
      }

      const walked = walkStops(stops, capacity, asDirected);
      if ("error" in walked) {
        return json(400, { success: false, error: `${label}, ${walked.error}` });
      }
      journeys.push({
        stops,
        manifest: walked.manifest,
        peak: walked.peak,
        asDirected,
        asDirectedHours,
      });
    }

    // Grey tarmac is a home match-day arrangement: the destination must be a
    // saved front-entrance address and the date must be a home fixture. Desks
    // with no fixture list yet are not held to the fixture half of the rule.
    if (journeys.some((j) => j.stops.some((s) => s.greyTarmac))) {
      const { data: fixtureRows } = await supabase
        .from("fixtures")
        .select("is_home, kickoff_utc")
        .eq("corporate", corporate);
      const hasFixtures = (fixtureRows ?? []).length > 0;
      const isHomeMatchDay = (fixtureRows ?? []).some(
        (f) =>
          f.is_home &&
          new Date(f.kickoff_utc as string).toLocaleDateString("en-CA", {
            timeZone: "Europe/London",
          }) === travelDate
      );

      if (hasFixtures && !isHomeMatchDay) {
        return json(400, {
          success: false,
          error: "Grey Tarmac drop off applies on home match days only",
        });
      }
    }

    const bookerName = (profile.full_name || "Travel Desk").trim();
    const bookerPhone = (profile.phone || "").trim();
    const bookerEmail = (profile.email || "").trim() || userData.user.email || "";
    const requestId = Date.now();
    const deskName = corporate.toUpperCase();

    // --- Build one Dispatch transfer carrying every car ---
    const dispatchAddress = (line1: string) => ({
      Line1: line1,
      Line2: "",
      Town: "",
      Postcode: "",
      Country: "United Kingdom",
    });

    const dispatchBookings = cars.map((car, i) => {
      const { stops, manifest, peak, asDirected, asDirectedHours } = journeys[i];
      const reference = amendReference ?? `APEXIA-${deskName}-${requestId}-C${i + 1}`;
      const last = stops[stops.length - 1];
      const endsWithDropoff = last?.type === "dropoff";
      // An as-directed car has no fixed destination, so everything after the
      // collection rides as a stop en route
      const viaStops = asDirected && !endsWithDropoff ? stops.slice(1) : stops.slice(1, -1);
      const anyGrey = stops.some((s) => s.greyTarmac);
      return {
        Reference: reference,
        CollectionDateTime: `${day}-${monthName}-${year} ${car.time}`,
        NumPassengers: peak,
        PassengerName: manifest[0],
        PassengerPhoneNumber: bookerPhone,
        PassengerMobileNumber: bookerPhone,
        ...(bookerEmail ? { PassengerEmailAddress: bookerEmail } : {}),
        BookingClass: vehicleToBookingClass[car.vehicle] || "Executive",
        BookedBy: `${deskName} Travel Desk`,
        BookingNotes: [
          anyGrey ? "GREY TARMAC DROP OFF (front entrance)." : "",
          asDirected ? `AS DIRECTED: car at disposal for ${asDirectedHours} hours.` : "",
          `${deskName} Travel Desk request (car ${i + 1} of ${cars.length}), booked by ${bookerName}.`,
          `Vehicle: ${car.vehicle}.`,
          `Passengers: ${manifest.join(", ")}.`,
          `Route: ${describeRoute(stops)}.`,
          car.notes?.trim() ? `Notes: ${car.notes.trim()}` : "",
        ].filter(Boolean).join(" "),
        AsDirected: asDirected ? "T" : "F",
        ...(asDirected
          ? { AsDirectedTime: asDirectedHours * 60, AsDirectedMileage: 0 }
          : {}),
        PickUpAddress: dispatchAddress(stops[0].address),
        ...(endsWithDropoff
          ? { DropOffAddress: dispatchAddress(last.address) }
          : {}),
        // Everything between the first and last stop rides as a via address
        ...Object.fromEntries(
          viaStops
            .slice(0, 10)
            .map((s, n) => [`ViaAddress${n + 1}`, dispatchAddress(s.address)])
        ),
      };
    });

    // Store each car against the booker so it shows in the portal history
    const carRowValues = cars.map((car, i) => {
      const { stops, manifest, peak, asDirected, asDirectedHours } = journeys[i];
      const last = stops[stops.length - 1];
      const endsWithDropoff = last?.type === "dropoff";
      const viaStops = asDirected && !endsWithDropoff ? stops.slice(1) : stops.slice(1, -1);
      return {
        name: manifest.join(", "),
        email: bookerEmail,
        phone: bookerPhone,
        travel_date: `${day}-${monthName}-${year} ${car.time}`,
        vehicle: car.vehicle,
        passengers: peak,
        bags: 0,
        collection_at: new Date(`${travelDate}T${car.time}:00`).toISOString(),
        pickup: { line1: stops[0].address, town: "", postcode: "" },
        dropoff: {
          line1: endsWithDropoff
            ? last.address
            : `As directed (${asDirectedHours} hours)`,
          town: "",
          postcode: "",
          // Any front-entrance stop marks the car, so it stands out on the sheet
          ...(stops.some((s) => s.greyTarmac) ? { grey_tarmac: true } : {}),
        },
        journey_type: asDirected ? "hourly" : "destination",
        as_directed_hours: asDirected ? asDirectedHours : null,
        via:
          viaStops.length > 0
            ? viaStops.map((s) => ({ line1: s.address, town: "", postcode: "" }))
            : null,
        stops,
      };
    });
    if (!amendReference) {
      const { error: dbError } = await supabase.from("bookings").insert(
        carRowValues.map((values, i) => ({
          ...values,
          user_id: userData.user.id,
          reference: dispatchBookings[i].Reference,
          corporate,
          status: "Requested",
        }))
      );
      if (dbError) {
        console.error("DB insert error:", dbError);
      }
    }

    const dispatchAuth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);
    const dispatchUrl = `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=${encodeURIComponent(DISPATCH_TRANSFER_REFERENCE)}&BookedBy=${encodeURIComponent(`${deskName} Travel Desk`)}`;

    let transferFailureMessage: string | null = null;
    const failedReferences: string[] = [];
    const confirmedReferences: string[] = [];

    try {
      const dispatchRes = await fetch(dispatchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${dispatchAuth}`,
        },
        body: JSON.stringify({ Bookings: dispatchBookings }),
      });
      const dispatchData = await dispatchRes.json();
      console.log("Dispatch API response:", JSON.stringify(dispatchData));

      const dispatchResult = Array.isArray(dispatchData?.Result) ? dispatchData.Result[0] : dispatchData;
      const resultBookings: Array<Record<string, unknown>> = Array.isArray(dispatchResult?.Bookings)
        ? dispatchResult.Bookings
        : [];

      if (!dispatchRes.ok) {
        transferFailureMessage = `Dispatch API returned HTTP ${dispatchRes.status}`;
      } else if (dispatchResult?.TransferStatus === "Failed") {
        transferFailureMessage = dispatchResult?.Message || "Dispatch transfer failed";
      } else {
        for (const dispatchBooking of dispatchBookings) {
          const match = resultBookings.find(
            (b) => b.BookingReference === dispatchBooking.Reference || b.Reference === dispatchBooking.Reference
          ) ?? resultBookings[dispatchBookings.indexOf(dispatchBooking)];
          if (match && match.Status === "Failed") {
            failedReferences.push(dispatchBooking.Reference);
          } else {
            confirmedReferences.push(dispatchBooking.Reference);
            const carIndex = dispatchBookings.indexOf(dispatchBooking);
            await supabase
              .from("bookings")
              .update({
                // An accepted amendment writes the new details over our record
                ...(amendReference ? carRowValues[carIndex] : {}),
                ...(match?.AssignedBookingID != null
                  ? {
                      assigned_booking_id: match.AssignedBookingID as number,
                      assigned_reference: (match?.AssignedBookingReference as string | undefined) ?? null,
                    }
                  : {}),
                status: "Confirmed",
              })
              .eq("reference", dispatchBooking.Reference);
          }
        }
      }
    } catch (dispatchErr) {
      console.error("Dispatch API call failed:", dispatchErr);
      transferFailureMessage = "Dispatch API call failed";
    }

    if (transferFailureMessage) {
      failedReferences.push(...dispatchBookings.map((b) => b.Reference));
    }
    // A failed amendment leaves the original booking standing untouched
    if (failedReferences.length > 0 && !amendReference) {
      await supabase.from("bookings").update({ status: "Failed" }).in("reference", failedReferences);
    }

    // --- One ops summary email for the whole request ---
    const carRows = cars.map((car, i) => {
      const { stops, manifest, peak } = journeys[i];
      const routeHtml = stops
        .map(
          (s, n) =>
            `<div style="margin-bottom: 3px;"><span style="color: #8a8070;">${n + 1}.</span> <strong>${
              s.type === "pickup" ? "Pick up" : "Drop off"
            }</strong> ${sanitize(
              s.passengers.length > 0
                ? s.passengers.join(", ")
                : s.type === "dropoff"
                  ? "all remaining"
                  : ""
            )} at ${sanitize(s.address)}${
              s.greyTarmac ? ' <strong style="color: #e0c341;">[GREY TARMAC]</strong>' : ""
            }</div>`
        )
        .join("");
      return `
      <tr>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${i + 1}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.time)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.vehicle)} (${peak} up)</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(manifest.join(", "))}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${routeHtml}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.notes?.trim() || "")}</td>
      </tr>`;
    }).join("");

    const htmlBody = `
      <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 720px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px;">
        <h1 style="font-size: 22px; font-weight: 300; letter-spacing: 0.1em; border-bottom: 1px solid #2a2a2a; padding-bottom: 20px; color: #b89b5e;">
          ${deskName} Travel Desk: ${
            amendReference
              ? `booking AMENDED (${sanitize(amendReference)})`
              : `${cars.length} car${cars.length === 1 ? "" : "s"} requested`
          }
        </h1>
        <p style="color: #8a8070; font-size: 13px;">
          Travel date: <strong style="color: #e0d5c4;">${day}-${monthName}-${year}</strong>
          &nbsp;|&nbsp; Booked by: <strong style="color: #e0d5c4;">${sanitize(bookerName)}</strong>
          ${bookerPhone ? `&nbsp;|&nbsp; ${sanitize(bookerPhone)}` : ""}
          ${failedReferences.length > 0 ? `<br/><strong style="color: #d06060;">WARNING: ${failedReferences.length} car(s) failed to transfer to Dispatch and need manual entry.</strong>` : ""}
        </p>
        <table style="width: 100%; margin-top: 16px; border-collapse: collapse; font-size: 13px;">
          <tr style="color: #8a8070; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; text-align: left;">
            <th style="padding: 8px;">#</th><th style="padding: 8px;">Time</th><th style="padding: 8px;">Vehicle</th>
            <th style="padding: 8px;">Passengers</th><th style="padding: 8px;">Route</th><th style="padding: 8px;">Notes</th>
          </tr>
          ${carRows}
        </table>
      </div>
    `;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "Apexia VIP <info@apexiavip.com>",
          to: ["info@apexiavip.com"],
          subject: `${
            amendReference && failedReferences.length > 0 ? "ACTION NEEDED - " : ""
          }${deskName} Travel Desk: ${
            amendReference ? "booking AMENDED" : `${cars.length} car(s)`
          } for ${day}-${monthName}-${year}${
            failedReferences.length > 0
              ? amendReference
                ? " (APPLY THIS CHANGE BY HAND)"
                : " (TRANSFER FAILED)"
              : ""
          }`,
          html: htmlBody,
          ...(bookerEmail ? { reply_to: bookerEmail } : {}),
        }),
      });
      if (!res.ok) {
        console.error("Resend API error:", res.status, await res.text());
      }
    } catch (emailErr) {
      console.error("Ops email failed:", emailErr);
    }

    // --- Passenger confirmations, per their own preferences ---
    if (confirmedReferences.length > 0) {
      try {
        const contactRows = await scopedPassengers(
          "name, phone, email, notify_sms, notify_email, notify_target"
        );
        const contacts = new Map(contactRows.map((r) => [r.name as string, r]));

        for (const [i, journey] of journeys.entries()) {
          const car = cars[i];
          if (!confirmedReferences.includes(dispatchBookings[i].Reference)) continue;
          const when = `${day}-${monthName}-${year} at ${car.time}`;
          // An amendment must not read like a brand new car
          const lead = amendReference ? "Updated booking" : "Car confirmed";

          for (const name of journey.manifest) {
            const c = contacts.get(name);
            if (!c) continue;
            if (c.notify_sms !== true && c.notify_email !== true) continue;

            // Where this passenger gets on and off
            const boarding = journey.stops.find(
              (s) => s.type === "pickup" && s.passengers.includes(name)
            );
            const setDown = journey.stops.find(
              (s) =>
                s.type === "dropoff" &&
                (s.passengers.length === 0 || s.passengers.includes(name))
            );
            const toBooker = c.notify_target === "booker";
            const line =
              `${name}: car on ${when} from ${boarding?.address ?? stopsFallback(journey)}` +
              `${setDown ? ` to ${setDown.address}` : ""}. ${car.vehicle}.`;

            const smsTo = toBooker ? bookerPhone : ((c.phone as string) || "");
            const emailTo = toBooker ? bookerEmail : ((c.email as string) || "");

            if (c.notify_sms === true && smsTo) {
              await trySendSms(
                smsTo,
                `APEXIA VIP - ${lead}. ${line} Booked by ${bookerName}. Any changes, contact your travel desk.`
              );
            }
            if (c.notify_email === true && emailTo) {
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${RESEND_API_KEY}`,
                },
                body: JSON.stringify({
                  from: "Apexia VIP <info@apexiavip.com>",
                  to: [emailTo],
                  subject: `${lead}: ${when}`,
                  html: `
                    <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 520px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px;">
                      <p style="color: #b89b5e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3em;">Apexia VIP</p>
                      <h1 style="font-size: 20px; font-weight: 300; letter-spacing: 0.08em;">${amendReference ? "Your booking has been updated" : "Your car is confirmed"}</h1>
                      <p style="font-size: 14px; color: #8a8070; line-height: 1.8;">
                        <strong style="color: #e0d5c4;">${sanitize(name)}</strong><br/>
                        ${sanitize(when)}<br/>
                        From ${sanitize(boarding?.address ?? "")}${setDown ? ` to ${sanitize(setDown.address)}` : ""}<br/>
                        Vehicle: ${sanitize(car.vehicle)}<br/>
                        Booked by ${sanitize(bookerName)}
                      </p>
                      <p style="font-size: 11px; color: #8a8070;">Any changes, please contact your travel desk. All journeys are handled with complete discretion.</p>
                    </div>
                  `,
                }),
              });
            }
          }
        }
      } catch (notifyErr) {
        // Confirmations must never fail a booking that is already placed
        console.error("Passenger confirmations failed:", notifyErr);
      }
    }

    if (confirmedReferences.length === 0) {
      // An amendment the booking system will not take is still a clear
      // instruction from the desk, so pass it to the ops team by hand. The ops
      // email above already carries the new details, marked AMENDED.
      if (amendReference) {
        return json(200, {
          success: true,
          handedToOps: true,
          references: [amendReference],
          failed: [],
          message:
            "Your travel team has been asked to make this change and will confirm shortly.",
        });
      }
      return json(502, {
        success: false,
        error: "We couldn't send this request to the booking system. Our team has been notified; please contact us directly.",
      });
    }

    return json(200, {
      success: true,
      references: confirmedReferences,
      failed: failedReferences,
    });
  } catch (error: unknown) {
    console.error("Error processing corporate booking:", error);
    return json(500, { success: false, error: "An error occurred processing your request." });
  }
});
