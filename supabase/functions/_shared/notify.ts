/**
 * Texting the passenger, shared by the Dispatch watcher and the chauffeur's
 * own buttons so both reach the same people by the same rules.
 */

export const trySendSms = async (to: string, message: string): Promise<boolean> => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !authToken || !from || !to) return false;
  try {
    const params = new URLSearchParams({ To: to, Body: message });
    params.append(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${sid}:${authToken}`)}`,
      },
      body: params.toString(),
    });
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

interface BookingLike {
  corporate?: string | null;
  user_id?: string | null;
  name?: string | null;
  phone?: string | null;
}

/**
 * Who hears about a journey: the member, or for a desk booking the assistant
 * who arranged it plus any passenger who asked to be told directly.
 */
export const recipientsFor = async (
  // deno-lint-ignore no-explicit-any
  admin: any,
  booking: BookingLike
): Promise<string[]> => {
  const numbers = new Set<string>();
  if (booking.corporate) {
    if (booking.user_id) {
      const { data: booker } = await admin
        .from("profiles")
        .select("phone")
        .eq("id", booking.user_id)
        .maybeSingle();
      if (booker?.phone) numbers.add(booker.phone as string);
    }
    const names = String(booking.name ?? "")
      .split(",")
      .map((n) => n.trim().replace(/\s+x\d+$/i, ""))
      .filter(Boolean);
    if (names.length > 0) {
      const { data: people } = await admin
        .from("corporate_passengers")
        .select("name, phone, notify_sms, notify_target")
        .eq("corporate", booking.corporate)
        .in("name", names);
      for (const p of people ?? []) {
        if (p.notify_sms !== true) continue;
        // Diverted passengers are covered by the assistant's own message
        if (p.notify_target === "booker") continue;
        if (p.phone) numbers.add(p.phone as string);
      }
    }
  } else if (booking.phone) {
    numbers.add(booking.phone);
  }
  return [...numbers];
};

/** When the car is due, in words a passenger reads at a glance. */
export const ukWhen = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      })
    : "your booking";
