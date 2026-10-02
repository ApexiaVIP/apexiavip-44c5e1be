import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** This is the one form the public can reach, so it is held tightly. */
const MAX_PER_HOUR_PER_IP = 3;
const OFFICE_EMAIL = "info@apexiavip.com";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const field = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();

    // Bots fill in every field they find; people never see this one
    if (body.website) return json(200, { success: true });

    const fullName = field(body.fullName, 100);
    const email = field(body.email, 255);
    const phone = field(body.phone, 30);
    const addressLine1 = field(body.addressLine1, 200);
    const addressLine2 = field(body.addressLine2, 200);
    const town = field(body.town, 100);
    const postcode = field(body.postcode, 20);
    const country = field(body.country, 100) || "United Kingdom";
    const heardFrom = field(body.heardFrom, 120);
    const message = field(body.message, 1000);

    if (fullName.length < 2) return json(400, { success: false, error: "Please give your full name" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return json(400, { success: false, error: "Please give a valid email address" });
    if (phone.replace(/\D/g, "").length < 7)
      return json(400, { success: false, error: "Please give a valid phone number" });
    if (!addressLine1 || !town || !postcode)
      return json(400, { success: false, error: "Please give your address, town and postcode" });

    // One person applying twice is fine; a script hammering us is not
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const { count } = await supabase
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("endpoint", "membership-application")
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= MAX_PER_HOUR_PER_IP) {
      return json(429, {
        success: false,
        error: "We have already received your enquiry. Please email info@apexiavip.com if you need us sooner.",
      });
    }
    await supabase.from("rate_limits").insert({ ip_address: ip, endpoint: "membership-application" });

    const { error: dbError } = await supabase.from("membership_applications").insert({
      full_name: fullName,
      email,
      phone,
      address_line1: addressLine1,
      address_line2: addressLine2,
      town,
      postcode,
      country,
      heard_from: heardFrom,
      message,
    });
    if (dbError) {
      console.error("Application insert failed:", dbError);
      return json(500, {
        success: false,
        error: "We could not record your enquiry. Please email info@apexiavip.com.",
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      const row = (label: string, value: string) =>
        value
          ? `<tr><td style="padding: 10px 0; color: #8a8070; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; vertical-align: top;">${label}</td><td style="padding: 10px 0;">${escape(
              value
            )}</td></tr>`
          : "";
      const address = [addressLine1, addressLine2, town, postcode, country].filter(Boolean).join(", ");

      // The office: everything they need to call the person back
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: "Apexia VIP <info@apexiavip.com>",
            to: [OFFICE_EMAIL],
            reply_to: email,
            subject: `Membership enquiry: ${fullName}`,
            html: `
              <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px;">
                <h1 style="font-size: 22px; font-weight: 300; letter-spacing: 0.1em; border-bottom: 1px solid #2a2a2a; padding-bottom: 18px; color: #b89b5e;">
                  Membership enquiry
                </h1>
                <table style="width: 100%; margin-top: 20px; border-collapse: collapse;">
                  ${row("Name", fullName)}
                  ${row("Email", email)}
                  ${row("Phone", phone)}
                  ${row("Address", address)}
                  ${row("Heard via", heardFrom)}
                  ${row("Message", message)}
                </table>
                <p style="margin-top: 28px; font-size: 13px; color: #8a8070;">
                  Reply to this email to reach them directly. Set them up in Admin &rarr; Invite once approved.
                </p>
              </div>`,
          }),
        });
      } catch (e) {
        console.error("Office email failed:", e);
      }

      // The applicant: say what happens next, and promise nothing we cannot keep
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: "Apexia VIP <info@apexiavip.com>",
            to: [email],
            subject: "Your enquiry to Apexia VIP",
            html: `
              <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 520px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 48px 40px; text-align: center;">
                <p style="color: #b89b5e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3em; margin-bottom: 28px;">Apexia VIP</p>
                <p style="font-size: 20px; font-weight: 300; letter-spacing: 0.05em; margin-bottom: 20px;">Thank you, ${escape(
                  fullName.split(" ")[0]
                )}</p>
                <p style="font-size: 14px; color: #8a8070; line-height: 1.7;">
                  We have your enquiry. Membership is by invitation, so a member of our team will be
                  in touch to talk it through and, if it is a good fit, arrange your account.
                </p>
                <p style="font-size: 14px; color: #8a8070; line-height: 1.7;">
                  If anything changes in the meantime, simply reply to this email.
                </p>
                <p style="font-size: 11px; color: #8a8070; margin-top: 32px;">All enquiries are handled with complete discretion.</p>
              </div>`,
          }),
        });
      } catch (e) {
        console.error("Applicant email failed:", e);
      }
    }

    return json(200, { success: true });
  } catch (error) {
    console.error("membership-application error:", error);
    return json(500, {
      success: false,
      error: "Something went wrong. Please email info@apexiavip.com.",
    });
  }
});
