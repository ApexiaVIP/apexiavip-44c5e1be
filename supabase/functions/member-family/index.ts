import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FAMILY_MEMBERS = 8;
const SYNTHETIC_EMAIL_DOMAIN = "members.apexiavip.com";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isValidPhone = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

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
    const caller = userData.user;

    // Require a code-verified session, same as bookings
    const sessionId = decodeJwtPayload(token)?.session_id;
    const { data: verifiedSession } = typeof sessionId === "string"
      ? await admin.from("mfa_sessions").select("id").eq("session_id", sessionId).maybeSingle()
      : { data: null };
    if (!verifiedSession) return json(403, { error: "Verification required" });

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, full_name, phone, status, primary_member_id")
      .eq("id", caller.id)
      .maybeSingle();
    if (!callerProfile || callerProfile.status !== "active") {
      return json(403, { error: "Membership not active" });
    }
    if (callerProfile.primary_member_id) {
      return json(403, { error: "Only the primary account holder can manage family members" });
    }

    const body = await req.json();
    const action = body?.action;

    if (action === "request") {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const phone = typeof body.phone === "string" ? body.phone.replace(/[\s\-()]/g, "") : "";

      if (!fullName || fullName.length > 100) return json(400, { error: "Please enter their name" });
      if (!isValidPhone(phone)) {
        return json(400, { error: "Phone must be in international format, e.g. +447700900123" });
      }

      const { count: familyCount } = await admin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("primary_member_id", caller.id);
      if ((familyCount ?? 0) >= MAX_FAMILY_MEMBERS) {
        return json(400, { error: "Family member limit reached. Please contact us." });
      }

      // Created banned + pending: they cannot sign in until an admin approves
      const syntheticEmail = `member-${phone.replace(/\D/g, "")}@${SYNTHETIC_EMAIL_DOMAIN}`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        phone,
        email_confirm: true,
        phone_confirm: true,
        ban_duration: "876000h",
        user_metadata: { full_name: fullName },
      });
      if (createError) {
        const msg = createError.message?.includes("already")
          ? "A member with this phone number already exists"
          : createError.message;
        return json(400, { error: msg });
      }

      const userId = created.user.id;
      const { error: profileError } = await admin.from("profiles").insert({
        id: userId,
        full_name: fullName,
        email: "",
        phone,
        status: "pending",
        invited_by: caller.id,
        primary_member_id: caller.id,
      });
      if (profileError) throw profileError;

      const { error: roleError } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role: "member" });
      if (roleError) throw roleError;

      // Notify admins by SMS (email as fallback); never block the request on it
      try {
        const { data: adminRoles } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        const adminIds = (adminRoles ?? []).map((r) => r.user_id);
        const { data: adminProfiles } = adminIds.length
          ? await admin.from("profiles").select("phone, email").in("id", adminIds)
          : { data: [] };

        const requester = callerProfile.full_name || callerProfile.phone;
        const message = `APEXIA VIP: ${requester} has requested family access for ${fullName}. Approve or decline in the admin area: https://apexiavip.com/admin`;

        const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
        const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
        const TWILIO_FROM = Deno.env.get("TWILIO_FROM");
        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        const smsConfigured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM);

        for (const adminProfile of adminProfiles ?? []) {
          if (smsConfigured && adminProfile.phone) {
            const params = new URLSearchParams({ To: adminProfile.phone, Body: message });
            params.append(
              TWILIO_FROM!.startsWith("MG") ? "MessagingServiceSid" : "From",
              TWILIO_FROM!
            );
            await fetch(
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
          } else if (RESEND_API_KEY && adminProfile.email) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
              },
              body: JSON.stringify({
                from: "Apexia VIP <info@apexiavip.com>",
                to: [adminProfile.email],
                subject: "Family member approval needed",
                html: `<p>${message}</p>`,
              }),
            });
          }
        }
      } catch (notifyError) {
        console.error("Admin notification failed (non-blocking):", notifyError);
      }

      return json(200, { success: true, user_id: userId });
    }

    if (action === "remove") {
      const targetId = typeof body.user_id === "string" ? body.user_id : "";
      if (!targetId) return json(400, { error: "Invalid family member" });

      const { data: target } = await admin
        .from("profiles")
        .select("id, primary_member_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!target || target.primary_member_id !== caller.id) {
        return json(404, { error: "Family member not found" });
      }

      // Removal deletes the account outright (profile, role and sessions
      // cascade); re-adding later goes through admin approval like any request
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
      if (deleteError) throw deleteError;

      return json(200, { success: true });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.error("member-family error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
