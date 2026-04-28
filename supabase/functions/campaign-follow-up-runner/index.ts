import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAzureEmailConfig, getGraphAccessToken, sendEmailViaGraph } from "../_shared/azure-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Subtract N business days (Mon–Fri only) from "now"
function businessDaysAgo(n: number): Date {
  const d = new Date();
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

interface SequenceStep {
  id: string;
  campaign_id: string;
  step_number: number;
  template_id: string | null;
  wait_business_days: number;
  condition: string;
  is_enabled: boolean;
  target_segment_id: string | null;
  created_by: string | null;
  // E12: 'email' | 'linkedin' | 'call'
  step_type?: string | null;
}

interface LegacyRule {
  id: string;
  campaign_id: string;
  template_id: string | null;
  wait_business_days: number;
  max_attempts: number;
  is_enabled: boolean;
  created_by: string;
}

function splitName(full?: string | null): { first: string; last: string } {
  if (!full) return { first: "", last: "" };
  const parts = String(full).trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.length > 1 ? parts.slice(1).join(" ") : "" };
}

function pat(name: string) {
  return new RegExp(`\\{\\s*${name}\\s*\\}`, "gi");
}

function substitute(text: string, ctx: {
  contact_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  position?: string | null;
  region?: string | null;
  country?: string | null;
  owner_name?: string | null;
}): string {
  if (!text) return text;
  const { first, last } = splitName(ctx.contact_name);
  return text
    .replace(pat("contact_name"), ctx.contact_name || "")
    .replace(pat("first_name"), first)
    .replace(pat("last_name"), last)
    .replace(pat("company_name"), ctx.company_name || "")
    .replace(pat("position"), ctx.position || "")
    .replace(pat("email"), ctx.email || "")
    .replace(pat("region"), ctx.region || "")
    .replace(pat("country"), ctx.country || "")
    .replace(pat("owner_name"), ctx.owner_name || "");
}

// escapeHtml + ensureHtmlBody live in `_shared/email-render.ts` so manual
// compose and automated follow-ups produce identical HTML.
import { ensureHtmlBody } from "../_shared/email-render.ts";

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Gate one campaign on its archive/end/status. Returns true if outreach
// should be skipped, after also flipping Active→Completed inline when the
// end_date has elapsed.
async function isCampaignBlocked(
  supabase: any,
  campaignId: string,
): Promise<{ blocked: boolean; ownerId: string | null; reason?: string }> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, status, start_date, end_date, archived_at, owner")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return { blocked: true, ownerId: null, reason: "campaign_not_found" };

  const today = new Date().toISOString().slice(0, 10);
  const notStarted = !!campaign.start_date && campaign.start_date > today;
  const ended = !!campaign.end_date && campaign.end_date < today;
  if (campaign.archived_at) return { blocked: true, ownerId: campaign.owner, reason: "archived" };
  if (notStarted) return { blocked: true, ownerId: campaign.owner, reason: "not_started" };
  if (campaign.status !== "Active") {
    return { blocked: true, ownerId: campaign.owner, reason: "campaign_not_active" };
  }
  if (ended) {
    // A2: Use the locked RPC so we don't race the send function or cron.
    await supabase.rpc("auto_complete_campaign", { _campaign_id: campaign.id });
    return { blocked: true, ownerId: campaign.owner, reason: "ended" };
  }

  // A9: Honor campaign timing windows so sequences don't fire on
  // holidays / blackout dates that manual sends are blocked from.
  const { data: inWindow } = await supabase.rpc("is_within_timing_window", {
    _campaign_id: campaignId,
  });
  if (inWindow === false) {
    return { blocked: true, ownerId: campaign.owner, reason: "outside_timing_window" };
  }

  return { blocked: false, ownerId: campaign.owner };
}

async function getOwnerName(supabase: any, ownerId: string | null): Promise<string> {
  if (!ownerId) return "";
  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", ownerId)
    .maybeSingle();
  return (prof as any)?.full_name || "";
}

