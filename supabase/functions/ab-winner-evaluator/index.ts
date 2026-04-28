import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_SENT_PER_VARIANT = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CAMPAIGN_CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Refresh aggregate counters from comms first
    const { data: variants } = await supabase
      .from("campaign_email_variants")
      .select("id, template_id, variant_label, sent_count, open_count, click_count, reply_count, is_winner");

    if (!variants || variants.length === 0) {
      return new Response(JSON.stringify({ success: true, evaluated: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by template
    const byTemplate = new Map<string, typeof variants>();
    for (const v of variants) {
      const arr = byTemplate.get(v.template_id) || [];
      arr.push(v);
      byTemplate.set(v.template_id, arr);
    }

    let winnersPicked = 0;
    for (const [templateId, vs] of byTemplate) {
      if (vs.some(v => v.is_winner)) continue;
      if (vs.length < 2) continue;
      if (vs.some(v => (v.sent_count ?? 0) < MIN_SENT_PER_VARIANT)) continue;

      const score = (v: typeof vs[0]) =>
        (v.open_count ?? 0) + 2 * (v.click_count ?? 0) + 5 * (v.reply_count ?? 0);

      const winner = vs.reduce((best, cur) => (score(cur) > score(best) ? cur : best));

      const { error } = await supabase
        .from("campaign_email_variants")
        .update({ is_winner: true })
        .eq("id", winner.id);

      if (!error) winnersPicked++;
    }

    return new Response(JSON.stringify({ success: true, evaluated: byTemplate.size, winnersPicked }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ab-winner-evaluator error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
