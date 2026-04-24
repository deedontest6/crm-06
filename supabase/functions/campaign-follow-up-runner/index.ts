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

interface Rule {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ensureHtmlBody(body: string): string {
  if (/<(p|div|br|table|ul|ol|h[1-6]|blockquote|section|article)\b/i.test(body)) return body;
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map((block) => `<p style="margin:0 0 1em 0; line-height:1.5;">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    const { data: rules, error: rulesErr } = await supabase
      .from("campaign_follow_up_rules")
      .select("id, campaign_id, template_id, wait_business_days, max_attempts, is_enabled, created_by")
      .eq("is_enabled", true);
    if (rulesErr) throw rulesErr;

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const rule of (rules || []) as Rule[]) {
      if (!rule.template_id) { skipped++; continue; }

      // Skip the whole rule if the campaign is paused / completed / archived / past end_date
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("id, status, end_date, archived_at, owner")
        .eq("id", rule.campaign_id)
        .maybeSingle();
      if (!campaign) { skipped++; continue; }
      const today = new Date().toISOString().slice(0, 10);
      const ended = !!campaign.end_date && campaign.end_date < today;
      if (campaign.archived_at || ended || campaign.status === "Paused" || campaign.status === "Completed") {
        skipped++;
        continue;
      }

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

      // Resolve owner display name once per rule (for {owner_name})
      let ownerName = "";
      if (campaign.owner) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", campaign.owner)
          .maybeSingle();
        ownerName = (prof as any)?.full_name || "";
      }

      for (const parent of parents) {
        if (!parent.contact_id) continue;

        // Race-safe: re-check for any inbound reply right before sending
        if (parent.conversation_id) {
          const { count: replyCount } = await supabase
            .from("campaign_communications")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", rule.campaign_id)
            .eq("conversation_id", parent.conversation_id)
            .eq("delivery_status", "received");
          if ((replyCount ?? 0) > 0) { skipped++; continue; }
        }

        // Skip if a follow-up already exists for this parent
        const { count: existing } = await supabase
          .from("campaign_communications")
          .select("id", { count: "exact", head: true })
          .eq("follow_up_parent_id", parent.id);
        if ((existing ?? 0) > 0) { skipped++; continue; }

        // Resolve recipient + account country for {country}
        const { data: contact } = await supabase
          .from("contacts")
          .select("email, contact_name, company_name, position, region")
          .eq("id", parent.contact_id)
          .maybeSingle();
        if (!contact?.email) { skipped++; continue; }

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
          owner: rule.created_by,
          created_by: rule.created_by,
          communication_date: new Date().toISOString(),
          sent_via: "follow_up_automation",
          notes: `Auto follow-up by rule ${rule.id} (waited ${rule.wait_business_days} business days, no reply).`,
        };

        if (result.success) {
          await supabase.from("campaign_communications").insert({
            ...baseRow,
            email_status: "Sent",
            delivery_status: "sent",
          });
          // Bump parent attempt counter
          await supabase
            .from("campaign_communications")
            .update({ follow_up_attempt: (parent.follow_up_attempt || 0) + 1 })
            .eq("id", parent.id);
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
      JSON.stringify({ success: true, sent, failed, skipped, rules_processed: (rules || []).length }),
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
