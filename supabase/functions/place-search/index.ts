import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_SEARCHES_PER_HOUR = 300;
const MAX_RESULTS = 6;
// Bias results toward the home patch; national and international still work
const BIAS_LAT = 53.4808;
const BIAS_LON = -2.2426;

interface Suggestion {
  label: string;
  line1: string;
  line2: string;
  town: string;
  postcode: string;
  country: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UK_POSTCODE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/;

const countryName = (code: string | undefined, fallback: string) => {
  if (!code) return fallback;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? fallback;
  } catch {
    return fallback;
  }
};

/** Full UK postcode: authoritative lookup via postcodes.io (ONS data) */
const searchPostcode = async (query: string): Promise<Suggestion[]> => {
  const res = await fetch(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(query.replace(/\s/g, ""))}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const r = data?.result;
  if (!r) return [];
  const town = r.post_town || r.admin_district || "";
  return [
    {
      label: `${r.postcode} · ${town}`,
      line1: "",
      line2: "",
      town,
      postcode: r.postcode,
      country: "United Kingdom",
    },
  ];
};

/** Places, landmarks and street addresses via Photon (OpenStreetMap) */
const searchPhoton = async (query: string): Promise<Suggestion[]> => {
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}` +
    `&limit=${MAX_RESULTS}&lang=en&lat=${BIAS_LAT}&lon=${BIAS_LON}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();

  const suggestions: Suggestion[] = [];
  for (const feature of data?.features ?? []) {
    const p = feature?.properties ?? {};
    const road = [p.housenumber, p.street].filter(Boolean).join(" ");
    const isPoi = !!p.name && p.name !== p.street && p.name !== p.city;
    const line1 = isPoi ? p.name : road || p.name || "";
    if (!line1) continue;
    const line2 = isPoi ? road : "";
    const town = p.city || p.town || p.village || p.district || p.county || "";
    const suggestion: Suggestion = {
      label: [line1, line2, town, p.postcode].filter(Boolean).join(", "),
      line1,
      line2,
      town,
      postcode: p.postcode || "",
      country: p.countrycode === "GB" ? "United Kingdom" : countryName(p.countrycode, p.country || ""),
    };
    if (!suggestions.some((s) => s.label === suggestion.label)) {
      suggestions.push(suggestion);
    }
  }
  // Home market first
  suggestions.sort((a, b) =>
    a.country === b.country ? 0 : a.country === "United Kingdom" ? -1 : 1
  );
  return suggestions.slice(0, MAX_RESULTS);
};

/** Google Places (Text Search, New) when a key is configured: best-in-class results */
const searchGoogle = async (query: string, apiKey: string): Promise<Suggestion[]> => {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.addressComponents",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "GB", maxResultCount: MAX_RESULTS }),
  });
  if (!res.ok) {
    console.error("Google Places error:", res.status, await res.text());
    return [];
  }
  const data = await res.json();

  const suggestions: Suggestion[] = [];
  for (const place of data?.places ?? []) {
    const comp = (type: string) =>
      place.addressComponents?.find((c: { types?: string[] }) => c.types?.includes(type))
        ?.longText ?? "";
    const name = place.displayName?.text ?? "";
    const road = [comp("street_number"), comp("route")].filter(Boolean).join(" ");
    const isPoi = !!name && name !== road;
    const line1 = isPoi ? name : road || name;
    if (!line1) continue;
    const town = comp("postal_town") || comp("locality") || comp("administrative_area_level_2");
    const suggestion: Suggestion = {
      label: place.formattedAddress ? `${name ? name + ", " : ""}${place.formattedAddress}` : name,
      line1,
      line2: isPoi ? road : "",
      town,
      postcode: comp("postal_code"),
      country: comp("country") || "United Kingdom",
    };
    if (!suggestions.some((s) => s.label === suggestion.label)) {
      suggestions.push(suggestion);
    }
  }
  return suggestions;
};

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

    // Members only, to keep the lookup from being an open public endpoint
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json(401, { error: "Not authenticated" });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) return json(401, { error: "Not authenticated" });

    const body = await req.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 120) return json(200, { suggestions: [] });

    // Rate limit per member
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", userData.user.id)
      .eq("endpoint", "place-search")
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= MAX_SEARCHES_PER_HOUR) {
      return json(429, { error: "Too many searches. Please try again shortly." });
    }
    await admin.from("rate_limits").insert({ ip_address: userData.user.id, endpoint: "place-search" });

    const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
    let suggestions: Suggestion[];
    if (UK_POSTCODE.test(query)) {
      suggestions = await searchPostcode(query);
      if (suggestions.length === 0) {
        suggestions = GOOGLE_MAPS_API_KEY
          ? await searchGoogle(query, GOOGLE_MAPS_API_KEY)
          : await searchPhoton(query);
      }
    } else if (GOOGLE_MAPS_API_KEY) {
      suggestions = await searchGoogle(query, GOOGLE_MAPS_API_KEY);
    } else {
      suggestions = await searchPhoton(query);
    }

    return json(200, { suggestions });
  } catch (error) {
    console.error("place-search error:", error);
    return json(500, { error: "An error occurred processing your request." });
  }
});
