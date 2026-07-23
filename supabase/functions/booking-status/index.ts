import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_REFERENCES = 10;
const MAX_CHECKS_PER_HOUR = 240;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
    const DISPATCH_TRANSFER_REFERENCE = Deno.env.get("DISPATCH_TRANSFER_REFERENCE");
    if (!DISPATCH_TRANSFER_REFERENCE) {
      throw new Error("DISPATCH_TRANSFER_REFERENCE is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Same gate as bookings: signed-in, code-verified, active member
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json(401, { error: "Not authenticated" });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json(401, { error: "Not authenticated" });
    const user = userData.user;

    const sessionId = decodeJwtPayload(token)?.session_id;
    const { data: verifiedSession } = typeof sessionId === "string"
      ? await admin.from("mfa_sessions").select("id").eq("session_id", sessionId).maybeSingle()
      : { data: null };
    if (!verifiedSession) return json(403, { error: "Verification required" });

    const { data: profile } = await admin
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.status !== "active") {
      return json(403, { error: "Membership not active" });
    }

    const body = await req.json();

    // Cancel a booking: business rule is cancel any time, invoiced regardless
    if (body?.action === "cancel") {
      const reference = typeof body.reference === "string" ? body.reference : "";
      if (!reference) return json(400, { error: "Invalid booking reference" });

      const { data: booking } = await admin
        .from("bookings")
        .select("reference, user_id, status")
        .eq("reference", reference)
        .maybeSingle();
      if (!booking || booking.user_id !== user.id) {
        return json(404, { error: "Booking not found" });
      }
      if (booking.status === "Cancelled") {
        return json(200, { success: true });
      }

      const dispatchAuth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);
      const cancelRes = await fetch(
        `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=` +
          `${encodeURIComponent(DISPATCH_TRANSFER_REFERENCE)}&BookedBy=Website`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${dispatchAuth}`,
          },
          body: JSON.stringify({ Bookings: [{ Reference: reference, Cancelled: "T" }] }),
        }
      );
      if (!cancelRes.ok) {
        console.error("Dispatch cancel HTTP", cancelRes.status, await cancelRes.text());
        return json(502, { error: "We could not reach the booking system. Please try again." });
      }
      const cancelData = await cancelRes.json();
      const cancelResult = Array.isArray(cancelData?.Result) ? cancelData.Result[0] : cancelData;
      const cancelBooking = Array.isArray(cancelResult?.Bookings)
        ? cancelResult.Bookings[0]
        : undefined;
      if (cancelResult?.TransferStatus === "Failed" || cancelBooking?.Status === "Failed") {
        const msg = cancelBooking?.Message || cancelResult?.Message || "Cancellation failed";
        console.error("Dispatch cancel failed:", msg);
        return json(502, {
          error: "The booking system rejected the cancellation. Please contact us.",
        });
      }

      await admin
        .from("bookings")
        .update({ status: "Cancelled", status_checked_at: new Date().toISOString() })
        .eq("reference", reference)
        .eq("user_id", user.id);

      return json(200, { success: true });
    }

    const references: string[] = Array.isArray(body?.references)
      ? body.references.filter((r: unknown) => typeof r === "string").slice(0, MAX_REFERENCES)
      : [];
    if (references.length === 0) return json(200, { statuses: [] });

    // Rate limit checks per member
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", user.id)
      .eq("endpoint", "booking-status")
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= MAX_CHECKS_PER_HOUR) {
      return json(429, { error: "Too many status checks. Please try again shortly." });
    }
    await admin.from("rate_limits").insert({ ip_address: user.id, endpoint: "booking-status" });

    // Only the caller's own bookings may be checked
    const { data: ownBookings, error: ownError } = await admin
      .from("bookings")
      .select("reference")
      .eq("user_id", user.id)
      .in("reference", references);
    if (ownError) throw ownError;
    const ownRefs = (ownBookings ?? []).map((b) => b.reference as string);
    if (ownRefs.length === 0) return json(200, { statuses: [] });

    // Ask Dispatch for current status of these bookings
    const dispatchAuth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);
    const dispatchUrl =
      `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=` +
      `${encodeURIComponent(DISPATCH_TRANSFER_REFERENCE)}&CheckBookingStatus=true`;

    const dispatchRes = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${dispatchAuth}`,
      },
      body: JSON.stringify({ Bookings: ownRefs.map((reference) => ({ Reference: reference })) }),
    });
    if (!dispatchRes.ok) {
      console.error("Dispatch status HTTP", dispatchRes.status, await dispatchRes.text());
      return json(502, { error: "We could not reach the booking system. Please try again." });
    }
    const dispatchData = await dispatchRes.json();
    const result = Array.isArray(dispatchData?.Result) ? dispatchData.Result[0] : dispatchData;
    const dispatchBookings = Array.isArray(result?.Bookings) ? result.Bookings : [];

    const statuses = [];
    for (const b of dispatchBookings) {
      const reference = b?.Reference;
      if (!reference || !ownRefs.includes(reference)) continue;
      const bookingStatus = b?.BookingStatus ?? null;
      statuses.push({
        reference,
        status: b?.Status ?? null,
        bookingStatus,
        latitude: b?.Latitude ?? null,
        longitude: b?.Longitude ?? null,
        locationDateTime: b?.LocationDateTime ?? null,
        trackDriverUrl: b?.TrackDriverURL ?? null,
        driver: b?.Driver
          ? {
              name: b.Driver.Name ?? "",
              mobile: b.Driver.Mobile ?? "",
              photoUrl: b.Driver.PhotoURL ?? "",
            }
          : null,
        vehicle: b?.Vehicle
          ? {
              description: b.Vehicle.Description ?? "",
              registration: b.Vehicle.Registration ?? "",
              photoUrl: b.Vehicle.PhotoURL ?? "",
            }
          : null,
        totalAmount: b?.TotalAmount ?? null,
        currencyCode: b?.CurrencyCode ?? null,
        message: b?.Message ?? null,
      });

      if (bookingStatus) {
        await admin
          .from("bookings")
          .update({ status: bookingStatus, status_checked_at: new Date().toISOString() })
          .eq("reference", reference)
          .eq("user_id", user.id);
      }
    }

    return json(200, { statuses });
  } catch (error) {
    console.error("booking-status error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
