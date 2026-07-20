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

    const body = await req.json();
    const action = body?.action;

    if (action === "list") {
      const { data: profiles, error } = await admin
        .from("profiles")
        .select("id, full_name, email, phone, status, created_at")
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

      if (!fullName || fullName.length > 100) return json(400, { error: "Invalid name" });
      if (!email.includes("@") || email.length > 255) return json(400, { error: "Invalid email" });
      if (!isValidPhone(phone)) {
        return json(400, { error: "Phone must be in international format, e.g. +447700900123" });
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        phone,
        email,
        phone_confirm: true,
        email_confirm: true,
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

      return json(200, { success: true });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.error("admin-users error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
