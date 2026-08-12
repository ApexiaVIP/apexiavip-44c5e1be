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

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitize = (str: string) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface CarRequest {
  passengers: string[];
  pickup: string;
  destination: string;
  vehicle: string;
  time: string;
  notes: string;
}

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
      .select("status, corporate, full_name, email, phone")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!profile || profile.status !== "active") {
      return json(403, { success: false, error: "Membership not active" });
    }
    if (!profile.corporate) {
      return json(403, { success: false, error: "No corporate desk access" });
    }
    const corporate = profile.corporate;

    // Rate limiting
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

    const body = await req.json();

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
    const { data: allowedRows } = await supabase
      .from("corporate_passengers")
      .select("name")
      .eq("corporate", corporate)
      .eq("active", true);
    const allowedNames = new Set((allowedRows ?? []).map((r: { name: string }) => r.name));

    for (const [i, car] of cars.entries()) {
      const label = `Car ${i + 1}`;
      if (!car || typeof car !== "object") {
        return json(400, { success: false, error: `${label}: invalid` });
      }
      const capacity = CAPACITY[car.vehicle];
      if (!capacity) {
        return json(400, { success: false, error: `${label}: invalid vehicle` });
      }
      if (!Array.isArray(car.passengers) || car.passengers.length < 1 || car.passengers.length > capacity) {
        return json(400, { success: false, error: `${label}: needs 1 to ${capacity} passengers for the ${car.vehicle}` });
      }
      for (const p of car.passengers) {
        if (typeof p !== "string" || !allowedNames.has(p)) {
          return json(400, { success: false, error: `${label}: unrecognised passenger` });
        }
      }
      if (new Set(car.passengers).size !== car.passengers.length) {
        return json(400, { success: false, error: `${label}: duplicate passenger` });
      }
      if (typeof car.pickup !== "string" || !car.pickup.trim() || car.pickup.length > 200) {
        return json(400, { success: false, error: `${label}: invalid pickup` });
      }
      if (typeof car.destination !== "string" || !car.destination.trim() || car.destination.length > 200) {
        return json(400, { success: false, error: `${label}: invalid destination` });
      }
      if (typeof car.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(car.time)) {
        return json(400, { success: false, error: `${label}: invalid pickup time` });
      }
      if (car.notes != null && (typeof car.notes !== "string" || car.notes.length > 500)) {
        return json(400, { success: false, error: `${label}: notes too long` });
      }
    }

    const bookerName = (profile.full_name || "Travel Desk").trim();
    const bookerPhone = (profile.phone || "").trim();
    const bookerEmail = (profile.email || "").trim() || userData.user.email || "";
    const requestId = Date.now();
    const deskName = corporate.toUpperCase();

    // --- Build one Dispatch transfer carrying every car ---
    const dispatchBookings = cars.map((car, i) => {
      const reference = amendReference ?? `APEXIA-${deskName}-${requestId}-C${i + 1}`;
      const manifest = car.passengers.join(", ");
      return {
        Reference: reference,
        CollectionDateTime: `${day}-${monthName}-${year} ${car.time}`,
        NumPassengers: car.passengers.length,
        PassengerName: car.passengers[0],
        PassengerPhoneNumber: bookerPhone,
        PassengerMobileNumber: bookerPhone,
        ...(bookerEmail ? { PassengerEmailAddress: bookerEmail } : {}),
        BookingClass: vehicleToBookingClass[car.vehicle] || "Executive",
        BookedBy: `${deskName} Travel Desk`,
        BookingNotes: [
          `${deskName} Travel Desk request (car ${i + 1} of ${cars.length}), booked by ${bookerName}.`,
          `Vehicle: ${car.vehicle}.`,
          `Passengers: ${manifest}.`,
          car.notes?.trim() ? `Notes: ${car.notes.trim()}` : "",
        ].filter(Boolean).join(" "),
        AsDirected: "F",
        PickUpAddress: {
          Line1: car.pickup.trim(),
          Line2: "",
          Town: "",
          Postcode: "",
          Country: "United Kingdom",
        },
        DropOffAddress: {
          Line1: car.destination.trim(),
          Line2: "",
          Town: "",
          Postcode: "",
          Country: "United Kingdom",
        },
      };
    });

    // Store each car against the booker so it shows in the portal history
    const carRowValues = cars.map((car, i) => ({
      name: car.passengers.join(", "),
      email: bookerEmail,
      phone: bookerPhone,
      travel_date: `${day}-${monthName}-${year} ${car.time}`,
      vehicle: car.vehicle,
      passengers: car.passengers.length,
      bags: 0,
      collection_at: new Date(`${travelDate}T${car.time}:00`).toISOString(),
      pickup: { line1: car.pickup.trim(), town: "", postcode: "" },
      dropoff: { line1: car.destination.trim(), town: "", postcode: "" },
      journey_type: "destination",
    }));
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
    const carRows = cars.map((car, i) => `
      <tr>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${i + 1}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.time)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.vehicle)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.passengers.join(", "))}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.pickup)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.destination)}</td>
        <td style="padding: 10px 8px; border-bottom: 1px solid #2a2a2a; vertical-align: top;">${sanitize(car.notes?.trim() || "")}</td>
      </tr>`).join("");

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
            <th style="padding: 8px;">Passengers</th><th style="padding: 8px;">Pickup</th><th style="padding: 8px;">Destination</th><th style="padding: 8px;">Notes</th>
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
          subject: `${deskName} Travel Desk: ${
            amendReference ? "booking AMENDED" : `${cars.length} car(s)`
          } for ${day}-${monthName}-${year}${failedReferences.length > 0 ? " (TRANSFER FAILED)" : ""}`,
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

    if (confirmedReferences.length === 0) {
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
