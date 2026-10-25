import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_SEARCHES_PER_HOUR = 300;
const MAX_RESULTS = 6;
/**
 * How many doors a postcode may offer.
 *
 * A postcode holds a few dozen addresses, and the point of typing one is to
 * scroll the list and pick yours, so this is not the six of a text search.
 */
const MAX_ADDRESSES = 60;
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
  /** Distance from the home patch, used only for ordering */
  miles?: number;
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

/** TOWN as Royal Mail writes it, back into the way an address is read. */
const titleCase = (s: string) =>
  s.replace(/\w[\w']*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

const addressFrom = (
  line1: string,
  line2: string,
  town: string,
  postcode: string
): Suggestion | null => {
  if (!line1) return null;
  return {
    label: [line1, line2, town, postcode].filter(Boolean).join(", "),
    line1,
    line2,
    town,
    postcode,
    country: "United Kingdom",
  };
};

/**
 * Every address at a full postcode, so the member picks their door.
 *
 * This is the "find my address" list every UK checkout has, and it can only
 * come from Royal Mail's address file, which is licensed. So it asks
 * whichever provider has been set up and says nothing if neither has: the
 * postcode itself still resolves below, and the address is typed by hand as
 * it was before.
 *
 * Either key is enough. Both are a single GET and neither is billed when no
 * postcode is looked up.
 */
const addressesAtPostcode = async (postcode: string): Promise<Suggestion[]> => {
  const tidy = postcode.replace(/\s+/g, " ").toUpperCase().trim();
  const found: Suggestion[] = [];
  try {
    const getAddressKey = Deno.env.get("GETADDRESS_API_KEY");
    if (getAddressKey) {
      const res = await fetch(
        `https://api.getaddress.io/find/${encodeURIComponent(tidy)}` +
          `?api-key=${encodeURIComponent(getAddressKey)}&expand=true&sort=true`
      );
      if (res.ok) {
        const data = await res.json();
        for (const a of data?.addresses ?? []) {
          const line1 = [a.line_1, a.line_2].filter(Boolean).join(", ");
          const line2 = [a.line_3, a.line_4].filter(Boolean).join(", ");
          const one = addressFrom(line1, line2, a.town_or_city ?? "", tidy);
          if (one) found.push(one);
        }
      } else {
        console.error("getAddress error:", res.status, await res.text());
      }
    }
  } catch (err) {
    console.error("getAddress failed:", err);
  }
  if (found.length > 0) return found.slice(0, MAX_ADDRESSES);

  try {
    const idealKey = Deno.env.get("IDEAL_POSTCODES_API_KEY");
    if (idealKey) {
      const res = await fetch(
        `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(tidy)}` +
          `?api_key=${encodeURIComponent(idealKey)}`
      );
      if (res.ok) {
        const data = await res.json();
        for (const a of data?.result ?? []) {
          const line1 = [a.line_1, a.line_2].filter(Boolean).join(", ");
          const one = addressFrom(line1, a.line_3 ?? "", titleCase(a.post_town ?? ""), tidy);
          if (one) found.push(one);
        }
      } else {
        console.error("Ideal Postcodes error:", res.status, await res.text());
      }
    }
  } catch (err) {
    console.error("Ideal Postcodes failed:", err);
  }
  return found.slice(0, MAX_ADDRESSES);
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
      label: `${r.postcode} · ${town} · use the postcode only`,
      line1: "",
      line2: "",
      town,
      postcode: r.postcode,
      country: "United Kingdom",
    },
  ];
};

/** Roughly how far a result is from the home patch, for ordering. */
const milesFromHome = (lat: number, lon: number): number => {
  const dLat = (lat - BIAS_LAT) * 69;
  const dLon = (lon - BIAS_LON) * 69 * Math.cos((BIAS_LAT * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

/** One pass at Photon, which matches on the words given and nothing else. */
const photonOnce = async (query: string): Promise<Suggestion[]> => {
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
      miles: Array.isArray(feature?.geometry?.coordinates)
        ? milesFromHome(feature.geometry.coordinates[1], feature.geometry.coordinates[0])
        : undefined,
    };
    if (!suggestions.some((s) => s.label === suggestion.label)) {
      suggestions.push(suggestion);
    }
  }
  // Nearest first, home market above everywhere else. Someone in Manchester
  // searching for a restaurant means the Manchester one, not the London one
  // that happens to share its name.
  suggestions.sort((a, b) => {
    if (a.country !== b.country) return a.country === "United Kingdom" ? -1 : 1;
    return (a.miles ?? 1e9) - (b.miles ?? 1e9);
  });
  return suggestions.slice(0, MAX_RESULTS);
};

/**
 * Photon matches on every word it is given, so a query with a district or a
 * city tacked on, which is exactly how people type a restaurant, finds
 * nothing at all rather than finding the place and ignoring the extra. Each
 * trailing word is dropped in turn until something comes back.
 */
const searchPhoton = async (query: string): Promise<Suggestion[]> => {
  const words = query.trim().split(/\s+/);
  for (let keep = words.length; keep >= 2; keep--) {
    const found = await photonOnce(words.slice(0, keep).join(" "));
    if (found.length > 0) return found;
  }
  return words.length === 1 ? photonOnce(query) : [];
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
      /*
       * A postcode is a request for a list to pick from, not for one row.
       *
       * Returning only the postcode centroid, which is what this used to do,
       * left a member who typed their postcode with an address that had no
       * building in it and no hint that they now had to type one. So: the
       * doors at that postcode first, then the named places the map knows
       * there, and the bare postcode last for anyone who wants only that.
       */
      const [doors, centroid] = await Promise.all([
        addressesAtPostcode(query),
        searchPostcode(query),
      ]);
      const places =
        doors.length > 0
          ? []
          : GOOGLE_MAPS_API_KEY
            ? await searchGoogle(query, GOOGLE_MAPS_API_KEY)
            : await searchPhoton(query);
      suggestions = [];
      for (const s of [...doors, ...places, ...centroid]) {
        if (!suggestions.some((seen) => seen.label === s.label)) suggestions.push(s);
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
