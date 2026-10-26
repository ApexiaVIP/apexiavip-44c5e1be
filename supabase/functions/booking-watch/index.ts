import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { followLink } from "../_shared/notify.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { transferAuth } from "../_shared/dispatch.ts";

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
// Dispatch refuses a status check within thirty seconds of the last one for
// the same booking, and refuses the whole request when one booking in it is
// too soon. So one member watching their car could lose the answer for every
// other booking in the sweep. Keep DISPATCH_RECHECK_MS in src/lib/bookingLive.ts
// in step with this.
const DISPATCH_RECHECK_MS = 30_000;
// A little past Dispatch's own window, so a clock a second out cannot bite
const RECHECK_MARGIN_MS = 5_000;

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
    // Preferred over the reference for the password; see _shared/dispatch.ts
    const DISPATCH_TRANSFER_API_KEY = Deno.env.get("DISPATCH_TRANSFER_API_KEY") ?? "";
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
        "reference, user_id, corporate, name, phone, status, notified_status, collection_at, vehicle, subject_to_availability, driver_moment, status_checked_at"
      )
      .not("reference", "is", null)
      .not("collection_at", "is", null)
      .gte("collection_at", new Date(now - WATCH_AFTER_HOURS * 3600 * 1000).toISOString())
      .lte("collection_at", new Date(now + WATCH_BEFORE_HOURS * 3600 * 1000).toISOString())
      .not("status", "in", '("Cancelled","Failed","Completed")')
      .order("collection_at")
      .limit(MAX_WATCHED);

    // Somebody's app or the travel desk may have asked about one of these
    // seconds ago. Including it would have Dispatch refuse the whole request,
    // and the next sweep is only five minutes away.
    const askedTooRecently = now - (DISPATCH_RECHECK_MS + RECHECK_MARGIN_MS);
    const all = watched ?? [];
    const bookings = all.filter((b) => {
      const last = b.status_checked_at ? Date.parse(b.status_checked_at as string) : NaN;
      return Number.isNaN(last) || last < askedTooRecently;
    });
    const heldOver = all.length - bookings.length;
    if (bookings.length === 0) {
      // A sweep that found everybody checked a moment ago still ran
      await recordHeartbeat(admin, "booking-watch", { watched: 0, heldOver });
      return json(200, { success: true, watched: 0, notified: 0, heldOver });
    }

    // Ask Dispatch where each of them stands
    const auth = transferAuth(DISPATCH_TRANSFER_API_KEY, DISPATCH_TRANSFER_REFERENCE);
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
      const body = await res.text();
      console.error("Dispatch status HTTP", res.status, body);
      return json(502, {
        success: false,
        error:
          res.status === 429
            ? "The booking system asked us to wait before checking these again"
            : "Could not reach the booking system",
        watched: bookings.length,
        heldOver,
      });
    }
    const data = await res.json();
    const result = Array.isArray(data?.Result) ? data.Result[0] : data;
    const live = Array.isArray(result?.Bookings) ? result.Bookings : [];

    let notified = 0;
    let changed = 0;
    // What happened to each one, so a manual run can be read at a glance
    const details: Record<string, unknown>[] = [];

    // Record that every watched booking was looked at, not just the ones that
    // moved: otherwise there is no way to tell "checked, unchanged" apart from
    // "never looked at"
    const checkedAt = new Date().toISOString();
    await admin
      .from("bookings")
      .update({ status_checked_at: checkedAt })
      .in(
        "reference",
        bookings.map((b) => b.reference as string)
      );

    for (const b of bookings) {
      const match = live.find((x: Record<string, unknown>) => x?.Reference === b.reference);
      const status = typeof match?.BookingStatus === "string" ? match.BookingStatus : "";
      if (!status) {
        details.push({ reference: b.reference, outcome: "not returned by the booking system" });
        continue;
      }
      // Whether the stored status changed is the wrong question to ask. The
      // passenger's own app writes that column too, every time they open their
      // bookings, so a member eager enough to look swallowed their own change
      // and the text was never sent. What matters is what we have told them,
      // which is what notified_status records.
      const moved = status !== b.status;
      if (moved) {
        changed += 1;
        await admin
          .from("bookings")
          .update({ status, status_checked_at: new Date().toISOString() })
          .eq("reference", b.reference);
      }

      const moment = classify(status);
      if (!moment) {
        // Say whether it actually moved. Reading "changed" against a count of
        // zero sent us looking for a bug that was only ever the wording.
        details.push({
          reference: b.reference,
          status,
          moved,
          outcome: "nothing a passenger gains from",
        });
        // Back to an uninteresting state: whatever we said no longer stands
        if (b.notified_status) {
          await admin
            .from("bookings")
            .update({ notified_status: null })
            .eq("reference", b.reference);
        }
        continue;
      }
      if (status === b.notified_status) {
        details.push({ reference: b.reference, status, outcome: "already texted" });
        continue;
      }
      // The chauffeur's own app texts the passenger the moment they set off
      // and the moment they arrive. Dispatch reaching the same point later
      // must not say it again.
      if (moment && moment === b.driver_moment) {
        details.push({ reference: b.reference, status, outcome: "chauffeur already texted" });
        continue;
      }

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
            // Our own link, so the passenger lands on our map rather than the
            // booking system's tracker
            ? `APEXIA VIP: ${driver || "Your chauffeur"} is on the way for your ${when} collection${
                carText ? `, ${carText}` : ""
              }. Follow the car: ${followLink(b.corporate as string | null)}`
            : moment === "arrived"
              ? `APEXIA VIP: ${driver || "Your chauffeur"} has arrived for your ${when} collection${
                  carText ? `, ${carText}` : ""
                }.`
              : b.subject_to_availability
                // A journey we never promised, now cancelled by the office:
                // say plainly that we could not cover it
                ? `APEXIA VIP: We are very sorry, we have not been able to cover your journey on ${when}. Please reply or email info@apexiavip.com and we will help you find another option.`
                // Cancelled by our team rather than by the member, who would
                // have been cancelling from the app
                : `APEXIA VIP: Your booking for ${when} has been cancelled by our team. If this is unexpected, please email info@apexiavip.com and we will put it right.`;

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

      // The moment the car is confirmed is when the app earns its place, so a
      // member who has never signed in from it gets one line inviting them,
      // and not again for a month
      let appNudge = "";
      let nudgeUserId: string | null = null;
      if (moment === "assigned" && !b.corporate && b.user_id) {
        const { data: member } = await admin
          .from("profiles")
          .select("app_platform, app_nudged_at")
          .eq("id", b.user_id as string)
          .maybeSingle();
        const nudgedRecently =
          !!member?.app_nudged_at &&
          Date.now() - new Date(member.app_nudged_at as string).getTime() < 30 * 24 * 3600 * 1000;
        if (member && !member.app_platform && !nudgedRecently) {
          appNudge = " Follow your car live in the app: apexiavip.com/app";
          nudgeUserId = b.user_id as string;
        }
      }

      let sentAny = false;
      for (const to of numbers) {
        if (await trySendSms(to, message + appNudge)) sentAny = true;
      }
      if (sentAny && nudgeUserId) {
        await admin
          .from("profiles")
          .update({ app_nudged_at: new Date().toISOString() })
          .eq("id", nudgeUserId);
      }
      details.push({
        reference: b.reference,
        status,
        moment,
        recipients: numbers.size,
        outcome: sentAny ? "texted" : "no number to text",
      });
      if (sentAny) {
        notified += 1;
        await admin
          .from("bookings")
          .update({ notified_status: status })
          .eq("reference", b.reference);
      }
    }

    await recordHeartbeat(admin, "booking-watch", { watched: bookings.length, heldOver, changed, notified });
    return json(200, { success: true, watched: bookings.length, heldOver, changed, notified, details });
  } catch (error) {
    console.error("booking-watch error:", error);
    return json(500, { success: false, error: "An error occurred" });
  }
});
