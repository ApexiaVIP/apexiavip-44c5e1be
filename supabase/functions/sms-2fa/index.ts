import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CODE_TTL_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 6;

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

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
};

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

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json(401, { error: "Not authenticated" });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json(401, { error: "Not authenticated" });
    const user = userData.user;

    const sessionId = decodeJwtPayload(token)?.session_id;
    if (!sessionId || typeof sessionId !== "string") {
      return json(401, { error: "Not authenticated" });
    }

    const body = await req.json();
    const action = body?.action;

    if (action === "status") {
      const { data: verified } = await admin
        .from("mfa_sessions")
        .select("id")
        .eq("session_id", sessionId)
        .maybeSingle();
      return json(200, { verified: !!verified });
    }

    // Only active members can send/verify codes
    const { data: profile } = await admin
      .from("profiles")
      .select("phone, status")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.status !== "active") {
      return json(403, { error: "Membership not active" });
    }

    if (action === "send") {
      const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
      const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
      const TWILIO_FROM = Deno.env.get("TWILIO_FROM");
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
        throw new Error("Twilio is not configured");
      }
      if (!profile.phone) {
        return json(400, { error: "No mobile number is registered for your account" });
      }

      // Rate limit sends per user
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await admin
        .from("rate_limits")
        .select("*", { count: "exact", head: true })
        .eq("ip_address", user.id)
        .eq("endpoint", "sms-2fa-send")
        .gte("created_at", oneHourAgo);
      if ((count ?? 0) >= MAX_SENDS_PER_HOUR) {
        return json(429, { error: "Too many codes requested. Please try again later." });
      }
      await admin.from("rate_limits").insert({ ip_address: user.id, endpoint: "sms-2fa-send" });

      // Generate the code and store only its hash; replace any previous codes
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      const randomInt = (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
      const code = (randomInt % 1000000).toString().padStart(6, "0");

      await admin.from("mfa_codes").delete().eq("user_id", user.id);
      const { error: insertError } = await admin.from("mfa_codes").insert({
        user_id: user.id,
        code_hash: await sha256(`${user.id}:${code}`),
        expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
      });
      if (insertError) throw insertError;

      // Send via Twilio (From may be a number or a Messaging Service SID)
      const params = new URLSearchParams({
        To: profile.phone,
        Body: `Your Apexia VIP security code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
      });
      params.append(TWILIO_FROM.startsWith("MG") ? "MessagingServiceSid" : "From", TWILIO_FROM);

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

      return json(200, { success: true, phone: maskPhone(profile.phone) });
    }

    if (action === "verify") {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^\d{6}$/.test(code)) return json(400, { error: "Invalid code" });

      const { data: record } = await admin
        .from("mfa_codes")
        .select("id, code_hash, attempts, expires_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!record || new Date(record.expires_at) < new Date()) {
        return json(400, { error: "Code expired. Please request a new one." });
      }
      if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        return json(429, { error: "Too many attempts. Please request a new code." });
      }

      const hash = await sha256(`${user.id}:${code}`);
      if (hash !== record.code_hash) {
        await admin
          .from("mfa_codes")
          .update({ attempts: record.attempts + 1 })
          .eq("id", record.id);
        return json(400, { error: "Incorrect code" });
      }

      // Success: burn the code and mark this session as verified
      await admin.from("mfa_codes").delete().eq("user_id", user.id);
      const { error: sessionError } = await admin
        .from("mfa_sessions")
        .upsert({ user_id: user.id, session_id: sessionId }, { onConflict: "session_id" });
      if (sessionError) throw sessionError;

      return json(200, { success: true });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.error("sms-2fa error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
