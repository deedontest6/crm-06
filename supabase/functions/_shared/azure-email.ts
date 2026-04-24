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

export interface GraphAttachment {
  name: string;
  contentBytesBase64: string;
  contentType?: string;
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
        return {
          graphMessageId: match.id || undefined,
          internetMessageId: match.internetMessageId || undefined,
          conversationId: match.conversationId || undefined,
        };
      }
    } catch (metaErr) {
      console.warn(`Error retrieving sent message metadata for ${mailboxEmail} on attempt ${attempt + 1}:`, metaErr);
    }
  }

  console.warn(`No sent message metadata found for ${mailboxEmail} after retries`);
  return {};
}

export async function findSentMessageGraphId(
  accessToken: string,
  mailboxEmail: string,
  internetMessageId?: string | null,
  conversationId?: string | null,
): Promise<string | undefined> {
  if (!internetMessageId && !conversationId) return undefined;

  const sentItemsUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/mailFolders/sentitems/messages?$top=25&$orderby=sentDateTime desc&$select=id,internetMessageId,conversationId`;

  try {
    const sentResp = await fetch(sentItemsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!sentResp.ok) {
      const errText = await sentResp.text();
      console.warn(`Failed to resolve sent graph message id for ${mailboxEmail}: ${sentResp.status} ${errText}`);
      return undefined;
    }

    const sentData = await sentResp.json();
    const messages = Array.isArray(sentData.value) ? sentData.value : [];
    const exactInternetMessageMatch = internetMessageId
      ? messages.find((message: any) => message.internetMessageId === internetMessageId)
      : undefined;

    if (exactInternetMessageMatch?.id) {
      return exactInternetMessageMatch.id;
    }

    const conversationMatch = conversationId
      ? messages.find((message: any) => message.conversationId === conversationId)
      : undefined;

    return conversationMatch?.id;
  } catch (error) {
    console.warn(`Error resolving sent graph message id for ${mailboxEmail}:`, error);
    return undefined;
  }
}

export async function sendEmailViaGraph(
  accessToken: string,
  senderEmail: string,
  recipientEmail: string,
  recipientName: string,
  subject: string,
  htmlBody: string,
  fromEmail?: string,
  _replyToGraphMessageId?: string,
  _replyToInternetMessageId?: string,
  attachments?: GraphAttachment[],
): Promise<SendEmailResult> {
  const senderMailbox = (fromEmail || senderEmail).trim();
  const encodedMailbox = encodeURIComponent(senderMailbox);
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodedMailbox}/sendMail`;

  // For replies, ensure subject has "Re:" prefix (thread correlation via conversationId after send)
  let finalSubject = subject;
  if (_replyToGraphMessageId || _replyToInternetMessageId) {
    if (!/^re\s*:/i.test(finalSubject)) {
      finalSubject = `Re: ${finalSubject}`;
    }
  }

  const message: Record<string, unknown> = {
    subject: finalSubject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: [{ emailAddress: { address: recipientEmail, name: recipientName } }],
  };

  if (attachments && attachments.length > 0) {
    message.attachments = attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType || "application/octet-stream",
      contentBytes: a.contentBytesBase64,
    }));
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

  const metadata = await fetchSentMessageMetadata(accessToken, senderMailbox, finalSubject, recipientEmail);

  return {
    success: true,
    graphMessageId: metadata.graphMessageId,
    internetMessageId: metadata.internetMessageId,
    conversationId: metadata.conversationId,
    sentAsUser: true,
  };
}
