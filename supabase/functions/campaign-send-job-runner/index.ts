/**
 * campaign-send-job-runner
 *
 * Cron-invoked. Claims a small batch of queued send-job-items and drives them
 * through `send-campaign-email`, then updates the items + parent jobs.
 *
 * Triggered by pg_cron every 1 minute (verify_jwt = false; bearer is the anon
 * key like other cron functions).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 5;

// Permanent failures that should NOT be retried.
// AUTH_FAILED + UNSUBSCRIBE_KEY_MISSING are configuration errors — retrying
// them is pointless and will hammer the function on every cron tick.
const PERMANENT_CODES = new Set([
  "CAMPAIGN_NOT_ACTIVE",
  "CAMPAIGN_ENDED",
  "CONTACT_UNSUBSCRIBED",
  "CONTACT_SUPPRESSED",
  "INVALID_EMAIL",
  "MISSING_EMAIL",
  "TEMPLATE_NOT_FOUND",
  "DUPLICATE_SEND",
  "AUTH_FAILED",
  "UNSUBSCRIBE_KEY_MISSING",
  "RECIPIENT_REJECTED",
]);

interface Item {
  id: string;
  job_id: string;
  campaign_id: string;
  contact_id: string;
  account_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  body: string;
  attempt_count: number;
  idempotency_key: string | null;
}

interface Job {
  id: string;
  template_id: string | null;
  attachments: Array<{ file_path: string; file_name: string }>;
  reply_to_parent_id: string | null;
  reply_to_thread_id: string | null;
  reply_to_internet_message_id: string | null;
  correlation_id: string | null;
  created_by: string;
}

function backoffMinutes(attempt: number): number {
  // 1, 5, 15, 45 ...
  return Math.min(60, Math.pow(3, attempt - 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Claim a batch of items atomically
    const { data: claimed, error: claimErr } = await admin.rpc("claim_send_job_items", {
      _limit: BATCH_SIZE,
    });
    if (claimErr) {
      console.error("[runner] claim failed", claimErr);
      return new Response(JSON.stringify({ ok: false, error: claimErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const items = (claimed || []) as Item[];
    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, claimed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load jobs referenced
    const jobIds = Array.from(new Set(items.map((i) => i.job_id)));
    const { data: jobs } = await admin
      .from("campaign_send_jobs")
      .select(
        "id,template_id,attachments,reply_to_parent_id,reply_to_thread_id,reply_to_internet_message_id,correlation_id,created_by",
      )
      .in("id", jobIds);
    const jobMap = new Map<string, Job>(((jobs as Job[]) || []).map((j) => [j.id, j]));

    // ── End-date safety net ────────────────────────────────────────────
    // Reject items whose campaign has already ended (covers items that were
    // queued before end_date and only now picked up by the runner).
    // end_date is INCLUSIVE — campaigns end at 23:59:59 UTC of that day.
    const campaignIds = Array.from(new Set(items.map((i) => i.campaign_id)));
    const endedCampaigns = new Set<string>();
    if (campaignIds.length > 0) {
      const { data: campRows } = await admin
        .from("campaigns")
        .select("id, end_date, archived_at")
        .in("id", campaignIds);
      const nowMs = Date.now();
      for (const c of (campRows || []) as Array<{ id: string; end_date: string | null; archived_at: string | null }>) {
        if (c.archived_at) {
          endedCampaigns.add(c.id);
        } else if (c.end_date) {
          const endMs = new Date(`${c.end_date}T23:59:59.999Z`).getTime();
          if (endMs < nowMs) endedCampaigns.add(c.id);
        }
      }
    }

    // ── B2 / P3.3: Recipient-timezone awareness ───────────────────────
    // For each item, look up the contact's region (from its linked account)
    // and skip-and-defer the send if the recipient is outside their local
    // business-hour window. Items are returned to the queue in 30 min
    // increments without consuming a retry attempt.
    const accountIds = Array.from(
      new Set(items.map((i) => i.account_id).filter(Boolean) as string[]),
    );
    const regionByAccount = new Map<string, string | null>();
    if (accountIds.length > 0) {
      const { data: accountRows } = await admin
        .from("accounts")
        .select("id, region")
        .in("id", accountIds);
      for (const row of (accountRows || []) as Array<{ id: string; region: string | null }>) {
        regionByAccount.set(row.id, row.region);
      }
    }

    let processed = 0;
    let failed = 0;
    let deferred = 0;

    for (const it of items) {
      const job = jobMap.get(it.job_id);
      if (!job) {
        await admin
          .from("campaign_send_job_items")
          .update({
            status: "failed",
            last_error_code: "JOB_MISSING",
            last_error_message: "Parent job not found",
          })
          .eq("id", it.id);
        failed++;
        continue;
      }

      // Pre-flight: campaign ended → permanent skip (no retries).
      if (endedCampaigns.has(it.campaign_id)) {
        await admin
          .from("campaign_send_job_items")
          .update({
            status: "skipped",
            last_error_code: "CAMPAIGN_ENDED",
            last_error_message: "Campaign end date has passed.",
          })
          .eq("id", it.id);
        failed++;
        continue;
      }

      // ── TZ-aware deferral ───────────────────────────────────────────
      // If the contact's region resolves to a timezone with a defined
      // business-hours window, and now() is outside that window, push the
      // item back to the queue (defer 30 min) without consuming a retry.
      const region = it.account_id ? regionByAccount.get(it.account_id) ?? null : null;
      if (region) {
        const { data: inHours } = await admin.rpc("is_within_recipient_business_hours", {
          _region: region,
        });
        if (inHours === false) {
          const next = new Date(Date.now() + 30 * 60_000);
          await admin.rpc("release_send_job_item_for_later", {
            _item_id: it.id,
            _next_at: next.toISOString(),
            _reason: "OUTSIDE_BUSINESS_HOURS",
          });
          deferred++;
          continue;
        }
      }

      try {
        // Invoke send-campaign-email with the job creator's identity is not
        // possible from the runner; the function accepts service-role calls
        // with the same payload. We rely on its existing internal checks
        // (suppression, caps, status, idempotency).
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-campaign-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
            "x-impersonate-user": job.created_by,
            "x-correlation-id": job.correlation_id || it.job_id,
          },
          body: JSON.stringify({
            campaign_id: it.campaign_id,
            contact_id: it.contact_id,
            account_id: it.account_id ?? undefined,
            template_id: job.template_id ?? undefined,
            subject: it.subject,
            body: it.body,
            recipient_email: it.recipient_email,
            recipient_name: it.recipient_name ?? "",
            idempotency_key: it.idempotency_key ?? undefined,
            attachments: job.attachments?.length ? job.attachments : undefined,
            ...(job.reply_to_parent_id
              ? {
                  parent_id: job.reply_to_parent_id,
                  thread_id: job.reply_to_thread_id || job.reply_to_parent_id,
                  ...(job.reply_to_internet_message_id
                    ? { parent_internet_message_id: job.reply_to_internet_message_id }
                    : {}),
                }
              : {}),
          }),
        });

        const data = await resp.json().catch(() => ({} as any));

        if (resp.ok && data?.success) {
          await admin
            .from("campaign_send_job_items")
            .update({
              status: "sent",
              communication_id: data.communication_id ?? null,
              last_error_code: null,
              last_error_message: null,
            })
            .eq("id", it.id);
          processed++;
        } else {
          const code: string = data?.errorCode || (resp.status === 429 ? "RATE_LIMITED" : "SEND_FAILED");
          const msg: string = data?.error || `HTTP ${resp.status}`;
          const isPermanent = PERMANENT_CODES.has(code);
          const reachedMax = it.attempt_count >= MAX_ATTEMPTS;

          if (isPermanent || reachedMax) {
            // Terminal: 'skipped' for permanent codes, 'failed' for retry-exhausted.
            await admin
              .from("campaign_send_job_items")
              .update({
                status: isPermanent ? "skipped" : "failed",
                last_error_code: code,
                last_error_message: msg,
                // Push next_attempt far out so even if the claim RPC ever
                // re-included terminal statuses, this row would not be picked.
                next_attempt_at: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(),
              })
              .eq("id", it.id);
          } else {
            const next = new Date(Date.now() + backoffMinutes(it.attempt_count) * 60_000);
            await admin
              .from("campaign_send_job_items")
              .update({
                status: "retrying",
                last_error_code: code,
                last_error_message: msg,
                next_attempt_at: next.toISOString(),
              })
              .eq("id", it.id);
          }
          failed++;
        }
      } catch (e) {
        const msg = (e as Error).message;
        const reachedMax = it.attempt_count >= MAX_ATTEMPTS;
        const next = new Date(Date.now() + backoffMinutes(it.attempt_count) * 60_000);
        await admin
          .from("campaign_send_job_items")
          .update({
            // Terminal failure stays as 'failed' so it stops being claimed;
            // transient exceptions go to 'retrying' so finalize_send_job
            // does not prematurely mark the parent job failed.
            status: reachedMax ? "failed" : "retrying",
            last_error_code: "RUNNER_EXCEPTION",
            last_error_message: msg,
            next_attempt_at: reachedMax
              ? new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString()
              : next.toISOString(),
          })
          .eq("id", it.id);
        failed++;
      }
    }

    // Finalize affected jobs (recompute counters / terminal status)
    for (const jid of jobIds) {
      await admin.rpc("finalize_send_job", { _job_id: jid });
    }

    return new Response(
      JSON.stringify({ ok: true, claimed: items.length, processed, failed, deferred }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[runner] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
