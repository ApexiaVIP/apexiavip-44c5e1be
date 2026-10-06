import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  asHours,
  ukDay,
  ukDayEnd,
  ukDayName,
  ukDayPlus,
  ukDayStart,
  ukTimeOf,
} from "../_shared/ukTime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Where timesheets go. The back office reads these, not the members. */
const RECIPIENT = Deno.env.get("TIMESHEET_RECIPIENT") ?? "accounts@apexiavip.com";

/** The weekly summary covers the seven days ending on the day it is sent. */
const WEEK_DAYS = 7;

/**
 * Which day to report on. The daily run fires late in the evening, so the day
 * that has just finished is the one three hours ago: that holds whether the
 * clocks are on BST or GMT.
 */
const dayToReport = (override: unknown): string =>
  typeof override === "string" && /^\d{4}-\d{2}-\d{2}$/.test(override)
    ? override
    : ukDay(new Date(Date.now() - 3 * 3600 * 1000));

interface Shift {
  started_at: string;
  ended_at: string | null;
}

interface Job {
  reference: string;
  name: string;
  collection_at: string | null;
  pickup: { line1?: string; town?: string; postcode?: string } | null;
  dropoff: { line1?: string; town?: string; postcode?: string } | null;
  journey_type: string | null;
  as_directed_hours: number | null;
  vehicle: string;
  driver_status: string | null;
  corporate: string | null;
}

interface Waypoint {
  booking_reference: string;
  kind: string;
  place: string;
  note: string;
  recorded_at: string;
}

const STEP_LABEL: Record<string, string> = {
  en_route: "En route",
  arrived: "Arrived",
  pob: "Passenger on board",
  waiting: "Waiting",
  clear: "Cleared",
  set_down: "Set down",
  collected: "Collected",
  note: "Note",
};

const addressLine = (a: Job["pickup"]) =>
  [a?.line1, a?.town, a?.postcode].filter(Boolean).join(", ");

/**
 * Minutes on duty within a day. An open shift is counted to the end of the
 * day and flagged, rather than guessed at.
 */
const minutesOnDuty = (shifts: Shift[], from: Date, to: Date) => {
  let minutes = 0;
  let stillOpen = false;
  for (const s of shifts) {
    const start = Math.max(new Date(s.started_at).getTime(), from.getTime());
    const rawEnd = s.ended_at ? new Date(s.ended_at).getTime() : to.getTime();
    if (!s.ended_at) stillOpen = true;
    const end = Math.min(rawEnd, to.getTime());
    if (end > start) minutes += (end - start) / 60000;
  }
  return { minutes, stillOpen };
};

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const sendEmail = async (subject: string, html: string) => {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.error("RESEND_API_KEY is not configured");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: "Apexia VIP <info@apexiavip.com>",
      to: [RECIPIENT],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error("Timesheet email failed:", res.status, await res.text());
    return false;
  }
  return true;
};

const SHELL = (title: string, inner: string) => `
  <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 680px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 36px;">
    <h1 style="font-size: 20px; font-weight: 300; letter-spacing: 0.1em; border-bottom: 1px solid #2a2a2a; padding-bottom: 18px; color: #b89b5e;">
      ${title}
    </h1>
    ${inner}
    <p style="margin-top: 32px; color: #6b6355; font-size: 11px; line-height: 1.6;">
      Hours come from the chauffeur signing on and off in the app. Job steps come
      from the buttons they press, which is a separate record from Dispatch.
    </p>
  </div>`;

