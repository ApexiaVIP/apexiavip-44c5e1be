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

/**
 * Where a competition's fixtures come from.
 *
 * The league and the European competitions are published as proper fixture
 * lists. The domestic cups are not published anywhere as a club fixture list,
 * because the draw is made round by round, so those are read from the club's
 * own calendar, where each tie is tagged with its competition.
 */
type Source =
  | { kind: "feed"; slug: string }
  | { kind: "calendar"; tag: string };

interface Competition {
  /** As stored and shown to the desk */
  name: string;
  source: Source;
}

export interface Desk {
  /** The club as the fixture feed names it, and as we store it */
  club: string;
  feedSlug: string;
  /** The club's calendar, covering every competition it plays in */
  calendarUrl: string;
  /** The club as that calendar names it, which is usually the longer form */
  calendarClub: string;
  /** Where a home tie is played, since the calendar carries no venue */
  homeVenue: string;
  competitions: Competition[];
}

/**
 * Desks that track a club's fixture list. A club plays in more than one
 * competition and the desk books cars for all of them, so following the
 * league alone left European nights and cup ties out of the schedule.
 */
const DESKS: Record<string, Desk> = {
  mcfc: {
    club: "Man City",
    feedSlug: "man-city",
    calendarUrl: "https://ics.fixtur.es/v2/manchester-city.ics",
    calendarClub: "Manchester City",
    homeVenue: "Etihad Stadium",
    competitions: [
      { name: "Premier League", source: { kind: "feed", slug: "epl" } },
      { name: "Champions League", source: { kind: "feed", slug: "champions-league" } },
      { name: "Carabao Cup", source: { kind: "calendar", tag: "LC" } },
      { name: "FA Cup", source: { kind: "calendar", tag: "FA" } },
    ],
  },
};

/**
 * A stable number for a tie the calendar gives no number for.
 *
 * Taken from the competition and the two clubs rather than the calendar's own
 * id or the date: the calendar sometimes carries two entries for one tie, and
 * a tie that is moved must keep its number so the move is seen as a change
 * rather than as a second fixture. Two clubs meeting twice in one cup are a
 * two legged tie, which swaps who is at home, so they stay distinct.
 */
export const numberForTie = (identity: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0) || 1;
};

/** Turn a club calendar into the same shape a fixture feed gives us. */
export const calendarRows = (
  ics: string,
  tag: string,
  desk: Desk,
  seasonFrom: Date,
  seasonTo: Date
): FeedRow[] => {
  // Long values are folded onto continuation lines, so put them back first
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const rows: FeedRow[] = [];
  const seen = new Set<number>();

  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const field = (name: string) =>
      (new RegExp(`^${name}[^:\\n]*:(.*)$`, "m").exec(block)?.[1] ?? "").trim();

    const summary = field("SUMMARY");
    if (!new RegExp(`\\[${tag}\\]`).test(summary)) continue;

    const start = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/.exec(field("DTSTART"));
    if (!start) continue;
    const [, y, mo, d, h, mi, sec] = start;
    const kickoff = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`);
    if (Number.isNaN(kickoff.getTime())) continue;
    if (kickoff < seasonFrom || kickoff >= seasonTo) continue;

    // "Home - Away [LC] (2-1)" once played, "Home - Away [LC]" before
    const teams = summary
      .replace(/\s*\[[A-Za-z0-9 ]+\]\s*/g, " ")
      .replace(/\s*\(\d+\s*-\s*\d+\)\s*$/, "")
      .trim();
    const parts = teams.split(" - ");
    if (parts.length !== 2) continue;
    const asOurs = (name: string) =>
      name.trim() === desk.calendarClub ? desk.club : name.trim();
    const home = asOurs(parts[0]);
    const away = asOurs(parts[1]);
    if (home !== desk.club && away !== desk.club) continue;

    const matchNumber = numberForTie(`${tag}|${home}|${away}`);
    // The calendar sometimes keeps a second copy of a tie once it has been
    // played; both describe the same fixture, so the first one wins
    if (seen.has(matchNumber)) continue;
    seen.add(matchNumber);

    rows.push({
      MatchNumber: matchNumber,
      RoundNumber: null,
      DateUtc: kickoff.toISOString(),
      Location: home === desk.club ? desk.homeVenue : "",
      HomeTeam: home,
      AwayTeam: away,
    });
  }
  return rows;
};

export interface FeedRow {
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
      // A season runs August to August, which bounds the club calendar
      const seasonFrom = new Date(Date.UTC(startYear, 7, 1));
      const seasonTo = new Date(Date.UTC(startYear + 1, 7, 1));
      // The calendar covers every competition, so it is fetched once and then
      // read by each competition that needs it
      let calendar: string | null = null;
      let calendarFailed = false;

      // Every competition the club plays in, each from wherever it is published
      for (const competition of desk.competitions) {
        let rows: FeedRow[] = [];

        if (competition.source.kind === "feed") {
          const feedUrl = `https://fixturedownload.com/feed/json/${competition.source.slug}-${startYear}/${desk.feedSlug}`;
          try {
            const feedRes = await fetch(feedUrl, { headers: { Accept: "application/json" } });
            if (!feedRes.ok) {
              console.error("Fixture feed HTTP", feedRes.status, feedUrl);
              results.push({ corporate, competition: competition.name, error: `Feed returned HTTP ${feedRes.status}` });
              continue;
            }
            const parsed = await feedRes.json();
            rows = Array.isArray(parsed) ? parsed : [];
          } catch (feedErr) {
            console.error("Fixture feed failed:", feedErr);
            results.push({ corporate, competition: competition.name, error: "Could not reach the fixture feed" });
            continue;
          }
        } else {
          if (calendar === null && !calendarFailed) {
            try {
              const calRes = await fetch(desk.calendarUrl, { headers: { Accept: "text/calendar" } });
              if (calRes.ok) calendar = await calRes.text();
              else {
                calendarFailed = true;
                console.error("Club calendar HTTP", calRes.status, desk.calendarUrl);
              }
            } catch (calErr) {
              calendarFailed = true;
              console.error("Club calendar failed:", calErr);
            }
          }
          if (!calendar) {
            results.push({ corporate, competition: competition.name, error: "Could not reach the club calendar" });
            continue;
          }
          rows = calendarRows(calendar, competition.source.tag, desk, seasonFrom, seasonTo);
        }

        if (rows.length === 0) {
          // A cup with no ties yet is the normal state before the draw, not a
          // fault, so it is reported as such and nothing is touched
          results.push({
            corporate,
            competition: competition.name,
            fixtures: 0,
            note:
              competition.source.kind === "calendar"
                ? "Not drawn yet"
                : "The feed returned no fixtures",
          });
          continue;
        }

        const { data: existingRows } = await supabase
          .from("fixtures")
          .select("id, match_number, kickoff_utc, venue, opponent, is_home, round_number")
          .eq("corporate", corporate)
          .eq("season", season)
          .eq("competition", competition.name);
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
            competition: competition.name,
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
          competition: competition.name,
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
                subject: `${corporate.toUpperCase()} ${competition.name} changes: ${changeSummaries.length} update(s)`,
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
    }

    return json(200, { success: true, results });
  } catch (error) {
    console.error("fixtures-sync error:", error);
    return json(500, { success: false, error: "An error occurred syncing fixtures." });
  }
});
