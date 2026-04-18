// Shared Microsoft Graph email sending utility

export interface AzureEmailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  graphMessageId?: string;
  internetMessageId?: string;
  conversationId?: string;
  sentAsUser?: boolean;
}

export function getAzureEmailConfig(): AzureEmailConfig | null {
  const tenantId = Deno.env.get("AZURE_EMAIL_TENANT_ID") || Deno.env.get("AZURE_TENANT_ID");
  const clientId = Deno.env.get("AZURE_EMAIL_CLIENT_ID") || Deno.env.get("AZURE_CLIENT_ID");
  const clientSecret = Deno.env.get("AZURE_EMAIL_CLIENT_SECRET") || Deno.env.get("AZURE_CLIENT_SECRET");
  const senderEmail = Deno.env.get("AZURE_SENDER_EMAIL");

  if (!tenantId || !clientId || !clientSecret || !senderEmail) {
    return null;
  }

  return { tenantId, clientId, clientSecret, senderEmail };
}

export async function getGraphAccessToken(config: AzureEmailConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  const data = await resp.json();
  if (!data.access_token) {
    const errMsg = data.error_description || data.error || "Unknown token error";
    throw new Error(`Azure token error: ${errMsg}`);
  }
  return data.access_token;
}

/**
 * Send email via Graph using the sender's own mailbox so campaign emails
 * always appear from the logged-in user, not the shared CRM mailbox.
 * After sending, poll Sent Items to retrieve conversation/thread metadata.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSubject(subject: string | null | undefined): string {
  return (subject || "")
    .replace(/^(re|fw|fwd)\s*:\s*/gi, "")
    .trim()
    .toLowerCase();
}

async function fetchSentMessageMetadata(
  accessToken: string,
  mailboxEmail: string,
  subject: string,
  recipientEmail: string,
): Promise<Pick<SendEmailResult, "graphMessageId" | "internetMessageId" | "conversationId">> {
  const sentItemsUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/mailFolders/sentitems/messages?$top=10&$orderby=sentDateTime desc&$select=id,internetMessageId,conversationId,subject,toRecipients`;
  const normalizedSubject = normalizeSubject(subject);
  const normalizedRecipient = recipientEmail.trim().toLowerCase();

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await sleep(1500);
    }

    try {
      const sentResp = await fetch(sentItemsUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!sentResp.ok) {
        const errText = await sentResp.text();
        console.warn(`Failed to query Sent Items for ${mailboxEmail} (attempt ${attempt + 1}): ${sentResp.status} ${errText}`);
        continue;
      }

      const sentData = await sentResp.json();
      const msgs = Array.isArray(sentData.value) ? sentData.value : [];
      const recipientMatches = msgs.filter((m: any) =>
        (m.toRecipients || []).some(
          (r: any) => r.emailAddress?.address?.toLowerCase() === normalizedRecipient,
        ),
      );

      const match =
        recipientMatches.find((m: any) => normalizeSubject(m.subject) === normalizedSubject) ||
        recipientMatches[0];

      if (match) {
        const graphMessageId = match.id || undefined;
        const internetMessageId = match.internetMessageId || undefined;
        const conversationId = match.conversationId || undefined;
        console.log(`Retrieved sent message metadata for ${mailboxEmail}: graphId=${graphMessageId}, internetMsgId=${internetMessageId}, convId=${conversationId}`);
        return { graphMessageId, internetMessageId, conversationId };
      }
    } catch (metaErr) {
      console.warn(`Error retrieving sent message metadata for ${mailboxEmail} on attempt ${attempt + 1}:`, metaErr);
    }
  }

  console.warn(`No sent message metadata found for ${mailboxEmail} after retries`);
  return {};
}

export async function sendEmailViaGraph(
  accessToken: string,
  senderEmail: string,
  recipientEmail: string,
  recipientName: string,
  subject: string,
  htmlBody: string,
  fromEmail?: string,
  replyToInternetMessageId?: string,
): Promise<SendEmailResult> {
  const senderMailbox = (fromEmail || senderEmail).trim();
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderMailbox)}/sendMail`;

  const message: Record<string, unknown> = {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: [{ emailAddress: { address: recipientEmail, name: recipientName } }],
  };

  if (replyToInternetMessageId) {
    message.internetMessageHeaders = [
      { name: "In-Reply-To", value: replyToInternetMessageId },
      { name: "References", value: replyToInternetMessageId },
    ];
  }

  const sendResp = await fetch(sendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!sendResp.ok) {
    const errBody = await sendResp.text();
    let errorCode = "SEND_FAILED";
    try {
      const parsed = JSON.parse(errBody);
      errorCode = parsed?.error?.code || "SEND_FAILED";
    } catch { /* ignore */ }
    console.error(`Graph sendMail failed for ${recipientEmail} from ${senderMailbox}: ${sendResp.status} ${errBody}`);
    return { success: false, error: errBody, errorCode, sentAsUser: false };
  }

  await sendResp.text();

  const metadata = await fetchSentMessageMetadata(accessToken, senderMailbox, subject, recipientEmail);

  return {
    success: true,
    graphMessageId: metadata.graphMessageId,
    internetMessageId: metadata.internetMessageId,
    conversationId: metadata.conversationId,
    sentAsUser: true,
  };
}