// Append a row to campaign_sequence_runs. Best-effort: never blocks the loop.
async function logRun(
  supabase: any,
  args: {
    campaignId: string;
    sequenceId: string;
    stepNumber: number;
    contactId: string | null;
    outcome: 'sent' | 'failed' | 'skipped' | 'action_item_created' | 'dry_run_match';
    reason?: string | null;
    detail?: string | null;
    communicationId?: string | null;
    isDryRun?: boolean;
  },
) {
  try {
    await supabase.from("campaign_sequence_runs").insert({
      campaign_id: args.campaignId,
      sequence_id: args.sequenceId,
      step_number: args.stepNumber,
      contact_id: args.contactId,
      outcome: args.outcome,
      reason: args.reason ?? null,
      detail: args.detail ?? null,
      communication_id: args.communicationId ?? null,
      is_dry_run: !!args.isDryRun,
    });
  } catch (err) {
    console.error("[follow-up-runner] logRun failed:", err);
  }
}

// Common per-recipient gating used by both sequence + legacy rule paths.
// Returns true when sending should be skipped.
async function shouldSkipRecipient(
  supabase: any,
  contactEmail: string,
  campaignId: string,
  ownerId: string | null,
  azureSender: string,
): Promise<{ skip: boolean; reason?: string }> {
  const { data: isSuppressed } = await supabase.rpc("is_email_suppressed", { _email: contactEmail, _campaign_id: campaignId });
  if (isSuppressed === true) return { skip: true, reason: "suppressed" };

  // Send-cap check using campaign owner as the "sender" (automation).
  if (ownerId) {
    const { data: capCheck } = await supabase.rpc("check_send_cap", {
      _campaign_id: campaignId,
      _sender_user_id: ownerId,
      _mailbox_email: azureSender,
    });
    if (capCheck && capCheck.allowed === false) {
      return { skip: true, reason: `cap:${capCheck.scope}` };
    }
  }
  return { skip: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron auth: only accept calls bearing the shared vault secret.
  const expectedCronSecret = Deno.env.get("CAMPAIGN_CRON_SECRET");
  if (expectedCronSecret) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expectedCronSecret) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const azureConfig = getAzureEmailConfig();
    if (!azureConfig) {
      return new Response(
        JSON.stringify({ success: false, error: "Email not configured (Azure secrets missing)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const accessToken = await getGraphAccessToken(azureConfig);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    // ── 1) PROCESS SEQUENCES (primary path) ─────────────────────────
    const { data: steps, error: stepsErr } = await supabase
      .from("campaign_sequences")
      .select("id, campaign_id, step_number, template_id, wait_business_days, condition, is_enabled, target_segment_id, created_by, step_type")
      .eq("is_enabled", true)
      .order("campaign_id", { ascending: true })
      .order("step_number", { ascending: true });
    if (stepsErr) throw stepsErr;

    // Group by campaign so we only resolve campaign / segment metadata once.
    const stepsByCampaign = new Map<string, SequenceStep[]>();
    for (const s of (steps || []) as SequenceStep[]) {
      const arr = stepsByCampaign.get(s.campaign_id) || [];
      arr.push(s);
      stepsByCampaign.set(s.campaign_id, arr);
    }

    for (const [campaignId, campaignSteps] of stepsByCampaign) {
      const { blocked, ownerId, reason } = await isCampaignBlocked(supabase, campaignId);
      if (blocked) {
        console.log(`Skipping campaign ${campaignId} sequence steps: ${reason || "blocked"}`);
        skipped += campaignSteps.length;
        continue;
      }
      const ownerName = await getOwnerName(supabase, ownerId);

      for (const step of campaignSteps) {
        const stepType = (step.step_type || "email").toLowerCase();
        const isEmail = stepType === "email";

        // E12: non-email steps don't need a template — they create an action_item
        // for the rep instead of sending. Email steps still require a template.
        if (isEmail && !step.template_id) {
          skipped++;
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: null, outcome: 'skipped', reason: 'no_template' });
          continue;
        }

        const { data: template } = isEmail
          ? await supabase
              .from("campaign_email_templates")
              .select("subject, body")
              .eq("id", step.template_id)
              .maybeSingle()
          : { data: null as any };
        if (isEmail && !template) {
          skipped++;
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: null, outcome: 'skipped', reason: 'template_missing' });
          continue;
        }

        // Determine the "parent" set for this step. Step 1 fires off the
        // initial outreach (sequence_step=0 OR null). Step N fires off the
        // most recent N-1 comm for the same contact.
        const cutoff = businessDaysAgo(step.wait_business_days).toISOString();
        const parentStep = step.step_number - 1;

        const parentQuery = supabase
          .from("campaign_communications")
          .select("id, contact_id, account_id, subject, body, conversation_id, internet_message_id, opened_at, sequence_step, communication_date")
          .eq("campaign_id", campaignId)
          .eq("communication_type", "Email")
          .eq("delivery_status", "sent")
          .lt("communication_date", cutoff);

        const { data: candidates } = parentStep === 0
          ? await parentQuery.or("sequence_step.is.null,sequence_step.eq.0")
          : await parentQuery.eq("sequence_step", parentStep);

        if (!candidates || candidates.length === 0) {
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: null, outcome: 'skipped', reason: 'no_eligible_parent' });
          continue;
        }

        // Optional segment filter: only contacts inside the segment.
        let allowedContactIds: Set<string> | null = null;
        if (step.target_segment_id) {
          const { data: segContacts } = await supabase
            .rpc("resolve_campaign_segment_contacts", { _segment_id: step.target_segment_id });
          allowedContactIds = new Set((segContacts || []).map((r: any) => r.contact_id));
          if (allowedContactIds.size === 0) {
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: null, outcome: 'skipped', reason: 'segment_empty' });
            continue;
          }
        }

        for (const parent of candidates) {
          if (!parent.contact_id) continue;
          if (allowedContactIds && !allowedContactIds.has(parent.contact_id)) {
            skipped++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'not_in_segment' });
            continue;
          }

          // A7: per-contact stop flag (rep manually halted automation).
          {
            const { data: cc } = await supabase
              .from("campaign_contacts")
              .select("stop_sequence")
              .eq("campaign_id", campaignId)
              .eq("contact_id", parent.contact_id)
              .maybeSingle();
            if (cc?.stop_sequence === true) {
              skipped++;
              await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'stop_sequence' });
              continue;
            }
          }

          // Idempotency: skip if a step-N comm already exists for this contact.
          const { count: existing } = await supabase
            .from("campaign_communications")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaignId)
            .eq("contact_id", parent.contact_id)
            .eq("sequence_step", step.step_number);
          if ((existing ?? 0) > 0) {
            skipped++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'already_fired' });
            continue;
          }

          // Cross-channel conflict guard (24h): don't touch a contact who was
          // already reached on a DIFFERENT channel within 24 hours. Applies to
          // both email and non-email steps to keep cadences polite.
          {
            const channel = isEmail ? "Email" : (stepType === "linkedin" ? "LinkedIn" : "Call");
            const { data: hasConflict } = await supabase.rpc("should_skip_for_channel_conflict", {
              _campaign_id: campaignId,
              _contact_id: parent.contact_id,
              _channel: channel,
              _hours: 24,
            });
            if (hasConflict === true) {
              skipped++;
              await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'channel_conflict_24h' });
              continue;
            }
          }

          // E12: non-email step — create an action item for the rep instead of sending.
          if (!isEmail) {
            // Resolve contact name for the task title.
            const { data: contactRow } = await supabase
              .from("contacts")
              .select("contact_name")
              .eq("id", parent.contact_id)
              .maybeSingle();
            const contactLabel = contactRow?.contact_name || "contact";
            const channelLabel = stepType === "linkedin" ? "LinkedIn message" : "phone call";
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 1);
            const { error: aiErr } = await supabase.from("action_items").insert({
              title: `Sequence step ${step.step_number}: send ${channelLabel} to ${contactLabel}`,
              description: `Auto-created by sequence step ${step.step_number} (${stepType}). Contact: ${contactLabel}. Parent email subject: ${parent.subject || "(none)"}.`,
              module_type: "campaigns",
              module_id: campaignId,
              status: "Open",
              priority: "Medium",
              due_date: dueDate.toISOString().slice(0, 10),
              assigned_to: ownerId,
              created_by: step.created_by || ownerId,
            });
            if (aiErr) {
              console.error("[follow-up-runner] action_item insert failed:", aiErr);
              failed++;
              await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'failed', reason: 'action_item_insert_failed', detail: String(aiErr?.message || aiErr).slice(0, 300) });
              continue;
            }
            // Stub comm row so step-N idempotency check finds it next tick.
            const { data: stubRow } = await supabase.from("campaign_communications").insert({
              campaign_id: campaignId,
              contact_id: parent.contact_id,
              account_id: parent.account_id,
              communication_type: stepType === "linkedin" ? "LinkedIn" : "Call",
              delivery_status: "manual",
              sequence_step: step.step_number,
              follow_up_parent_id: parent.id,
              follow_up_attempt: (parent.sequence_step ?? 0) + 1,
              owner: step.created_by,
              created_by: step.created_by,
              communication_date: new Date().toISOString(),
              sent_via: "sequence_runner",
              notes: `Auto step ${step.step_number} (${stepType}) — action item created for rep to perform manually.`,
            }).select("id").maybeSingle();
            sent++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'action_item_created', reason: stepType, communicationId: (stubRow as any)?.id ?? null });
            continue;
          }

          // Condition gating
          if (step.condition === "no_reply") {
            if (parent.conversation_id) {
              // A7: count ANY non-outbound row in the conversation as a reply,
              // including manual log-call/log-LinkedIn entries the rep made.
              const { count: replyCount } = await supabase
                .from("campaign_communications")
                .select("id", { count: "exact", head: true })
                .eq("campaign_id", campaignId)
                .eq("conversation_id", parent.conversation_id)
                .in("delivery_status", ["received", "manual"]);
              if ((replyCount ?? 0) > 0) {
                skipped++;
                await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'replied' });
                continue;
              }
            }
          } else if (step.condition === "no_open") {
            if (parent.opened_at) {
              skipped++;
              await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'opened' });
              continue;
            }
          }
          // 'always' has no extra gate

          // Resolve recipient
          const { data: contact } = await supabase
            .from("contacts")
            .select("email, contact_name, company_name, position, region")
            .eq("id", parent.contact_id)
            .maybeSingle();
          if (!contact?.email) {
            skipped++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'no_email' });
            continue;
          }

          const gate = await shouldSkipRecipient(supabase, contact.email, campaignId, ownerId, azureConfig.senderEmail);
          if (gate.skip) {
            skipped++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: gate.reason || 'gate' });
            continue;
          }

          let accountCountry = "";
          if (parent.account_id) {
            const { data: acct } = await supabase
              .from("accounts")
              .select("country")
              .eq("id", parent.account_id)
              .maybeSingle();
            accountCountry = (acct as any)?.country || "";
          }

          const ctx = {
            contact_name: contact.contact_name,
            email: contact.email,
            company_name: contact.company_name,
            position: contact.position,
            region: contact.region,
            country: accountCountry,
            owner_name: ownerName,
          };

          const subject = substitute(template.subject || `Following up: ${parent.subject || ""}`, ctx);
          const bodyText = substitute(template.body || "", ctx);
          const htmlBody = ensureHtmlBody(bodyText);
          const sendRequestId = await sha256Hex(`${campaignId}|${parent.contact_id}|sequence|${step.id}|${step.step_number}`);

          const { count: duplicateRequest } = await supabase
            .from("campaign_communications")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaignId)
            .eq("send_request_id", sendRequestId)
            .neq("delivery_status", "failed");
          if ((duplicateRequest ?? 0) > 0) {
            skipped++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'duplicate_request' });
            continue;
          }

          const result = await sendEmailViaGraph(
            accessToken,
            azureConfig.senderEmail,
            contact.email,
            contact.contact_name || contact.email,
            subject,
            htmlBody,
            undefined,
            undefined,
            parent.internet_message_id || undefined,
          );

          const baseRow = {
            campaign_id: campaignId,
            contact_id: parent.contact_id,
            account_id: parent.account_id,
            communication_type: "Email",
            subject,
            body: bodyText,
            template_id: step.template_id,
            conversation_id: result.conversationId || parent.conversation_id,
            internet_message_id: result.internetMessageId || null,
            graph_message_id: result.graphMessageId || null,
            follow_up_parent_id: parent.id,
            follow_up_attempt: (parent.sequence_step ?? 0) + 1,
            sequence_step: step.step_number,
            send_request_id: sendRequestId,
            owner: step.created_by,
            created_by: step.created_by,
            communication_date: new Date().toISOString(),
            sent_via: "sequence_runner",
            notes: `Auto step ${step.step_number} via sequence ${step.id} (waited ${step.wait_business_days} business days, condition=${step.condition}).`,
          };

          if (result.success) {
            const { data: sentRow } = await supabase.from("campaign_communications").insert({
              ...baseRow,
              email_status: "Sent",
              delivery_status: "sent",
            }).select("id").maybeSingle();
            // Cap ledger row (automation also counts toward owner's cap).
            if (ownerId) {
              const { error: sendLogError } = await supabase.from("campaign_send_log").insert({
                campaign_id: campaignId,
                contact_id: parent.contact_id,
                sender_user_id: ownerId,
                mailbox_email: azureConfig.senderEmail.toLowerCase(),
                send_request_id: sendRequestId,
                correlation_id: sendRequestId,
              });
              if (sendLogError) console.error(`[follow-up-runner] sequence correlation=${sendRequestId} send-log insert failed:`, sendLogError);
            }
            sent++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'sent', communicationId: (sentRow as any)?.id ?? null });
          } else {
            const { data: failedRow } = await supabase.from("campaign_communications").insert({
              ...baseRow,
              email_status: "Failed",
              delivery_status: "failed",
              notes: `${baseRow.notes} Send failed: ${result.error?.slice(0, 500) || result.errorCode || "unknown"}`,
            }).select("id").maybeSingle();
            failed++;
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'failed', reason: result.errorCode || 'send_failed', detail: (result.error || '').slice(0, 300), communicationId: (failedRow as any)?.id ?? null });
          }
        }
      }
    }

    // ── 2) LEGACY RULE PATH (only fires for rules that haven't been
    //       back-filled into sequences yet — Phase B migration disables
    //       all rules at apply time, so this branch is effectively a
    //       safety net for any rule a user re-enables after migration). ──
    const { data: rules } = await supabase
      .from("campaign_follow_up_rules")
      .select("id, campaign_id, template_id, wait_business_days, max_attempts, is_enabled, created_by")
      .eq("is_enabled", true);

    for (const rule of (rules || []) as LegacyRule[]) {
      if (!rule.template_id) { skipped++; continue; }

      // If a sequence already exists for the same template+wait, skip the
      // rule outright — sequences own this cadence now.
      const { count: dup } = await supabase
        .from("campaign_sequences")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", rule.campaign_id)
        .eq("template_id", rule.template_id)
        .eq("wait_business_days", rule.wait_business_days);
      if ((dup ?? 0) > 0) { skipped++; continue; }

      const { blocked, ownerId, reason } = await isCampaignBlocked(supabase, rule.campaign_id);
      if (blocked) {
        console.log(`Skipping campaign ${rule.campaign_id} legacy rule ${rule.id}: ${reason || "blocked"}`);
        skipped++;
        continue;
      }
      const ownerName = await getOwnerName(supabase, ownerId);

      const cutoff = businessDaysAgo(rule.wait_business_days).toISOString();
      const { data: parents } = await supabase
        .from("campaign_communications")
        .select("id, contact_id, account_id, subject, body, conversation_id, internet_message_id, follow_up_attempt")
        .eq("campaign_id", rule.campaign_id)
        .eq("communication_type", "Email")
        .eq("delivery_status", "sent")
        .lt("communication_date", cutoff)
        .lt("follow_up_attempt", rule.max_attempts);
      if (!parents || parents.length === 0) continue;

      const { data: template } = await supabase
        .from("campaign_email_templates")
        .select("subject, body")
        .eq("id", rule.template_id)
        .maybeSingle();
      if (!template) { skipped++; continue; }

      for (const parent of parents) {
        if (!parent.contact_id) continue;

        // A7: per-contact stop flag for legacy rule path too.
        {
          const { data: cc } = await supabase
            .from("campaign_contacts")
            .select("stop_sequence")
            .eq("campaign_id", rule.campaign_id)
            .eq("contact_id", parent.contact_id)
            .maybeSingle();
          if (cc?.stop_sequence === true) { skipped++; continue; }
        }

        if (parent.conversation_id) {
          const { count: replyCount } = await supabase
            .from("campaign_communications")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", rule.campaign_id)
            .eq("conversation_id", parent.conversation_id)
            .in("delivery_status", ["received", "manual"]);
          if ((replyCount ?? 0) > 0) { skipped++; continue; }
        }

        const { count: existing } = await supabase
          .from("campaign_communications")
          .select("id", { count: "exact", head: true })
          .eq("follow_up_parent_id", parent.id);
        if ((existing ?? 0) > 0) { skipped++; continue; }

        const { data: contact } = await supabase
          .from("contacts")
          .select("email, contact_name, company_name, position, region")
          .eq("id", parent.contact_id)
          .maybeSingle();
        if (!contact?.email) { skipped++; continue; }

        const gate = await shouldSkipRecipient(supabase, contact.email, rule.campaign_id, ownerId, azureConfig.senderEmail);
        if (gate.skip) { skipped++; continue; }

        let accountCountry = "";
        if (parent.account_id) {
          const { data: acct } = await supabase
            .from("accounts")
            .select("country")
            .eq("id", parent.account_id)
            .maybeSingle();
          accountCountry = (acct as any)?.country || "";
        }

        const ctx = {
          contact_name: contact.contact_name,
          email: contact.email,
          company_name: contact.company_name,
          position: contact.position,
          region: contact.region,
          country: accountCountry,
          owner_name: ownerName,
        };
        const subject = substitute(template.subject || `Following up: ${parent.subject || ""}`, ctx);
        const bodyText = substitute(template.body || "", ctx);
        const htmlBody = ensureHtmlBody(bodyText);
        const sendRequestId = await sha256Hex(`${rule.campaign_id}|${parent.contact_id}|legacy|${rule.id}|${(parent.follow_up_attempt || 0) + 1}`);

        const { count: duplicateRequest } = await supabase
          .from("campaign_communications")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", rule.campaign_id)
          .eq("send_request_id", sendRequestId)
          .neq("delivery_status", "failed");
        if ((duplicateRequest ?? 0) > 0) { skipped++; continue; }

        const result = await sendEmailViaGraph(
          accessToken,
          azureConfig.senderEmail,
          contact.email,
          contact.contact_name || contact.email,
          subject,
          htmlBody,
          undefined,
          undefined,
          parent.internet_message_id || undefined,
        );

        const baseRow = {
          campaign_id: rule.campaign_id,
          contact_id: parent.contact_id,
          account_id: parent.account_id,
          communication_type: "Email",
          subject,
          body: bodyText,
          template_id: rule.template_id,
          conversation_id: result.conversationId || parent.conversation_id,
          internet_message_id: result.internetMessageId || null,
          graph_message_id: result.graphMessageId || null,
          follow_up_parent_id: parent.id,
          follow_up_attempt: (parent.follow_up_attempt || 0) + 1,
          send_request_id: sendRequestId,
          owner: rule.created_by,
          created_by: rule.created_by,
          communication_date: new Date().toISOString(),
          sent_via: "follow_up_automation",
          notes: `Auto follow-up by legacy rule ${rule.id} (waited ${rule.wait_business_days} business days, no reply).`,
        };

        if (result.success) {
          await supabase.from("campaign_communications").insert({
            ...baseRow,
            email_status: "Sent",
            delivery_status: "sent",
          });
          await supabase
            .from("campaign_communications")
            .update({ follow_up_attempt: (parent.follow_up_attempt || 0) + 1 })
            .eq("id", parent.id);
          if (ownerId) {
            const { error: sendLogError } = await supabase.from("campaign_send_log").insert({
              campaign_id: rule.campaign_id,
              contact_id: parent.contact_id,
              sender_user_id: ownerId,
              mailbox_email: azureConfig.senderEmail.toLowerCase(),
              send_request_id: sendRequestId,
              correlation_id: sendRequestId,
            });
            if (sendLogError) console.error(`[follow-up-runner] legacy correlation=${sendRequestId} send-log insert failed:`, sendLogError);
          }
          sent++;
        } else {
          await supabase.from("campaign_communications").insert({
            ...baseRow,
            email_status: "Failed",
            delivery_status: "failed",
            notes: `${baseRow.notes} Send failed: ${result.error?.slice(0, 500) || result.errorCode || "unknown"}`,
          });
          failed++;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        failed,
        skipped,
        sequence_steps_processed: (steps || []).length,
        legacy_rules_processed: (rules || []).length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("campaign-follow-up-runner error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
