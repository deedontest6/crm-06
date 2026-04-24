import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { findSentMessageGraphId, getAzureEmailConfig, getGraphAccessToken, sendEmailViaGraph, type GraphAttachment } from "../_shared/azure-email.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AttachmentInput {
  file_path: string;
  file_name: string;
}

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
  attachments?: AttachmentInput[];
}

const MAX_TOTAL_ATTACHMENT_BYTES = 9 * 1024 * 1024; // ~9MB safe ceiling under Graph 10MB

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ensureHtmlBody(body: string): string {
  // If body already contains block-level HTML, leave as-is.
  if (/<(p|div|br|table|ul|ol|h[1-6]|blockquote|section|article)\b/i.test(body)) {
    return body;
  }
  // Convert plain text → paragraph-aware HTML so blank lines render as spacing
  // and single newlines as <br>. Mirrors what the Preview tab shows (whitespace-pre-wrap).
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map(block => {
      const inner = escapeHtml(block).replace(/\n/g, "<br>");
      return `<p style="margin:0 0 1em 0; line-height:1.5;">${inner}</p>`;
    })
    .join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function inferContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    txt: "text/plain", csv: "text/csv",
  };
  return map[ext] || "application/octet-stream";
}

async function buildAttachments(
  supabaseClient: any,
  inputs: AttachmentInput[] | undefined,
): Promise<{ attachments: GraphAttachment[]; error?: string }> {
  if (!inputs || inputs.length === 0) return { attachments: [] };

  const out: GraphAttachment[] = [];
  let totalBytes = 0;

  for (const a of inputs) {
    const { data, error } = await supabaseClient.storage
      .from("campaign-materials")
      .download(a.file_path);
    if (error || !data) {
      return { attachments: [], error: `Failed to load attachment "${a.file_name}": ${error?.message || "not found"}` };
    }
    const buf = await data.arrayBuffer();
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { attachments: [], error: `Attachments exceed 9 MB total size limit. Remove some files and try again.` };
    }
    out.push({
      name: a.file_name,
      contentBytesBase64: arrayBufferToBase64(buf),
      contentType: inferContentType(a.file_name),
    });
  }
  return { attachments: out };
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

    // Guard: do not allow sending for campaigns that are ended, paused, or archived.
    if (payload.campaign_id) {
      const { data: campaignRow } = await supabaseClient
        .from("campaigns")
        .select("status, end_date, archived_at")
        .eq("id", payload.campaign_id)
        .maybeSingle();
      if (campaignRow) {
        const today = new Date().toISOString().slice(0, 10);
        const ended = !!campaignRow.end_date && campaignRow.end_date < today;
        const blockedStatus = campaignRow.status === "Completed" || campaignRow.status === "Paused";
        if (campaignRow.archived_at || ended || blockedStatus) {
          return new Response(JSON.stringify({
            success: false,
            error: campaignRow.archived_at
              ? "This campaign is archived; outreach is disabled."
              : ended
                ? "This campaign has passed its end date; outreach is disabled."
                : "This campaign is not active; outreach is disabled.",
            errorCode: "CAMPAIGN_NOT_ACTIVE",
          }), {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const azureConfig = getAzureEmailConfig();
    if (!azureConfig) {
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
    console.log(`Sending campaign email from user mailbox: ${senderEmail} (shared mailbox: ${mailboxEmail})`);

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

      return new Response(JSON.stringify({
        success: false,
        error: `Failed to authenticate with email provider: ${errMsg}`,
        errorCode: "AUTH_FAILED",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build attachments (returns early on error)
    const { attachments, error: attachError } = await buildAttachments(supabaseClient, payload.attachments);
    if (attachError) {
      return new Response(JSON.stringify({
        success: false,
        error: attachError,
        errorCode: "ATTACHMENT_ERROR",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If reply, lookup parent metadata
    let replyToGraphMessageId: string | undefined;
    let replyToInternetMessageId: string | undefined;
    let fallbackConversationId: string | null = null;
    if (payload.parent_id) {
      if (payload.parent_internet_message_id) {
        replyToInternetMessageId = payload.parent_internet_message_id;
      }
      const { data: parentComm } = await supabaseClient
        .from("campaign_communications")
        .select("graph_message_id, internet_message_id, conversation_id")
        .eq("id", payload.parent_id)
        .single();
      if (parentComm?.graph_message_id) {
        replyToGraphMessageId = parentComm.graph_message_id;
      }
      if (!replyToInternetMessageId && parentComm?.internet_message_id) {
        replyToInternetMessageId = parentComm.internet_message_id;
      }
      if (parentComm?.conversation_id) {
        fallbackConversationId = parentComm.conversation_id;
      }
      if (!replyToGraphMessageId) {
        replyToGraphMessageId = await findSentMessageGraphId(
          accessToken,
          senderEmail,
          replyToInternetMessageId,
          fallbackConversationId,
        );
      }
    }

    // Generate tracking ID up-front so the pixel URL embedded in the email
    // matches the row we're about to insert.
    const trackingId = crypto.randomUUID();
    const trackingPixelUrl = `${supabaseUrl}/functions/v1/email-track?t=${trackingId}`;
    const trackingPixel = `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none !important;border:0;outline:0;" />`;

    const baseHtmlBody = ensureHtmlBody(payload.body);
    const htmlBody = `${baseHtmlBody}${trackingPixel}`;

    const result = await sendEmailViaGraph(
      accessToken,
      mailboxEmail,
      payload.recipient_email,
      payload.recipient_name,
      payload.subject,
      htmlBody,
      senderEmail,
      replyToGraphMessageId,
      replyToGraphMessageId ? replyToInternetMessageId : undefined,
      attachments,
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
        tracking_id: trackingId,
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
