import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

serve(async () => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/functions/v1/booking-watch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: "{}",
  });
  const text = await res.text();
  return new Response(
    JSON.stringify({ status: res.status, body: text }),
    { headers: { "Content-Type": "application/json" } },
  );
});