const TH = `style="text-align: left; padding: 8px 10px; color: #8a8070; font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; border-bottom: 1px solid #2a2a2a;"`;
const TD = `style="padding: 8px 10px; font-size: 13px; border-bottom: 1px solid #1a1a1a; vertical-align: top;"`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Only the scheduled job may run this
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (token !== serviceKey) return json(401, { success: false, error: "Not permitted" });

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "weekly" ? "weekly" : "daily";
    const day = dayToReport(body.date);

    const { data: drivers } = await admin
      .from("profiles")
      .select("id, full_name, phone")
      .eq("is_driver", true);
    if (!drivers || drivers.length === 0) {
      return json(200, { success: true, mode, day, sent: 0, note: "no chauffeur accounts" });
    }
    const driverIds = drivers.map((d) => d.id as string);

    const firstDay = mode === "weekly" ? ukDayPlus(day, -(WEEK_DAYS - 1)) : day;
    const from = ukDayStart(firstDay);
    const to = ukDayEnd(day);

    // Everything in the window, fetched once and sorted out per chauffeur
    const [{ data: shifts }, { data: jobs }, { data: waypoints }] = await Promise.all([
      admin
        .from("driver_shifts")
        .select("driver_id, started_at, ended_at")
        .in("driver_id", driverIds)
        .lt("started_at", to.toISOString())
        .or(`ended_at.is.null,ended_at.gte.${from.toISOString()}`),
      admin
        .from("bookings")
        .select(
          "reference, name, collection_at, pickup, dropoff, journey_type, as_directed_hours, vehicle, driver_status, corporate, driver_id"
        )
        .in("driver_id", driverIds)
        .gte("collection_at", from.toISOString())
        .lt("collection_at", to.toISOString())
        .order("collection_at"),
      admin
        .from("booking_waypoints")
        .select("driver_id, booking_reference, kind, place, note, recorded_at")
        .in("driver_id", driverIds)
        .gte("recorded_at", from.toISOString())
        .lt("recorded_at", to.toISOString())
        .order("recorded_at"),
    ]);

    const forDriver = <T extends { driver_id?: string }>(rows: T[] | null, id: string) =>
      (rows ?? []).filter((r) => r.driver_id === id);

    let sent = 0;

    if (mode === "daily") {
      for (const driver of drivers) {
        const id = driver.id as string;
        const mine = forDriver(shifts as ({ driver_id: string } & Shift)[], id);
        const myJobs = forDriver(jobs as ({ driver_id: string } & Job)[], id);
        const myPoints = forDriver(waypoints as ({ driver_id: string } & Waypoint)[], id);
        // A chauffeur who did nothing gets no sheet, so the office only reads
        // what actually happened
        if (mine.length === 0 && myJobs.length === 0) continue;

        const { minutes, stillOpen } = minutesOnDuty(mine, from, to);
        const signOn = mine.map((s) => ukTimeOf(s.started_at)).join(", ") || "not signed on";
        const signOff = mine.some((s) => !s.ended_at)
          ? "still on duty"
          : mine.map((s) => ukTimeOf(s.ended_at)).join(", ") || "not signed off";

        const cleared = myJobs.filter((j) => j.driver_status === "clear").length;
        const unfinished = myJobs.filter((j) => j.driver_status && j.driver_status !== "clear");
        const untouched = myJobs.filter((j) => !j.driver_status);

        const jobRows = myJobs
          .map((j) => {
            const steps = myPoints
              .filter((w) => w.booking_reference === j.reference)
              .map(
                (w) =>
                  `${ukTimeOf(w.recorded_at)} ${esc(STEP_LABEL[w.kind] ?? w.kind)}${
                    w.place ? ` &middot; ${esc(w.place)}` : ""
                  }`
              )
              .join("<br/>");
            const route =
              j.journey_type === "hourly"
                ? `As directed${j.as_directed_hours ? `, ${j.as_directed_hours} hours` : ""}`
                : `${esc(addressLine(j.pickup))}<br/>&rarr; ${esc(addressLine(j.dropoff))}`;
            return `<tr>
              <td ${TD}><span style="font-family: monospace; color: #b89b5e;">${ukTimeOf(j.collection_at)}</span></td>
              <td ${TD}>${esc(j.name)}${j.corporate ? `<br/><span style="color:#6b6355;font-size:11px;">${esc(j.corporate)}</span>` : ""}</td>
              <td ${TD}>${route}</td>
              <td ${TD}>${steps || '<span style="color:#6b6355;">no steps recorded</span>'}</td>
            </tr>`;
          })
          .join("");

        const flags: string[] = [];
        if (stillOpen) flags.push("Did not sign off, so hours run to midnight.");
        if (unfinished.length > 0) {
          flags.push(
            `${unfinished.length} job${unfinished.length > 1 ? "s" : ""} started but never cleared: ${unfinished
              .map((j) => esc(j.reference))
              .join(", ")}.`
          );
        }
        if (untouched.length > 0) {
          flags.push(
            `${untouched.length} job${untouched.length > 1 ? "s" : ""} with no buttons pressed at all: ${untouched
              .map((j) => esc(j.reference))
              .join(", ")}.`
          );
        }
        if (minutes > 0 && myJobs.length === 0) flags.push("On duty with no jobs assigned.");

        const html = SHELL(
          `${esc(driver.full_name ?? "Chauffeur")} &middot; ${ukDayName(day)}`,
          `
          <table style="width:100%; border-collapse: collapse; margin-top: 18px;">
            <tr><th ${TH}>On duty</th><th ${TH}>Signed on</th><th ${TH}>Signed off</th><th ${TH}>Jobs</th></tr>
            <tr>
              <td ${TD}><strong style="color:#b89b5e;">${asHours(minutes)}</strong></td>
              <td ${TD}>${esc(signOn)}</td>
              <td ${TD}>${esc(signOff)}</td>
              <td ${TD}>${myJobs.length} assigned, ${cleared} cleared</td>
            </tr>
          </table>
          ${
            flags.length > 0
              ? `<p style="margin-top: 20px; padding: 12px 14px; background: #2E2515; border-left: 3px solid #e0c341; color: #e0c341; font-size: 12px; line-height: 1.7;">${flags
                  .map(esc)
                  .join("<br/>")}</p>`
              : ""
          }
          ${
            myJobs.length > 0
              ? `<table style="width:100%; border-collapse: collapse; margin-top: 24px;">
                   <tr><th ${TH}>Time</th><th ${TH}>Passenger</th><th ${TH}>Journey</th><th ${TH}>History</th></tr>
                   ${jobRows}
                 </table>`
              : `<p style="margin-top: 20px; color:#6b6355; font-size:13px;">No jobs assigned on this day.</p>`
          }`
        );

        if (await sendEmail(`Timesheet: ${driver.full_name ?? "Chauffeur"} - ${ukDayName(day)}`, html))
          sent++;
      }

      return json(200, { success: true, mode, day, sent });
    }

    // --- Weekly: one sheet for the whole fleet ---
    const days: string[] = [];
    for (let i = WEEK_DAYS - 1; i >= 0; i--) days.push(ukDayPlus(day, -i));

    const rows = drivers
      .map((driver) => {
        const id = driver.id as string;
        const mine = forDriver(shifts as ({ driver_id: string } & Shift)[], id);
        const myJobs = forDriver(jobs as ({ driver_id: string } & Job)[], id);
        const perDay = days.map((d) => {
          const { minutes } = minutesOnDuty(mine, ukDayStart(d), ukDayEnd(d));
          return minutes;
        });
        const total = perDay.reduce((a, b) => a + b, 0);
        const cleared = myJobs.filter((j) => j.driver_status === "clear").length;
        return { driver, perDay, total, jobs: myJobs.length, cleared };
      })
      .filter((r) => r.total > 0 || r.jobs > 0)
      .sort((a, b) => b.total - a.total);

    const head = days
      .map(
        (d) =>
          `<th ${TH}>${ukDayStart(d).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            timeZone: "Europe/London",
          })}</th>`
      )
      .join("");

    const bodyRows = rows
      .map(
        (r) => `<tr>
          <td ${TD}>${esc(r.driver.full_name ?? "Chauffeur")}</td>
          ${r.perDay.map((m) => `<td ${TD}>${m > 0 ? asHours(m) : '<span style="color:#3a3a3a;">-</span>'}</td>`).join("")}
          <td ${TD}><strong style="color:#b89b5e;">${asHours(r.total)}</strong></td>
          <td ${TD}>${r.jobs} / ${r.cleared}</td>
        </tr>`
      )
      .join("");

    const fleetMinutes = rows.reduce((a, r) => a + r.total, 0);
    const html = SHELL(
      `Weekly timesheets &middot; week to ${ukDayName(day)}`,
      rows.length === 0
        ? `<p style="margin-top:20px;color:#6b6355;font-size:13px;">No chauffeur signed on this week.</p>`
        : `<table style="width:100%; border-collapse: collapse; margin-top: 18px;">
             <tr><th ${TH}>Chauffeur</th>${head}<th ${TH}>Total</th><th ${TH}>Jobs / cleared</th></tr>
             ${bodyRows}
           </table>
           <p style="margin-top: 20px; color:#8a8070; font-size:12px;">
             ${rows.length} chauffeur${rows.length > 1 ? "s" : ""} on duty, ${asHours(fleetMinutes)} across the fleet.
           </p>`
    );

    if (await sendEmail(`Weekly timesheets - week to ${ukDayName(day)}`, html)) sent++;
    return json(200, { success: true, mode, week: { from: firstDay, to: day }, sent });
  } catch (error) {
    console.error("driver-timesheets error:", error);
    return json(500, { success: false, error: "Something went wrong" });
  }
});
