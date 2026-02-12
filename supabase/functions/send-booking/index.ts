import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  "https://apexiavip.lovable.app",
  "https://id-preview--47b1f34e-c2e6-4cdd-8d35-be71ddb4e18b.lovable.app",
];

const isAllowedOrigin = (origin: string) => {
  if (allowedOrigins.includes(origin)) return true;
  // Allow any Lovable preview/dev subdomain
  if (/^https:\/\/[a-z0-9-]+\.lovable\.app$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.lovableproject\.com$/.test(origin)) return true;
  return false;
};

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
};

const MAX_REQUESTS_PER_HOUR = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const body = await req.json();

    // Honeypot check - if this hidden field is filled, it's a bot
    if (body.website) {
      // Silently accept but don't process
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const { name, email, phone, travelDate, vehicle, passengers, bags } = body;

    // Basic server-side validation
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 100) {
      return new Response(JSON.stringify({ success: false, error: "Invalid name" }), {
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    if (!email || typeof email !== "string" || !email.includes("@") || email.length > 255) {
      return new Response(JSON.stringify({ success: false, error: "Invalid email" }), {
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    if (!phone || typeof phone !== "string" || phone.trim().length === 0 || phone.length > 30) {
      return new Response(JSON.stringify({ success: false, error: "Invalid phone" }), {
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    if (!travelDate || typeof travelDate !== "string" || travelDate.length > 50) {
      return new Response(JSON.stringify({ success: false, error: "Invalid travel date" }), {
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const allowedVehicles = ["Range Rover", "S-Class", "Viano", "JetClass"];
    if (!vehicle || !allowedVehicles.includes(vehicle)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid vehicle" }), {
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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
        { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
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
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error sending booking email:", error);
    return new Response(
      JSON.stringify({ success: false, error: "An error occurred processing your request." }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      }
    );
  }
});
