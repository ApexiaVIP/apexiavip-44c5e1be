import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_REQUESTS_PER_HOUR = 10;

// Map vehicle names to Dispatch booking classes
const vehicleToBookingClass: Record<string, string> = {
  "Range Rover": "Executive",
  "S-Class": "Executive",
  "Viano": "VIP",
  "JetClass": "VIP",
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

    const body = await req.json();

    // Honeypot check
    if (body.website) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name, email, phone, travelDate, travelDateRaw, vehicle, passengers, bags, pickupAddress, dropoffAddress } = body;

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
    if (!dropoffAddress || !dropoffAddress.line1 || !dropoffAddress.town || !dropoffAddress.postcode) {
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

    // Database client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Store in database
    const { error: dbError } = await supabase.from("bookings").insert({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      travel_date: travelDate,
      vehicle,
      passengers: passengers ?? 1,
      bags: bags ?? 0,
    });

    if (dbError) {
      console.error("DB insert error:", dbError);
    }

    // --- Send to Dispatch Transfer API ---
    const bookingReference = `APEXIA-${Date.now()}`;
    const collectionDateTime = `${travelDateRaw || travelDate} 09:00`;
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
      BookingNotes: `Vehicle: ${vehicle}`,
      PickUpAddress: {
        Line1: pickupAddress.line1?.trim() || "",
        Line2: pickupAddress.line2?.trim() || "",
        Town: pickupAddress.town?.trim() || "",
        Postcode: pickupAddress.postcode?.trim() || "",
        Country: pickupAddress.country?.trim() || "United Kingdom",
      },
      DropOffAddress: {
        Line1: dropoffAddress.line1?.trim() || "",
        Line2: dropoffAddress.line2?.trim() || "",
        Town: dropoffAddress.town?.trim() || "",
        Postcode: dropoffAddress.postcode?.trim() || "",
        Country: dropoffAddress.country?.trim() || "United Kingdom",
      },
    };

    const dispatchAuth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);

    const dispatchUrl = `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=${encodeURIComponent(DISPATCH_TRANSFER_REFERENCE)}&BookedBy=Website`;

    try {
      const dispatchRes = await fetch(dispatchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${dispatchAuth}`,
        },
        body: JSON.stringify(dispatchPayload),
      });

      const dispatchData = await dispatchRes.json();
      console.log("Dispatch API response:", JSON.stringify(dispatchData));

      if (dispatchData.TransferStatus === "Failed") {
        console.error("Dispatch transfer failed:", dispatchData.Message);
      }
    } catch (dispatchErr) {
      console.error("Dispatch API call failed:", dispatchErr);
      // Don't fail the whole request if Dispatch fails - email still goes out
    }

    // --- Send email notification ---
    const safePickup = `${sanitize(pickupAddress.line1 || "")}, ${sanitize(pickupAddress.town || "")}, ${sanitize(pickupAddress.postcode || "")}`;
    const safeDropoff = `${sanitize(dropoffAddress.line1 || "")}, ${sanitize(dropoffAddress.town || "")}, ${sanitize(dropoffAddress.postcode || "")}`;

    const htmlBody = `
      <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px;">
        <h1 style="font-size: 24px; font-weight: 300; letter-spacing: 0.1em; border-bottom: 1px solid #2a2a2a; padding-bottom: 20px; color: #b89b5e;">
          New Booking Enquiry
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
        subject: `Booking Enquiry — ${safeName} — ${safeVehicle}`,
        html: htmlBody,
        reply_to: email.trim(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Resend API error [${res.status}]: ${JSON.stringify(data)}`);
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
