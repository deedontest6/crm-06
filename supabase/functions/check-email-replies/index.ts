import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAzureEmailConfig, getGraphAccessToken } from "../_shared/azure-email.ts";
import { areSubjectsCompatible } from "../_shared/subject-normalize.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

type SentEmailRecord = {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  account_id: string | null;
  conversation_id: string | null;
  internet_message_id: string | null;
  subject: string | null;
  owner: string | null;
  created_by: string | null;
  communication_date: string | null;
};

type TrackableEmailRecord = SentEmailRecord & {
  sender_mailbox: string;
  contact_email: string | null;
};

type SkipReason =
  | "chronology"
  | "subject_mismatch"
  | "contact_mismatch"
  | "ambiguous_candidates"
  | "no_eligible_parent";

type SkipCounts = {
  chronology: number;
  subject_mismatch: number;
  contact_mismatch: number;
  ambiguous: number;
  no_parent: number;
};

async function loadSenderMaps(supabase: any, sentEmails: SentEmailRecord[]) {
  const senderByMessageId = new Map<string, string>();
  const internetMessageIds = [...new Set(sentEmails.map((email) => email.internet_message_id).filter(Boolean))] as string[];

  if (internetMessageIds.length > 0) {
    const { data: emailHistory, error } = await supabase
      .from("email_history")
      .select("internet_message_id, sender_email")
      .in("internet_message_id", internetMessageIds);

    if (error) {
      console.error("Failed to load sender emails from email_history:", error);
    } else {
      for (const record of emailHistory || []) {
        const messageId = record.internet_message_id?.trim();
        const senderEmail = record.sender_email?.trim().toLowerCase();
        if (messageId && senderEmail) {
          senderByMessageId.set(messageId, senderEmail);
        }
      }
    }
  }

  const senderByOwnerId = new Map<string, string>();
  const ownerIds = [...new Set(sentEmails.map((email) => email.owner).filter(Boolean))] as string[];

  if (ownerIds.length > 0) {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select('id, "Email ID"')
      .in("id", ownerIds);

    if (error) {
      console.error("Failed to load sender emails from profiles:", error);
    } else {
      for (const profile of profiles || []) {
        const senderEmail = profile?.["Email ID"]?.trim().toLowerCase();
        if (profile?.id && senderEmail) {
          senderByOwnerId.set(profile.id, senderEmail);
        }
      }
    }
  }

  return { senderByMessageId, senderByOwnerId };
}

async function loadContactEmails(supabase: any, contactIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (contactIds.length === 0) return map;
  const { data, error } = await supabase
    .from("contacts")
    .select("id, email")
    .in("id", contactIds);
  if (error) {
    console.error("Failed to load contact emails:", error);
    return map;
  }
  for (const c of data || []) {
    if (c?.id && c?.email) map.set(c.id, c.email.trim().toLowerCase());
  }
  return map;
}

function resolveSenderMailbox(
  email: SentEmailRecord,
  senderByMessageId: Map<string, string>,
  senderByOwnerId: Map<string, string>,
  fallbackMailbox: string,
) {
  const senderFromHistory = email.internet_message_id ? senderByMessageId.get(email.internet_message_id) : undefined;
  const senderFromOwner = email.owner ? senderByOwnerId.get(email.owner) : undefined;
  return (senderFromHistory || senderFromOwner || fallbackMailbox).trim().toLowerCase();
}

async function fetchInboxMessages(accessToken: string, mailbox: string, sinceISO: string): Promise<any[]> {
  const allMessages: any[] = [];
  let nextLink: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=receivedDateTime ge ${sinceISO}&$orderby=receivedDateTime desc&$top=50&$select=id,subject,from,toRecipients,receivedDateTime,internetMessageId,conversationId,bodyPreview,uniqueBody,body`;

  while (nextLink) {
    const resp: Response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Graph inbox fetch failed for ${mailbox}: ${resp.status} ${errText}`);
      break;
    }

    const data: any = await resp.json();
    const messages = data.value || [];
    allMessages.push(...messages);
    nextLink = allMessages.length < 200 ? (data["@odata.nextLink"] || null) : null;
  }

  return allMessages;
}

