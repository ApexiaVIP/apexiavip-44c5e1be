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
        .select(
          "reference, user_id, status, name, phone, email, travel_date, vehicle, pickup, dropoff, corporate, assigned_reference"
        )
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
        const msg = String(
          cancelBooking?.Message || cancelResult?.Message || "Cancellation failed"
        );
        console.error("Dispatch cancel failed:", reference, msg, JSON.stringify(cancelData));

        // The member has asked to cancel and is entitled to have that honoured.
        // When the booking system will not take it directly, hand it to the ops
        // team rather than leaving the member with a dead end.
        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        const escape = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const pickup = (booking.pickup as { line1?: string } | null)?.line1 ?? "";
        const dropoff = (booking.dropoff as { line1?: string } | null)?.line1 ?? "";
        if (RESEND_API_KEY) {
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
              },
              body: JSON.stringify({
                from: "Apexia VIP <info@apexiavip.com>",
                to: ["info@apexiavip.com"],
                subject: `CANCEL THIS BOOKING: ${booking.reference}${
                  booking.assigned_reference ? ` (Dispatch ${booking.assigned_reference})` : ""
                }`,
                html: `
                  <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px;">
                    <h1 style="font-size: 20px; font-weight: 300; letter-spacing: 0.08em; color: #d06060;">Cancellation needs doing by hand</h1>
                    <p style="font-size: 13px; color: #8a8070; line-height: 1.8;">
                      A member cancelled in the app, but the booking system refused it:<br/>
                      <em>${escape(msg)}</em>
                    </p>
                    <table style="width: 100%; margin-top: 16px; font-size: 13px;">
                      <tr><td style="color:#8a8070; padding:6px 0;">Reference</td><td>${escape(String(booking.reference ?? ""))}</td></tr>
                      <tr><td style="color:#8a8070; padding:6px 0;">Dispatch ref</td><td>${escape(String(booking.assigned_reference ?? "unknown"))}</td></tr>
                      <tr><td style="color:#8a8070; padding:6px 0;">Passenger</td><td>${escape(String(booking.name ?? ""))}</td></tr>
                      <tr><td style="color:#8a8070; padding:6px 0;">Travel</td><td>${escape(String(booking.travel_date ?? ""))}</td></tr>
                      <tr><td style="color:#8a8070; padding:6px 0;">Vehicle</td><td>${escape(String(booking.vehicle ?? ""))}</td></tr>
                      <tr><td style="color:#8a8070; padding:6px 0;">Route</td><td>${escape(pickup)} to ${escape(dropoff)}</td></tr>
                      <tr><td style="color:#8a8070; padding:6px 0;">Requested by</td><td>${escape(String(booking.email ?? booking.phone ?? ""))}</td></tr>
                    </table>
                    <p style="font-size: 12px; color: #8a8070;">Please cancel it in Dispatch. The member has been told the team is handling it.</p>
                  </div>
                `,
              }),
            });
          } catch (mailErr) {
            console.error("Cancellation hand-off email failed:", mailErr);
          }
        }

        await admin
          .from("bookings")
          .update({
            status: "Cancellation requested",
            status_checked_at: new Date().toISOString(),
          })
          .eq("reference", reference)
          .eq("user_id", user.id);

        return json(200, {
          success: true,
          handedToOps: true,
          message:
            "Your travel team has been asked to cancel this journey and will confirm shortly.",
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

    // The caller's own bookings, plus (view-only) their family members' bookings
    const { data: matchedBookings, error: ownError } = await admin
      .from("bookings")
      .select("reference, user_id")
      .in("reference", references);
    if (ownError) throw ownError;

    const { data: familyProfiles } = await admin
      .from("profiles")
      .select("id")
      .eq("primary_member_id", user.id);
    const familyIds = new Set((familyProfiles ?? []).map((p) => p.id as string));

    const ownRefs = (matchedBookings ?? [])
      .filter((b) => b.user_id === user.id || (b.user_id && familyIds.has(b.user_id as string)))
      .map((b) => b.reference as string);
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
          .eq("reference", reference);
      }
    }

    return json(200, { statuses });
  } catch (error) {
    console.error("booking-status error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
