import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAzureEmailConfig, getGraphAccessToken, sendEmailViaGraph } from "../_shared/azure-email.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EmailRequest {
  campaign_id: string;
  contact_id: string;
  account_id?: string;
  template_id?: string;
  subject: string;
  body: string;
  recipient_email: string;
  recipient_name: string;
  parent_id?: string;
  thread_id?: string;
  parent_internet_message_id?: string;
}

/**
 * Convert plain text body to HTML-safe body.
 * If the body already contains HTML tags, leave it as-is.
 * Otherwise, convert newlines to <br> tags.
 */
function ensureHtmlBody(body: string): string {
  if (/<[a-z][\s\S]*>/i.test(body)) {
    return body;
  }
  return body.replace(/\n/g, '<br>');
}

async function resolveSenderEmail(supabaseClient: any, user: { id: string; email?: string | null }) {
  const { data: profile } = await supabaseClient
    .from("profiles")
    .select('full_name, "Email ID"')
    .eq("id", user.id)
    .maybeSingle();

  const profileEmail = profile?.["Email ID"]?.trim();
  const authEmail = user.email?.trim();

  return profileEmail || authEmail || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("MY_SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload: EmailRequest = await req.json();
    if (!payload.subject || !payload.body || !payload.recipient_email) {
      return new Response(JSON.stringify({ error: "Missing required fields: subject, body, recipient_email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const azureConfig = getAzureEmailConfig();
    if (!azureConfig) {
      console.error("Azure email credentials not configured");
      return new Response(JSON.stringify({
        success: false,
        error: "Email sending is not configured. Please ask your administrator to set up Azure email credentials.",
        errorCode: "NOT_CONFIGURED",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const senderEmail = await resolveSenderEmail(supabaseClient, user);
    if (!senderEmail) {
      return new Response(JSON.stringify({
        success: false,
        error: "Your user email is not configured. Please update your profile email before sending campaign emails.",
        errorCode: "USER_EMAIL_NOT_CONFIGURED",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mailboxEmail = azureConfig.senderEmail;
    console.log(`Sending campaign email from user mailbox: ${senderEmail} (shared mailbox configured: ${mailboxEmail})`);

    let accessToken: string;
    try {
      accessToken = await getGraphAccessToken(azureConfig);
    } catch (err) {
      const errMsg = (err as Error).message;
      console.error("Failed to get Azure access token:", errMsg);

      await supabaseClient.from("campaign_communications").insert({
        campaign_id: payload.campaign_id,
        contact_id: payload.contact_id,
        account_id: payload.account_id || null,
        communication_type: "Email",
        subject: payload.subject,
        body: payload.body,
        email_status: "Failed",
        delivery_status: "failed",
        sent_via: "azure",
        template_id: payload.template_id || null,
        thread_id: payload.thread_id || null,
        parent_id: payload.parent_id || null,
        owner: user.id,
        created_by: user.id,
        notes: `Azure token error: ${errMsg}`,
        communication_date: new Date().toISOString(),
      });

      await supabaseClient.from("email_history").insert({
        subject: payload.subject,
        body: payload.body,
        recipient_email: payload.recipient_email,
        recipient_name: payload.recipient_name,
        sender_email: senderEmail,
        sent_by: user.id,
        contact_id: payload.contact_id,
        account_id: payload.account_id || null,
        status: "failed",
        sent_at: new Date().toISOString(),
      });

      return new Response(JSON.stringify({
        success: false,
        error: `Failed to authenticate with email provider: ${errMsg}`,
        errorCode: "AUTH_FAILED",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If this is a reply, look up the parent's internet_message_id for threading
    let replyToInternetMessageId: string | undefined;
    let fallbackConversationId: string | null = null;
    if (payload.parent_id) {
      // Use explicitly passed parent_internet_message_id first
      if (payload.parent_internet_message_id) {
        replyToInternetMessageId = payload.parent_internet_message_id;
      }

      const { data: parentComm } = await supabaseClient
        .from("campaign_communications")
        .select("internet_message_id, conversation_id")
        .eq("id", payload.parent_id)
        .single();

      if (!replyToInternetMessageId && parentComm?.internet_message_id) {
          replyToInternetMessageId = parentComm.internet_message_id;
      }

      if (parentComm?.conversation_id) {
        fallbackConversationId = parentComm.conversation_id;
      }
    }

    const htmlBody = ensureHtmlBody(payload.body);

    const result = await sendEmailViaGraph(
      accessToken,
      mailboxEmail,
      payload.recipient_email,
      payload.recipient_name,
      payload.subject,
      htmlBody,
      senderEmail,
      replyToInternetMessageId,
    );

    const deliveryStatus = result.success ? "sent" : "failed";
    const messageId = result.internetMessageId || crypto.randomUUID();
    const threadId = payload.thread_id || payload.parent_id || null;
    const parentId = payload.parent_id || null;
    const conversationId = result.conversationId || fallbackConversationId;
    const actualSender = senderEmail;

    const { data: commRecord, error: commError } = await supabaseClient
      .from("campaign_communications")
      .insert({
        campaign_id: payload.campaign_id,
        contact_id: payload.contact_id,
        account_id: payload.account_id || null,
        communication_type: "Email",
        subject: payload.subject,
        body: payload.body,
        email_status: result.success ? "Sent" : "Failed",
        delivery_status: deliveryStatus,
        sent_via: "azure",
        template_id: payload.template_id || null,
        message_id: messageId,
        thread_id: threadId,
        parent_id: parentId,
        graph_message_id: result.graphMessageId || null,
        internet_message_id: result.internetMessageId || null,
        conversation_id: conversationId,
        owner: user.id,
        created_by: user.id,
        notes: result.error ? `Send error: ${result.error.substring(0, 500)}` : null,
        communication_date: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (commError) {
      console.error("Communication log error:", commError);
    }

    await supabaseClient.from("email_history").insert({
      subject: payload.subject,
      body: payload.body,
      recipient_email: payload.recipient_email,
      recipient_name: payload.recipient_name,
      sender_email: actualSender,
      sent_by: user.id,
      contact_id: payload.contact_id,
      account_id: payload.account_id || null,
      status: deliveryStatus,
      sent_at: new Date().toISOString(),
      internet_message_id: result.internetMessageId || null,
    });

    return new Response(
      JSON.stringify({
        success: result.success,
        delivery_status: deliveryStatus,
        communication_id: commRecord?.id,
        message_id: messageId,
        conversation_id: conversationId,
        sent_as: actualSender,
        error: result.error || undefined,
        errorCode: result.errorCode || undefined,
      }),
      {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: String(err), errorCode: "UNEXPECTED" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