export function extractReplyBody(msg: any): string {
  const candidates = [
    { content: msg?.uniqueBody?.content, type: msg?.uniqueBody?.contentType },
    { content: msg?.body?.content, type: msg?.body?.contentType },
    { content: msg?.bodyPreview, type: "text" },
  ];

  for (const c of candidates) {
    if (!c.content || typeof c.content !== "string") continue;
    let text = c.content;

    if ((c.type || "").toLowerCase() === "html") {
      text = text.replace(/<style[\s\S]*?<\/style>/gi, "")
                 .replace(/<script[\s\S]*?<\/script>/gi, "");
      text = text.replace(/<\/?(br|p|div)[^>]*>/gi, "\n");
      text = text.replace(/<[^>]+>/g, "");
      text = text.replace(/&nbsp;/g, " ")
                 .replace(/&amp;/g, "&")
                 .replace(/&lt;/g, "<")
                 .replace(/&gt;/g, ">")
                 .replace(/&quot;/g, '"')
                 .replace(/&#39;/g, "'");
    }

    text = text.split("\n")
               .filter((line) => !/^\s*(From|Sent|To|Cc|Subject)\s*:/i.test(line))
               .join("\n");

    text = text.replace(/\n{3,}/g, "\n\n").trim();
    if (text.length > 0) return text;
  }
  return "";
}

async function logSkip(
  supabase: any,
  reason: SkipReason,
  payload: {
    campaign_id?: string | null;
    contact_id?: string | null;
    contact_email?: string | null;
    sender_email?: string | null;
    subject?: string | null;
    conversation_id?: string | null;
    received_at?: string | null;
    parent_communication_id?: string | null;
    parent_subject?: string | null;
    parent_sent_at?: string | null;
    details?: Record<string, unknown>;
    correlation_id?: string | null;
  },
) {
  try {
    await supabase.from("email_reply_skip_log").insert({
      campaign_id: payload.campaign_id ?? null,
      contact_id: payload.contact_id ?? null,
      contact_email: payload.contact_email ?? null,
      sender_email: payload.sender_email ?? null,
      subject: payload.subject ?? null,
      conversation_id: payload.conversation_id ?? null,
      received_at: payload.received_at ?? null,
      parent_communication_id: payload.parent_communication_id ?? null,
      parent_subject: payload.parent_subject ?? null,
      parent_sent_at: payload.parent_sent_at ?? null,
      skip_reason: reason,
      details: payload.details ?? {},
      correlation_id: payload.correlation_id ?? null,
    });
  } catch (e) {
    console.error("Failed to write skip log:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("MY_SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Optional scoping body for manual re-runs.
  let scopedCampaignId: string | null = null;
  let scopedContactId: string | null = null;
  let correlationId: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.clone().json().catch(() => ({}));
      if (body?.campaign_id && typeof body.campaign_id === "string") scopedCampaignId = body.campaign_id;
      if (body?.contact_id && typeof body.contact_id === "string") scopedContactId = body.contact_id;
      // Stamp every emitted row (skip log + outbound) so the UI can deep-link.
      correlationId = crypto.randomUUID();
    }
  } catch { /* ignore */ }

  const skipCounts: SkipCounts = {
    chronology: 0, subject_mismatch: 0, contact_mismatch: 0, ambiguous: 0, no_parent: 0,
  };

  try {
    const azureConfig = getAzureEmailConfig();
    if (!azureConfig) {
      return new Response(JSON.stringify({ error: "Azure email not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken: string;
    try {
      accessToken = await getGraphAccessToken(azureConfig);
    } catch (err) {
      console.error("Failed to get Graph token for reply check:", (err as Error).message);
      return new Response(JSON.stringify({ error: "Auth failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let sentQuery = supabase
      .from("campaign_communications")
      .select("id, campaign_id, contact_id, account_id, conversation_id, internet_message_id, subject, owner, created_by, communication_date")
      .eq("communication_type", "Email")
      .eq("sent_via", "azure")
      .not("conversation_id", "is", null)
      .gte("communication_date", sevenDaysAgo)
      .order("communication_date", { ascending: false });

    if (scopedCampaignId) sentQuery = sentQuery.eq("campaign_id", scopedCampaignId);
    if (scopedContactId) sentQuery = sentQuery.eq("contact_id", scopedContactId);

    const { data: sentEmails, error: fetchErr } = await sentQuery;

    if (fetchErr) {
      console.error("Failed to fetch sent emails:", fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!sentEmails || sentEmails.length === 0) {
      return new Response(JSON.stringify({
        message: "No trackable emails found",
        correlation_id: correlationId,
        scanned: 0, inserted: 0,
        skipped: skipCounts,
        durationMs: Date.now() - startedAt,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { senderByMessageId, senderByOwnerId } = await loadSenderMaps(supabase, sentEmails as SentEmailRecord[]);

    const contactIds = [...new Set((sentEmails as SentEmailRecord[]).map((e) => e.contact_id).filter(Boolean))] as string[];
    const contactEmailById = await loadContactEmails(supabase, contactIds);

    const trackableEmails: TrackableEmailRecord[] = (sentEmails as SentEmailRecord[]).map((email) => ({
      ...email,
      sender_mailbox: resolveSenderMailbox(email, senderByMessageId, senderByOwnerId, azureConfig.senderEmail),
      contact_email: email.contact_id ? (contactEmailById.get(email.contact_id) || null) : null,
    }));

    const compositeKey = (convId: string, contactId: string | null) => `${convId}::${contactId || "no-contact"}`;
    const bucketByCompositeKey = new Map<string, TrackableEmailRecord[]>();
    const bucketsByConvId = new Map<string, string[]>();

    for (const email of trackableEmails) {
      const convId = email.conversation_id!;
      const key = compositeKey(convId, email.contact_id);
      if (!bucketByCompositeKey.has(key)) bucketByCompositeKey.set(key, []);
      bucketByCompositeKey.get(key)!.push(email);
      if (!bucketsByConvId.has(convId)) bucketsByConvId.set(convId, []);
      const list = bucketsByConvId.get(convId)!;
      if (!list.includes(key)) list.push(key);
    }

    const mailboxToConvIds = new Map<string, Set<string>>();
    for (const email of trackableEmails) {
      if (!mailboxToConvIds.has(email.sender_mailbox)) {
        mailboxToConvIds.set(email.sender_mailbox, new Set());
      }
      mailboxToConvIds.get(email.sender_mailbox)!.add(email.conversation_id!);
    }

    const allInternetMsgIds = new Set(
      trackableEmails.map((email) => email.internet_message_id).filter(Boolean)
    );

    const { data: existingSynced } = await supabase
      .from("campaign_communications")
      .select("internet_message_id")
      .eq("sent_via", "graph-sync")
      .not("internet_message_id", "is", null);

    const existingSyncedIds = new Set(
      (existingSynced || []).map((e: any) => e.internet_message_id).filter(Boolean)
    );

    let totalRepliesFound = 0;
    let totalScanned = 0;
    const processedMailboxes: string[] = [];

    for (const [mailbox, trackedConvIds] of mailboxToConvIds.entries()) {
      try {
        console.log(`Fetching inbox for ${mailbox}, tracking ${trackedConvIds.size} conversations`);
        const inboxMessages = await fetchInboxMessages(accessToken, mailbox, sevenDaysAgo);
        console.log(`Got ${inboxMessages.length} inbox messages for ${mailbox}`);

        const relevantMessages = inboxMessages.filter(
          (msg: any) => msg.conversationId && trackedConvIds.has(msg.conversationId)
        );
        console.log(`${relevantMessages.length} messages match tracked conversations for ${mailbox}`);
        totalScanned += relevantMessages.length;

        for (const msg of relevantMessages) {
          const msgInternetId = msg.internetMessageId;
          if (!msgInternetId) continue;
          if (allInternetMsgIds.has(msgInternetId)) continue;
          if (existingSyncedIds.has(msgInternetId)) continue;

          const fromEmail = (msg.from?.emailAddress?.address || "").trim().toLowerCase();
          const fromName = msg.from?.emailAddress?.name || fromEmail;
          const receivedAt = msg.receivedDateTime || new Date().toISOString();
          if (!fromEmail || fromEmail === mailbox) continue;

          const candidateBucketKeys = bucketsByConvId.get(msg.conversationId) || [];
          if (candidateBucketKeys.length === 0) continue;

          // === BOUNCE / NDR DETECTION ===
          // Microsoft Graph routes Non-Delivery Reports through the same conversationId
          // as the original outbound email. Detect by sender + subject heuristics and
          // record on the parent communication so dashboards can show "bounced".
          const subjectLower = (msg.subject || "").toLowerCase();
          const isBounceSender =
            /mailer-daemon|mailerdaemon|postmaster|microsoftexchange|mail delivery (sub)?system/i.test(fromEmail) ||
            /mailer-daemon|mailerdaemon|postmaster|microsoftexchange|mail delivery (sub)?system/i.test(fromName);
          const isBounceSubject =
            subjectLower.startsWith("undeliverable:") ||
            subjectLower.startsWith("undelivered:") ||
            subjectLower.startsWith("returned mail") ||
            subjectLower.startsWith("failure notice") ||
            subjectLower.startsWith("mail delivery failed") ||
            subjectLower.includes("delivery status notification") ||
            subjectLower.includes("delivery has failed") ||
            subjectLower.includes("could not be delivered") ||
            subjectLower.includes("returned to sender");
          if (isBounceSender || isBounceSubject) {
            // Pick the most recent OUTBOUND-SENT row in this conversation as the parent.
            // Re-query DB so we filter on delivery_status/sent_via reliably (those
            // fields aren't on the in-memory bucket records).
            const { data: parentRows } = await supabase
              .from("campaign_communications")
              .select("id, communication_date")
              .eq("conversation_id", msg.conversationId)
              .eq("communication_type", "Email")
              .neq("sent_via", "graph-sync")
              .eq("delivery_status", "sent")
              .order("communication_date", { ascending: false })
              .limit(1);
            const parent = (parentRows || [])[0];
            if (parent) {
              const bodyForCode = msg.bodyPreview || "";
              const bounceType = /5\.\d\.\d/.test(bodyForCode) || /\b550\b|\b552\b|\b553\b/.test(bodyForCode)
                ? "hard"
                : /4\.\d\.\d/.test(bodyForCode) || /\b421\b|\b450\b|\b451\b/.test(bodyForCode)
                  ? "soft"
                  : "unknown";
              await supabase
                .from("campaign_communications")
                .update({
                  email_status: "Failed",
                  delivery_status: "failed",
                  bounced_at: receivedAt,
                  bounce_type: bounceType,
                  bounce_reason: (msg.bodyPreview || msg.subject || "").slice(0, 500),
                })
                .eq("id", parent.id);
              existingSyncedIds.add(msgInternetId);
              allInternetMsgIds.add(msgInternetId);
              console.log(`Bounce recorded for parent=${parent.id} type=${bounceType}`);
            } else {
              console.log(`Bounce detected but no eligible sent parent in conv=${msg.conversationId}`);
            }
            continue; // do not treat as a real reply
          }


          // 1. Strict match by contact email.
          let chosenKey: string | null = null;
          const matchReasons: string[] = [];
          const matchedKeys: string[] = [];
          for (const key of candidateBucketKeys) {
            const bucket = bucketByCompositeKey.get(key) || [];
            const ce = bucket[0]?.contact_email;
            if (ce && ce === fromEmail) matchedKeys.push(key);
          }
          if (matchedKeys.length === 1) {
            chosenKey = matchedKeys[0];
            matchReasons.push("exact-contact-email-match");
          } else if (matchedKeys.length > 1) {
            const ranked = matchedKeys
              .map((k) => ({ k, t: new Date(bucketByCompositeKey.get(k)?.[0]?.communication_date || 0).getTime() }))
              .sort((a, b) => b.t - a.t);
            chosenKey = ranked[0].k;
            matchReasons.push(`multi-email-match-${matchedKeys.length}-picked-newest`);
          }

          // 2. Fallback: only one candidate bucket.
          if (!chosenKey && candidateBucketKeys.length === 1) {
            chosenKey = candidateBucketKeys[0];
            matchReasons.push("single-candidate-fallback");
          }

          // 3. Ambiguous — log + skip.
          if (!chosenKey) {
            skipCounts.ambiguous++;
            const candidates = candidateBucketKeys.map((k) => {
              const b = bucketByCompositeKey.get(k)?.[0];
              return { contact_id: b?.contact_id || null, contact_email: b?.contact_email || null };
            });
            const sample = bucketByCompositeKey.get(candidateBucketKeys[0])?.[0];
            await logSkip(supabase, "ambiguous_candidates", {
              campaign_id: sample?.campaign_id || null,
              sender_email: fromEmail,
              subject: msg.subject || null,
              conversation_id: msg.conversationId,
              received_at: receivedAt,
              correlation_id: correlationId,
              details: { candidates, reason: "no contact email matched sender" },
            });
            continue;
          }

          const chosenBucketSample = bucketByCompositeKey.get(chosenKey)?.[0];

          // CONTACT MISMATCH guard: if we resolved a chosenKey via fallback but the
          // fromEmail doesn't match the bucket contact, log and skip.
          if (
            chosenBucketSample?.contact_email &&
            fromEmail !== chosenBucketSample.contact_email
          ) {
            skipCounts.contact_mismatch++;
            await logSkip(supabase, "contact_mismatch", {
              campaign_id: chosenBucketSample.campaign_id,
              contact_id: chosenBucketSample.contact_id,
              contact_email: chosenBucketSample.contact_email,
              sender_email: fromEmail,
              subject: msg.subject || null,
              conversation_id: msg.conversationId,
              received_at: receivedAt,
              correlation_id: correlationId,
              details: { match_reasons: matchReasons },
            });
            continue;
          }

          const convEmails = bucketByCompositeKey.get(chosenKey) || [];
          const receivedTime = new Date(receivedAt).getTime();

          // CHRONOLOGY GATE
          const chronologicalParents = convEmails.filter((o) => {
            const outTime = new Date(o.communication_date || 0).getTime();
            return outTime <= receivedTime;
          });

          if (chronologicalParents.length === 0) {
            skipCounts.chronology++;
            const newest = convEmails
              .slice()
              .sort((a, b) => new Date(b.communication_date || 0).getTime() - new Date(a.communication_date || 0).getTime())[0];
            await logSkip(supabase, "chronology", {
              campaign_id: chosenBucketSample?.campaign_id || null,
              contact_id: chosenBucketSample?.contact_id || null,
              contact_email: chosenBucketSample?.contact_email || null,
              sender_email: fromEmail,
              subject: msg.subject || null,
              conversation_id: msg.conversationId,
              received_at: receivedAt,
              parent_communication_id: newest?.id || null,
              parent_subject: newest?.subject || null,
              parent_sent_at: newest?.communication_date || null,
              correlation_id: correlationId,
              details: { reason: "reply received before any outbound in bucket", bucket_size: convEmails.length },
            });
            continue;
          }

          // SUBJECT COMPATIBILITY GATE
          const eligibleParents = chronologicalParents.filter((o) =>
            areSubjectsCompatible(msg.subject, o.subject),
          );

          if (eligibleParents.length === 0) {
            skipCounts.subject_mismatch++;
            const newestChrono = chronologicalParents
              .slice()
              .sort((a, b) => new Date(b.communication_date || 0).getTime() - new Date(a.communication_date || 0).getTime())[0];
            await logSkip(supabase, "subject_mismatch", {
              campaign_id: chosenBucketSample?.campaign_id || null,
              contact_id: chosenBucketSample?.contact_id || null,
              contact_email: chosenBucketSample?.contact_email || null,
              sender_email: fromEmail,
              subject: msg.subject || null,
              conversation_id: msg.conversationId,
              received_at: receivedAt,
              parent_communication_id: newestChrono?.id || null,
              parent_subject: newestChrono?.subject || null,
              parent_sent_at: newestChrono?.communication_date || null,
              correlation_id: correlationId,
              details: {
                considered_parents: chronologicalParents.map((p) => ({
                  id: p.id, subject: p.subject, sent_at: p.communication_date,
                })),
              },
            });
            continue;
          }

          const originalEmail = eligibleParents.sort(
            (a, b) => new Date(b.communication_date || 0).getTime() - new Date(a.communication_date || 0).getTime(),
          )[0];

          if (!originalEmail) {
            skipCounts.no_parent++;
            await logSkip(supabase, "no_eligible_parent", {
              campaign_id: chosenBucketSample?.campaign_id || null,
              contact_id: chosenBucketSample?.contact_id || null,
              contact_email: chosenBucketSample?.contact_email || null,
              sender_email: fromEmail,
              subject: msg.subject || null,
              conversation_id: msg.conversationId,
              received_at: receivedAt,
              correlation_id: correlationId,
              details: { match_reasons: matchReasons },
            });
            continue;
          }

          console.log(
            `Reply matched: conv=${msg.conversationId} from=${fromEmail} ` +
            `-> contact=${chosenBucketSample?.contact_id} (email=${chosenBucketSample?.contact_email || "?"}) ` +
            `reasons=[${matchReasons.join(",")}]`
          );

          const cleanBody = extractReplyBody(msg);

          const { error: insertErr } = await supabase
            .from("campaign_communications")
            .insert({
              campaign_id: originalEmail.campaign_id,
              contact_id: originalEmail.contact_id,
              account_id: originalEmail.account_id || null,
              communication_type: "Email",
              subject: msg.subject || `Re: ${originalEmail.subject || ""}`,
              body: cleanBody || msg.bodyPreview || null,
              email_status: "Replied",
              delivery_status: "received",
              sent_via: "graph-sync",
              internet_message_id: msgInternetId,
              conversation_id: msg.conversationId,
              parent_id: originalEmail.id,
              owner: originalEmail.owner,
              created_by: originalEmail.created_by,
              notes: `Reply from ${fromName} (${fromEmail})${correlationId ? ` [correlation:${correlationId}]` : ""}`,
              communication_date: receivedAt,
            });

          if (insertErr) {
            console.error(`Failed to insert reply for conv ${msg.conversationId}:`, insertErr);
            continue;
          }

          totalRepliesFound++;
          existingSyncedIds.add(msgInternetId);
          allInternetMsgIds.add(msgInternetId);

          await supabase
            .from("campaign_communications")
            .update({ email_status: "Replied" })
            .eq("id", originalEmail.id);

          // Notifications
          try {
            const { data: campaignRow } = await supabase
              .from("campaigns")
              .select("campaign_name, owner, created_by")
              .eq("id", originalEmail.campaign_id)
              .maybeSingle();
            const campaignName = campaignRow?.campaign_name || "campaign";
            const recipients = new Set<string>();
            if (campaignRow?.owner) recipients.add(campaignRow.owner);
            if (campaignRow?.created_by) recipients.add(campaignRow.created_by);
            if (originalEmail.owner) recipients.add(originalEmail.owner);

            const message = `📩 New reply from ${fromName} on "${campaignName}"`;
            for (const userId of recipients) {
              await supabase.from("notifications").insert({
                user_id: userId,
                message,
                notification_type: "campaign_reply",
                module_type: "campaigns",
                module_id: originalEmail.campaign_id,
              });
            }
          } catch (notifErr) {
            console.error("Failed to insert reply notification:", notifErr);
          }

          if (originalEmail.internet_message_id) {
            const { data: historyRow } = await supabase
              .from("email_history")
              .select("reply_count")
              .eq("internet_message_id", originalEmail.internet_message_id)
              .maybeSingle();

            await supabase
              .from("email_history")
              .update({
                replied_at: receivedAt,
                last_reply_at: receivedAt,
                reply_count: (historyRow?.reply_count || 0) + 1,
              })
              .eq("internet_message_id", originalEmail.internet_message_id);
          }

          if (originalEmail.contact_id) {
            const { data: cc } = await supabase
              .from("campaign_contacts")
              .select("stage")
              .eq("campaign_id", originalEmail.campaign_id)
              .eq("contact_id", originalEmail.contact_id)
              .single();

            const stageRanks: Record<string, number> = {
              "Not Contacted": 0, "Email Sent": 1, "Phone Contacted": 2,
              "LinkedIn Contacted": 3, "Responded": 4, "Qualified": 5,
            };
            const currentRank = stageRanks[cc?.stage || "Not Contacted"] ?? 0;
            if (stageRanks["Responded"] > currentRank) {
              await supabase
                .from("campaign_contacts")
                .update({ stage: "Responded" })
                .eq("campaign_id", originalEmail.campaign_id)
                .eq("contact_id", originalEmail.contact_id);
            }
          }

          if (originalEmail.account_id) {
            const { data: acContacts } = await supabase
              .from("campaign_contacts")
              .select("stage")
              .eq("campaign_id", originalEmail.campaign_id)
              .eq("account_id", originalEmail.account_id);

            let derivedStatus = "Not Contacted";
            const contacts = acContacts || [];
            if (contacts.some((c: any) => c.stage === "Qualified")) derivedStatus = "Deal Created";
            else if (contacts.some((c: any) => c.stage === "Responded")) derivedStatus = "Responded";
            else if (contacts.some((c: any) => c.stage !== "Not Contacted")) derivedStatus = "Contacted";

            await supabase
              .from("campaign_accounts")
              .update({ status: derivedStatus })
              .eq("campaign_id", originalEmail.campaign_id)
              .eq("account_id", originalEmail.account_id);
          }
        }

        processedMailboxes.push(mailbox);
      } catch (mbErr) {
        console.error(`Error processing mailbox ${mailbox}:`, mbErr);
      }
    }

    const totalSkipped =
      skipCounts.chronology + skipCounts.subject_mismatch + skipCounts.contact_mismatch +
      skipCounts.ambiguous + skipCounts.no_parent;

    console.log(
      `Reply check complete: ${totalRepliesFound} new replies, ${totalSkipped} skipped ` +
      `(chronology=${skipCounts.chronology}, subject=${skipCounts.subject_mismatch}, contact=${skipCounts.contact_mismatch}, ambiguous=${skipCounts.ambiguous}, no_parent=${skipCounts.no_parent}) ` +
      `across ${processedMailboxes.length} mailboxes ${correlationId ? `correlation=${correlationId}` : ""}`
    );

    return new Response(JSON.stringify({
      message: "Reply check complete",
      correlation_id: correlationId,
      scanned: totalScanned,
      inserted: totalRepliesFound,
      skipped: skipCounts,
      mailboxesChecked: processedMailboxes.length,
      // Backwards-compatible fields used by existing UI:
      repliesFound: totalRepliesFound,
      skippedAmbiguous: skipCounts.ambiguous,
      durationMs: Date.now() - startedAt,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Unexpected error in check-email-replies:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
