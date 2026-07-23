import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_REQUESTS_PER_HOUR = 10;
const DEFAULT_COLLECTION_TIME = { hours: "09", minutes: "00" };

// Map vehicle names to Dispatch booking classes
const vehicleToBookingClass: Record<string, string> = {
  "Range Rover": "Executive",
  "S-Class": "Executive",
  "Viano": "VIP",
  "JetClass": "VIP",
};

const dispatchMonthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const dispatchMonthLookup = dispatchMonthNames.reduce<Record<string, number>>((acc, month, index) => {
  acc[month.toLowerCase()] = index;
  return acc;
}, {});

const padNumber = (value: number | string) => value.toString().padStart(2, "0");

const formatDispatchDate = (day: number, monthIndex: number, year: number) =>
  `${padNumber(day)}-${dispatchMonthNames[monthIndex]}-${year}`;

const buildCollectionDateTime = (travelDateRaw?: string, travelDateDisplay?: string) => {
  const candidates = [travelDateRaw, travelDateDisplay]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().replace(/,/g, "").replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1"));

  for (const candidate of candidates) {
    const dispatchFormatMatch = candidate.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (dispatchFormatMatch) {
      const [, day, monthToken, year, hours = DEFAULT_COLLECTION_TIME.hours, minutes = DEFAULT_COLLECTION_TIME.minutes] = dispatchFormatMatch;
      const monthIndex = dispatchMonthLookup[monthToken.toLowerCase()];

      if (monthIndex !== undefined) {
        return `${formatDispatchDate(Number(day), monthIndex, Number(year))} ${hours}:${minutes}`;
      }
    }

    const isoFormatMatch = candidate.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::\d{2})?)?/);
    if (isoFormatMatch) {
      const [, year, month, day, hours = DEFAULT_COLLECTION_TIME.hours, minutes = DEFAULT_COLLECTION_TIME.minutes] = isoFormatMatch;
      return `${formatDispatchDate(Number(day), Number(month) - 1, Number(year))} ${hours}:${minutes}`;
    }

    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return `${formatDispatchDate(parsed.getDate(), parsed.getMonth(), parsed.getFullYear())} ${DEFAULT_COLLECTION_TIME.hours}:${DEFAULT_COLLECTION_TIME.minutes}`;
    }
  }

  throw new Error("Invalid travel date supplied for Dispatch booking");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const DISPATCH_TRANSFER_REFERENCE = Deno.env.get("DISPATCH_TRANSFER_REFERENCE");
    if (!DISPATCH_TRANSFER_REFERENCE) {
      throw new Error("DISPATCH_TRANSFER_REFERENCE is not configured");
    }

    // Database client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Members only: require an authenticated user with an active profile
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ success: false, error: "Sign in required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Require the SMS second factor: this session must appear in mfa_sessions
    // (the session_id claim is trustworthy because getUser() validated the token)
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
      ? await supabase
          .from("mfa_sessions")
          .select("id")
          .eq("session_id", sessionId)
          .maybeSingle()
      : { data: null };
    if (!verifiedSession) {
      return new Response(
        JSON.stringify({ success: false, error: "Two-factor verification required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: memberProfile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!memberProfile || memberProfile.status !== "active") {
      return new Response(JSON.stringify({ success: false, error: "Membership not active" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    // Honeypot check
    if (body.website) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name, email, phone, travelDate, travelDateRaw, vehicle, passengers, bags, pickupAddress, dropoffAddress } = body;

    // Journey type: to a destination (default) or by-the-hour at the
    // passenger's direction
    const journeyType = body.journeyType === "hourly" ? "hourly" : "destination";
    const asDirectedHours =
      journeyType === "hourly" ? parseInt(String(body.asDirectedHours), 10) : null;
    if (journeyType === "hourly" && (!Number.isFinite(asDirectedHours) || asDirectedHours! < 4 || asDirectedHours! > 24)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid hire duration (minimum 4 hours)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isValidStop = (s: unknown): s is Record<string, string> =>
      !!s && typeof s === "object" &&
      !!(s as Record<string, unknown>).line1 &&
      !!(s as Record<string, unknown>).town &&
      !!(s as Record<string, unknown>).postcode;
    const viaStops: Record<string, string>[] =
      journeyType === "destination" && Array.isArray(body.viaStops)
        ? body.viaStops.slice(0, 5).filter(isValidStop)
        : [];

    // Basic server-side validation
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return new Response(JSON.stringify({ success: false, error: "Invalid name" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!email || typeof email !== "string" || !email.includes("@") || email.length > 255) {
      return new Response(JSON.stringify({ success: false, error: "Invalid email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!phone || typeof phone !== "string" || phone.trim().length === 0 || phone.length > 30) {
      return new Response(JSON.stringify({ success: false, error: "Invalid phone" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!travelDate || typeof travelDate !== "string" || travelDate.length > 50) {
      return new Response(JSON.stringify({ success: false, error: "Invalid travel date" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allowedVehicles = ["Range Rover", "S-Class", "Viano", "JetClass"];
    if (!vehicle || !allowedVehicles.includes(vehicle)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid vehicle" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!pickupAddress || !pickupAddress.line1 || !pickupAddress.town || !pickupAddress.postcode) {
      return new Response(JSON.stringify({ success: false, error: "Invalid pickup address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (
      journeyType === "destination" &&
      (!dropoffAddress || !dropoffAddress.line1 || !dropoffAddress.town || !dropoffAddress.postcode)
    ) {
      return new Response(JSON.stringify({ success: false, error: "Invalid dropoff address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize inputs for HTML email
    const sanitize = (str: string) =>
      str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const safeName = sanitize(name.trim());
    const safeEmail = sanitize(email.trim());
    const safePhone = sanitize(phone.trim());
    const safeTravelDate = sanitize(travelDate.trim());
    const safeVehicle = sanitize(vehicle);

    // Rate limiting
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("cf-connecting-ip") || "unknown";

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("endpoint", "send-booking")
      .gte("created_at", oneHourAgo);

    if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR) {
      return new Response(
        JSON.stringify({ success: false, error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record this request for rate limiting
    await supabase.from("rate_limits").insert({ ip_address: ip, endpoint: "send-booking" });

    // Amending? Reuse the original reference so Dispatch overwrites the booking
    const amendReference =
      typeof body.amendReference === "string" && body.amendReference ? body.amendReference : null;
    if (amendReference) {
      const { data: existing } = await supabase
        .from("bookings")
        .select("reference, user_id")
        .eq("reference", amendReference)
        .maybeSingle();
      if (!existing || existing.user_id !== userData.user.id) {
        return new Response(JSON.stringify({ success: false, error: "Booking not found" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Store the booking against the member so it appears in My Bookings
    const bookingReference = amendReference ?? `APEXIA-${Date.now()}`;
    const collectionAt =
      typeof body.collectionAt === "string" && !Number.isNaN(Date.parse(body.collectionAt))
        ? new Date(body.collectionAt).toISOString()
        : null;
    const bookingRow = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      travel_date: travelDate,
      vehicle,
      passengers: passengers ?? 1,
      bags: bags ?? 0,
      collection_at: collectionAt,
      pickup: pickupAddress,
      dropoff: journeyType === "destination" ? dropoffAddress : null,
      journey_type: journeyType,
      as_directed_hours: asDirectedHours,
      via: viaStops.length > 0 ? viaStops : null,
    };
    if (!amendReference) {
      const { error: dbError } = await supabase.from("bookings").insert({
        ...bookingRow,
        user_id: userData.user.id,
        reference: bookingReference,
        status: "Requested",
      });
      if (dbError) {
        console.error("DB insert error:", dbError);
      }
    }

    // --- Send to Dispatch Transfer API ---
    const collectionDateTime = buildCollectionDateTime(travelDateRaw, travelDate);
    const bookingClass = vehicleToBookingClass[vehicle] || "Executive";

    const dispatchPayload = {
      Reference: bookingReference,
      CollectionDateTime: collectionDateTime,
      NumPassengers: passengers ?? 1,
      PassengerName: name.trim(),
      PassengerPhoneNumber: phone.trim(),
      PassengerMobileNumber: phone.trim(),
      PassengerEmailAddress: email.trim(),
      BookingClass: bookingClass,
      NumSuitcases: bags ?? 0,
      BookedBy: "Website",
      BookingNotes:
        journeyType === "hourly"
          ? `Vehicle: ${vehicle}. As directed hire: ${asDirectedHours} hours.`
          : `Vehicle: ${vehicle}`,
      AsDirected: journeyType === "hourly" ? "T" : "F",
      ...(journeyType === "hourly"
        ? { AsDirectedTime: asDirectedHours! * 60, AsDirectedMileage: 0 }
        : {}),
      PickUpAddress: {
        Line1: pickupAddress.line1?.trim() || "",
        Line2: pickupAddress.line2?.trim() || "",
        Town: pickupAddress.town?.trim() || "",
        Postcode: pickupAddress.postcode?.trim() || "",
        Country: pickupAddress.country?.trim() || "United Kingdom",
      },
      ...(journeyType === "destination"
        ? {
            DropOffAddress: {
              Line1: dropoffAddress.line1?.trim() || "",
              Line2: dropoffAddress.line2?.trim() || "",
              Town: dropoffAddress.town?.trim() || "",
              Postcode: dropoffAddress.postcode?.trim() || "",
              Country: dropoffAddress.country?.trim() || "United Kingdom",
            },
          }
        : {}),
      // Stops en route map to Dispatch via addresses
      ...Object.fromEntries(
        viaStops.map((stop, i) => [
          `ViaAddress${i + 1}`,
          {
            Line1: stop.line1?.trim() || "",
            Line2: stop.line2?.trim() || "",
            Town: stop.town?.trim() || "",
            Postcode: stop.postcode?.trim() || "",
            Country: stop.country?.trim() || "United Kingdom",
          },
        ])
      ),
    };

    const dispatchAuth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);

    const dispatchUrl = `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=${encodeURIComponent(DISPATCH_TRANSFER_REFERENCE)}&BookedBy=Website`;

    let dispatchFailureMessage: string | null = null;

    try {
      const dispatchRes = await fetch(dispatchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${dispatchAuth}`,
        },
        body: JSON.stringify({ Bookings: [dispatchPayload] }),
      });

      const dispatchData = await dispatchRes.json();
      console.log("Dispatch API response:", JSON.stringify(dispatchData));

      const dispatchResult = Array.isArray(dispatchData?.Result) ? dispatchData.Result[0] : dispatchData;
      const dispatchBooking = Array.isArray(dispatchResult?.Bookings) ? dispatchResult.Bookings[0] : undefined;

      if (!dispatchRes.ok) {
        dispatchFailureMessage = `Dispatch API returned HTTP ${dispatchRes.status}`;
      } else if (dispatchResult?.TransferStatus === "Failed") {
        dispatchFailureMessage = dispatchResult?.Message || "Dispatch transfer failed";
      } else if (dispatchBooking?.Status === "Failed") {
        dispatchFailureMessage = dispatchBooking?.Message || "Dispatch booking failed";
      }

      if (dispatchFailureMessage) {
        console.error("Dispatch transfer failed:", dispatchFailureMessage);
      } else if (amendReference) {
        // Amendment accepted: write the new details over our record
        await supabase
          .from("bookings")
          .update({ ...bookingRow, status: "Confirmed" })
          .eq("reference", bookingReference);
      } else {
        // Link our record to the booking created in Dispatch
        await supabase
          .from("bookings")
          .update({
            assigned_booking_id: dispatchBooking?.AssignedBookingID ?? null,
            assigned_reference: dispatchBooking?.AssignedBookingReference ?? null,
            status: "Confirmed",
          })
          .eq("reference", bookingReference);
      }
    } catch (dispatchErr) {
      console.error("Dispatch API call failed:", dispatchErr);
      dispatchFailureMessage = "Dispatch API call failed";
    }

    // A failed amendment leaves the original booking standing, so only new
    // bookings are marked Failed
    if (dispatchFailureMessage && !amendReference) {
      await supabase
        .from("bookings")
        .update({ status: "Failed" })
        .eq("reference", bookingReference);
    }

    // --- Send email notification ---
    const safePickup = `${sanitize(pickupAddress.line1 || "")}, ${sanitize(pickupAddress.town || "")}, ${sanitize(pickupAddress.postcode || "")}`;
    const safeDropoff =
      journeyType === "hourly"
        ? `As directed (${asDirectedHours} hour hire)`
        : `${sanitize(dropoffAddress.line1 || "")}, ${sanitize(dropoffAddress.town || "")}, ${sanitize(dropoffAddress.postcode || "")}`;
    const stopsRows = viaStops
      .map(
        (stop, i) =>
          `<tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Stop ${i + 1}</td><td style="padding: 12px 0;">${sanitize(stop.line1 || "")}, ${sanitize(stop.town || "")}, ${sanitize(stop.postcode || "")}</td></tr>`
      )
      .join("");

    const htmlBody = `
      <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px;">
        <h1 style="font-size: 24px; font-weight: 300; letter-spacing: 0.1em; border-bottom: 1px solid #2a2a2a; padding-bottom: 20px; color: #b89b5e;">
          ${amendReference ? "Booking Amended" : "New Booking Enquiry"}
        </h1>
        <table style="width: 100%; margin-top: 24px; border-collapse: collapse;">
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Name</td><td style="padding: 12px 0;">${safeName}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Email</td><td style="padding: 12px 0;">${safeEmail}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Phone</td><td style="padding: 12px 0;">${safePhone}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Travel Date</td><td style="padding: 12px 0;">${safeTravelDate}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Vehicle</td><td style="padding: 12px 0;">${safeVehicle}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Passengers</td><td style="padding: 12px 0;">${passengers ?? 'N/A'}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Luggage</td><td style="padding: 12px 0;">${bags ?? 0}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Pickup</td><td style="padding: 12px 0;">${safePickup}</td></tr>
          ${stopsRows}
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Dropoff</td><td style="padding: 12px 0;">${safeDropoff}</td></tr>
        </table>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Apexia VIP <info@apexiavip.com>",
        to: ["info@apexiavip.com"],
        subject: `${amendReference ? "Booking AMENDED" : "Booking Enquiry"}: ${safeName} (${safeVehicle})`,
        html: htmlBody,
        reply_to: email.trim(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Resend API error [${res.status}]: ${JSON.stringify(data)}`);
    }

    if (dispatchFailureMessage) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "We couldn't send your booking to the booking system. Please try again or contact us directly.",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending booking email:", error);
    return new Response(
      JSON.stringify({ success: false, error: "An error occurred processing your request." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
