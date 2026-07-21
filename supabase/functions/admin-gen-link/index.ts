import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: "jamesacton007@gmail.com",
    options: { redirectTo: "https://apexiavip.com/reset-password" },
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ link: data.properties?.action_link }), {
    headers: { "content-type": "application/json" },
  });
});
