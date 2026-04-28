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

/**
 * Resolve the just-sent message in Sent Items. Strategy (most reliable first):
 *   1. Match by `correlationToken` embedded in the HTML body — survives any
 *      subject localisation, "Re:" stacking, and Outlook prefix mutation.
 *   2. Fallback: subject-normalize + recipient match.
 *   3. Fallback: most recent message to that recipient.
 *
 * Retry budget: 8 attempts with exponential backoff (0.5s → 8s, capped),
 * total ~16s. Graph's Sent Items indexing latency for a brand-new send can
 * exceed 7s on first writes; the previous 5×1.5s budget was insufficient.
 */
async function fetchSentMessageMetadata(
  accessToken: string,
  mailboxEmail: string,
  subject: string,
  recipientEmail: string,
  correlationToken?: string,
): Promise<Pick<SendEmailResult, "graphMessageId" | "internetMessageId" | "conversationId">> {
  const selectFields = "id,internetMessageId,conversationId,subject,toRecipients,bodyPreview";
  const sentItemsUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}/mailFolders/sentitems/messages?$top=15&$orderby=sentDateTime desc&$select=${selectFields}`;
  const normalizedSubject = normalizeSubject(subject);
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  const backoffMs = [500, 1000, 1500, 2000, 3000, 4000, 5000, 8000];

  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    if (attempt > 0) {
      await sleep(backoffMs[attempt]);
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

      // 1. Correlation-token match — most reliable.
      if (correlationToken) {
        const tokenMatch = msgs.find((m: any) =>
          typeof m.bodyPreview === "string" && m.bodyPreview.includes(correlationToken),
        );
        if (tokenMatch) {
          return {
            graphMessageId: tokenMatch.id || undefined,
            internetMessageId: tokenMatch.internetMessageId || undefined,
            conversationId: tokenMatch.conversationId || undefined,
          };
        }
      }

      // 2. Recipient + subject match.
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

  console.warn(`No sent message metadata found for ${mailboxEmail} after retries (correlation=${correlationToken || "n/a"})`);
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

export interface InternetHeader { name: string; value: string }

/**
 * Build a hidden HTML span carrying a unique correlation token. Embedded in
 * every outbound message so we can later match the row in Sent Items even
 * when subject/recipient heuristics fail (localised "Re:" prefixes, Outlook
 * tag injection, etc).
 */
export function makeCorrelationToken(): string {
  return `lvc-${crypto.randomUUID().replace(/-/g, "")}`;
}

function injectCorrelationMarker(htmlBody: string, token: string): string {
  // Hidden, zero-pixel marker that survives quoting / forwarding without
  // affecting rendered output. Placed at end so it's the last text in
  // bodyPreview when the message body is short.
  const marker = `<span style="display:none !important;font-size:0;line-height:0;color:transparent;">${token}</span>`;
  return `${htmlBody}${marker}`;
}

/**
 * Decide whether to use standard RFC 5322 header names (`In-Reply-To`,
 * `References`) or Microsoft's `x-` prefixed variants. Standard names are
 * what Gmail/Outlook actually use for threading; the `x-` variants only
 * exist because older Graph builds rejected non-prefixed custom headers.
 *
 * Strategy: try standard names first. If Graph rejects with
 * ErrorInvalidInternetMessageHeader, the caller retries with `x-` prefix.
 */
function buildThreadingHeaders(
  replyToInternetMessageId: string | undefined,
  prevReferences: string | undefined,
  useXPrefix: boolean,
): InternetHeader[] {
  if (!replyToInternetMessageId) return [];
  const irtName = useXPrefix ? "x-In-Reply-To" : "In-Reply-To";
  const refsName = useXPrefix ? "x-References" : "References";
  const refsValue = (prevReferences || "").trim()
    ? `${(prevReferences || "").trim()} ${replyToInternetMessageId}`
    : replyToInternetMessageId;
  return [
    { name: irtName, value: replyToInternetMessageId },
    { name: refsName, value: refsValue },
  ];
}

export async function sendEmailViaGraph(
  accessToken: string,
  senderEmail: string,
  recipientEmail: string,
  recipientName: string,
  subject: string,
  htmlBody: string,
  fromEmail?: string,
  replyToGraphMessageId?: string,
  replyToInternetMessageId?: string,
  attachments?: GraphAttachment[],
  internetMessageHeaders?: InternetHeader[],
  options?: { correlationToken?: string; previousReferences?: string; parentMailbox?: string },
): Promise<SendEmailResult> {
  const senderMailbox = (fromEmail || senderEmail).trim();
  const encodedMailbox = encodeURIComponent(senderMailbox);

  // For replies, ensure subject has "Re:" prefix.
  let finalSubject = subject;
  if (replyToGraphMessageId || replyToInternetMessageId) {
    if (!/^re\s*:/i.test(finalSubject)) {
      finalSubject = `Re: ${finalSubject}`;
    }
  }

  // Embed correlation marker for reliable Sent Items lookup.
  const correlationToken = options?.correlationToken || makeCorrelationToken();
  const finalHtmlBody = injectCorrelationMarker(htmlBody, correlationToken);

  // === MAILBOX SELECTION FOR createReply ===
  // The parent message lives in whichever mailbox originally sent it. If the
  // parent was sent as a shared mailbox (e.g. crm@realthingks.com) but the
  // current send is going through a user mailbox (e.g. user@realthingks.com),
  // calling createReply against the user mailbox returns 403 ErrorAccessDenied
  // because Graph can't find the message there. Use the parent's mailbox.
  const replyMailbox = (options?.parentMailbox || senderMailbox).trim();
  const encodedReplyMailbox = encodeURIComponent(replyMailbox);

  // Reply path A — auto-resolve graphMessageId from internetMessageId if the
  // caller didn't have it cached (handles the case where the original send's
  // metadata capture failed and we never stored graph_message_id).
  let resolvedReplyGraphId = replyToGraphMessageId;
  if (!resolvedReplyGraphId && replyToInternetMessageId) {
    resolvedReplyGraphId = await findSentMessageGraphId(
      accessToken,
      replyMailbox,
      replyToInternetMessageId,
      null,
    );
  }

  // Reply path A — we know the parent's graphMessageId in the SAME mailbox:
  // use Graph's native createReply + send. Graph guarantees the reply lands
  // in the same conversationId and writes the canonical In-Reply-To /
  // References headers itself, which is the most reliable way to keep the
  // thread together in Outlook AND Gmail.
  if (resolvedReplyGraphId) {
    try {
      const createReplyUrl = `https://graph.microsoft.com/v1.0/users/${encodedReplyMailbox}/messages/${resolvedReplyGraphId}/createReply`;
      const createResp = await fetch(createReplyUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (createResp.ok) {
        const draft = await createResp.json();
        const draftId = draft?.id;
        if (draftId) {
          const patchBody: Record<string, unknown> = {
            subject: finalSubject,
            body: { contentType: "HTML", content: finalHtmlBody },
            toRecipients: [{ emailAddress: { address: recipientEmail, name: recipientName } }],
          };
          if (attachments && attachments.length > 0) {
            patchBody.attachments = attachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.contentType || "application/octet-stream",
              contentBytes: a.contentBytesBase64,
            }));
          }
          const patchResp = await fetch(
            `https://graph.microsoft.com/v1.0/users/${encodedReplyMailbox}/messages/${draftId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(patchBody),
            },
          );
          if (patchResp.ok) {
            const sendResp = await fetch(
              `https://graph.microsoft.com/v1.0/users/${encodedReplyMailbox}/messages/${draftId}/send`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
              },
            );
            if (sendResp.ok) {
              // Look up metadata in the mailbox where the reply was actually sent.
              const metadata = await fetchSentMessageMetadata(
                accessToken,
                replyMailbox,
                finalSubject,
                recipientEmail,
                correlationToken,
              );
              return {
                success: true,
                graphMessageId: metadata.graphMessageId,
                internetMessageId: metadata.internetMessageId,
                conversationId: metadata.conversationId,
                sentAsUser: true,
              };
            } else {
              const errBody = await sendResp.text();
              console.warn(`Native reply send failed (${sendResp.status}); falling back to sendMail with headers. ${errBody}`);
            }
          } else {
            const errBody = await patchResp.text();
            console.warn(`Native reply PATCH failed (${patchResp.status}); falling back to sendMail with headers. ${errBody}`);
          }
        }
      } else {
        const errBody = await createResp.text();
        console.warn(`createReply failed against ${replyMailbox} (${createResp.status}); falling back to sendMail with headers. ${errBody}`);
        // If we tried the parent mailbox and got 403, try once more against the
        // current sender mailbox (some tenants have permissions inverted).
        if (createResp.status === 403 && replyMailbox.toLowerCase() !== senderMailbox.toLowerCase()) {
          const retryUrl = `https://graph.microsoft.com/v1.0/users/${encodedMailbox}/messages/${resolvedReplyGraphId}/createReply`;
          const retryResp = await fetch(retryUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (retryResp.ok) {
            const draft = await retryResp.json();
            const draftId = draft?.id;
            if (draftId) {
              const patchResp2 = await fetch(
                `https://graph.microsoft.com/v1.0/users/${encodedMailbox}/messages/${draftId}`,
                {
                  method: "PATCH",
                  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    subject: finalSubject,
                    body: { contentType: "HTML", content: finalHtmlBody },
                    toRecipients: [{ emailAddress: { address: recipientEmail, name: recipientName } }],
                  }),
                },
              );
              if (patchResp2.ok) {
                const sendResp2 = await fetch(
                  `https://graph.microsoft.com/v1.0/users/${encodedMailbox}/messages/${draftId}/send`,
                  { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
                );
                if (sendResp2.ok) {
                  const metadata = await fetchSentMessageMetadata(
                    accessToken, senderMailbox, finalSubject, recipientEmail, correlationToken,
                  );
                  return {
                    success: true,
                    graphMessageId: metadata.graphMessageId,
                    internetMessageId: metadata.internetMessageId,
                    conversationId: metadata.conversationId,
                    sentAsUser: true,
                  };
                } else {
                  await sendResp2.text();
                }
              } else {
                await patchResp2.text();
              }
            }
          } else {
            await retryResp.text();
          }
        }
      }
    } catch (e) {
      console.warn("Native reply path threw, falling back to sendMail:", (e as Error).message);
    }
  }

  // Reply path B / new send: sendMail with x-prefixed In-Reply-To / References.
  // Note: Microsoft Graph's `sendMail` rejects standard RFC 5322 header names
  // ("In-Reply-To", "References") as InvalidInternetMessageHeader and only
  // accepts `x-` prefixed custom headers. Most mail clients (Gmail/Outlook)
  // ignore `x-` prefixed variants for threading — which is why createReply
  // (above) is the only reliable path for true thread continuity. We still
  // include the x- headers as best-effort metadata for our own reply matcher.
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodedMailbox}/sendMail`;
  const baseAttachments = attachments && attachments.length > 0
    ? attachments.map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.contentType || "application/octet-stream",
        contentBytes: a.contentBytesBase64,
      }))
    : undefined;

  const message: Record<string, unknown> = {
    subject: finalSubject,
    body: { contentType: "HTML", content: finalHtmlBody },
    toRecipients: [{ emailAddress: { address: recipientEmail, name: recipientName } }],
  };
  if (baseAttachments) message.attachments = baseAttachments;

  const threadingHeaders = buildThreadingHeaders(
    replyToInternetMessageId,
    options?.previousReferences,
    true, // always x-prefix; Graph rejects standard names
  );
  const callerHeaders = (internetMessageHeaders || []).map((h) => ({
    name: h.name.startsWith("x-") || h.name.startsWith("X-") ? h.name : `x-${h.name}`,
    value: h.value,
  }));
  const allHeaders = [...threadingHeaders, ...callerHeaders];
  if (allHeaders.length > 0) message.internetMessageHeaders = allHeaders;

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

  const metadata = await fetchSentMessageMetadata(
    accessToken,
    senderMailbox,
    finalSubject,
    recipientEmail,
    correlationToken,
  );

  return {
    success: true,
    graphMessageId: metadata.graphMessageId,
    internetMessageId: metadata.internetMessageId,
    conversationId: metadata.conversationId,
    sentAsUser: true,
  };
}
