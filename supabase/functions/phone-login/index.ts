import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CODE_TTL_MINUTES = 10;
const CLAIM_TTL_MINUTES = 2;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 6;
const MAX_STARTS_PER_IP_PER_HOUR = 15;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sha256 = async (input: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const maskPhone = (phone: string) =>
  phone.length > 3 ? `••• ••• ${phone.slice(-3)}` : phone;

const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 1)}•••@${domain}`;
};

const NOT_REGISTERED = "This number is not registered. Access is by invitation only.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const action = body?.action;
    const phone = typeof body?.phone === "string" ? body.phone.replace(/[\s\-()]/g, "") : "";
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return json(400, { error: "Please enter a valid phone number." });
    }

    // Rate limit by caller IP across both actions
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("cf-connecting-ip") || "unknown";
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: ipCount } = await admin
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("endpoint", "phone-login")
      .gte("created_at", oneHourAgo);
    if ((ipCount ?? 0) >= MAX_STARTS_PER_IP_PER_HOUR) {
      return json(429, { error: "Too many attempts. Please try again later." });
    }
    await admin.from("rate_limits").insert({ ip_address: ip, endpoint: "phone-login" });

    const { data: profile } = await admin
      .from("profiles")
      .select("id, phone, email, status")
      .eq("phone", phone)
      .maybeSingle();
    if (!profile || profile.status !== "active") {
      return json(400, { error: NOT_REGISTERED });
    }
    const userId = profile.id;

    if (action === "start") {
      const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
      const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
      const TWILIO_FROM = Deno.env.get("TWILIO_FROM");
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      const smsConfigured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM);
      if (!smsConfigured && !RESEND_API_KEY) {
        throw new Error("No code delivery channel is configured");
      }

      // Per-member send limit (shared with the in-session code sender)
      const { count } = await admin
        .from("rate_limits")
        .select("*", { count: "exact", head: true })
        .eq("ip_address", userId)
        .eq("endpoint", "sms-2fa-send")
        .gte("created_at", oneHourAgo);
      if ((count ?? 0) >= MAX_SENDS_PER_HOUR) {
        return json(429, { error: "Too many codes requested. Please try again later." });
      }
      await admin.from("rate_limits").insert({ ip_address: userId, endpoint: "sms-2fa-send" });

      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      const randomInt = (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
      const code = (randomInt % 1000000).toString().padStart(6, "0");

      await admin.from("mfa_codes").delete().eq("user_id", userId);
      const { error: insertError } = await admin.from("mfa_codes").insert({
        user_id: userId,
        code_hash: await sha256(`${userId}:${code}`),
        expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
      });
      if (insertError) throw insertError;

      if (smsConfigured) {
        const params = new URLSearchParams({
          To: phone,
          Body: `Your Apexia VIP access code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
        });
        params.append(TWILIO_FROM!.startsWith("MG") ? "MessagingServiceSid" : "From", TWILIO_FROM!);

        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
            },
            body: params.toString(),
          }
        );
        if (!twilioRes.ok) {
          const twilioBody = await twilioRes.text();
          console.error("Twilio error:", twilioRes.status, twilioBody);
          return json(502, { error: "We could not send the SMS. Please try again." });
        }
        return json(200, { success: true, channel: "sms", sent_to: maskPhone(phone) });
      }

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "Apexia VIP <info@apexiavip.com>",
          to: [profile.email],
          subject: `${code} is your Apexia VIP access code`,
          html: `
            <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 480px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px; text-align: center;">
              <p style="color: #b89b5e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3em; margin-bottom: 24px;">Apexia VIP</p>
              <p style="font-size: 14px; color: #8a8070;">Your access code is</p>
              <p style="font-size: 36px; letter-spacing: 0.3em; color: #e0d5c4; margin: 16px 0;">${code}</p>
              <p style="font-size: 12px; color: #8a8070;">It expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, please contact us.</p>
            </div>
          `,
        }),
      });
      if (!emailRes.ok) {
        console.error("Resend error:", emailRes.status, await emailRes.text());
        return json(502, { error: "We could not send the code. Please try again." });
      }
      return json(200, { success: true, channel: "email", sent_to: maskEmail(profile.email) });
    }

    if (action === "finish") {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^\d{6}$/.test(code)) return json(400, { error: "Invalid code" });

      const { data: record } = await admin
        .from("mfa_codes")
        .select("id, code_hash, attempts, expires_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!record || new Date(record.expires_at) < new Date()) {
        return json(400, { error: "Code expired. Please request a new one." });
      }
      if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        return json(429, { error: "Too many attempts. Please request a new code." });
      }

      const hash = await sha256(`${userId}:${code}`);
      if (hash !== record.code_hash) {
        await admin
          .from("mfa_codes")
          .update({ attempts: record.attempts + 1 })
          .eq("id", record.id);
        return json(400, { error: "Incorrect code" });
      }

      // Code is good: burn it, mint a one-time sign-in token and a claim token
      await admin.from("mfa_codes").delete().eq("user_id", userId);

      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: profile.email,
      });
      const tokenHash = linkData?.properties?.hashed_token;
      if (linkError || !tokenHash) {
        console.error("generateLink error:", linkError);
        return json(500, { error: "We could not sign you in. Please try again." });
      }

      const claimBytes = new Uint8Array(32);
      crypto.getRandomValues(claimBytes);
      const claimToken = Array.from(claimBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const { error: claimError } = await admin.from("mfa_codes").insert({
        user_id: userId,
        code_hash: await sha256(`${userId}:claim:${claimToken}`),
        expires_at: new Date(Date.now() + CLAIM_TTL_MINUTES * 60 * 1000).toISOString(),
      });
      if (claimError) throw claimError;

      return json(200, { success: true, token_hash: tokenHash, claim_token: claimToken });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.error("phone-login error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
