/**
 * enqueue-campaign-send
 *
 * Creates a campaign_send_jobs row + N campaign_send_job_items rows in one
 * call so the browser does not have to loop through `send-campaign-email`
 * for bulk sends. The runner cron picks the items up.
 *
 * Body: {
 *   campaign_id: string;
 *   template_id?: string;
 *   segment_id?: string;
 *   sender_mailbox?: string;
 *   reply_to?: { parent_id: string; thread_id?: string; internet_message_id?: string };
 *   attachments?: { file_path: string; file_name: string }[];
 *   items: Array<{
 *     contact_id: string;
 *     account_id?: string | null;
 *     recipient_email: string;
 *     recipient_name?: string;
 *     subject: string;
 *     body: string;
 *     idempotency_key?: string;
 *   }>;
 * }
 *
 * Returns: { job_id, queued_count }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ItemIn {
  contact_id: string;
  account_id?: string | null;
  recipient_email: string;
  recipient_name?: string;
  subject: string;
  body: string;
  idempotency_key?: string;
}

interface Body {
  campaign_id: string;
  template_id?: string;
  segment_id?: string;
  sender_mailbox?: string;
  reply_to?: { parent_id: string; thread_id?: string; internet_message_id?: string };
  attachments?: Array<{ file_path: string; file_name: string }>;
  items: ItemIn[];
  // ISO-8601. When set in the future, the runner will skip items until this time.
  scheduled_at?: string | null;
  // Defaults to 3 days. Set to 0 to disable the dup-send window check.
  dup_window_days?: number;
}

function bad(status: number, error: string) {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return bad(401, "Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !userData?.user) return bad(401, "Unauthorized");
    const userId = userData.user.id;

    const body = (await req.json()) as Body;
    if (!body?.campaign_id) return bad(400, "campaign_id required");
    if (!Array.isArray(body.items) || body.items.length === 0)
      return bad(400, "items required");

    // Hard cap to protect DB
    const MAX_ITEMS = 1000;
    if (body.items.length > MAX_ITEMS)
      return bad(400, `Too many items (max ${MAX_ITEMS})`);

    // A3 hardening — re-check manage permission server-side via the locked RPC,
    // independent of the RLS check that the userClient insert relies on.
    const { data: canManage, error: pErr } = await userClient.rpc("can_manage_campaign", {
      _campaign_id: body.campaign_id,
    });
    if (pErr || canManage !== true) {
      return bad(403, "You do not have permission to send for this campaign.");
    }

    // ── End-date hard block ────────────────────────────────────────────
    // Reject the entire request if the campaign has already ended or is
    // archived. end_date is treated as INCLUSIVE end-of-day in UTC so EU
    // campaigns ending 2026-04-30 stay open through 2026-04-30 23:59 UTC.
    const { data: campRow, error: campErr } = await userClient
      .from("campaigns")
      .select("end_date, archived_at, status")
      .eq("id", body.campaign_id)
      .single();
    if (campErr || !campRow) return bad(404, "Campaign not found");
    if (campRow.archived_at) return bad(409, "Campaign is archived");
    if (campRow.end_date) {
      const endOfDay = new Date(`${campRow.end_date}T23:59:59.999Z`);
      if (endOfDay.getTime() < Date.now()) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Campaign end date has passed. No new outreach allowed.",
            errorCode: "CAMPAIGN_ENDED",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── A2: server-side duplicate-send window guard ────────────────────
    // Reject any items that already received a successful email in the
    // configured lookback window. This closes the race-condition where two
    // browser tabs both pass the client-only check at the same time.
    const dupWindow = Number.isFinite(body.dup_window_days) ? Math.max(0, Number(body.dup_window_days)) : 3;
    let filteredItems = body.items;
    let skippedDupCount = 0;
    if (dupWindow > 0 && body.items.length > 0) {
      const contactIds = Array.from(new Set(body.items.map((i) => i.contact_id)));
      const { data: recents } = await userClient.rpc("recent_campaign_sends_for_contacts", {
        _campaign_id: body.campaign_id,
        _contact_ids: contactIds,
        _window_days: dupWindow,
      });
      const recentSet = new Set<string>(((recents as any[]) || []).map((r) => r.contact_id));
      if (recentSet.size > 0) {
        filteredItems = body.items.filter((it) => !recentSet.has(it.contact_id));
        skippedDupCount = body.items.length - filteredItems.length;
      }
    }

    // ── Channel coordination: skip contacts that already received a
    // non-Email touch (Call / LinkedIn) today, to avoid same-day overlap.
    // Single batched RPC instead of N round-trips.
    let skippedChannelCount = 0;
    if (filteredItems.length > 0) {
      const ids = Array.from(new Set(filteredItems.map((i) => i.contact_id)));
      const { data: touched } = await userClient.rpc("has_channel_touch_today_batch", {
        _campaign_id: body.campaign_id,
        _contact_ids: ids,
        _exclude_type: "Email",
      });
      const skipSet = new Set<string>(((touched as { contact_id: string }[]) || []).map((r) => r.contact_id));
      if (skipSet.size > 0) {
        const before = filteredItems.length;
        filteredItems = filteredItems.filter((it) => !skipSet.has(it.contact_id));
        skippedChannelCount = before - filteredItems.length;
      }
    }

    if (filteredItems.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `No recipients are eligible right now (duplicates: ${skippedDupCount}, same-day cross-channel: ${skippedChannelCount}).`,
          errorCode: "ALL_INELIGIBLE",
          skipped_duplicates: skippedDupCount,
          skipped_channel_conflict: skippedChannelCount,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use the user's RLS-bound client so policies enforce manage permission.
    const correlationId = crypto.randomUUID();
    const { data: job, error: jobErr } = await userClient
      .from("campaign_send_jobs")
      .insert({
        campaign_id: body.campaign_id,
        created_by: userId,
        template_id: body.template_id ?? null,
        segment_id: body.segment_id ?? null,
        sender_mailbox: body.sender_mailbox ?? null,
        reply_to_parent_id: body.reply_to?.parent_id ?? null,
        reply_to_thread_id: body.reply_to?.thread_id ?? null,
        reply_to_internet_message_id: body.reply_to?.internet_message_id ?? null,
        attachments: body.attachments ?? [],
        status: "queued",
        total_items: filteredItems.length,
        correlation_id: correlationId,
        scheduled_at: body.scheduled_at ?? null,
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      console.error("[enqueue] job insert failed", jobErr);
      return bad(403, jobErr?.message || "Failed to create job");
    }

    const itemRows = filteredItems.map((it) => ({
      job_id: job.id,
      campaign_id: body.campaign_id,
      contact_id: it.contact_id,
      account_id: it.account_id ?? null,
      recipient_email: it.recipient_email,
      recipient_name: it.recipient_name ?? null,
      subject: it.subject,
      body: it.body,
      idempotency_key: it.idempotency_key ?? null,
      status: "queued",
    }));

    // Insert items in chunks of 200 using service role (RLS already validated above)
    const admin = createClient(supabaseUrl, serviceRoleKey);
    for (let i = 0; i < itemRows.length; i += 200) {
      const chunk = itemRows.slice(i, i + 200);
      const { error: itErr } = await admin.from("campaign_send_job_items").insert(chunk);
      if (itErr) {
        console.error("[enqueue] item insert failed", itErr);
        // best-effort: cancel the job so nothing partial runs
        await admin.from("campaign_send_jobs").update({
          status: "failed",
          error_summary: `Item insert failed: ${itErr.message}`,
        }).eq("id", job.id);
        return bad(500, itErr.message);
      }
    }

    // Audit event
    await admin.from("campaign_events").insert({
      campaign_id: body.campaign_id,
      actor_user_id: userId,
      event_type: "send_job_queued",
      to_value: job.id,
      metadata: {
        total_items: filteredItems.length,
        skipped_duplicates: skippedDupCount,
        skipped_channel_conflict: skippedChannelCount,
        scheduled_at: body.scheduled_at ?? null,
        correlation_id: correlationId,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        job_id: job.id,
        queued_count: filteredItems.length,
        skipped_duplicates: skippedDupCount,
        skipped_channel_conflict: skippedChannelCount,
        scheduled_at: body.scheduled_at ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[enqueue] fatal", e);
    return bad(500, (e as Error).message);
  }
});
