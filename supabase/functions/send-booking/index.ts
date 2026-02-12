import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface BookingRequest {
  name: string;
  email: string;
  phone: string;
  travelDate: string;
  vehicle: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const { name, email, phone, travelDate, vehicle } =
      (await req.json()) as BookingRequest;

    // Store in database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error: dbError } = await supabase.from("bookings").insert({
      name,
      email,
      phone,
      travel_date: travelDate,
      vehicle,
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
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Name</td><td style="padding: 12px 0;">${name}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Email</td><td style="padding: 12px 0;">${email}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Phone</td><td style="padding: 12px 0;">${phone}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Travel Date</td><td style="padding: 12px 0;">${travelDate}</td></tr>
          <tr><td style="padding: 12px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em;">Vehicle</td><td style="padding: 12px 0;">${vehicle}</td></tr>
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
        to: ["jamesacton007@gmail.com"],
        subject: `Booking Enquiry — ${name} — ${vehicle}`,
        html: htmlBody,
        reply_to: email,
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
