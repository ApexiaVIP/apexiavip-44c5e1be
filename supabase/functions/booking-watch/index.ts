import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** How far either side of a collection time a booking is worth watching. */
const WATCH_BEFORE_HOURS = 24 * 14;
const WATCH_AFTER_HOURS = 4;
const MAX_WATCHED = 100;

const trySendSms = async (to: string, message: string) => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !authToken || !from || !to) return false;
  try {
    const params = new URLSearchParams({ To: to, Body: message });
    params.append(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${sid}:${authToken}`)}`,
        },
        body: params.toString(),
      }
    );
    if (!res.ok) {
      console.error("Status SMS failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Status SMS failed:", err);
    return false;
  }
};

/**
 * Dispatch wording varies, so statuses are matched loosely and only the moments
 * a passenger benefits from hearing about are texted. Anything unrecognised is
 * recorded but never texted, so a new status can never send nonsense.
 */
type Moment = "assigned" | "onroute" | "arrived" | "cancelled" | null;

const classify = (status: string): Moment => {
  const s = status.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s.includes("cancel")) return "cancelled";
  if (
    s.includes("onroute") ||
    s.includes("enroute") ||
    s.includes("onway") ||
    s.includes("ontheway") ||
    s.includes("travelling")
  ) {
    return "onroute";
  }
  if (
    s.includes("arrived") ||
    s.includes("atpickup") ||
    s.includes("waiting") ||
    s.includes("onsite")
  ) {
    return "arrived";
  }
  if (
    s.includes("dispatch") ||
    s.includes("allocated") ||
    s.includes("assigned") ||
    s.includes("accepted")
  ) {
    return "assigned";
  }
  // Passenger on board, completed, no show: nothing useful to say to them
  return null;
};

const ukWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "your journey";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const DISPATCH_TRANSFER_REFERENCE = Deno.env.get("DISPATCH_TRANSFER_REFERENCE");
    if (!DISPATCH_TRANSFER_REFERENCE) {
      throw new Error("DISPATCH_TRANSFER_REFERENCE is not configured");
    }

    // Only the scheduled job may run this
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (token !== serviceKey) return json(401, { success: false, error: "Not permitted" });

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const now = Date.now();
    const { data: watched } = await admin
      .from("bookings")
      .select(
        "reference, user_id, corporate, name, phone, status, notified_status, collection_at, vehicle"
      )
      .not("reference", "is", null)
      .not("collection_at", "is", null)
      .gte("collection_at", new Date(now - WATCH_AFTER_HOURS * 3600 * 1000).toISOString())
      .lte("collection_at", new Date(now + WATCH_BEFORE_HOURS * 3600 * 1000).toISOString())
      .not("status", "in", '("Cancelled","Failed","Completed")')
      .order("collection_at")
      .limit(MAX_WATCHED);

    const bookings = watched ?? [];
    if (bookings.length === 0) return json(200, { success: true, watched: 0, notified: 0 });

    // Ask Dispatch where each of them stands
    const auth = btoa(`TRANSFERAPIUSER:${DISPATCH_TRANSFER_REFERENCE}`);
    const res = await fetch(
      `https://dispatch.deversoftware.com/Dispatch/Transfer/?TransferToReference=${encodeURIComponent(
        DISPATCH_TRANSFER_REFERENCE
      )}&CheckBookingStatus=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
        body: JSON.stringify({ Bookings: bookings.map((b) => ({ Reference: b.reference })) }),
      }
    );
    if (!res.ok) {
      console.error("Dispatch status HTTP", res.status, await res.text());
      return json(502, { success: false, error: "Could not reach the booking system" });
    }
    const data = await res.json();
    const result = Array.isArray(data?.Result) ? data.Result[0] : data;
    const live = Array.isArray(result?.Bookings) ? result.Bookings : [];

    let notified = 0;
    let changed = 0;

    for (const b of bookings) {
      const match = live.find((x: Record<string, unknown>) => x?.Reference === b.reference);
      const status = typeof match?.BookingStatus === "string" ? match.BookingStatus : "";
      if (!status || status === b.status) continue;

      changed += 1;
      await admin
        .from("bookings")
        .update({ status, status_checked_at: new Date().toISOString() })
        .eq("reference", b.reference);

      const moment = classify(status);
      if (!moment) {
        // Back to an uninteresting state: whatever we said no longer stands
        if (b.notified_status) {
          await admin
            .from("bookings")
            .update({ notified_status: null })
            .eq("reference", b.reference);
        }
        continue;
      }
      if (status === b.notified_status) continue;

      const driver = (match?.Driver as { Name?: string } | undefined)?.Name?.trim() ?? "";
      const car =
        (match?.Vehicle as { Description?: string; Registration?: string } | undefined) ?? {};
      const carText =
        [car.Description, car.Registration].filter(Boolean).join(" ") || (b.vehicle as string) || "";
      const when = ukWhen(b.collection_at as string | null);

      const message =
        moment === "assigned"
          ? `APEXIA VIP: Your chauffeur for ${when} is confirmed${driver ? `. ${driver}` : ""}${
              carText ? `, ${carText}` : ""
            }. We will text again when he sets off.`
          : moment === "onroute"
            ? `APEXIA VIP: ${driver || "Your chauffeur"} is on the way for your ${when} collection${
                carText ? `, ${carText}` : ""
              }.`
            : moment === "arrived"
              ? `APEXIA VIP: ${driver || "Your chauffeur"} has arrived for your ${when} collection${
                  carText ? `, ${carText}` : ""
                }.`
              : `APEXIA VIP: Your booking for ${when} has been cancelled. Please contact us if this is unexpected.`;

      // Who hears about it: the member, or for a desk booking the assistant who
      // arranged it plus any passenger who asked to be told directly
      const numbers = new Set<string>();
      if (b.corporate) {
        if (b.user_id) {
          const { data: booker } = await admin
            .from("profiles")
            .select("phone")
            .eq("id", b.user_id as string)
            .maybeSingle();
          if (booker?.phone) numbers.add(booker.phone as string);
        }
        const names = String(b.name ?? "")
          .split(",")
          .map((n) => n.trim().replace(/\s+x\d+$/i, ""))
          .filter(Boolean);
        if (names.length > 0) {
          const { data: people } = await admin
            .from("corporate_passengers")
            .select("name, phone, notify_sms, notify_target")
            .eq("corporate", b.corporate as string)
            .in("name", names);
          for (const p of people ?? []) {
            if (p.notify_sms !== true) continue;
            // Diverted passengers are covered by the assistant's own message
            if (p.notify_target === "booker") continue;
            if (p.phone) numbers.add(p.phone as string);
          }
        }
      } else if (b.phone) {
        numbers.add(b.phone as string);
      }

      let sentAny = false;
      for (const to of numbers) {
        if (await trySendSms(to, message)) sentAny = true;
      }
      if (sentAny) {
        notified += 1;
        await admin
          .from("bookings")
          .update({ notified_status: status })
          .eq("reference", b.reference);
      }
    }

    return json(200, { success: true, watched: bookings.length, changed, notified });
  } catch (error) {
    console.error("booking-watch error:", error);
    return json(500, { success: false, error: "An error occurred" });
  }
});
