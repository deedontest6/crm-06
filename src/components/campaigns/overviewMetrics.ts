// Shared metric helpers for Campaign Overview & Analytics so numbers always match Monitoring.

export interface EmailThread {
  threadId: string;
  contactId: string | null;
  accountId: string | null;
  lastDate: string | null;
  subject: string;
  outboundCount: number;
  inboundCount: number;
  hasReply: boolean;
  hasFailed: boolean;
  lastDirection: "outbound" | "inbound";
  messages: any[];
}

const isCallType = (t: string) => t === "Call" || t === "Phone";

export function getEmailThreads(comms: any[]): EmailThread[] {
  const groups: Record<string, any[]> = {};
  comms.forEach((c) => {
    if (c.communication_type !== "Email") return;
    const key = c.conversation_id || `solo-${c.id}`;
    (groups[key] ||= []).push(c);
  });
  return Object.entries(groups).map(([threadId, msgs]) => {
    const sorted = msgs
      .slice()
      .sort(
        (a, b) =>
          new Date(a.communication_date || 0).getTime() -
          new Date(b.communication_date || 0).getTime()
      );
    const last = sorted[sorted.length - 1];
    const outbound = sorted.filter((m) => m.sent_via !== "graph-sync");
    const inbound = sorted.filter((m) => m.sent_via === "graph-sync");
    return {
      threadId,
      contactId: last?.contact_id || null,
      accountId: last?.account_id || null,
      lastDate: last?.communication_date || null,
      subject: last?.subject || "Email",
      outboundCount: outbound.length,
      inboundCount: inbound.length,
      hasReply: inbound.length > 0,
      hasFailed: sorted.some(
        (m) => m.email_status === "Failed" || m.delivery_status === "failed"
      ),
      lastDirection: last?.sent_via === "graph-sync" ? "inbound" : "outbound",
      messages: sorted,
    };
  });
}

/**
 * Outbound-only thread filter — matches the dashboard tile rule
 * (RPC `get_campaign_aggregates_v2` uses `count(*) FILTER (WHERE has_outbound)`).
 * Pure-inbound threads (autoreplies, stray sync rows) are excluded.
 */
export function getOutboundEmailThreads(comms: any[]): EmailThread[] {
  return getEmailThreads(comms).filter((t) => t.outboundCount > 0);
}

export function getCallRows(comms: any[]) {
  return comms.filter((c) => isCallType(c.communication_type));
}
export function getLinkedInRows(comms: any[]) {
  return comms.filter((c) => c.communication_type === "LinkedIn");
}

export function getOutreachCounts(comms: any[]) {
  const threads = getEmailThreads(comms);
  const outboundThreads = threads.filter((t) => t.outboundCount > 0);
  const calls = getCallRows(comms);
  const linkedin = getLinkedInRows(comms);
  const contacts = getOutreachContactCounts(comms);
  // Tile rule: email = OUTBOUND thread count, call/linkedin = unique contacts.
  // Replies, follow-ups and pure-inbound threads must NOT inflate these numbers.
  const emailThreadCount = outboundThreads.length;
  // F7: uniqueTouchedContacts = single contact_id touched on ANY channel,
  // counted once. Used by the funnel to clamp `Contacted` to ≤ Total Contacts.
  const uniqueTouchedContacts = new Set<string>([
    ...contacts.emailContactIds,
    ...contacts.callContactIds,
    ...contacts.linkedinContactIds,
  ]).size;
  return {
    threads,
    outboundThreads,
    emailThreads: emailThreadCount,
    calls: contacts.callContacts,
    linkedin: contacts.linkedinContacts,
    total: emailThreadCount + contacts.callContacts + contacts.linkedinContacts,
    uniqueTouchedContacts,
    // Raw row counts kept for places that explicitly need them
    rawEmailThreads: threads.length,
    rawCalls: calls.length,
    rawLinkedin: linkedin.length,
  };
}

/**
 * Counts UNIQUE contacts touched per channel (the "10 contacted = 10" rule).
 * Replies, follow-ups and provider sync rows do NOT inflate these counts.
 * A contact reached on email AND phone counts once per channel (so 2 in total).
 */
export function getOutreachContactCounts(comms: any[]) {
  const emailSet = new Set<string>();
  const callSet = new Set<string>();
  const linkedinSet = new Set<string>();
  comms.forEach((c: any) => {
    if (!c.contact_id) return;
    const t = c.communication_type;
    if (t === "Email") {
      // Outbound only — exclude inbound provider sync rows
      if ((c.sent_via || "manual") !== "graph-sync") emailSet.add(c.contact_id);
    } else if (t === "Call" || t === "Phone") {
      callSet.add(c.contact_id);
    } else if (t === "LinkedIn") {
      linkedinSet.add(c.contact_id);
    }
  });
  return {
    emailContacts: emailSet.size,
    callContacts: callSet.size,
    linkedinContacts: linkedinSet.size,
    totalUniqueTouches: emailSet.size + callSet.size + linkedinSet.size,
    emailContactIds: emailSet,
    callContactIds: callSet,
    linkedinContactIds: linkedinSet,
  };
}

export function getRepliedThreads(comms: any[]) {
  // Only threads we initiated count as replies we earned.
  return getEmailThreads(comms).filter(
    (t) => t.outboundCount > 0 && t.hasReply
  );
}

export function getOpenedThreads(comms: any[]) {
  return getEmailThreads(comms).filter(
    (t) => t.outboundCount > 0 && t.messages.some((m: any) => m.opened_at)
  );
}

export interface FunnelData {
  total: number;
  contacted: number;
  responded: number;
  qualified: number;
  converted: number;
}

export function getFunnel(
  contacts: any[],
  comms: any[],
  deals: any[] = []
): FunnelData {
  const threads = getEmailThreads(comms);
  const callRows = getCallRows(comms);
  const liRows = getLinkedInRows(comms);

  const outboundContactIds = new Set<string>();
  threads.forEach((t) => {
    if (t.contactId && t.outboundCount > 0) outboundContactIds.add(t.contactId);
  });
  callRows.forEach((c) => c.contact_id && outboundContactIds.add(c.contact_id));
  liRows.forEach((c) => c.contact_id && outboundContactIds.add(c.contact_id));

  const inboundContactIds = new Set<string>();
  threads.forEach((t) => {
    if (t.contactId && t.inboundCount > 0) inboundContactIds.add(t.contactId);
  });

  const dealContactIds = new Set<string>(
    deals.map((d) => d.source_campaign_contact_id).filter(Boolean)
  );
  const dealAccountIds = new Set<string>(
    deals.map((d) => d.account_id).filter(Boolean)
  );

  let contacted = 0,
    responded = 0,
    qualified = 0,
    converted = 0;
  contacts.forEach((c: any) => {
    const stage = c.stage || "Not Contacted";
    const isContacted =
      stage !== "Not Contacted" || outboundContactIds.has(c.contact_id);
    const isResponded =
      stage === "Responded" ||
      stage === "Qualified" ||
      inboundContactIds.has(c.contact_id);
    const isQualified = stage === "Qualified";
    const isConverted =
      dealContactIds.has(c.contact_id) ||
      (c.account_id && dealAccountIds.has(c.account_id));
    if (isContacted) contacted++;
    if (isResponded) responded++;
    if (isQualified) qualified++;
    if (isConverted) converted++;
  });

  return { total: contacts.length, contacted, responded, qualified, converted };
}
