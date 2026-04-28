// Dry-run preview for campaign follow-up sequences.
// Mirrors campaign-follow-up-runner's selection logic but does NOT send any
// email, create action items, or write to campaign_communications. Every
// candidate is recorded into campaign_sequence_runs with is_dry_run=true so
// the UI can surface results in the run logs drawer.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  step_type?: string | null;
}

async function logRun(
  supabase: any,
  args: {
    campaignId: string; sequenceId: string; stepNumber: number;
    contactId: string | null; outcome: string; reason?: string | null; detail?: string | null;
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
      is_dry_run: true,
    });
  } catch (err) {
    console.error("[follow-up-dryrun] logRun failed:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Auth: verify caller using their JWT against the user-scoped client.
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const campaignId: string = body?.campaign_id;
    const onlyStepId: string | undefined = body?.step_id;
    if (!campaignId) {
      return new Response(JSON.stringify({ error: "Missing campaign_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Authorization: verify the caller can manage this campaign via RLS.
    const { data: managePeek, error: mErr } = await userClient
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .maybeSingle();
    if (mErr || !managePeek) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Now use service-role for cross-table reads (no RLS needed during sim).
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let stepsQuery = supabase
      .from("campaign_sequences")
      .select("id, campaign_id, step_number, template_id, wait_business_days, condition, is_enabled, target_segment_id, step_type")
      .eq("campaign_id", campaignId)
      .eq("is_enabled", true)
      .order("step_number", { ascending: true });
    if (onlyStepId) stepsQuery = stepsQuery.eq("id", onlyStepId);

    const { data: steps, error: stepsErr } = await stepsQuery;
    if (stepsErr) throw stepsErr;

    let wouldSend = 0;
    let wouldSkip = 0;
    const byReason: Record<string, number> = {};
    const bump = (r: string) => { byReason[r] = (byReason[r] || 0) + 1; };
    const runIds: string[] = [];
    runIds.push(`dryrun-${Date.now()}`);

    for (const step of (steps || []) as SequenceStep[]) {
      const stepType = (step.step_type || "email").toLowerCase();
      const isEmail = stepType === "email";

      if (isEmail && !step.template_id) {
        wouldSkip++; bump('no_template');
        await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: null, outcome: 'skipped', reason: 'no_template' });
        continue;
      }

      const cutoff = businessDaysAgo(step.wait_business_days).toISOString();
      const parentStep = step.step_number - 1;

      const parentQuery = supabase
        .from("campaign_communications")
        .select("id, contact_id, opened_at, conversation_id, sequence_step")
        .eq("campaign_id", campaignId)
        .eq("communication_type", "Email")
        .eq("delivery_status", "sent")
        .lt("communication_date", cutoff);

      const { data: candidates } = parentStep === 0
        ? await parentQuery.or("sequence_step.is.null,sequence_step.eq.0")
        : await parentQuery.eq("sequence_step", parentStep);

      if (!candidates || candidates.length === 0) {
        bump('no_eligible_parent');
        await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: null, outcome: 'skipped', reason: 'no_eligible_parent' });
        continue;
      }

      let allowedContactIds: Set<string> | null = null;
      if (step.target_segment_id) {
        const { data: segContacts } = await supabase
          .rpc("resolve_campaign_segment_contacts", { _segment_id: step.target_segment_id });
        allowedContactIds = new Set((segContacts || []).map((r: any) => r.contact_id));
        if (allowedContactIds.size === 0) {
          bump('segment_empty');
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: null, outcome: 'skipped', reason: 'segment_empty' });
          continue;
        }
      }

      for (const parent of candidates) {
        if (!parent.contact_id) continue;
        if (allowedContactIds && !allowedContactIds.has(parent.contact_id)) {
          wouldSkip++; bump('not_in_segment');
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'not_in_segment' });
          continue;
        }

        const { data: cc } = await supabase
          .from("campaign_contacts")
          .select("stop_sequence")
          .eq("campaign_id", campaignId)
          .eq("contact_id", parent.contact_id)
          .maybeSingle();
        if (cc?.stop_sequence === true) {
          wouldSkip++; bump('stop_sequence');
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'stop_sequence' });
          continue;
        }

        const { count: existing } = await supabase
          .from("campaign_communications")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .eq("contact_id", parent.contact_id)
          .eq("sequence_step", step.step_number);
        if ((existing ?? 0) > 0) {
          wouldSkip++; bump('already_fired');
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'already_fired' });
          continue;
        }

        if (isEmail && step.condition === "no_reply" && parent.conversation_id) {
          const { count: replyCount } = await supabase
            .from("campaign_communications")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", campaignId)
            .eq("conversation_id", parent.conversation_id)
            .in("delivery_status", ["received", "manual"]);
          if ((replyCount ?? 0) > 0) {
            wouldSkip++; bump('replied');
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'replied' });
            continue;
          }
        } else if (isEmail && step.condition === "no_open" && parent.opened_at) {
          wouldSkip++; bump('opened');
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'opened' });
          continue;
        }

        const { data: contact } = await supabase
          .from("contacts")
          .select("email")
          .eq("id", parent.contact_id)
          .maybeSingle();
        if (isEmail && !contact?.email) {
          wouldSkip++; bump('no_email');
          await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'no_email' });
          continue;
        }

        if (isEmail && contact?.email) {
          const { data: isSuppressed } = await supabase.rpc("is_email_suppressed", { _email: contact.email, _campaign_id: campaignId });
          if (isSuppressed === true) {
            wouldSkip++; bump('suppressed');
            await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'skipped', reason: 'suppressed' });
            continue;
          }
        }

        wouldSend++;
        await logRun(supabase, { campaignId, sequenceId: step.id, stepNumber: step.step_number, contactId: parent.contact_id, outcome: 'dry_run_match', reason: stepType });
      }
    }

    return new Response(
      JSON.stringify({ success: true, wouldSend, wouldSkip, byReason, runIds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[follow-up-dryrun] error:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});