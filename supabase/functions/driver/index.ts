import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { recipientsFor, trySendSms, ukWhen } from "../_shared/notify.ts";

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

/** The steps a chauffeur works through, in the order they happen. */
const PROGRESS_KINDS = ["en_route", "arrived", "pob", "waiting", "clear"] as const;
type Progress = (typeof PROGRESS_KINDS)[number];

/** How long a finished job stays on the chauffeur's screen. */
const KEEP_CLEARED_HOURS = 12;

/**
 * How long a chauffeur has to take back a clear they did not mean. The office
 * is not told about a job until this has passed, so an undo within it leaves
 * no trace anywhere but our own log.
 */
const UNDO_CLEAR_MINUTES = 30;

/** How far either side of now a job is worth picking up from Dispatch. */
const DISCOVER_BEHIND_HOURS = 12;
const DISCOVER_AHEAD_HOURS = 48;

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

    // --- Moving a job on: en route, arrived, on board, waiting, clear ---
    if (action === "progress") {
      const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 80) : "";
      const kind = typeof body.kind === "string" ? body.kind : "";
      if (!reference) return json(400, { error: "Which job?" });
      if (!PROGRESS_KINDS.includes(kind as Progress)) {
        return json(400, { error: "Unknown step" });
      }

      // Only the chauffeur the job belongs to may move it on
      const { data: job } = await admin
        .from("bookings")
        .select("reference, driver_id, driver_moment, corporate, user_id, name, phone, collection_at, vehicle")
        .eq("reference", reference)
        .maybeSingle();
      if (!job || job.driver_id !== user.id) {
        return json(403, { error: "That job is not assigned to you" });
      }

      const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
      const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;

      // Where the job has got to is what the chauffeur's screen and the
      // passenger both depend on, so it is written first. A problem keeping
      // the history must never stop someone finishing a job.
      const { error: statusError } = await admin
        .from("bookings")
        .update({
          driver_status: kind,
          driver_status_at: new Date().toISOString(),
          // A finished job keeps no record of where the chauffeur is
          ...(kind === "clear"
            ? { driver_lat: null, driver_lng: null, driver_position_at: null }
            : {}),
        })
        .eq("reference", reference);
      if (statusError) throw statusError;

      const { error: logError } = await admin.from("booking_waypoints").insert({
        booking_reference: reference,
        driver_id: user.id,
        kind,
        place: typeof body.place === "string" ? body.place.trim().slice(0, 200) : "",
        note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : "",
        lat,
        lng,
      });
      if (logError) console.error("Could not record the stop:", logError);

      // The two moments a passenger wants to hear about. Sent from here rather
      // than left to the Dispatch watcher, which only runs every five minutes
      // and would have the passenger still waiting indoors.
      const moment = kind === "en_route" ? "onroute" : kind === "arrived" ? "arrived" : null;
      if (moment && job.driver_moment !== moment) {
        const who = (profile.full_name as string)?.trim() || "Your chauffeur";
        const when = ukWhen(job.collection_at as string | null);
        const car = (job.vehicle as string) || "";
        // The link is ours. On a phone with the app it opens there, and on
        // any other phone it opens the same live map on the website. A
        // passenger is never sent to the booking system's own tracker.
        // It has to be the www host: the apex redirects, and neither Apple
        // nor Android follows a redirect when checking who owns a domain.
        const follow = "www.apexiavip.com/bookings";
        const message =
          moment === "onroute"
            ? `APEXIA VIP: ${who} is on the way for your ${when} collection${car ? `, ${car}` : ""}. Follow the car: ${follow}`
            : `APEXIA VIP: ${who} has arrived for your ${when} collection${car ? `, ${car}` : ""} and is waiting for you.`;
        let sentAny = false;
        for (const to of await recipientsFor(admin, job)) {
          if (await trySendSms(to, message)) sentAny = true;
        }
        if (sentAny) {
          await admin
            .from("bookings")
            .update({ driver_moment: moment })
            .eq("reference", reference);
        }
      }

      return json(200, { success: true, reference, driver_status: kind });
    }

    // --- Where the car is, while a job is running ---
    if (action === "position") {
      const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 80) : "";
      const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
      const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;
      if (!reference || lat === null || lng === null) return json(400, { error: "No position" });
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return json(400, { error: "Position out of range" });
      }
      // Only the chauffeur on the job, and only while it is still running, so
      // nothing is recorded once a job is finished
      const { error } = await admin
        .from("bookings")
        .update({
          driver_lat: lat,
          driver_lng: lng,
          driver_position_at: new Date().toISOString(),
        })
        .eq("reference", reference)
        .eq("driver_id", user.id)
        .neq("driver_status", "clear");
      if (error) throw error;
      return json(200, { success: true });
    }

    // --- Taking back a clear pressed by mistake ---
    if (action === "undo_clear") {
      const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 80) : "";
      if (!reference) return json(400, { error: "Which job?" });

      const { data: job } = await admin
        .from("bookings")
        .select("reference, driver_id, driver_status, driver_status_at, job_report_sent_at")
        .eq("reference", reference)
        .maybeSingle();
      if (!job || job.driver_id !== user.id) {
        return json(403, { error: "That job is not assigned to you" });
      }
      if (job.driver_status !== "clear") {
        return json(400, { error: "That job is not cleared" });
      }
      if (job.job_report_sent_at) {
        return json(400, {
          error: "The office has already been sent this job. Call them to change it.",
        });
      }
      const clearedAt = job.driver_status_at ? Date.parse(job.driver_status_at as string) : 0;
      if (!clearedAt || Date.now() - clearedAt > UNDO_CLEAR_MINUTES * 60 * 1000) {
        return json(400, {
          error: `A clear can only be taken back within ${UNDO_CLEAR_MINUTES} minutes.`,
        });
      }

      await admin
        .from("booking_waypoints")
        .delete()
        .eq("booking_reference", reference)
        .eq("driver_id", user.id)
        .eq("kind", "clear");

      // Put the job back to wherever it had got to before it was cleared
      const { data: remaining } = await admin
        .from("booking_waypoints")
        .select("kind, recorded_at")
        .eq("booking_reference", reference)
        .eq("driver_id", user.id)
        .in("kind", PROGRESS_KINDS as unknown as string[])
        .order("recorded_at", { ascending: false })
        .limit(1);
      const back = (remaining?.[0]?.kind as string | undefined) ?? null;

      const { error } = await admin
        .from("bookings")
        .update({ driver_status: back, driver_status_at: new Date().toISOString() })
        .eq("reference", reference);
      if (error) throw error;
      return json(200, { success: true, driver_status: back });
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

    // --- The chauffeur's day ---
    const open = await admin
      .from("driver_shifts")
      .select("id, started_at")
      .eq("driver_id", user.id)
      .is("ended_at", null)
      .maybeSingle();

    const myKey = phoneKey(profile.phone as string);
    const columns =
      "reference, name, vehicle, collection_at, travel_date, pickup, dropoff, via, stops, journey_type, as_directed_hours, notes, children, client_car, passengers, status, corporate, driver_id, driver_status, driver_status_at, job_report_sent_at";

    // 1. Pick up anything Dispatch has newly put in this chauffeur's name.
    //    Once seen it is written down, so the job survives a bad answer from
    //    Dispatch, or the office moving its time without telling us.
    const dispatchStatus = new Map<string, Record<string, unknown>>();
    if (myKey && DISPATCH_TRANSFER_REFERENCE) {
      const from = new Date(Date.now() - DISCOVER_BEHIND_HOURS * 3600 * 1000).toISOString();
      const to = new Date(Date.now() + DISCOVER_AHEAD_HOURS * 3600 * 1000).toISOString();
      const { data: candidates } = await admin
        .from("bookings")
        .select("reference, driver_id")
        .not("reference", "is", null)
        .not("collection_at", "is", null)
        .gte("collection_at", from)
        .lte("collection_at", to)
        .not("status", "in", '("Cancelled","Failed")')
        .order("collection_at");

      const refs = (candidates ?? []).map((b) => b.reference as string);
      if (refs.length > 0) {
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
            for (const b of Array.isArray(result?.Bookings) ? result.Bookings : []) {
              if (b?.Reference) dispatchStatus.set(b.Reference, b);
            }
            const newlyMine: string[] = [];
            let driverName = "";
            for (const candidate of candidates ?? []) {
              const live = dispatchStatus.get(candidate.reference as string);
              const driver = live?.Driver as { Mobile?: string; Name?: string } | undefined;
              if (!driver?.Mobile || phoneKey(driver.Mobile) !== myKey) continue;
              if (candidate.driver_id === user.id) continue;
              newlyMine.push(candidate.reference as string);
              driverName = driver.Name?.trim() || driverName;
            }
            if (newlyMine.length > 0) {
              await admin
                .from("bookings")
                .update({
                  driver_id: user.id,
                  driver_name: driverName || (profile.full_name as string) || null,
                })
                .in("reference", newlyMine);
            }
          } else {
            console.error("Dispatch status HTTP", res.status, await res.text());
          }
        } catch (e) {
          // A bad answer from Dispatch costs us new jobs, never the ones the
          // chauffeur already has
          console.error("Dispatch lookup failed:", e);
        }
      }
    }

    // 2. The day itself comes from our own records, so nothing disappears
    const clearedSince = new Date(Date.now() - KEEP_CLEARED_HOURS * 3600 * 1000).toISOString();
    const { data: assigned } = await admin
      .from("bookings")
      .select(columns)
      .eq("driver_id", user.id)
      .not("status", "in", '("Cancelled","Failed")')
      .order("collection_at", { nullsFirst: false });

    const jobs = (assigned ?? [])
      .filter((b) => {
        // A finished job stays on screen for the rest of the shift, then goes
        if (b.driver_status !== "clear") return true;
        return !!b.driver_status_at && b.driver_status_at > clearedSince;
      })
      .map((b) => {
        const live = dispatchStatus.get(b.reference as string);
        const vehicle = live?.Vehicle as { Description?: string; Registration?: string } | undefined;
        const driver = live?.Driver as { Name?: string; Mobile?: string } | undefined;
        return {
          ...b,
          dispatchStatus: live?.BookingStatus ?? null,
          vehicleDescription: vehicle?.Description ?? "",
          vehicleRegistration: vehicle?.Registration ?? "",
          driverName: driver?.Name ?? "",
        };
      });

    const myRefs = jobs.map((b) => b.reference as string);
    const { data: waypoints } = myRefs.length
      ? await admin
          .from("booking_waypoints")
          .select("id, booking_reference, kind, place, note, recorded_at, lat, lng")
          .in("booking_reference", myRefs)
          .order("recorded_at")
      : { data: [] as Record<string, unknown>[] };

    return json(200, {
      success: true,
      driver: { name: profile.full_name, phone: profile.phone },
      shift: open.data ?? null,
      jobs,
      waypoints: waypoints ?? [],
    });
  } catch (error) {
    console.error("driver function error:", error);
    return json(500, { error: "Something went wrong. Please try again." });
  }
});
