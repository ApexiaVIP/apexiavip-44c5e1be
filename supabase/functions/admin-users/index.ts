import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// E.164: + followed by 8-15 digits
const isValidPhone = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);

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

    // Authenticate the caller and confirm they are an admin
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json(401, { error: "Not authenticated" });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json(401, { error: "Not authenticated" });
    const caller = userData.user;

    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    if (!isAdmin) return json(403, { error: "Admin access required" });

    // Admin actions also require the SMS-verified session
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
      ? await admin.from("mfa_sessions").select("id").eq("session_id", sessionId).maybeSingle()
      : { data: null };
    if (!verifiedSession) return json(403, { error: "Two-factor verification required" });

    const body = await req.json();
    const action = body?.action;

    if (action === "list") {
      const { data: profiles, error } = await admin
        .from("profiles")
        .select(
          "id, full_name, email, phone, status, created_at, avatar_url, primary_member_id, profile_completed"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: roles, error: rolesError } = await admin
        .from("user_roles")
        .select("user_id, role");
      if (rolesError) throw rolesError;

      const members = (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
      }));
      return json(200, { members });
    }

    if (action === "invite") {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const phone = typeof body.phone === "string" ? body.phone.replace(/[\s\-()]/g, "") : "";

      // Only the mobile number is required; the member completes the rest
      // of their profile after first sign-in
      if (fullName.length > 100) return json(400, { error: "Invalid name" });
      if (email && (!email.includes("@") || email.length > 255)) {
        return json(400, { error: "Invalid email" });
      }
      if (!isValidPhone(phone)) {
        return json(400, { error: "Phone must be in international format, e.g. +447700900123" });
      }

      // Sign-in never uses this address; it only anchors the auth account
      // until the member provides their real email in their profile
      const authEmail = email || `member-${phone.replace(/\D/g, "")}@members.apexiavip.com`;

      // Create the member directly: sign-in is passwordless (mobile + SMS code),
      // so nothing in onboarding depends on an email being delivered
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: authEmail,
        phone,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createError) {
        const msg = createError.message?.includes("already")
          ? "A user with this phone or email already exists"
          : createError.message;
        return json(400, { error: msg });
      }

      const userId = created.user.id;
      const { error: profileError } = await admin.from("profiles").insert({
        id: userId,
        full_name: fullName,
        email,
        phone,
        status: "active",
        invited_by: caller.id,
      });
      if (profileError) throw profileError;

      const { error: roleError } = await admin
        .from("user_roles")
        .insert({ user_id: userId, role: "member" });
      if (roleError) throw roleError;

      // Courtesy welcome email: purely informational, sign-in never depends on it
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (RESEND_API_KEY && email) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: "Apexia VIP <info@apexiavip.com>",
              to: [email],
              subject: "Welcome to Apexia VIP",
              html: `
                <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 520px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 48px 40px; text-align: center;">
                  <p style="color: #b89b5e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.3em; margin-bottom: 28px;">Apexia VIP</p>
                  <p style="font-size: 20px; font-weight: 300; letter-spacing: 0.05em; margin-bottom: 20px;">Welcome, ${fullName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
                  <p style="font-size: 14px; color: #8a8070; line-height: 1.7;">Your membership is now active. To sign in, simply visit the site, choose Members, and enter this mobile number ending ${phone.slice(-3)}. We will text you a secure access code. There is no password to remember.</p>
                  <p style="margin: 32px 0;"><a href="https://apexiavip.com/login" style="color: #b89b5e; border: 1px solid #b89b5e; padding: 14px 36px; text-decoration: none; font-size: 12px; text-transform: uppercase; letter-spacing: 0.2em;">Member Sign In</a></p>
                  <p style="font-size: 11px; color: #8a8070;">All enquiries are handled with complete discretion.</p>
                </div>
              `,
            }),
          });
        } catch (emailError) {
          console.error("Welcome email failed (non-blocking):", emailError);
        }
      }

      return json(200, { success: true, user_id: userId });
    }

    if (action === "revoke" || action === "restore") {
      const userId = body?.user_id;
      if (!userId || typeof userId !== "string") return json(400, { error: "Invalid user id" });
      if (userId === caller.id) return json(400, { error: "You cannot revoke your own access" });

      const { data: targetIsAdmin } = await admin.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (targetIsAdmin) return json(400, { error: "Admin accounts cannot be revoked here" });

      const revoking = action === "revoke";
      const { error: banError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: revoking ? "876000h" : "none",
      });
      if (banError) throw banError;

      const { error: statusError } = await admin
        .from("profiles")
        .update({ status: revoking ? "revoked" : "active" })
        .eq("id", userId);
      if (statusError) throw statusError;

      if (revoking) {
        await admin.from("mfa_sessions").delete().eq("user_id", userId);
      }

      return json(200, { success: true });
    }

    if (action === "approve_family" || action === "reject_family") {
      const userId = body?.user_id;
      if (!userId || typeof userId !== "string") return json(400, { error: "Invalid user id" });

      const { data: target } = await admin
        .from("profiles")
        .select("id, status")
        .eq("id", userId)
        .maybeSingle();
      if (!target || target.status !== "pending") {
        return json(400, { error: "No pending request found for this member" });
      }

      if (action === "approve_family") {
        const { error: unbanError } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: "none",
        });
        if (unbanError) throw unbanError;
        const { error: statusError } = await admin
          .from("profiles")
          .update({ status: "active" })
          .eq("id", userId);
        if (statusError) throw statusError;
        return json(200, { success: true });
      }

      // Reject: remove the account entirely (cascades to profile and role)
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;
      return json(200, { success: true });
    }

    if (action === "reset_2fa") {
      const userId = body?.user_id;
      if (!userId || typeof userId !== "string") return json(400, { error: "Invalid user id" });

      const newPhone =
        typeof body.new_phone === "string" && body.new_phone.trim()
          ? body.new_phone.replace(/[\s\-()]/g, "")
          : null;
      if (newPhone && !isValidPhone(newPhone)) {
        return json(400, { error: "Phone must be in international format, e.g. +447700900123" });
      }

      if (newPhone) {
        const { error: phoneError } = await admin.auth.admin.updateUserById(userId, {
          phone: newPhone,
          phone_confirm: true,
        });
        if (phoneError) return json(400, { error: phoneError.message });
        const { error: profileError } = await admin
          .from("profiles")
          .update({ phone: newPhone })
          .eq("id", userId);
        if (profileError) throw profileError;
      }

      // Invalidate their verified sessions so every device re-verifies by SMS
      const { error: wipeError } = await admin
        .from("mfa_sessions")
        .delete()
        .eq("user_id", userId);
      if (wipeError) throw wipeError;

      return json(200, { success: true });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.error("admin-users error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
