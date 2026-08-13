import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Desks that track a club's fixture list. */
const DESKS: Record<string, { club: string; feedSlug: string; competition: string }> = {
  mcfc: { club: "Man City", feedSlug: "man-city", competition: "Premier League" },
};

interface FeedRow {
  MatchNumber: number;
  RoundNumber: number | null;
  DateUtc: string;
  Location: string | null;
  HomeTeam: string;
  AwayTeam: string;
}

/** Seasons run Aug to May: before July, we are still in last year's season. */
const seasonStartYear = (now: Date) =>
  now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

const seasonLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

const parseFeedDate = (value: string) => {
  // Feed format is "2026-08-23 13:00:00Z"; make it strictly ISO before parsing
  const iso = value.trim().replace(" ", "T");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const sanitize = (str: string) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const formatUk = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();

    // The scheduled job calls with the service role key; a desk user can also
    // trigger a manual refresh of their own desk
    let desksToSync = Object.keys(DESKS);
    if (token !== serviceKey) {
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (userError || !userData?.user) {
        return json(401, { success: false, error: "Sign in required" });
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("status, corporate")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (!profile || profile.status !== "active" || !profile.corporate) {
        return json(403, { success: false, error: "No corporate desk access" });
      }
      if (!DESKS[profile.corporate]) {
        return json(400, { success: false, error: "This desk does not track fixtures" });
      }
      desksToSync = [profile.corporate];
    }

    const startYear = seasonStartYear(new Date());
    const season = seasonLabel(startYear);
    const results: Record<string, unknown>[] = [];

    for (const corporate of desksToSync) {
      const desk = DESKS[corporate];
      const feedUrl = `https://fixturedownload.com/feed/json/epl-${startYear}/${desk.feedSlug}`;

      let rows: FeedRow[] = [];
      try {
        const feedRes = await fetch(feedUrl, { headers: { Accept: "application/json" } });
        if (!feedRes.ok) {
          console.error("Fixture feed HTTP", feedRes.status, feedUrl);
          results.push({ corporate, error: `Feed returned HTTP ${feedRes.status}` });
          continue;
        }
        const parsed = await feedRes.json();
        rows = Array.isArray(parsed) ? parsed : [];
      } catch (feedErr) {
        console.error("Fixture feed failed:", feedErr);
        results.push({ corporate, error: "Could not reach the fixture feed" });
        continue;
      }

      if (rows.length === 0) {
        results.push({ corporate, error: "Feed returned no fixtures" });
        continue;
      }

      const { data: existingRows } = await supabase
        .from("fixtures")
        .select("id, match_number, kickoff_utc, venue, opponent, is_home, round_number")
        .eq("corporate", corporate)
        .eq("season", season)
        .eq("competition", desk.competition);
      const existing = new Map(
        (existingRows ?? []).map((r) => [r.match_number as number, r])
      );

      const changes: { fixture_id: string; corporate: string; field: string; old_value: string; new_value: string }[] = [];
      const changeSummaries: string[] = [];
      let added = 0;

      for (const row of rows) {
        const kickoff = parseFeedDate(row.DateUtc);
        if (!kickoff || typeof row.MatchNumber !== "number") continue;
        const isHome = row.HomeTeam === desk.club;
        const opponent = isHome ? row.AwayTeam : row.HomeTeam;
        const venue = (row.Location ?? "").trim();

        const values = {
          corporate,
          club: desk.club,
          competition: desk.competition,
          season,
          match_number: row.MatchNumber,
          round_number: row.RoundNumber,
          kickoff_utc: kickoff,
          home_team: row.HomeTeam,
          away_team: row.AwayTeam,
          opponent,
          is_home: isHome,
          venue,
          last_synced_at: new Date().toISOString(),
        };

        const prior = existing.get(row.MatchNumber);
        if (!prior) {
          const { data: inserted, error: insertError } = await supabase
            .from("fixtures")
            .insert(values)
            .select("id")
            .single();
          if (insertError) {
            console.error("Fixture insert failed:", insertError);
            continue;
          }
          added += 1;
          if (inserted?.id) {
            // A brand new fixture on an established list is worth flagging
            if ((existingRows?.length ?? 0) > 0) {
              changes.push({
                fixture_id: inserted.id,
                corporate,
                field: "added",
                old_value: "",
                new_value: `${row.HomeTeam} v ${row.AwayTeam}, ${formatUk(kickoff)}`,
              });
              changeSummaries.push(
                `ADDED: ${row.HomeTeam} v ${row.AwayTeam}, ${formatUk(kickoff)}`
              );
            }
          }
          continue;
        }

        const priorKickoff = new Date(prior.kickoff_utc as string).toISOString();
        if (priorKickoff !== kickoff) {
          changes.push({
            fixture_id: prior.id as string,
            corporate,
            field: "kickoff",
            old_value: priorKickoff,
            new_value: kickoff,
          });
          changeSummaries.push(
            `MOVED: ${row.HomeTeam} v ${row.AwayTeam}, was ${formatUk(priorKickoff)}, now ${formatUk(kickoff)}`
          );
        }
        if ((prior.venue as string) !== venue) {
          changes.push({
            fixture_id: prior.id as string,
            corporate,
            field: "venue",
            old_value: (prior.venue as string) ?? "",
            new_value: venue,
          });
          changeSummaries.push(
            `VENUE: ${row.HomeTeam} v ${row.AwayTeam}, was ${prior.venue || "unset"}, now ${venue || "unset"}`
          );
        }

        const { error: updateError } = await supabase
          .from("fixtures")
          .update(values)
          .eq("id", prior.id as string);
        if (updateError) console.error("Fixture update failed:", updateError);
      }

      if (changes.length > 0) {
        const { error: changeError } = await supabase.from("fixture_changes").insert(changes);
        if (changeError) console.error("Fixture change log failed:", changeError);
      }

      results.push({
        corporate,
        season,
        fixtures: rows.length,
        added,
        changed: changeSummaries.length,
      });

      // Tell the ops team when a fixture moves: cars are already booked around
      // these kickoffs
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (RESEND_API_KEY && changeSummaries.length > 0 && (existingRows?.length ?? 0) > 0) {
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
              subject: `${corporate.toUpperCase()} fixture changes: ${changeSummaries.length} update(s)`,
              html: `
                <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e0d5c4; padding: 40px;">
                  <h1 style="font-size: 20px; font-weight: 300; letter-spacing: 0.1em; border-bottom: 1px solid #2a2a2a; padding-bottom: 20px; color: #b89b5e;">
                    ${corporate.toUpperCase()} fixture changes
                  </h1>
                  <p style="color: #8a8070; font-size: 13px;">The published schedule changed. Check any cars already booked around these dates.</p>
                  <ul style="font-size: 13px; line-height: 1.9;">
                    ${changeSummaries.map((s) => `<li>${sanitize(s)}</li>`).join("")}
                  </ul>
                </div>
              `,
            }),
          });
        } catch (emailErr) {
          console.error("Fixture change email failed (non-blocking):", emailErr);
        }
      }
    }

    return json(200, { success: true, results });
  } catch (error) {
    console.error("fixtures-sync error:", error);
    return json(500, { success: false, error: "An error occurred syncing fixtures." });
  }
});
