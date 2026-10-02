import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DISPATCH_TRANSFER_REFERENCE = Deno.env.get("DISPATCH_TRANSFER_REFERENCE") ?? "";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Two phone numbers are the same chauffeur if their last nine digits match.
 * Dispatch stores them however the office typed them: 07700 900123,
 * +447700900123, 44 7700 900123.
 */
const phoneKey = (raw: string | null | undefined): string => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return json(401, { error: "Not authenticated" });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json(401, { error: "Not authenticated" });
    const user = userData.user;

    const { data: profile } = await admin
      .from("profiles")
      .select("status, is_driver, full_name, phone")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.status !== "active") return json(403, { error: "Account not active" });
    if (profile.is_driver !== true) return json(403, { error: "Not a driver account" });

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "today";

    // --- Shift clock: ours alone, and the basis of the timesheet ---
    if (action === "shift_start" || action === "shift_end") {
      const { data: open } = await admin
        .from("driver_shifts")
        .select("id, started_at")
        .eq("driver_id", user.id)
        .is("ended_at", null)
        .maybeSingle();

      if (action === "shift_start") {
        if (open) return json(200, { success: true, shift: open });
        const { data: created, error } = await admin
          .from("driver_shifts")
          .insert({ driver_id: user.id })
          .select("id, started_at")
          .single();
        if (error) throw error;
        return json(200, { success: true, shift: created });
      }

      if (!open) return json(200, { success: true, shift: null });
      const { error } = await admin
        .from("driver_shifts")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", open.id);
      if (error) throw error;
      return json(200, { success: true, shift: null });
    }

    // --- Record a stop within a job ---
    if (action === "waypoint_add") {
      const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 80) : "";
      const kind = typeof body.kind === "string" ? body.kind : "";
      if (!reference) return json(400, { error: "Which job?" });
      if (!["set_down", "collected", "waiting", "note"].includes(kind)) {
        return json(400, { error: "Unknown kind of stop" });
      }
      const { error } = await admin.from("booking_waypoints").insert({
        booking_reference: reference,
        driver_id: user.id,
        kind,
        place: typeof body.place === "string" ? body.place.trim().slice(0, 200) : "",
        note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : "",
      });
      if (error) throw error;
      return json(200, { success: true });
    }

    if (action === "waypoint_undo") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json(400, { error: "Which entry?" });
      // Only the driver's own, and only while it is fresh enough to be a slip
      const { error } = await admin
        .from("booking_waypoints")
        .delete()
        .eq("id", id)
        .eq("driver_id", user.id)
        .gte("recorded_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
      if (error) throw error;
      return json(200, { success: true });
    }

    // --- The driver's day ---
    const open = await admin
      .from("driver_shifts")
      .select("id, started_at")
      .eq("driver_id", user.id)
      .is("ended_at", null)
      .maybeSingle();

    // Everything that could still be driven: from six hours ago to the end of
    // tomorrow, so an overnight job and tomorrow's early start both appear
    const from = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 42 * 3600 * 1000).toISOString();
    const { data: candidates } = await admin
      .from("bookings")
      .select(
        "reference, name, vehicle, collection_at, travel_date, pickup, dropoff, via, stops, journey_type, as_directed_hours, notes, children, client_car, passengers, status, corporate"
      )
      .not("reference", "is", null)
      .not("collection_at", "is", null)
      .gte("collection_at", from)
      .lte("collection_at", to)
      .not("status", "in", '("Cancelled","Failed")')
      .order("collection_at");

    const refs = (candidates ?? []).map((b) => b.reference as string);
    const mine: Record<string, unknown>[] = [];

    if (refs.length > 0 && DISPATCH_TRANSFER_REFERENCE) {
      // Dispatch knows who is driving; we match on the mobile it reports
      const auth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);
      try {
        const res = await fetch(
          `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=${encodeURIComponent(
            DISPATCH_TRANSFER_REFERENCE
          )}&CheckBookingStatus=true`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
            body: JSON.stringify({ Bookings: refs.map((reference) => ({ Reference: reference })) }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const result = Array.isArray(data?.Result) ? data.Result[0] : data;
          const live = new Map<string, Record<string, unknown>>();
          for (const b of Array.isArray(result?.Bookings) ? result.Bookings : []) {
            if (b?.Reference) live.set(b.Reference, b);
          }
          const myKey = phoneKey(profile.phone as string);
          for (const booking of candidates ?? []) {
            const l = live.get(booking.reference as string);
            const driverPhone = phoneKey((l?.Driver as { Mobile?: string })?.Mobile);
            if (!myKey || !driverPhone || driverPhone !== myKey) continue;
            mine.push({
              ...booking,
              dispatchStatus: l?.BookingStatus ?? null,
              vehicleDescription: (l?.Vehicle as { Description?: string })?.Description ?? "",
              vehicleRegistration: (l?.Vehicle as { Registration?: string })?.Registration ?? "",
            });
          }
        } else {
          console.error("Dispatch status HTTP", res.status, await res.text());
        }
      } catch (e) {
        console.error("Dispatch lookup failed:", e);
      }
    }

    // The stops already logged against those jobs
    const myRefs = mine.map((b) => b.reference as string);
    const { data: waypoints } = myRefs.length
      ? await admin
          .from("booking_waypoints")
          .select("id, booking_reference, kind, place, note, recorded_at")
          .in("booking_reference", myRefs)
          .order("recorded_at")
      : { data: [] as Record<string, unknown>[] };

    return json(200, {
      success: true,
      driver: { name: profile.full_name, phone: profile.phone },
      shift: open.data ?? null,
      jobs: mine,
      waypoints: waypoints ?? [],
    });
  } catch (error) {
    console.error("driver function error:", error);
    return json(500, { error: "Something went wrong. Please try again." });
  }
});
