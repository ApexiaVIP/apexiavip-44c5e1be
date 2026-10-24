import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * A chauffeur asks for a route when they set off and again when the traffic
 * ahead of them changes, so a long job through town is a few dozen. This caps
 * a phone that has got itself into a loop before it costs anything.
 */
const MAX_ROUTES_PER_HOUR = 150;

/** Google will not answer for ever, and a chauffeur is sat at a kerb waiting. */
const GIVE_UP_MS = 8000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Point {
  lat: number;
  lng: number;
}

const point = (raw: unknown): Point | null => {
  const p = raw as { lat?: unknown; lng?: unknown } | null;
  if (typeof p?.lat !== "number" || typeof p?.lng !== "number") return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return null;
  return { lat: p.lat, lng: p.lng };
};

const withTimeout = (url: string, init: RequestInit) => {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), GIVE_UP_MS);
  return fetch(url, { ...init, signal: stop.signal }).finally(() => clearTimeout(timer));
};

/**
 * Google Routes, which is the one that knows what the traffic is doing.
 *
 * The destination goes as the address where we have one, because Google puts
 * a car at the door rather than at the middle of the postcode. The heading is
 * sent so that a route starting on a dual carriageway sets off the way the
 * car is already pointing instead of opening with a U-turn.
 */
const askGoogle = async (
  from: Point,
  to: Point,
  address: string,
  heading: number | null,
  key: string
): Promise<unknown> => {
  const res = await withTimeout("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": [
        "routes.duration",
        "routes.distanceMeters",
        "routes.legs.steps.navigationInstruction",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.staticDuration",
        "routes.legs.steps.polyline.encodedPolyline",
      ].join(","),
    },
    body: JSON.stringify({
      origin: {
        location: {
          latLng: { latitude: from.lat, longitude: from.lng },
          ...(heading !== null ? { heading: Math.round(heading) } : {}),
        },
      },
      destination: address
        ? { address }
        : { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      languageCode: "en-GB",
      regionCode: "GB",
      units: "IMPERIAL",
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`routes ${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = await res.json();
  if (!body?.routes?.length) throw new Error("routes returned no route");
  return body;
};

/**
 * An open router, for when Google will not answer.
 *
 * It knows the road network but nothing about the traffic on it, so what it
 * sends back is marked as such and the screen stops promising an arrival
 * time it cannot stand behind.
 */
const askOpenRouter = async (from: Point, to: Point): Promise<unknown> => {
  const path = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const res = await withTimeout(
    `https://router.project-osrm.org/route/v1/driving/${path}` +
      `?overview=false&steps=true&geometries=geojson&annotations=false`,
    { method: "GET" }
  );
  if (!res.ok) throw new Error(`open router ${res.status}`);
  const body = await res.json();
  if (!body?.routes?.length) throw new Error("open router returned no route");
  return body;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return json(401, { error: "Not authenticated" });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json(401, { error: "Not authenticated" });
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const from = point(body?.from);
    const to = point(body?.to);
    if (!from || !to) return json(400, { error: "A route needs both ends" });
    const address = typeof body?.address === "string" ? body.address.slice(0, 200) : "";
    const heading =
      typeof body?.heading === "number" && Number.isFinite(body.heading)
        ? ((body.heading % 360) + 360) % 360
        : null;

    const sinceAnHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", userId)
      .eq("endpoint", "route")
      .gte("created_at", sinceAnHourAgo);
    if ((count ?? 0) >= MAX_ROUTES_PER_HOUR) {
      return json(429, { error: "Too many routes. Use Waze for this one." });
    }
    await admin.from("rate_limits").insert({ ip_address: userId, endpoint: "route" });

    const key = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
    if (key) {
      try {
        return json(200, {
          provider: "google",
          withTraffic: true,
          route: await askGoogle(from, to, address, heading, key),
        });
      } catch (err) {
        // Most likely the Routes API is not switched on for this key yet. The
        // chauffeur still gets a route, it just does not know the traffic.
        console.error("route: google unavailable, falling back:", err);
      }
    }

    return json(200, {
      provider: "open",
      withTraffic: false,
      route: await askOpenRouter(from, to),
    });
  } catch (error) {
    console.error("route error:", error);
    return json(502, { error: "Could not work out a route" });
  }
});
