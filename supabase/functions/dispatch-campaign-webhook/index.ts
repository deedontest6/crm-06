// supabase/functions/dispatch-campaign-webhook/index.ts
//
// Receives a payload from a Postgres trigger (via pg_net) describing a
// campaign event, looks up matching enabled webhooks (campaign-scoped or
// global), and POSTs the payload to each target URL with optional HMAC.
//
// Records every attempt in `campaign_webhook_deliveries`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DispatchBody {
  event_type: string;        // 'sent' | 'replied' | 'bounced' | 'opened' ...
  campaign_id: string | null;
  payload: Record<string, unknown>;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: DispatchBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!body.event_type) {
    return new Response(JSON.stringify({ error: "event_type required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Match: webhook is enabled, subscribed to event_type, and either
  // campaign-scoped to the same campaign or global (campaign_id is NULL).
  const { data: hooks, error } = await supabase
    .from("campaign_webhooks")
    .select("id, target_url, secret, events, campaign_id, failure_count")
    .eq("is_enabled", true)
    .contains("events", [body.event_type])
    .or(body.campaign_id ? `campaign_id.is.null,campaign_id.eq.${body.campaign_id}` : "campaign_id.is.null");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results = await Promise.all((hooks || []).map(async (hook) => {
    const fullPayload = JSON.stringify({
      event: body.event_type,
      campaign_id: body.campaign_id,
      timestamp: new Date().toISOString(),
      data: body.payload,
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (hook.secret) {
      const sig = await hmacSha256Hex(hook.secret, fullPayload);
      headers["X-Webhook-Signature"] = `sha256=${sig}`;
    }

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let err: string | null = null;
    try {
      const res = await fetch(hook.target_url, {
        method: "POST",
        headers,
        body: fullPayload,
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = res.status;
      responseBody = (await res.text()).slice(0, 1000);
    } catch (e) {
      err = String(e).slice(0, 500);
    }

    const isOk = statusCode !== null && statusCode >= 200 && statusCode < 300;

    // Record delivery
    await supabase.from("campaign_webhook_deliveries").insert({
      webhook_id: hook.id,
      event_type: body.event_type,
      payload: body.payload,
      status_code: statusCode,
      response_body: responseBody,
      error: err,
    });

    // Update webhook stats
    await supabase.from("campaign_webhooks").update({
      last_delivery_at: new Date().toISOString(),
      last_status: statusCode ? String(statusCode) : (err ? "error" : "unknown"),
      failure_count: isOk ? 0 : (hook.failure_count || 0) + 1,
    }).eq("id", hook.id);

    return { id: hook.id, ok: isOk, status: statusCode };
  }));

  return new Response(JSON.stringify({ dispatched: results.length, results }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
