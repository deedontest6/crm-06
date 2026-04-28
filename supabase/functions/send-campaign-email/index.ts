import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { findSentMessageGraphId, getAzureEmailConfig, getGraphAccessToken, sendEmailViaGraph, type GraphAttachment } from "../_shared/azure-email.ts";
// Unsubscribe feature removed.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

interface AttachmentInput {
  file_path: string;
  file_name: string;
}

interface EmailRequest {
  campaign_id: string;
  contact_id: string;
  account_id?: string;
  idempotency_key?: string;
  template_id?: string;
  // Optional explicit variant. If omitted and template has variants, the
  // server picks one via weighted random (or the declared winner).
  variant_id?: string;
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

// escapeHtml + ensureHtmlBody live in `_shared/email-render.ts` so the manual
// compose path and the automated follow-up runner produce identical HTML.
import { ensureHtmlBody } from "../_shared/email-render.ts";

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

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
    .select('full_name, "Email ID", email_signature')
    .eq("id", user.id)
    .maybeSingle();

  const profileEmail = profile?.["Email ID"]?.trim();
  const authEmail = user.email?.trim();
  return {
    email: profileEmail || authEmail || null,
    signature: profile?.email_signature || null,
    fullName: profile?.full_name || null,
  };
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

    // Internal callers (the send-job-runner) use the service role key + an
    // x-impersonate-user header to act on behalf of the original campaign owner.
    let user: { id: string; email?: string | null } | null = null;
    const impersonateUserId = req.headers.get("x-impersonate-user");
    if (token === serviceRoleKey && impersonateUserId) {
      const { data: u, error: uErr } = await supabaseClient.auth.admin.getUserById(impersonateUserId);
      if (uErr || !u?.user) {
        return new Response(JSON.stringify({ error: "Invalid impersonation user" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = { id: u.user.id, email: u.user.email };
    } else {
      const { data: { user: authUser }, error: authError } = await supabaseClient.auth.getUser(token);
      if (authError || !authUser) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = { id: authUser.id, email: authUser.email };
    }

    const payload: EmailRequest = await req.json();
    if (!payload.campaign_id || !payload.contact_id || !payload.subject || !payload.body) {
      return new Response(JSON.stringify({ error: "Missing required fields: campaign_id, contact_id, subject, body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: campaignContact } = await supabaseClient
      .from("campaign_contacts")
      .select("account_id, contacts(email, contact_name)")
      .eq("campaign_id", payload.campaign_id)
      .eq("contact_id", payload.contact_id)
      .maybeSingle();
    const contactRecord = (campaignContact as any)?.contacts;
    const resolvedRecipientEmail = String(contactRecord?.email || "").trim();
    const resolvedRecipientName = String(contactRecord?.contact_name || payload.recipient_name || resolvedRecipientEmail).trim();
    const resolvedAccountId = payload.account_id || (campaignContact as any)?.account_id || null;
    if (!campaignContact || !resolvedRecipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedRecipientEmail)) {
      return new Response(JSON.stringify({
        success: false,
        error: "Recipient is not a valid contact in this campaign or has no valid email address.",
        errorCode: "INVALID_CAMPAIGN_RECIPIENT",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (payload.parent_id) {
      // Defense-in-depth: verify the reply parent belongs to the SAME
      // campaign + contact + (when both sides expose it) the same account.
      // Stale form state in bulk operations could otherwise reply into the
      // wrong account thread.
      const { data: parentCheck } = await supabaseClient
        .from("campaign_communications")
        .select("id, account_id")
        .eq("id", payload.parent_id)
        .eq("campaign_id", payload.campaign_id)
        .eq("contact_id", payload.contact_id)
        .maybeSingle();
      if (!parentCheck) {
        return new Response(JSON.stringify({ success: false, error: "Reply parent does not belong to this campaign contact.", errorCode: "INVALID_REPLY_PARENT" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (
        payload.account_id &&
        parentCheck.account_id &&
        payload.account_id !== parentCheck.account_id
      ) {
        return new Response(JSON.stringify({ success: false, error: "Reply parent belongs to a different account.", errorCode: "INVALID_REPLY_PARENT_ACCOUNT" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Guard: only actively running campaigns can send outreach.
    if (payload.campaign_id) {
      const { data: campaignRow } = await supabaseClient
        .from("campaigns")
        .select("status, start_date, end_date, archived_at")
        .eq("id", payload.campaign_id)
        .maybeSingle();
      if (campaignRow) {
        const today = new Date().toISOString().slice(0, 10);
        const startsInFuture = !!campaignRow.start_date && campaignRow.start_date > today;
        const ended = !!campaignRow.end_date && campaignRow.end_date < today;
        const blockedStatus = campaignRow.status !== "Active";
        if (campaignRow.archived_at || startsInFuture || ended || blockedStatus) {
          // A2: Single-source status flip via locked RPC (no inline UPDATE).
          if (ended && (campaignRow.status === "Active" || campaignRow.status === "Paused")) {
            await supabaseClient.rpc("auto_complete_campaign", { _campaign_id: payload.campaign_id });
          }
          return new Response(JSON.stringify({
            success: false,
            error: campaignRow.archived_at
              ? "This campaign is archived; outreach is disabled."
              : startsInFuture
                ? "This campaign has not reached its start date yet; outreach is disabled."
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

      // ── Timing-window enforcement ──────────────────────────────────
      // If the campaign defines explicit timing windows, today's date MUST
      // fall within at least one of them. This lets ops pause outreach
      // around holidays / blackout periods without archiving the campaign.
      // No windows defined → no restriction (campaign-level start/end above
      // is the only gate).
      const { data: windows } = await supabaseClient
        .from("campaign_timing_windows")
        .select("start_date, end_date, window_name")
        .eq("campaign_id", payload.campaign_id);
      if (windows && windows.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const inWindow = windows.some(
          (w: any) => w.start_date <= today && w.end_date >= today,
        );
        if (!inWindow) {
          // Find the next upcoming window for a helpful message.
          const upcoming = windows
            .filter((w: any) => w.start_date > today)
            .sort((a: any, b: any) => a.start_date.localeCompare(b.start_date))[0];
          const hint = upcoming
            ? ` Next active window: "${upcoming.window_name}" starts ${upcoming.start_date}.`
            : "";
          return new Response(JSON.stringify({
            success: false,
            error: `Today is outside this campaign's allowed sending windows.${hint}`,
            errorCode: "OUTSIDE_TIMING_WINDOW",
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

    const senderInfo = await resolveSenderEmail(supabaseClient, user);
    const senderEmail = senderInfo.email;
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

    const sendRequestId = await sha256Hex([
      payload.campaign_id,
      payload.contact_id,
      payload.parent_id || "root",
      payload.template_id || "no-template",
      payload.idempotency_key || `${payload.subject}\n${payload.body}`,
    ].join("|"));

    const { data: existingSuccessfulSend } = await supabaseClient
      .from("campaign_communications")
      .select("id, message_id, conversation_id")
      .eq("campaign_id", payload.campaign_id)
      .eq("send_request_id", sendRequestId)
      .neq("delivery_status", "failed")
      .maybeSingle();
    if (existingSuccessfulSend) {
      return new Response(JSON.stringify({
        success: true,
        duplicate: true,
        delivery_status: "sent",
        communication_id: existingSuccessfulSend.id,
        message_id: existingSuccessfulSend.message_id,
        conversation_id: existingSuccessfulSend.conversation_id,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Suppression list check (GDPR/CAN-SPAM) ─────────────────────────
    {
      const { data: suppressed } = await supabaseClient.rpc("is_email_suppressed", {
        _email: resolvedRecipientEmail,
        _campaign_id: payload.campaign_id ?? null,
      });
      if (suppressed === true) {
        return new Response(JSON.stringify({
          success: false,
          error: "This recipient has unsubscribed or is on the suppression list.",
          errorCode: "SUPPRESSED",
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Cross-campaign frequency cap (E3) ───────────────────────────────
    // Default policy lives in `check_contact_frequency_cap`: at most N emails
    // per contact within a rolling window across ALL campaigns. Prevents
    // contact fatigue when many campaigns target the same audience.
    {
      const { data: freqResult } = await supabaseClient.rpc("check_contact_frequency_cap", {
        _contact_id: payload.contact_id,
      });
      const allowed = (freqResult as any)?.allowed;
      if (freqResult && allowed === false) {
        return new Response(JSON.stringify({
          success: false,
          error: `Frequency cap reached for this contact (${(freqResult as any)?.recent_count ?? "?"}/${(freqResult as any)?.limit ?? "?"} in the last ${(freqResult as any)?.window_hours ?? "?"}h across all campaigns).`,
          errorCode: "FREQUENCY_CAP_EXCEEDED",
          frequencyDetails: freqResult,
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const mailboxEmail = azureConfig.senderEmail;

    // ── Send-cap enforcement (campaign + per-user + per-mailbox) ──────
    if (payload.campaign_id) {
      const { data: capCheck } = await supabaseClient.rpc("check_send_cap", {
        _campaign_id: payload.campaign_id,
        _sender_user_id: user.id,
        _mailbox_email: mailboxEmail,
      });
      if (capCheck && capCheck.allowed === false) {
        const scopeLabel = capCheck.scope === "per_user"
          ? "your account"
          : capCheck.scope === "per_mailbox"
            ? "the shared mailbox"
            : "this campaign";
        return new Response(JSON.stringify({
          success: false,
          error: `Send cap reached for ${scopeLabel}: ${capCheck.hourly_used}/${capCheck.hourly_limit} this hour, ${capCheck.daily_used}/${capCheck.daily_limit} today. Try again later.`,
          errorCode: "SEND_CAP_EXCEEDED",
          capDetails: capCheck,
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── A/B variant resolution ────────────────────────────────────────
    // If the caller passed an explicit variant_id, honor it. Otherwise, if
    // the template has variants, pick one server-side via weighted random
    // and PERSIST the assignment so the same contact always gets the same
    // variant on retry / follow-up. Falls back to the legacy non-sticky
    // picker if the sticky function is somehow unavailable.
    let resolvedVariantId: string | null = payload.variant_id || null;
    let effectiveSubject = payload.subject;
    let effectiveBody = payload.body;
    if (!resolvedVariantId && payload.template_id) {
      const { data: assignedId, error: pickErr } = await supabaseClient.rpc(
        "pick_or_assign_variant",
        {
          _template_id: payload.template_id,
          _contact_id: payload.contact_id,
          _campaign_id: payload.campaign_id,
        },
      );
      if (!pickErr && assignedId) {
        resolvedVariantId = assignedId as string;
      } else {
        // Fallback to non-sticky picker (logs the failure but keeps sending).
        const { data: pickedId } = await supabaseClient.rpc("pick_campaign_variant", {
          _template_id: payload.template_id,
        });
        if (pickedId) resolvedVariantId = pickedId as string;
        if (pickErr) console.warn("[send-campaign-email] pick_or_assign_variant failed, used fallback:", pickErr.message);
      }
    }
    if (resolvedVariantId) {
      const { data: variantRow } = await supabaseClient
        .from("campaign_email_variants")
        .select("subject, body")
        .eq("id", resolvedVariantId)
        .maybeSingle();
      if (variantRow) {
        // Variants override only if both fields are non-empty — protects
        // against an accidentally blank variant nuking the compose payload.
        if (variantRow.subject?.trim()) effectiveSubject = variantRow.subject;
        if (variantRow.body?.trim()) effectiveBody = variantRow.body;
      }
    }

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
        account_id: resolvedAccountId,
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

    // If reply, lookup parent metadata (full row so we can quote the body
    // and stitch In-Reply-To / References headers).
    let replyToGraphMessageId: string | undefined;
    let replyToInternetMessageId: string | undefined;
    let fallbackConversationId: string | null = null;
    let parentForQuote: { subject?: string; body?: string; communication_date?: string; sender_email?: string | null; references?: string | null } | null = null;
    if (payload.parent_id) {
      if (payload.parent_internet_message_id) {
        replyToInternetMessageId = payload.parent_internet_message_id;
      }
      const { data: parentComm } = await supabaseClient
        .from("campaign_communications")
        .select("graph_message_id, internet_message_id, conversation_id, subject, body, communication_date, sender_email, references")
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
      if (parentComm) {
        parentForQuote = {
          subject: parentComm.subject,
          body: parentComm.body,
          communication_date: parentComm.communication_date,
          sender_email: (parentComm as any).sender_email || senderEmail,
          references: (parentComm as any).references || null,
        };
      }
      if (!replyToGraphMessageId) {
        replyToGraphMessageId = await findSentMessageGraphId(
          accessToken,
          senderEmail,
          replyToInternetMessageId,
          fallbackConversationId,
        );
      }

      // === REPLY MODE: enforce subject parity with parent ===
      // Outlook never mutates a reply subject (only adds "Re:"), and Gmail
      // uses subject-equivalence to decide whether to thread. Any client-side
      // subject change would land the reply in a fresh Gmail thread on the
      // contact's side. Server-side enforcement is the only reliable guard.
      if (parentForQuote?.subject) {
        const parentSubject = parentForQuote.subject.trim();
        const parentRoot = parentSubject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").trim();
        effectiveSubject = /^\s*re\s*:/i.test(parentSubject)
          ? parentSubject
          : `Re: ${parentRoot}`;
      }

      // === REPLY MODE: require resolvable Graph parent for native createReply ===
      // If we can't resolve the parent's graphMessageId, sendMail with custom
      // headers is a known-broken fallback for Gmail recipients (it creates a
      // brand-new thread). Better to fail loudly than silently break threading.
      if (!replyToGraphMessageId && !replyToInternetMessageId) {
        return new Response(JSON.stringify({
          success: false,
          error: "Cannot send reply: original email's Graph metadata is missing. Try sending as a new email instead.",
          errorCode: "REPLY_PARENT_UNRESOLVABLE",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Threading headers are now built inside sendEmailViaGraph using
    // standard RFC 5322 names (In-Reply-To / References). We only forward
    // the previous References chain so it can be extended correctly.
    let referencesHeader: string | null = null;
    if (replyToInternetMessageId) {
      const prevRefs = (parentForQuote?.references || "").trim();
      referencesHeader = prevRefs
        ? `${prevRefs} ${replyToInternetMessageId}`
        : replyToInternetMessageId;
    }

    // Generate tracking ID up-front so the pixel URL embedded in the email
    // matches the row we're about to insert.
    const trackingId = crypto.randomUUID();
    const trackingPixelUrl = `${supabaseUrl}/functions/v1/email-track?t=${trackingId}`;
    // Skip tracking pixel on replies — Gmail flags reply emails with tracking
    // pixels as suspicious, hurting deliverability. Opens are already
    // attributed to the original send.
    const isReply = !!payload.parent_id;
    const trackingPixel = isReply
      ? ""
      : `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none !important;border:0;outline:0;" />`;

    // ── Append signature (no unsubscribe footer) ──────────────────────
    const baseHtmlBody = ensureHtmlBody(effectiveBody);
    const signatureHtml = senderInfo.signature
      ? `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;color:#475569;font-size:13px;">${senderInfo.signature}</div>`
      : "";

    // ── Outlook/Gmail-style quoted parent block on replies ────────────
    let quotedHtml = "";
    if (parentForQuote && parentForQuote.body) {
      const parentDateStr = parentForQuote.communication_date
        ? new Date(parentForQuote.communication_date).toUTCString()
        : "";
      const parentSenderStr = parentForQuote.sender_email || senderEmail;
      const parentBodyHtml = ensureHtmlBody(parentForQuote.body);
      quotedHtml = `<br><br><div style="border-left:2px solid #cbd5e1;padding:0 0 0 12px;margin-top:12px;color:#475569;font-size:13px;">`
        + `<div style="margin-bottom:6px;color:#64748b;font-size:12px;">On ${parentDateStr}, ${parentSenderStr} wrote:</div>`
        + parentBodyHtml
        + `</div>`;
    }

    const htmlBody = `${baseHtmlBody}${signatureHtml}${quotedHtml}${trackingPixel}`;

    // Track every mailbox we attempted so the user-facing error can show
    // exactly what was tried (instead of just the last attempt).
    const attemptedMailboxes: string[] = [senderEmail];

    // For replies, prefer routing createReply through the parent's mailbox.
    // The parent message exists only in the mailbox that originally sent it,
    // so calling createReply against any other mailbox returns 403.
    const parentMailbox = (parentForQuote?.sender_email || "").trim() || undefined;

    let result = await sendEmailViaGraph(
      accessToken,
      mailboxEmail,
      resolvedRecipientEmail,
      resolvedRecipientName,
      effectiveSubject,
      htmlBody,
      senderEmail,
      replyToGraphMessageId,
      replyToInternetMessageId,
      attachments,
      undefined,
      { previousReferences: parentForQuote?.references || undefined, parentMailbox },
    );

    let sentAsShared = false;
    // Fall back to the configured shared mailbox whenever Graph denies the
    // per-user send (common when the app registration lacks Mail.Send for
    // that specific user mailbox but does have access to the shared mailbox).
    // Set AZURE_DISABLE_SHARED_FALLBACK=true to skip this fallback when the
    // shared mailbox isn't licensed to send — avoids a misleading second 403.
    const sharedFallbackDisabled = (Deno.env.get("AZURE_DISABLE_SHARED_FALLBACK") || "").toLowerCase() === "true";
    if (
      !result.success &&
      result.errorCode === "ErrorAccessDenied" &&
      mailboxEmail &&
      senderEmail.toLowerCase() !== mailboxEmail.toLowerCase() &&
      !sharedFallbackDisabled
    ) {
      console.warn(`User mailbox send denied for ${senderEmail}; retrying via shared mailbox ${mailboxEmail}`);
      attemptedMailboxes.push(mailboxEmail);
      result = await sendEmailViaGraph(
        accessToken,
        mailboxEmail,
        resolvedRecipientEmail,
        resolvedRecipientName,
        effectiveSubject,
        htmlBody,
        undefined,
        replyToGraphMessageId,
        replyToInternetMessageId,
        attachments,
        undefined,
        { previousReferences: parentForQuote?.references || undefined, parentMailbox },
      );
      sentAsShared = result.success;
    }

    const attemptedSharedMailbox = senderEmail.toLowerCase() !== mailboxEmail.toLowerCase() && (
      sentAsShared || (!result.success && result.errorCode === "ErrorAccessDenied")
    );
    const deliveryStatus = result.success ? "sent" : "failed";
    const messageId = result.internetMessageId || crypto.randomUUID();
    const threadId = payload.thread_id || payload.parent_id || null;
    const parentId = payload.parent_id || null;
    const conversationId = result.conversationId || fallbackConversationId;
    // C8: when the user-mailbox send was denied and we fell back to the shared mailbox,
    // the recipient actually received the message from `mailboxEmail`, not `senderEmail`.
    // Surface the true sender so the UI toast / result panel can show "Sent as <shared>".
    const actualSender = attemptedSharedMailbox ? mailboxEmail : senderEmail;
    // Build a clear admin-friendly error that names every mailbox we tried,
    // so it's obvious the issue is Graph permissions (not wrong sender choice).
    const userFacingError = !result.success && result.errorCode === "ErrorAccessDenied"
      ? `Microsoft 365 denied mailbox send access. Tried: ${attemptedMailboxes.join(", ")}. Ask your admin to grant the Azure app the "Mail.Send" Application permission (with admin consent) and an Application Access Policy covering the sender mailbox.`
      : result.error;

    const { data: commRecord, error: commError } = await supabaseClient
      .from("campaign_communications")
      .insert({
        campaign_id: payload.campaign_id,
        contact_id: payload.contact_id,
        account_id: resolvedAccountId,
        communication_type: "Email",
        subject: effectiveSubject,
        body: effectiveBody,
        email_status: result.success ? "Sent" : "Failed",
        delivery_status: deliveryStatus,
        sent_via: "azure",
        template_id: payload.template_id || null,
        variant_id: resolvedVariantId,
        message_id: messageId,
        thread_id: threadId,
        parent_id: parentId,
        graph_message_id: result.graphMessageId || null,
        internet_message_id: result.internetMessageId || null,
        conversation_id: conversationId,
        references: referencesHeader,
        sender_email: actualSender,
        tracking_id: trackingId,
        send_request_id: sendRequestId,
        sent_as_shared: sentAsShared,
        error_code: result.errorCode || null,
        error_message: userFacingError ? userFacingError.substring(0, 1000) : null,
        last_attempt_at: new Date().toISOString(),
        owner: user.id,
        created_by: user.id,
        notes: userFacingError ? `Send error: ${userFacingError.substring(0, 500)}` : null,
        communication_date: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (commError) {
      console.error("Communication log error:", commError);
    }

    await supabaseClient.from("email_history").insert({
      subject: effectiveSubject,
      body: effectiveBody,
      recipient_email: resolvedRecipientEmail,
      recipient_name: resolvedRecipientName,
      sender_email: actualSender,
      sent_by: user.id,
      contact_id: payload.contact_id,
      account_id: resolvedAccountId,
      status: deliveryStatus,
      sent_at: new Date().toISOString(),
      internet_message_id: result.internetMessageId || null,
    });

    // Ledger row for cap enforcement (only on actual sends).
    if (result.success) {
      const { error: sendLogError } = await supabaseClient.from("campaign_send_log").insert({
        campaign_id: payload.campaign_id || null,
        contact_id: payload.contact_id || null,
        sender_user_id: user.id,
        mailbox_email: mailboxEmail.toLowerCase(),
        send_request_id: sendRequestId,
        correlation_id: sendRequestId,
      });
      if (sendLogError) {
        console.error(`[send-campaign-email] correlation=${sendRequestId} send-log insert failed:`, sendLogError);
      }
    }

    return new Response(
      JSON.stringify({
        success: result.success,
        delivery_status: deliveryStatus,
        communication_id: commRecord?.id,
        message_id: messageId,
        conversation_id: conversationId,
        sent_as: actualSender,
        sent_as_shared: sentAsShared,
        error: userFacingError || undefined,
        errorCode: result.errorCode || undefined,
      }),
      {
        status: 200,
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
