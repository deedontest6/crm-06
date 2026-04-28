import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Classify a reply email body into one of:
 *   positive | negative | neutral | auto-reply | meeting-requested
 * Persists `reply_intent` on the campaign_communications row.
 *
 * Body: { communication_id: uuid }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI Gateway not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { communication_id } = await req.json();
    if (!communication_id) {
      return new Response(JSON.stringify({ error: "communication_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: row, error } = await supabase
      .from("campaign_communications")
      .select("id, subject, body, reply_intent")
      .eq("id", communication_id)
      .maybeSingle();

    if (error || !row) {
      return new Response(JSON.stringify({ error: "Communication not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (row.reply_intent) {
      return new Response(JSON.stringify({ intent: row.reply_intent, cached: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You classify outbound-sales reply emails. Categories:
- positive: interested, wants to learn more, asks questions
- negative: not interested, hard no, unsubscribe
- neutral: ambiguous, "circle back later", "send info"
- auto-reply: out-of-office, vacation, no-reply bot
- meeting-requested: explicitly asks to schedule, gives availability

Subject: ${row.subject || "(no subject)"}
Body:
${(row.body || "").slice(0, 2000)}

Respond ONLY with one of: positive | negative | neutral | auto-reply | meeting-requested`;

    const aiRes = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 16,
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited", retryAfter: 60 }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("AI error:", aiRes.status, txt);
      return new Response(JSON.stringify({ error: "AI request failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const raw = (aiJson.choices?.[0]?.message?.content || "").toLowerCase().trim();
    const allowed = ["positive", "negative", "neutral", "auto-reply", "meeting-requested"];
    const intent = allowed.find((c) => raw.includes(c)) || "neutral";

    await supabase
      .from("campaign_communications")
      .update({ reply_intent: intent })
      .eq("id", communication_id);

    return new Response(JSON.stringify({ intent }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("classify-reply-intent error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});