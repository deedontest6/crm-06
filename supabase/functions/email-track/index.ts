import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// 1×1 transparent PNG
const PIXEL = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
), c => c.charCodeAt(0));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const pixelHeaders = {
  ...corsHeaders,
  "Content-Type": "image/png",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

function pixelResponse() {
  return new Response(PIXEL, { status: 200, headers: pixelHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const tracking = url.searchParams.get("t");
    if (!tracking) return pixelResponse();

    // Validate UUID shape
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tracking)) {
      return pixelResponse();
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: existing } = await supabase
      .from("campaign_communications")
      .select("id, opened_at, open_count")
      .eq("tracking_id", tracking)
      .maybeSingle();

    if (existing) {
      const now = new Date().toISOString();
      await supabase
        .from("campaign_communications")
        .update({
          opened_at: existing.opened_at ?? now,
          last_opened_at: now,
          open_count: (existing.open_count ?? 0) + 1,
        })
        .eq("id", existing.id);
    }
  } catch (err) {
    console.error("email-track error:", err);
  }

  return pixelResponse();
});
