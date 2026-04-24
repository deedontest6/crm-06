import { useState, Fragment, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Plus, Search, MessageSquare, AlertTriangle, ChevronDown, ChevronRight, Phone, ArrowUpDown, Send, Mail, ListChecks, Reply, Linkedin, Info, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { format, formatDistanceToNow } from "date-fns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { EmailComposeModal } from "./EmailComposeModal";
import { stageRanks } from "./campaignUtils";
import { parseEmailBody } from "./emailBody";
import { SyncStatusPill } from "./SyncStatusPill";
import { isReachableEmail, isReachableLinkedIn, isReachablePhone, normalizeChannel, channelLabel, formatPhoneForDisplay } from "@/lib/email";
import { areSubjectsCompatible } from "@/utils/subjectNormalize";
import { Link } from "react-router-dom";

interface Props {
  campaignId: string;
  isCampaignEnded: boolean;
  viewMode?: "outreach" | "analytics";
  onViewModeChange?: (v: "outreach" | "analytics") => void;
  initialChannel?: "email" | "linkedin" | "call";
  initialStatusFilter?: "all" | "sent" | "replied" | "failed" | "bounced";
  initialThreadId?: string;
}

type OutreachTab = "email" | "linkedin" | "call";

// --- Channel reachability helpers (shared) ---
const hasEmail = (c: any) => isReachableEmail(c?.contacts?.email);
const hasLinkedIn = (c: any) => isReachableLinkedIn(c?.contacts?.linkedin);
const hasPhone = (c: any) =>
  isReachablePhone(c?.contacts?.phone_no) || isReachablePhone(c?.accounts?.phone);
const reachableFor = (channel: "Email" | "LinkedIn" | "Call" | "Phone", c: any) => {
  if (channel === "Email") return hasEmail(c);
  if (channel === "LinkedIn") return hasLinkedIn(c);
  return hasPhone(c); // Call / Phone
};

interface ColumnDef {
  key: string;
  label: string;
  sortable?: boolean;
  render: (c: any) => React.ReactNode;
  className?: string;
}

export function CampaignCommunications({ campaignId, isCampaignEnded, viewMode, onViewModeChange, initialChannel, initialStatusFilter, initialThreadId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { logCreate } = useCRUDAudit();
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [emailComposeOpen, setEmailComposeOpen] = useState(false);
  const [replyContext, setReplyContext] = useState<{ parent_id: string; thread_id: string | null; subject: string; contactId: string; internet_message_id?: string | null } | undefined>(undefined);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskContactId, setTaskContactId] = useState("");
  const [taskForm, setTaskForm] = useState({ title: "", description: "", due_date: "", priority: "Medium" });
  const [accountFilter, setAccountFilter] = useState("all");
  const [contactFilter, setContactFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [outreachTab, setOutreachTab] = useState<OutreachTab>("email");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [emailStatusFilter, setEmailStatusFilter] = useState<"all" | "sent" | "replied" | "failed" | "bounced">("all");
  const [linkedinStatusFilter, setLinkedinStatusFilter] = useState<"all" | "connectionSent" | "connected" | "messageSent" | "responded">("all");
  const [callStatusFilter, setCallStatusFilter] = useState<"all" | "interested" | "notInterested" | "callLater" | "noAnswer">("all");
  // B1: Eligible (reachable, no touch yet) | Touched (has at least one touch) | All — per LinkedIn/Call tab.
  const [linkedinScope, setLinkedinScope] = useState<"all" | "eligible" | "touched">("all");
  const [callScope, setCallScope] = useState<"all" | "eligible" | "touched">("all");
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [seededThreads, setSeededThreads] = useState<Set<string>>(new Set());
  const [viewFullEmail, setViewFullEmail] = useState<any | null>(null);
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [threadInitDone, setThreadInitDone] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<null | {
    correlation_id?: string;
    inserted?: number;
    scanned?: number;
    durationMs?: number;
    skipped?: Record<string, number>;
    scope?: { campaign_id?: string; contact_id?: string };
  }>(null);

  useEffect(() => {
    if (initialChannel) setOutreachTab(initialChannel);
    if (initialStatusFilter) setEmailStatusFilter(initialStatusFilter);
    if (initialStatusFilter === "replied") {
      setOutreachTab("email");
      setOpenThreads(new Set());
      setThreadInitDone(false);
    }
  }, [initialChannel, initialStatusFilter]);

  const toggleThreadOpen = (key: string) => {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleMessageExpanded = (id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Background auto-sync of email replies — every 60s while mounted, plus once 2s after mount.
  // Silent (no toasts). Failures only logged to console.
  const syncReplies = useCallback(async (manual = false) => {
    if (!manual && typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (manual) setIsSyncing(true);
    try {
      await supabase.functions.invoke("check-email-replies", { body: {} });
      queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
      setLastSyncedAt(new Date());
      if (manual) toast({ title: "Synced", description: "Email replies refreshed." });
    } catch (e) {
      console.error("Reply sync error:", e);
      if (manual) toast({ title: "Sync failed", description: "Could not refresh replies.", variant: "destructive" });
    } finally {
      if (manual) setIsSyncing(false);
    }
  }, [campaignId, queryClient]);

  // Manual scoped re-sync — POSTs { campaign_id, contact_id? } to check-email-replies
  // and surfaces the per-reason skip summary so users can deep-link into the audit log.
  const runResync = useCallback(async (contactIdScope?: string) => {
    setIsResyncing(true);
    try {
      const body: Record<string, string> = { campaign_id: campaignId };
      if (contactIdScope) body.contact_id = contactIdScope;
      const { data, error } = await supabase.functions.invoke("check-email-replies", { body });
      if (error) throw error;
      const result = (data as any) || {};
      setResyncResult({
        correlation_id: result.correlation_id,
        inserted: result.inserted ?? 0,
        scanned: result.scanned ?? 0,
        durationMs: result.durationMs,
        skipped: result.skipped || {},
        scope: { campaign_id: campaignId, contact_id: contactIdScope },
      });
      queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
      setLastSyncedAt(new Date());
    } catch (e: any) {
      console.error("Re-sync error:", e);
      toast({ title: "Re-sync failed", description: e?.message || "Could not re-sync replies.", variant: "destructive" });
    } finally {
      setIsResyncing(false);
    }
  }, [campaignId, queryClient]);

  useEffect(() => {
    const initial = setTimeout(syncReplies, 2000);
    const interval = setInterval(syncReplies, 60_000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [syncReplies]);

  // Visibility-change: when the tab becomes visible after being hidden for >2 min,
  // trigger an immediate background sync so users see fresh replies right away.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let hiddenSince: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
      } else if (document.visibilityState === "visible") {
        const wasAwayMs = hiddenSince ? Date.now() - hiddenSince : 0;
        hiddenSince = null;
        if (wasAwayMs > 2 * 60_000) {
          void syncReplies();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [syncReplies]);

  // Realtime sync: keep contact/account info fresh in dropdowns so reachability
  // (email / linkedin / phone) updates within seconds of an edit elsewhere.
  // Scoped to this campaign's join tables to avoid invalidating on unrelated edits.
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    };
    const channel = supabase
      .channel(`campaign-comms-sync-${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_contacts", filter: `campaign_id=eq.${campaignId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_accounts", filter: `campaign_id=eq.${campaignId}` }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [campaignId, queryClient]);

  // Reuse the shared query keys from useCampaignDetail so React Query dedupes
  // these requests instead of refetching the same data per component.
  const { data: communications = [], refetch } = useQuery({
    queryKey: ["campaign-communications", campaignId, "monitoring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("*, contacts(contact_name, email), accounts(account_name)")
        .eq("campaign_id", campaignId)
        .order("communication_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const { data: campaignContacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId, "monitoring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("*, contacts(contact_name, email, company_name, position, region, linkedin, phone_no), accounts(account_name, phone)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const { data: campaignAccounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId, "monitoring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("*, accounts(account_name, industry, region, country)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const { data: phoneScripts = [] } = useQuery({
    queryKey: ["campaign-phone-scripts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_phone_scripts").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Campaign metadata for primary-channel labelling
  const { data: campaignMeta } = useQuery({
    queryKey: ["campaign-primary-channel", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("primary_channel, enabled_channels")
        .eq("id", campaignId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const primaryChannel = (campaignMeta?.primary_channel || "").trim();
  // Resolve enabled channels (multi-channel) with legacy fallback to primary_channel.
  const enabledChannels = useMemo<string[]>(() => {
    const raw = (campaignMeta as any)?.enabled_channels as string[] | null | undefined;
    const norm = (v: string) => (v === "Call" ? "Phone" : v);
    if (raw && raw.length > 0) return raw.map(norm).filter((v) => ["Email", "Phone", "LinkedIn"].includes(v));
    if (primaryChannel) return [norm(primaryChannel)];
    return ["Email", "Phone", "LinkedIn"];
  }, [campaignMeta, primaryChannel]);
  const enableEmail = enabledChannels.includes("Email");
  const enablePhone = enabledChannels.includes("Phone");
  const enableLinkedIn = enabledChannels.includes("LinkedIn");

  // Snap outreach tab to the first enabled channel if current one is disabled.
  useEffect(() => {
    const tabAllowed =
      (outreachTab === "email" && enableEmail) ||
      (outreachTab === "linkedin" && enableLinkedIn) ||
      (outreachTab === "call" && enablePhone);
    if (tabAllowed) return;
    if (enableEmail) setOutreachTab("email");
    else if (enableLinkedIn) setOutreachTab("linkedin");
    else if (enablePhone) setOutreachTab("call");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableEmail, enableLinkedIn, enablePhone]);

  // Note: per-contact outreach timeline is fetched inside the Log Outreach modal
  // (see logForm.contact_id-keyed useQuery below `logForm` declaration).

  const ownerIds = [...new Set(communications.map((c: any) => c.owner).filter(Boolean))] as string[];
  const { displayNames } = useUserDisplayNames(ownerIds);

  // --- Channel-filtered data ---
  const isCall = (type: string) => type === "Call" || type === "Phone";
  const emailComms = useMemo(() => communications.filter((c: any) => c.communication_type === "Email"), [communications]);
  const linkedinComms = useMemo(() => communications.filter((c: any) => c.communication_type === "LinkedIn"), [communications]);
  const callComms = useMemo(() => communications.filter((c: any) => isCall(c.communication_type)), [communications]);

  // --- Channel stats ---
  // Sent = count of distinct outbound emails (deduped by internet_message_id when present)
  //   so Outlook auto-resyncs cannot inflate the number with duplicates.
  // Replied = count of distinct (conversation_id + contact_id) buckets with a graph-sync row
  //   so Outlook reusing one conversationId across recipients does NOT count once for everyone.
  const emailStats = useMemo(() => {
    const outboundIds = new Set<string>();
    let outboundFallback = 0;
    for (const c of emailComms) {
      if (c.sent_via !== "azure" && c.sent_via !== "manual") continue;
      if (c.internet_message_id) outboundIds.add(c.internet_message_id);
      else outboundFallback++;
    }
    const inboundBuckets = new Set<string>();
    for (const c of emailComms) {
      if (c.sent_via !== "graph-sync") continue;
      if (!c.conversation_id) continue;
      inboundBuckets.add(`${c.conversation_id}::${c.contact_id || "no-contact"}`);
    }
    return {
      sent: outboundIds.size + outboundFallback,
      replied: inboundBuckets.size,
      bounced: emailComms.filter((c: any) => c.email_status === "Bounced").length,
      failed: emailComms.filter((c: any) => c.email_status === "Failed").length,
    };
  }, [emailComms]);

  const linkedinStats = useMemo(() => ({
    connectionSent: linkedinComms.filter((c: any) => c.linkedin_status === "Connection Sent").length,
    connected: linkedinComms.filter((c: any) => c.linkedin_status === "Connected").length,
    messageSent: linkedinComms.filter((c: any) => c.linkedin_status === "Message Sent" || c.linkedin_status === "InMail Sent").length,
    responded: linkedinComms.filter((c: any) => c.linkedin_status === "Responded").length,
  }), [linkedinComms]);

  const callStats = useMemo(() => ({
    interested: callComms.filter((c: any) => c.call_outcome === "Interested").length,
    notInterested: callComms.filter((c: any) => c.call_outcome === "Not Interested").length,
    callLater: callComms.filter((c: any) => c.call_outcome === "Call Later").length,
    noAnswer: callComms.filter((c: any) => c.call_outcome === "No Answer" || c.call_outcome === "Voicemail").length,
  }), [callComms]);

  // --- Threads: group emails by COMPOSITE (conversation_id + contact_id) so that
  // when Outlook reuses one conversationId across multiple recipients with the
  // same subject, each contact still gets their own thread. This is the
  // defense-in-depth UI layer that complements the edge-function fix.
  // Inbound graph-sync rows whose sender does not match the bucket's contact
  // email are filtered out as "orphans" and surfaced separately.
  const SENDER_RE = /\(([^)]+@[^)]+)\)/;
  const extractSenderEmailFromNotes = (notes?: string | null): string | null => {
    if (!notes) return null;
    const m = notes.match(SENDER_RE);
    return m ? m[1].trim().toLowerCase() : null;
  };

  const { threads, orphanReplies } = useMemo(() => {
    const emailThreads: Record<string, any[]> = {};
    const contactActivity: Record<string, any[]> = {};
    const orphans: any[] = [];

    communications.forEach((c: any) => {
      if (c.communication_type === "Email" && c.conversation_id) {
        // Composite key: conversation_id + contact_id
        const key = `${c.conversation_id}::${c.contact_id || "no-contact"}`;
        if (!emailThreads[key]) emailThreads[key] = [];
        emailThreads[key].push(c);
      } else if (c.communication_type === "Email") {
        // Standalone email (no conversation thread) — keep on Email tab
        const key = `solo-${c.id}`;
        emailThreads[key] = [c];
      } else {
        const key = c.contact_id || "no-contact";
        if (!contactActivity[key]) contactActivity[key] = [];
        contactActivity[key].push(c);
      }
    });

    const result: any[] = [];

    // Email conversation threads — drop inbound rows whose sender email does
    // NOT match the bucket's contact email (orphan replies). These are
    // surfaced separately at the bottom of the Email tab. Also drop inbound
    // rows whose normalized subject is incompatible with the parent thread
    // (defense-in-depth UI mirror of the edge-function guard).
    Object.entries(emailThreads).forEach(([compositeKey, msgs]) => {
      const sample = msgs[0];
      const contactEmail = (sample?.contacts?.email || "").trim().toLowerCase();
      // Parent subject = first outbound (or first message) in the bucket.
      const parentForSubject =
        msgs.find((m) => (m.sent_via || "manual") !== "graph-sync") || msgs[0];
      const parentSubject = parentForSubject?.subject || "";
      const cleanedMsgs: any[] = [];
      for (const m of msgs) {
        if (m.sent_via === "graph-sync" && contactEmail) {
          const senderEmail = extractSenderEmailFromNotes(m.notes);
          if (senderEmail && senderEmail !== contactEmail) {
            orphans.push(m);
            continue;
          }
          if (parentSubject && m.subject && !areSubjectsCompatible(parentSubject, m.subject)) {
            orphans.push(m);
            continue;
          }
        }
        cleanedMsgs.push(m);
      }
      if (cleanedMsgs.length === 0) return;

      const sorted = cleanedMsgs.sort((a, b) => new Date(a.communication_date || 0).getTime() - new Date(b.communication_date || 0).getTime());
      const lastMsg = sorted[sorted.length - 1];
      const hasReply = sorted.some((m) => m.sent_via === "graph-sync");
      const hasFailed = sorted.some((m) => m.email_status === "Failed" || m.delivery_status === "failed");
      // Channel counts must reflect outbound only — inbound graph-sync rows
      // should not inflate the "Email N" badge ("1 sent, 1 reply" not "2").
      const outboundCount = sorted.filter((m) => (m.sent_via || "manual") !== "graph-sync").length;
      result.push({
        contactId: lastMsg?.contact_id || "no-contact",
        contactName: lastMsg?.contacts?.contact_name || "Unknown",
        contactEmail: lastMsg?.contacts?.email || "",
        accountName: lastMsg?.accounts?.account_name || "",
        messages: sorted,
        lastActivity: lastMsg?.communication_date,
        threadType: "email",
        threadLabel: lastMsg?.subject || "Email Thread",
        hasReply,
        hasFailed,
        compositeKey,
        channelCounts: { Email: outboundCount, Call: 0, LinkedIn: 0 },
      });
    });

    // Contact activity groups (non-email or non-threaded)
    Object.entries(contactActivity).forEach(([contactId, msgs]) => {
      const sorted = msgs.sort((a, b) => new Date(a.communication_date || 0).getTime() - new Date(b.communication_date || 0).getTime());
      const lastMsg = sorted[sorted.length - 1];
      result.push({
        contactId,
        contactName: lastMsg?.contacts?.contact_name || "Unknown",
        accountName: lastMsg?.accounts?.account_name || "",
        messages: sorted,
        lastActivity: lastMsg?.communication_date,
        threadType: "activity",
        threadLabel: `${lastMsg?.contacts?.contact_name || "Unknown"} — Activity`,
        hasReply: false,
        channelCounts: {
          Email: msgs.filter(m => m.communication_type === "Email").length,
          Call: msgs.filter(m => isCall(m.communication_type)).length,
          LinkedIn: msgs.filter(m => m.communication_type === "LinkedIn").length,
        },
      });
    });

    return {
      threads: result.sort((a, b) => new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime()),
      orphanReplies: orphans.sort((a, b) => new Date(b.communication_date || 0).getTime() - new Date(a.communication_date || 0).getTime()),
    };
  }, [communications]);

  const [logForm, setLogForm] = useState({
    communication_type: "Call", contact_id: "", subject: "", body: "", notes: "", linkedin_profile_url: "",
    email_status: "Sent", call_outcome: "", linkedin_status: "Connection Sent",
  });

  // Per-contact outreach timeline for the Log Outreach modal
  const [showTimeline, setShowTimeline] = useState(false);
  const { data: contactTimeline = [], isLoading: timelineLoading } = useQuery({
    queryKey: ["contact-outreach-timeline", campaignId, logForm.contact_id],
    enabled: logModalOpen && !!logForm.contact_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("id, communication_type, communication_date, email_status, linkedin_status, call_outcome, notes, subject, owner")
        .eq("campaign_id", campaignId)
        .eq("contact_id", logForm.contact_id)
        .order("communication_date", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data || [];
    },
  });

  const [timelineChannelTab, setTimelineChannelTab] = useState<"all" | "Email" | "LinkedIn" | "Call">("all");
  const filteredTimeline = useMemo(() => {
    if (timelineChannelTab === "all") return contactTimeline;
    if (timelineChannelTab === "Call") {
      return contactTimeline.filter((t: any) => t.communication_type === "Call" || t.communication_type === "Phone");
    }
    return contactTimeline.filter((t: any) => t.communication_type === timelineChannelTab);
  }, [contactTimeline, timelineChannelTab]);
  const timelineCounts = useMemo(() => ({
    all: contactTimeline.length,
    Email: contactTimeline.filter((t: any) => t.communication_type === "Email").length,
    LinkedIn: contactTimeline.filter((t: any) => t.communication_type === "LinkedIn").length,
    Call: contactTimeline.filter((t: any) => t.communication_type === "Call" || t.communication_type === "Phone").length,
  }), [contactTimeline]);

  // Resolve owner display names for timeline rows
  const timelineOwnerIds = useMemo(
    () => Array.from(new Set(contactTimeline.map((t: any) => t.owner).filter(Boolean))) as string[],
    [contactTimeline],
  );
  const { displayNames: timelineOwnerNames } = useUserDisplayNames(timelineOwnerIds);

  // --- Handlers (unchanged logic) ---
  const handleLogCommunication = async () => {
    if (isCampaignEnded) {
      toast({ title: "Campaign ended", description: "No further outreach can be logged.", variant: "destructive" });
      return;
    }
    // For LinkedIn, append profile URL to notes if provided
    let finalNotes = logForm.notes || null;
    if (logForm.communication_type === "LinkedIn" && logForm.linkedin_profile_url?.trim()) {
      const url = logForm.linkedin_profile_url.trim();
      finalNotes = finalNotes ? `${finalNotes}\nProfile: ${url}` : `Profile: ${url}`;
    }
    const contactRecord = campaignContacts.find((cc: any) => cc.contact_id === logForm.contact_id);
    const accountId = contactRecord?.account_id || null;
    const { data: inserted, error } = await supabase.from("campaign_communications").insert({
      campaign_id: campaignId, contact_id: logForm.contact_id || null,
      account_id: accountId, communication_type: logForm.communication_type,
      subject: logForm.subject || null, body: logForm.body || null,
      notes: finalNotes,
      email_status: logForm.communication_type === "Email" ? logForm.email_status : null,
      call_outcome: isCall(logForm.communication_type) ? logForm.call_outcome : null,
      linkedin_status: logForm.communication_type === "LinkedIn" ? logForm.linkedin_status : null,
      delivery_status: logForm.communication_type === "Email" ? "manual" : null,
      sent_via: "manual",
      owner: user!.id, created_by: user!.id,
      communication_date: new Date().toISOString(),
    }).select("id").single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    if (logForm.contact_id) {
      const channelStageMap: Record<string, string> = { Email: "Email Sent", Call: "Phone Contacted", Phone: "Phone Contacted", LinkedIn: "LinkedIn Contacted" };
      const newStage = channelStageMap[logForm.communication_type];
      const newRank = stageRanks[newStage] ?? 0;
      const { data: currentContact } = await supabase
        .from("campaign_contacts").select("stage")
        .eq("campaign_id", campaignId).eq("contact_id", logForm.contact_id).single();
      const currentRank = stageRanks[currentContact?.stage || "Not Contacted"] ?? 0;
      if (newRank > currentRank) {
        await supabase.from("campaign_contacts").update({ stage: newStage })
          .eq("campaign_id", campaignId).eq("contact_id", logForm.contact_id);
      }

      // Also persist linkedin_status on the campaign_contacts row whenever a
      // LinkedIn touch is logged — otherwise the field stays at default forever
      // and any stage analytics on it is wrong.
      if (logForm.communication_type === "LinkedIn" && logForm.linkedin_status) {
        await supabase
          .from("campaign_contacts")
          .update({ linkedin_status: logForm.linkedin_status })
          .eq("campaign_id", campaignId)
          .eq("contact_id", logForm.contact_id);
      }
    }

    if (accountId) {
      const { data: acContacts } = await supabase.from("campaign_contacts")
        .select("stage").eq("campaign_id", campaignId).eq("account_id", accountId);
      const contacts = acContacts || [];
      let derivedStatus = "Not Contacted";
      if (contacts.some((c: any) => c.stage === "Qualified")) derivedStatus = "Deal Created";
      else if (contacts.some((c: any) => c.stage === "Responded")) derivedStatus = "Responded";
      else if (contacts.some((c: any) => c.stage !== "Not Contacted")) derivedStatus = "Contacted";
      await supabase.from("campaign_accounts").update({ status: derivedStatus })
        .eq("campaign_id", campaignId).eq("account_id", accountId);
    }

    queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    // B8: refresh per-contact timeline so reopening the modal shows the new touch immediately.
    if (logForm.contact_id) {
      queryClient.invalidateQueries({ queryKey: ["contact-outreach-timeline", campaignId, logForm.contact_id] });
    }
    setLogModalOpen(false);
    await logCreate('campaign_communications', inserted?.id || '', {
      campaign_id: campaignId, communication_type: logForm.communication_type,
      contact_id: logForm.contact_id, subject: logForm.subject,
    });
    setLogForm({ communication_type: "Call", contact_id: "", subject: "", body: "", notes: "", linkedin_profile_url: "", email_status: "Sent", call_outcome: "", linkedin_status: "Connection Sent" });
    toast({ title: "Communication logged" });
  };

  const handleCreateTask = async () => {
    if (!taskForm.title.trim()) { toast({ title: "Task title is required", variant: "destructive" }); return; }
    // Enrich description with contact/account info for CampaignActionItems parsing
    let enrichedDescription = taskForm.description || "";
    if (taskContactId) {
      const contact = campaignContacts.find((cc: any) => cc.contact_id === taskContactId);
      const contactName = contact?.contacts?.contact_name || "";
      const accountId = contact?.account_id;
      const account = accountId ? campaignAccounts.find((ca: any) => ca.account_id === accountId) : null;
      const accountName = account?.accounts?.account_name || "";
      const prefix = `Contact: ${contactName}${accountName ? ` | Account: ${accountName}` : ""}`;
      enrichedDescription = enrichedDescription ? `${prefix}\n${enrichedDescription}` : prefix;
    }
    const { data: inserted, error } = await supabase.from("action_items").insert({
      title: taskForm.title, description: enrichedDescription || null,
      due_date: taskForm.due_date || null, priority: taskForm.priority,
      status: "Open", module_type: "campaigns", module_id: campaignId,
      created_by: user!.id, assigned_to: user!.id,
    }).select("id").single();
    if (error) { toast({ title: "Error creating task", description: error.message, variant: "destructive" }); return; }
    await logCreate('action_items', inserted?.id || '', { title: taskForm.title, module_type: 'campaigns', campaign_id: campaignId, contact_id: taskContactId });
    setTaskModalOpen(false);
    setTaskForm({ title: "", description: "", due_date: "", priority: "Medium" });
    setTaskContactId("");
    toast({ title: "Task created" });
  };

  const openTaskForContact = (contactId: string, contactName: string) => {
    setTaskContactId(contactId);
    setTaskForm({ title: `Follow up with ${contactName}`, description: "", due_date: "", priority: "Medium" });
    setTaskModalOpen(true);
  };

  const openReply = (msg: any) => {
    setReplyContext({
      parent_id: msg.id,
      thread_id: msg.thread_id || msg.id,
      subject: msg.subject || "",
      contactId: msg.contact_id,
      internet_message_id: msg.internet_message_id || null, // A4
    });
    setEmailComposeOpen(true);
  };

  const handleEmailSent = async (sentContactId?: string) => {
    if (sentContactId) {
      const newStage = "Email Sent";
      const newRank = stageRanks[newStage] ?? 0;
      const { data: currentContact } = await supabase
        .from("campaign_contacts").select("stage, account_id")
        .eq("campaign_id", campaignId).eq("contact_id", sentContactId).single();
      const currentRank = stageRanks[currentContact?.stage || "Not Contacted"] ?? 0;
      if (newRank > currentRank) {
        await supabase.from("campaign_contacts").update({ stage: newStage })
          .eq("campaign_id", campaignId).eq("contact_id", sentContactId);
      }
      const accountId = currentContact?.account_id;
      if (accountId) {
        const { data: acContacts } = await supabase.from("campaign_contacts")
          .select("stage").eq("campaign_id", campaignId).eq("account_id", accountId);
        const acList = acContacts || [];
        let derivedStatus = "Not Contacted";
        if (acList.some((c: any) => c.stage === "Qualified")) derivedStatus = "Deal Created";
        else if (acList.some((c: any) => c.stage === "Responded")) derivedStatus = "Responded";
        else if (acList.some((c: any) => c.stage !== "Not Contacted")) derivedStatus = "Contacted";
        await supabase.from("campaign_accounts").update({ status: derivedStatus })
          .eq("campaign_id", campaignId).eq("account_id", accountId);
      }
    }
    // Stage update only. Query invalidation is debounced via onBatchComplete
    // (single refetch after the whole batch) to avoid N refetches in bulk mode.
  };

  const handleBatchComplete = () => {
    queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
  };

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openLogModal = (channel: string) => {
    // Auto-select the sole eligible contact for the channel so the user doesn't
    // have to click a one-item dropdown.
    const eligible = campaignContacts.filter((cc: any) => reachableFor(channel as any, cc));
    const autoContactId = eligible.length === 1 ? eligible[0].contact_id : "";
    setLogForm({
      communication_type: channel,
      contact_id: autoContactId,
      subject: "",
      body: "",
      notes: "",
      linkedin_profile_url: "",
      email_status: "Sent",
      call_outcome: "",
      linkedin_status: "Connection Sent",
    });
    setLogModalOpen(true);
  };

  // --- Filtering ---
  const applyFilters = (data: any[]) => {
    return data.filter((c: any) => {
      if (accountFilter !== "all" && c.account_id !== accountFilter) return false;
      if (contactFilter !== "all" && c.contact_id !== contactFilter) return false;
      if (ownerFilter !== "all" && c.owner !== ownerFilter) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const match = c.contacts?.contact_name?.toLowerCase().includes(q) ||
          c.accounts?.account_name?.toLowerCase().includes(q) ||
          c.subject?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  };

  const applySort = (data: any[]) => {
    return [...data].sort((a, b) => {
      const dateA = new Date(a.communication_date || 0).getTime();
      const dateB = new Date(b.communication_date || 0).getTime();
      return sortAsc ? dateA - dateB : dateB - dateA;
    });
  };



  const emailFiltered = useMemo(() => applySort(applyFilters(emailComms)), [emailComms, accountFilter, contactFilter, ownerFilter, searchTerm, sortAsc]);
  const linkedinFiltered = useMemo(() => {
    const base = applySort(applyFilters(linkedinComms));
    if (linkedinStatusFilter === "all") return base;
    const map: Record<string, (c: any) => boolean> = {
      connectionSent: (c) => c.linkedin_status === "Connection Sent",
      connected: (c) => c.linkedin_status === "Connected",
      messageSent: (c) => c.linkedin_status === "Message Sent" || c.linkedin_status === "InMail Sent",
      responded: (c) => c.linkedin_status === "Responded",
    };
    return base.filter(map[linkedinStatusFilter] || (() => true));
  }, [linkedinComms, accountFilter, contactFilter, ownerFilter, searchTerm, sortAsc, linkedinStatusFilter]);
  const callFiltered = useMemo(() => {
    const base = applySort(applyFilters(callComms));
    if (callStatusFilter === "all") return base;
    const map: Record<string, (c: any) => boolean> = {
      interested: (c) => c.call_outcome === "Interested",
      notInterested: (c) => c.call_outcome === "Not Interested",
      callLater: (c) => c.call_outcome === "Call Later",
      noAnswer: (c) => c.call_outcome === "No Answer" || c.call_outcome === "Voicemail",
    };
    return base.filter(map[callStatusFilter] || (() => true));
  }, [callComms, accountFilter, contactFilter, ownerFilter, searchTerm, sortAsc, callStatusFilter]);

  // Email threads — normalized after filtering. Header counts/badges always
  // reflect the messages that are actually rendered. Stable threadKey prevents
  // index-based key churn between renders.
  const normalizeSubjectRoot = (s?: string | null): string =>
    (s || "").replace(/^\s*(re|fw|fwd)\s*:\s*/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  const emailThreadsFiltered = useMemo(() => {
    return threads
      .filter((t) => t.threadType === "email")
      .map((t) => {
        const visible = applyFilters(t.messages);
        if (visible.length === 0) return null;
        // FINAL GUARD (defense-in-depth): even after composite-key bucketing
        // and orphan extraction, re-validate every message belongs to this
        // contact thread so a stale row can never visually leak across threads.
        const bucketContactId = t.contactId || "no-contact";
        const bucketContactEmail = (t.contactEmail || "").trim().toLowerCase();
        // Build a quick lookup of outbound rows in this bucket so inbound
        // replies can be validated against their parent's date + subject.
        const outboundById = new Map<string, any>();
        for (const m of visible) {
          if ((m.sent_via || "manual") !== "graph-sync") outboundById.set(m.id, m);
        }
        const outboundList = Array.from(outboundById.values());
        const guarded = visible.filter((m: any) => {
          const isInbound = m.sent_via === "graph-sync";
          const msgContactId = m.contact_id || "no-contact";
          if (!isInbound) return msgContactId === bucketContactId;
          // Inbound: contact_id must match AND sender email (from notes) must
          // equal the bucket's contact email when both are known.
          if (msgContactId !== bucketContactId) return false;
          if (bucketContactEmail) {
            const senderEmail = extractSenderEmailFromNotes(m.notes);
            if (senderEmail && senderEmail !== bucketContactEmail) return false;
          }
          // CHRONOLOGY + SUBJECT GUARD: an inbound reply must occur after
          // some outbound in this bucket, and its subject root must match
          // that outbound. Hides historical inbox rows attached to a future
          // outbound by Outlook conversationId reuse.
          const inboundTime = new Date(m.communication_date || 0).getTime();
          const inboundRoot = normalizeSubjectRoot(m.subject);
          // Prefer the explicit parent if present and valid.
          const parent = m.parent_id ? outboundById.get(m.parent_id) : null;
          const candidates = parent
            ? [parent]
            : outboundList.filter(
                (o) => new Date(o.communication_date || 0).getTime() <= inboundTime,
              );
          if (candidates.length === 0) return false;
          // Require at least one candidate that satisfies BOTH chronology
          // (outbound <= inbound) AND subject compatibility.
          const ok = candidates.some((o) => {
            const outTime = new Date(o.communication_date || 0).getTime();
            if (outTime > inboundTime) return false;
            const outRoot = normalizeSubjectRoot(o.subject);
            if (!inboundRoot || !outRoot) return true;
            return inboundRoot === outRoot || inboundRoot.includes(outRoot) || outRoot.includes(inboundRoot);
          });
          return ok;
        });
        if (guarded.length === 0) return null;
        // Sort newest -> oldest for an Outlook-style latest-on-top reader.
        const sorted = [...guarded].sort(
          (a, b) =>
            new Date(b.communication_date || 0).getTime() -
            new Date(a.communication_date || 0).getTime()
        );
        const newest = sorted[0];
        const hasReply = sorted.some((m) => m.sent_via === "graph-sync");
        const hasFailed = sorted.some(
          (m) => m.email_status === "Failed" || m.delivery_status === "failed"
        );
        const messages = sorted.map((m) => {
          const isInbound = m.sent_via === "graph-sync";
          const isFailed =
            m.email_status === "Failed" || m.delivery_status === "failed";
          let kind: "outbound-first" | "outbound-reply" | "inbound-reply" | "failed" =
            "outbound-first";
          if (isFailed) kind = "failed";
          else if (isInbound) kind = "inbound-reply";
          else if (m.parent_id) kind = "outbound-reply";
          const parsed = parseEmailBody(m.body);
          return { ...m, kind, parsed };
        });
        // threadKey is the COMPOSITE (conversation_id + contact_id) so two
        // contacts on the same Outlook conversationId never collide visually.
        const threadKey =
          t.compositeKey ||
          (newest?.conversation_id ? `${newest.conversation_id}::${newest.contact_id || "no-contact"}` : `solo-${newest?.id}`);
        return {
          ...t,
          threadKey,
          messages,
          messageCount: messages.length,
          hasReply,
          hasFailed,
          threadLabel: newest?.subject || t.threadLabel || "Email Thread",
          lastActivity: newest?.communication_date,
        };
      })
      .filter(Boolean)
      .filter((t: any) => {
        // Outbound-required rule (matches dashboard tile / RPC `has_outbound`):
        // hide pure-inbound threads (autoreplies / stray sync rows) so the
        // header count agrees with the Monitoring tile.
        return t.messages.some((m: any) => (m.sent_via || "manual") !== "graph-sync");
      })
      .filter((t: any) => {
        if (emailStatusFilter === "all") return true;
        if (emailStatusFilter === "sent") return t.messages.some((m: any) => m.sent_via === "azure" || m.sent_via === "manual");
        if (emailStatusFilter === "replied") return t.hasReply;
        if (emailStatusFilter === "failed") return t.hasFailed;
        if (emailStatusFilter === "bounced") return t.messages.some((m: any) => m.email_status === "Bounced");
        return true;
      }) as any[];
  }, [threads, accountFilter, contactFilter, ownerFilter, searchTerm, emailStatusFilter]);

  // Seed the newest message of each thread as expanded-by-default exactly once
  // per threadKey. After this, users can freely toggle (collapse/re-expand) any
  // message and the state persists across thread Collapsible open/close.
  useEffect(() => {
    const newSeeds: Array<{ threadKey: string; msgId: string }> = [];
    for (const t of emailThreadsFiltered) {
      if (!t?.threadKey || seededThreads.has(t.threadKey)) continue;
      // Reader sorts newest -> oldest, so the newest message is at index 0.
      const newest = t.messages?.[0];
      if (newest?.id) newSeeds.push({ threadKey: t.threadKey, msgId: newest.id });
    }
    if (newSeeds.length === 0) return;
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      for (const s of newSeeds) next.add(s.msgId);
      return next;
    });
    setSeededThreads((prev) => {
      const next = new Set(prev);
      for (const s of newSeeds) next.add(s.threadKey);
      return next;
    });
  }, [emailThreadsFiltered, seededThreads]);

  // Select the first (newest) thread by default once. If an initialThreadId
  // was provided (drilldown from Overview), select that exact thread instead.
  useEffect(() => {
    if (threadInitDone || emailThreadsFiltered.length === 0) return;
    let targetKey: string | undefined;
    if (initialThreadId) {
      // initialThreadId may be a raw conversation_id, a composite key, or a `solo-` key.
      targetKey = emailThreadsFiltered.find((t: any) => t.threadKey === initialThreadId)?.threadKey
        || emailThreadsFiltered.find((t: any) => t.threadKey?.startsWith(`${initialThreadId}::`))?.threadKey;
    }
    const firstKey = targetKey || emailThreadsFiltered[0]?.threadKey;
    if (firstKey) setSelectedThreadKey(firstKey);
    setThreadInitDone(true);
  }, [emailThreadsFiltered, threadInitDone, initialThreadId, initialStatusFilter]);

  // Reset selection if it no longer exists after filtering.
  useEffect(() => {
    if (!selectedThreadKey) return;
    if (!emailThreadsFiltered.some((t: any) => t.threadKey === selectedThreadKey)) {
      setSelectedThreadKey(emailThreadsFiltered[0]?.threadKey || null);
    }
  }, [emailThreadsFiltered, selectedThreadKey]);


  // --- Badges ---
  const channelBadge = (type: string) => {
    const normalizedType = type === "Phone" ? "Call" : type;
    const colors: Record<string, string> = {
      Email: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      Call: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      LinkedIn: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    };
    return <Badge className={colors[normalizedType] || ""} variant="secondary">{normalizedType}</Badge>;
  };

  const deliveryBadge = (commType: string, status: string | null) => {
    const normalizedType = commType === "Phone" ? "Call" : commType;
    if (normalizedType === "Call" || normalizedType === "LinkedIn") return null;
    if (!status) return null;
    const colors: Record<string, string> = {
      sent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      manual: "bg-muted text-muted-foreground",
    };
    const displayLabel = status === "manual" ? "Logged" : status;
    return <Badge className={`text-[10px] ${colors[status] || ""}`} variant="secondary">{displayLabel}</Badge>;
  };

  const accountOptions = campaignAccounts.map((ca: any) => ({ id: ca.account_id, name: ca.accounts?.account_name || "Unknown" }));
  const contactOptions = campaignContacts.map((cc: any) => ({ id: cc.contact_id, name: cc.contacts?.contact_name || "Unknown" }));

  // --- Shared table renderer ---
  const renderCommTable = (data: any[], columns: ColumnDef[], showChannelCol: boolean) => {
    if (data.length === 0) {
      // B5: provide CTA hint for non-email empty states.
      const cta =
        outreachTab === "linkedin"
          ? "Use Log LinkedIn above to record a touch."
          : outreachTab === "call"
          ? "Use Log Call above to record a touch."
          : "";
      return (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No outreach logged yet.</p>
          {cta && <p className="text-xs text-muted-foreground mt-1">{cta}</p>}
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            {columns.map(col => (
              <TableHead key={col.key} className={col.className || ""} onClick={col.sortable ? () => setSortAsc(!sortAsc) : undefined}>
                {col.sortable ? <span className="flex items-center gap-1 cursor-pointer select-none">{col.label} <ArrowUpDown className="h-3 w-3" /></span> : col.label}
              </TableHead>
            ))}
            <TableHead className="w-20">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((c: any) => (
            <Fragment key={c.id}>
              <TableRow className="cursor-pointer" onClick={() => toggleExpand(c.id)}>
                <TableCell className="px-2">
                  {expandedRows.has(c.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </TableCell>
                {columns.map(col => (
                  <TableCell key={col.key} className={col.className}>{col.render(c)}</TableCell>
                ))}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-0.5">
                    {!isCampaignEnded && c.communication_type === "Email" && c.contact_id && (
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-0.5" onClick={() => openReply(c)}>
                        <Reply className="h-3 w-3" />
                      </Button>
                    )}
                    {!isCampaignEnded && c.contacts?.contact_name && (
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-0.5"
                        onClick={() => openTaskForContact(c.contact_id, c.contacts?.contact_name || "")}>
                        <ListChecks className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              {expandedRows.has(c.id) && (
                <TableRow>
                  <TableCell colSpan={columns.length + 2} className="bg-muted/30 p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {c.subject && <div><span className="text-muted-foreground">Subject:</span> {c.subject}</div>}
                      {c.body && <div><span className="text-muted-foreground">Body:</span> <span className="whitespace-pre-wrap">{c.body}</span></div>}
                      {c.notes && <div className="col-span-2"><span className="text-muted-foreground">Notes:</span> {c.notes}</div>}
                      {c.communication_type === "Email" && c.email_status && <div><span className="text-muted-foreground">Email Status:</span> {c.email_status}</div>}
                      {isCall(c.communication_type) && c.call_outcome && <div><span className="text-muted-foreground">Outcome:</span> {c.call_outcome}</div>}
                      {c.communication_type === "LinkedIn" && c.linkedin_status && <div><span className="text-muted-foreground">LinkedIn Status:</span> {c.linkedin_status}</div>}
                      {c.delivery_status && <div><span className="text-muted-foreground">Delivery:</span> {c.delivery_status === "manual" ? "Logged manually" : `${c.delivery_status}${c.sent_via && c.sent_via !== "manual" ? ` (via ${c.sent_via})` : ""}`}</div>}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    );
  };

  // --- Stat pill helper ---
  const StatPill = ({ label, value, color }: { label: string; value: number; color: string }) => (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${color}`}>
      <span className="text-base font-semibold">{value}</span>
      <span>{label}</span>
    </div>
  );

  // --- Column definitions per channel ---
  const allColumns: ColumnDef[] = [
    { key: "date", label: "Date", sortable: true, render: (c) => <span className="text-sm whitespace-nowrap">{c.communication_date ? format(new Date(c.communication_date), "dd MMM yyyy HH:mm") : "—"}</span> },
    { key: "channel", label: "Channel", render: (c) => channelBadge(c.communication_type) },
    { key: "contact", label: "Contact", render: (c) => <span className="font-medium">{c.contacts?.contact_name || "—"}</span> },
    { key: "account", label: "Account", render: (c) => c.accounts?.account_name || "—" },
    { key: "status", label: "Status", render: (c) => c.email_status || c.call_outcome || c.linkedin_status || "—" },
    { key: "delivery", label: "Delivery", render: (c) => deliveryBadge(c.communication_type, c.delivery_status) },
    { key: "owner", label: "Owner", render: (c) => <span className="text-sm">{c.owner ? displayNames[c.owner] || "—" : "—"}</span> },
  ];

  const emailColumns: ColumnDef[] = [
    { key: "date", label: "Date", sortable: true, render: (c) => <span className="text-sm whitespace-nowrap">{c.communication_date ? format(new Date(c.communication_date), "dd MMM yyyy HH:mm") : "—"}</span> },
    { key: "contact", label: "Contact", render: (c) => <span className="font-medium">{c.contacts?.contact_name || "—"}</span> },
    { key: "account", label: "Account", render: (c) => c.accounts?.account_name || "—" },
    { key: "subject", label: "Subject", render: (c) => <span className="truncate max-w-[200px] block">{c.subject || "—"}</span> },
    { key: "status", label: "Status", render: (c) => c.email_status || "—" },
    { key: "delivery", label: "Delivery", render: (c) => deliveryBadge(c.communication_type, c.delivery_status) },
    { key: "owner", label: "Owner", render: (c) => <span className="text-sm">{c.owner ? displayNames[c.owner] || "—" : "—"}</span> },
  ];

  const linkedinColumns: ColumnDef[] = [
    { key: "date", label: "Date", sortable: true, render: (c) => <span className="text-sm whitespace-nowrap">{c.communication_date ? format(new Date(c.communication_date), "dd MMM yyyy HH:mm") : "—"}</span> },
    { key: "contact", label: "Contact", render: (c) => <span className="font-medium">{c.contacts?.contact_name || "—"}</span> },
    { key: "account", label: "Account", render: (c) => c.accounts?.account_name || "—" },
    { key: "linkedin_status", label: "LinkedIn Status", render: (c) => {
      const s = c.linkedin_status;
      if (!s) return "—";
      const colors: Record<string, string> = {
        "Connection Sent": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
        "Connected": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
        "Message Sent": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
        "InMail Sent": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
        "Responded": "bg-primary/10 text-primary",
        "Not Interested": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      };
      return <Badge className={colors[s] || ""} variant="secondary">{s}</Badge>;
    }},
    { key: "notes", label: "Notes", render: (c) => <span className="text-xs text-muted-foreground truncate max-w-[200px] block">{c.notes || "—"}</span> },
    { key: "owner", label: "Owner", render: (c) => <span className="text-sm">{c.owner ? displayNames[c.owner] || "—" : "—"}</span> },
  ];

  const callColumns: ColumnDef[] = [
    { key: "date", label: "Date", sortable: true, render: (c) => <span className="text-sm whitespace-nowrap">{c.communication_date ? format(new Date(c.communication_date), "dd MMM yyyy HH:mm") : "—"}</span> },
    { key: "contact", label: "Contact", render: (c) => <span className="font-medium">{c.contacts?.contact_name || "—"}</span> },
    { key: "account", label: "Account", render: (c) => c.accounts?.account_name || "—" },
    { key: "outcome", label: "Outcome", render: (c) => {
      const o = c.call_outcome;
      if (!o) return "—";
      const colors: Record<string, string> = {
        "Interested": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
        "Not Interested": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
        "Call Later": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
        "Wrong Contact": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
        "No Answer": "bg-muted text-muted-foreground",
        "Voicemail": "bg-muted text-muted-foreground",
      };
      return <Badge className={colors[o] || ""} variant="secondary">{o}</Badge>;
    }},
    { key: "notes", label: "Notes", render: (c) => <span className="text-xs text-muted-foreground truncate max-w-[200px] block">{c.notes || "—"}</span> },
    { key: "owner", label: "Owner", render: (c) => <span className="text-sm">{c.owner ? displayNames[c.owner] || "—" : "—"}</span> },
  ];

  // --- Inline filter controls (rendered inside the unified toolbar) ---
  const renderFilterControls = () => (
    <>
      <div className="relative flex-1 min-w-[140px] max-w-[220px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-7 h-7 text-xs" />
      </div>
    </>
  );

  // --- Phone script reference panel ---
  const renderPhoneScripts = () => {
    if (phoneScripts.length === 0) return null;
    return (
      <Card className="border mt-4">
        <CardHeader className="py-2.5 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-primary" /> Call Scripts</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            {phoneScripts.map((script: any) => (
              <Collapsible key={script.id} defaultOpen={phoneScripts.length === 1}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left text-sm font-medium p-2 rounded hover:bg-muted/50">
                  <ChevronDown className="h-3.5 w-3.5" /> {script.script_name || "Script"}
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-6 space-y-2 text-sm text-muted-foreground">
                  {script.opening_script && <div><p className="font-medium text-foreground text-xs">Opening</p><p className="whitespace-pre-wrap">{script.opening_script}</p></div>}
                  {script.key_talking_points && <div><p className="font-medium text-foreground text-xs">Key Points</p>{(() => { try { const pts = JSON.parse(script.key_talking_points); if (Array.isArray(pts)) return <ul className="list-disc ml-4">{pts.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>; } catch {} return <p className="whitespace-pre-wrap">{script.key_talking_points}</p>; })()}</div>}
                  {script.discovery_questions && <div><p className="font-medium text-foreground text-xs">Questions</p>{(() => { try { const qs = JSON.parse(script.discovery_questions); if (Array.isArray(qs)) return <ul className="list-disc ml-4">{qs.map((q: string, i: number) => <li key={i}>{q}</li>)}</ul>; } catch {} return <p className="whitespace-pre-wrap">{script.discovery_questions}</p>; })()}</div>}
                  {script.objection_handling && <div><p className="font-medium text-foreground text-xs">Objections</p>{(() => { try { const objs = JSON.parse(script.objection_handling); if (Array.isArray(objs)) return <div className="space-y-1">{objs.map((o: any, i: number) => <div key={i} className="border-l-2 border-muted pl-2"><p className="text-xs"><strong>Q:</strong> {o.objection}</p><p className="text-xs"><strong>A:</strong> {o.response}</p></div>)}</div>; } catch {} return <p className="whitespace-pre-wrap">{script.objection_handling}</p>; })()}</div>}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  // --- Thread view (All tab only) ---
  const renderThreadView = () => (
    <div className="space-y-2">
      {threads.length === 0 ? (
        <div className="text-center py-8"><p className="text-sm text-muted-foreground">No outreach logged yet.</p></div>
      ) : (
        threads.map((thread, idx) => (
          <Card key={`${thread.threadType}-${thread.contactId}-${idx}`} className="border">
            <Collapsible>
              <CollapsibleTrigger asChild>
                <CardHeader className="py-2.5 px-4 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {thread.threadType === "email" && <Mail className="h-3.5 w-3.5 text-blue-500" />}
                      <span className="font-medium text-sm">{thread.contactName}</span>
                      {thread.accountName && <span className="text-xs text-muted-foreground">· {thread.accountName}</span>}
                      {thread.threadType === "email" && thread.threadLabel && (
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">— {thread.threadLabel}</span>
                      )}
                      <span className="text-xs text-muted-foreground">({thread.messages.length})</span>
                      {thread.hasReply && <Badge className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" variant="secondary">Replied</Badge>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {thread.channelCounts.Email > 0 && <Badge variant="secondary" className="text-[10px] gap-0.5"><Mail className="h-2.5 w-2.5" />{thread.channelCounts.Email}</Badge>}
                      {thread.channelCounts.Call > 0 && <Badge variant="secondary" className="text-[10px] gap-0.5"><Phone className="h-2.5 w-2.5" />{thread.channelCounts.Call}</Badge>}
                      {thread.channelCounts.LinkedIn > 0 && <Badge variant="secondary" className="text-[10px] gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{thread.channelCounts.LinkedIn}</Badge>}
                      {!isCampaignEnded && (
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-0.5" onClick={(e) => { e.stopPropagation(); openTaskForContact(thread.contactId, thread.contactName); }}>
                          <ListChecks className="h-3 w-3" /> Task
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 px-4 pb-3">
                  <div className="space-y-2 border-l-2 border-muted pl-3">
                    {thread.messages.map((msg: any) => (
                      <div key={msg.id} className={`text-sm ${msg.sent_via === "graph-sync" ? "bg-green-50 dark:bg-green-900/10 rounded p-1.5" : ""}`}>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {channelBadge(msg.communication_type)}
                          <span>{msg.communication_date ? format(new Date(msg.communication_date), "dd MMM yyyy HH:mm") : "—"}</span>
                          {deliveryBadge(msg.communication_type, msg.delivery_status)}
                          {msg.sent_via === "azure" && <Badge variant="outline" className="text-[10px] px-1 py-0">Sent</Badge>}
                          {msg.sent_via === "graph-sync" && <Badge className="text-[10px] px-1 py-0 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" variant="secondary">Auto-synced Reply</Badge>}
                          {msg.parent_id && msg.sent_via !== "graph-sync" && <Badge variant="outline" className="text-[10px] px-1 py-0">Reply</Badge>}
                          <span className="ml-auto flex items-center gap-1">
                            {!isCampaignEnded && msg.communication_type === "Email" && msg.contact_id && (
                              <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-0.5 px-1.5" onClick={(e) => { e.stopPropagation(); openReply(msg); }}>
                                <Reply className="h-3 w-3" /> Reply
                              </Button>
                            )}
                            {msg.owner ? displayNames[msg.owner] || "—" : "—"}
                          </span>
                        </div>
                        {msg.subject && <p className="font-medium mt-0.5">{msg.subject}</p>}
                        {msg.body && <p className="text-muted-foreground whitespace-pre-wrap mt-0.5 text-xs">{msg.body.substring(0, 200)}{msg.body.length > 200 ? "..." : ""}</p>}
                        {msg.notes && <p className="text-xs italic text-muted-foreground mt-0.5">Note: {msg.notes}</p>}
                        {msg.email_status && <span className="text-xs text-muted-foreground">Status: {msg.email_status}</span>}
                        {msg.call_outcome && <span className="text-xs text-muted-foreground">Outcome: {msg.call_outcome}</span>}
                        {msg.linkedin_status && <span className="text-xs text-muted-foreground">LinkedIn: {msg.linkedin_status}</span>}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))
      )}
    </div>
  );

  const showLogActivity = !isCampaignEnded && (outreachTab === "linkedin" || outreachTab === "call");
  const showSendEmail = !isCampaignEnded && outreachTab === "email";

  // Channel reachability counts for current campaign
  const reachableCounts = useMemo(() => ({
    email: campaignContacts.filter(hasEmail).length,
    linkedin: campaignContacts.filter(hasLinkedIn).length,
    phone: campaignContacts.filter(hasPhone).length,
  }), [campaignContacts]);

  const emailableContacts = useMemo(
    () => campaignContacts.filter(hasEmail),
    [campaignContacts],
  );

  // B1: contacts with at least one logged touch on a given channel.
  const touchedContactIds = useMemo(() => {
    const linkedinSet = new Set<string>();
    const callSet = new Set<string>();
    const emailSet = new Set<string>();
    for (const c of communications as any[]) {
      if (!c.contact_id) continue;
      if (c.communication_type === "LinkedIn") linkedinSet.add(c.contact_id);
      else if (isCall(c.communication_type)) callSet.add(c.contact_id);
      else if (c.communication_type === "Email") emailSet.add(c.contact_id);
    }
    return { linkedin: linkedinSet, call: callSet, email: emailSet };
  }, [communications]);

  // Contacts that are reachable on a channel but have no logged touch yet.
  const eligibleNotTouched = useMemo(() => ({
    linkedin: campaignContacts.filter((c: any) => hasLinkedIn(c) && !touchedContactIds.linkedin.has(c.contact_id)),
    call: campaignContacts.filter((c: any) => hasPhone(c) && !touchedContactIds.call.has(c.contact_id)),
  }), [campaignContacts, touchedContactIds]);

  // B1: Render contacts that are reachable on a channel but have no logged touch yet,
  // with a quick "Log <channel>" action so users can act on them immediately.
  const renderEligibleContactsList = (rows: any[], channel: "LinkedIn" | "Call") => {
    if (rows.length === 0) {
      return (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No eligible contacts left — every reachable contact has at least one {channel} touch logged.
        </div>
      );
    }
    return (
      <div className="border rounded-md divide-y divide-border">
        {rows.map((cc: any) => {
          const c = cc.contacts || {};
          const acct = cc.accounts || {};
          const value = channel === "LinkedIn" ? c.linkedin : (c.phone_no || acct.phone);
          return (
            <div key={cc.contact_id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
              <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 items-center">
                <span className="font-medium truncate">{c.contact_name || "—"}</span>
                <span className="text-xs text-muted-foreground truncate">{c.company_name || acct.account_name || "—"}</span>
                <span className="text-xs text-muted-foreground truncate font-mono">{value || "—"}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={isCampaignEnded}
                onClick={() => {
                  setLogForm((prev) => ({ ...prev, communication_type: channel, contact_id: cc.contact_id }));
                  setLogModalOpen(true);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Log {channel}
              </Button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderEmailThreadsView = () => {
    if (emailThreadsFiltered.length === 0) {
      return (
        <p className="text-xs text-muted-foreground py-2 px-1">
          No email threads yet — use <span className="text-foreground font-medium">Send Email</span> above to start.
        </p>
      );
    }

    const selectedThread =
      emailThreadsFiltered.find((t: any) => t.threadKey === selectedThreadKey) ||
      emailThreadsFiltered[0];

    return (
      <>
        <div className="flex border rounded-md overflow-hidden bg-card md:h-[640px] flex-col md:flex-row">
          {/* LEFT PANE — Thread list */}
          <div className="md:w-[340px] md:shrink-0 md:border-r border-b md:border-b-0 max-h-[300px] md:max-h-none overflow-y-auto">
            <div className="px-3 py-2 border-b bg-muted/30 sticky top-0 z-10 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {emailThreadsFiltered.length} conversation{emailThreadsFiltered.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="divide-y">
              {emailThreadsFiltered.map((thread: any) => {
                const isActive = thread.threadKey === selectedThread?.threadKey;
                return (
                  <button
                    key={thread.threadKey}
                    type="button"
                    onClick={() => setSelectedThreadKey(thread.threadKey)}
                    className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-muted/40 ${
                      isActive ? "bg-primary/10 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-foreground truncate flex-1">
                        {thread.contactName}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                        {thread.lastActivity ? formatDistanceToNow(new Date(thread.lastActivity), { addSuffix: false }) : ""}
                      </span>
                    </div>
                    {thread.accountName && (
                      <p className="text-[11px] text-muted-foreground truncate mb-0.5">{thread.accountName}</p>
                    )}
                    <p className="text-xs text-foreground/80 truncate font-medium">
                      {thread.threadLabel}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      {thread.hasReply && (
                        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Replied
                        </Badge>
                      )}
                      {thread.hasFailed && !thread.hasReply && (
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">Failed</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                        {thread.messageCount} msg{thread.messageCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT PANE — Conversation reader. Stable `key` forces a clean
              remount when the selected thread changes so per-thread UI state
              (expanded messages, scroll) cannot bleed across threads. */}
          <div key={selectedThread?.threadKey || "empty"} className="flex-1 min-w-0 flex flex-col">
            {!selectedThread ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-sm text-muted-foreground">Select a conversation to read.</p>
              </div>
            ) : (
              <>
                {/* Subject header + actions */}
                <div className="px-4 py-3 border-b bg-card sticky top-0 z-10">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h3 className="text-base font-semibold text-foreground truncate flex-1" title={selectedThread.threadLabel}>
                      {selectedThread.threadLabel}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isCampaignEnded && selectedThread.contactId !== "no-contact" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              // Reader is newest-first; newest message is at index 0.
                              const newest = selectedThread.messages[0];
                              if (newest) openReply(newest);
                            }}
                          >
                            <Reply className="h-3 w-3" /> Reply
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => openTaskForContact(selectedThread.contactId, selectedThread.contactName)}
                          >
                            <ListChecks className="h-3 w-3" /> Task
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedThread.contactName}</span>
                    {selectedThread.contactEmail && <span>· {selectedThread.contactEmail}</span>}
                    {selectedThread.accountName && <span>· {selectedThread.accountName}</span>}
                    <span className="ml-auto tabular-nums">
                      {selectedThread.messageCount} message{selectedThread.messageCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>

                {/* Messages — oldest to newest, expandable */}
                <div className="flex-1 overflow-y-auto divide-y">
                  {selectedThread.messages.map((msg: any) => {
                    const isExpanded = expandedMessages.has(msg.id);
                    const showQuoted = expandedMessages.has(`${msg.id}-quoted`);
                    const showError = expandedMessages.has(`${msg.id}-error`);
                    const isInbound = msg.kind === "inbound-reply";
                    const isFailed = msg.kind === "failed";
                    const senderLabel = isInbound
                      ? (msg.contacts?.contact_name || "Contact")
                      : (msg.owner ? (displayNames[msg.owner] || "You") : "You");
                    const senderEmail = isInbound
                      ? (msg.contacts?.email || extractSenderEmailFromNotes(msg.notes) || "")
                      : "";
                    const recipientLabel = isInbound
                      ? (msg.owner ? (displayNames[msg.owner] || "You") : "You")
                      : (msg.contacts?.contact_name || "Recipient");
                    const recipientEmail = isInbound ? "" : (msg.contacts?.email || "");
                    const directionLabel = isInbound ? "Received" : msg.parent_id ? "Reply" : "Sent";
                    const initial = (senderLabel || "?").trim().charAt(0).toUpperCase();

                    return (
                      <div key={msg.id} className={isInbound ? "bg-primary/5" : isFailed ? "bg-destructive/5" : ""}>
                        {/* Header row — always visible, click to toggle */}
                        <button
                          type="button"
                          className="w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors"
                          onClick={() => toggleMessageExpanded(msg.id)}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                                isInbound ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                              }`}
                            >
                              {initial}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-semibold text-foreground truncate">{senderLabel}</span>
                                {senderEmail && (
                                  <span className="text-xs text-muted-foreground truncate">&lt;{senderEmail}&gt;</span>
                                )}
                                {isFailed ? (
                                  <Badge variant="destructive" className="text-[9px] px-1.5 py-0 ml-auto shrink-0">Failed</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-auto shrink-0">{directionLabel}</Badge>
                                )}
                                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                                  {msg.communication_date ? format(new Date(msg.communication_date), "dd MMM, HH:mm") : "—"}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                To: <span className="text-foreground/80">{recipientLabel}</span>
                                {recipientEmail && <span> &lt;{recipientEmail}&gt;</span>}
                              </div>
                              {!isExpanded && msg.parsed?.newText && (
                                <p className="text-xs text-muted-foreground truncate mt-1">
                                  {msg.parsed.newText.slice(0, 140)}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>

                        {/* Expanded body */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pl-15 ml-11 space-y-3">
                            {msg.parsed?.newText ? (
                              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                                {msg.parsed.newText.length > 1200
                                  ? msg.parsed.newText.slice(0, 1200) + "…"
                                  : msg.parsed.newText}
                              </p>
                            ) : (
                              <p className="text-xs italic text-muted-foreground">No message body.</p>
                            )}

                            {msg.parsed?.quotedText && (
                              <div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-1.5 text-xs text-muted-foreground gap-1"
                                  onClick={(e) => { e.stopPropagation(); toggleMessageExpanded(`${msg.id}-quoted`); }}
                                  title="Show trimmed content"
                                >
                                  <span className="font-mono">…</span>
                                  {showQuoted ? "Hide quoted text" : "Show quoted text"}
                                </Button>
                                {showQuoted && (
                                  <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap font-sans bg-muted/30 border-l-2 border-muted pl-3 py-2 rounded-sm">
                                    {msg.parsed.quotedText}
                                  </pre>
                                )}
                              </div>
                            )}

                            <div className="flex items-center gap-2">
                              {(msg.body && msg.body.length > 1200) && (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-xs"
                                  onClick={(e) => { e.stopPropagation(); setViewFullEmail(msg); }}
                                >
                                  View full email
                                </Button>
                              )}
                              {!isCampaignEnded && msg.contact_id && !isFailed && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1 ml-auto"
                                  onClick={(e) => { e.stopPropagation(); openReply(msg); }}
                                >
                                  <Reply className="h-3 w-3" /> Reply
                                </Button>
                              )}
                            </div>

                            {isFailed && msg.notes && (
                              <div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-destructive"
                                  onClick={(e) => { e.stopPropagation(); toggleMessageExpanded(`${msg.id}-error`); }}
                                >
                                  {showError ? "Hide error details" : "Show error details"}
                                </Button>
                                {showError && (
                                  <p className="mt-1 text-xs text-destructive whitespace-pre-wrap rounded-sm border border-destructive/30 bg-destructive/5 px-2 py-1.5">{msg.notes}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Unmatched (orphan) replies — surfaced separately so nothing is silently dropped. */}
        {orphanReplies.length > 0 && (
          <Collapsible className="mt-3 border rounded-md">
            <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 text-left">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-amber-600" />
                {orphanReplies.length} unmatched repl{orphanReplies.length === 1 ? "y" : "ies"}
                <span className="text-[10px] text-muted-foreground/70">
                  (sender did not match the linked contact — kept here for review)
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="divide-y border-t">
                {orphanReplies.map((msg: any) => (
                  <div key={msg.id} className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{msg.subject || "(no subject)"}</span>
                      <span className="text-muted-foreground ml-auto whitespace-nowrap">
                        {msg.communication_date ? format(new Date(msg.communication_date), "dd MMM, HH:mm") : "—"}
                      </span>
                    </div>
                    {msg.notes && <p className="text-muted-foreground mt-0.5">{msg.notes}</p>}
                    <p className="text-muted-foreground/80 mt-0.5">
                      Linked contact: {msg.contacts?.contact_name || "Unknown"}
                      {msg.contacts?.email && <> &lt;{msg.contacts.email}&gt;</>}
                    </p>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </>
    );
  };


  const hasEmailStats = emailStats.sent + emailStats.replied + emailStats.bounced + emailStats.failed > 0;
  const hasLinkedinStats = linkedinStats.connectionSent + linkedinStats.connected + linkedinStats.messageSent + linkedinStats.responded > 0;
  const hasCallStats = callStats.interested + callStats.notInterested + callStats.callLater + callStats.noAnswer > 0;

  const hasAnyFilter =
    searchTerm !== "" || accountFilter !== "all" || contactFilter !== "all" || ownerFilter !== "all" ||
    (outreachTab === "email" && emailStatusFilter !== "all") ||
    (outreachTab === "linkedin" && linkedinStatusFilter !== "all") ||
    (outreachTab === "call" && callStatusFilter !== "all");

  const clearAllFilters = () => {
    setSearchTerm("");
    setAccountFilter("all");
    setContactFilter("all");
    setOwnerFilter("all");
    setEmailStatusFilter("all");
    setLinkedinStatusFilter("all");
    setCallStatusFilter("all");
  };

  // Reusable status chip — toggles filter; active gets accent color.
  const StatusChip = ({
    label, count, active, onClick, tone = "default",
  }: { label: string; count: number; active: boolean; onClick: () => void; tone?: "default" | "success" | "destructive" | "warning" }) => {
    const toneClasses: Record<string, string> = {
      default: active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted/60",
      success: active ? "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500" : "bg-card hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
      destructive: active ? "bg-destructive text-destructive-foreground border-destructive" : "bg-card hover:bg-destructive/10",
      warning: active ? "bg-amber-500 text-white border-amber-500" : "bg-card hover:bg-amber-50 dark:hover:bg-amber-950/30",
    };
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${toneClasses[tone]}`}
      >
        <span>{label}</span>
        <span className="tabular-nums opacity-90">{count}</span>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <Tabs value={outreachTab} onValueChange={(v) => setOutreachTab(v as OutreachTab)}>
        {/* Industry-standard toolbar layout:
            LEFT:  [Channel tabs] [Search] [Contact] [Account] [Owner] [Status chips]
            RIGHT: [Clear] [View switch] [Synced · refresh] [Primary Action] [Ended] */}
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="h-7">
            {enableEmail && (
              <TabsTrigger value="email" className="text-xs h-6 px-2.5 gap-1.5">
                <Mail className="h-3 w-3" /> Email
                <span className="tabular-nums text-muted-foreground">{reachableCounts.email}/{campaignContacts.length}</span>
              </TabsTrigger>
            )}
            {enableLinkedIn && (
              <TabsTrigger value="linkedin" className="text-xs h-6 px-2.5 gap-1.5">
                <Linkedin className="h-3 w-3" /> LinkedIn
                <span className="tabular-nums text-muted-foreground">{reachableCounts.linkedin}/{campaignContacts.length}</span>
              </TabsTrigger>
            )}
            {enablePhone && (
              <TabsTrigger value="call" className="text-xs h-6 px-2.5 gap-1.5">
                <Phone className="h-3 w-3" /> Phone
                <span className="tabular-nums text-muted-foreground">{reachableCounts.phone}/{campaignContacts.length}</span>
              </TabsTrigger>
            )}
          </TabsList>

          {renderFilterControls()}

          {/* Per-channel status chips inline with filters */}
          {outreachTab === "email" && hasEmailStats && (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip label="All" count={emailComms.length} active={emailStatusFilter === "all"} onClick={() => setEmailStatusFilter("all")} />
              <StatusChip label="Sent" count={emailStats.sent} active={emailStatusFilter === "sent"} onClick={() => setEmailStatusFilter(emailStatusFilter === "sent" ? "all" : "sent")} />
              <StatusChip label="Replied" count={emailStats.replied} active={emailStatusFilter === "replied"} onClick={() => setEmailStatusFilter(emailStatusFilter === "replied" ? "all" : "replied")} tone="success" />
              <StatusChip label="Failed" count={emailStats.failed} active={emailStatusFilter === "failed"} onClick={() => setEmailStatusFilter(emailStatusFilter === "failed" ? "all" : "failed")} tone="destructive" />
              <StatusChip label="Bounced" count={emailStats.bounced} active={emailStatusFilter === "bounced"} onClick={() => setEmailStatusFilter(emailStatusFilter === "bounced" ? "all" : "bounced")} tone="warning" />
            </div>
          )}
          {outreachTab === "linkedin" && hasLinkedinStats && (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip label="All" count={linkedinComms.length} active={linkedinStatusFilter === "all"} onClick={() => setLinkedinStatusFilter("all")} />
              <StatusChip label="Connection Sent" count={linkedinStats.connectionSent} active={linkedinStatusFilter === "connectionSent"} onClick={() => setLinkedinStatusFilter(linkedinStatusFilter === "connectionSent" ? "all" : "connectionSent")} tone="warning" />
              <StatusChip label="Connected" count={linkedinStats.connected} active={linkedinStatusFilter === "connected"} onClick={() => setLinkedinStatusFilter(linkedinStatusFilter === "connected" ? "all" : "connected")} tone="success" />
              <StatusChip label="Message Sent" count={linkedinStats.messageSent} active={linkedinStatusFilter === "messageSent"} onClick={() => setLinkedinStatusFilter(linkedinStatusFilter === "messageSent" ? "all" : "messageSent")} />
              <StatusChip label="Responded" count={linkedinStats.responded} active={linkedinStatusFilter === "responded"} onClick={() => setLinkedinStatusFilter(linkedinStatusFilter === "responded" ? "all" : "responded")} tone="success" />
            </div>
          )}
          {outreachTab === "call" && hasCallStats && (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip label="All" count={callComms.length} active={callStatusFilter === "all"} onClick={() => setCallStatusFilter("all")} />
              <StatusChip label="Interested" count={callStats.interested} active={callStatusFilter === "interested"} onClick={() => setCallStatusFilter(callStatusFilter === "interested" ? "all" : "interested")} tone="success" />
              <StatusChip label="Not Interested" count={callStats.notInterested} active={callStatusFilter === "notInterested"} onClick={() => setCallStatusFilter(callStatusFilter === "notInterested" ? "all" : "notInterested")} tone="destructive" />
              <StatusChip label="Call Later" count={callStats.callLater} active={callStatusFilter === "callLater"} onClick={() => setCallStatusFilter(callStatusFilter === "callLater" ? "all" : "callLater")} tone="warning" />
              <StatusChip label="No Answer" count={callStats.noAnswer} active={callStatusFilter === "noAnswer"} onClick={() => setCallStatusFilter(callStatusFilter === "noAnswer" ? "all" : "noAnswer")} />
            </div>
          )}

          {hasAnyFilter && (
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground" onClick={clearAllFilters}>
              Clear filters
            </Button>
          )}

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            {viewMode && onViewModeChange && (
              <div className="inline-flex h-7 items-center rounded-md border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => onViewModeChange("outreach")}
                  className={`px-2 h-6 rounded-sm transition-colors ${viewMode === "outreach" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Outreach
                </button>
                <button
                  type="button"
                  onClick={() => onViewModeChange("analytics")}
                  className={`px-2 h-6 rounded-sm transition-colors ${viewMode === "analytics" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Analytics
                </button>
              </div>
            )}
            <SyncStatusPill
              lastSyncedAt={lastSyncedAt}
              isSyncing={isSyncing}
              onRetry={() => syncReplies(true)}
            />
            {outreachTab === "email" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                onClick={() => syncReplies(true)}
                disabled={isSyncing}
                title="Refresh email replies"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
              </Button>
            )}
            {outreachTab === "email" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => {
                  // Scope: if a thread is open, restrict to that thread's contact.
                  const composite = selectedThreadKey || "";
                  const parts = composite.split("::");
                  const contactScope = parts.length === 2 && parts[1] && parts[1] !== "no-contact" ? parts[1] : undefined;
                  void runResync(contactScope);
                }}
                disabled={isResyncing || isSyncing}
                title={selectedThreadKey ? "Re-sync replies for the open thread's contact" : "Re-sync replies for the whole campaign"}
              >
                <RefreshCw className={`h-3 w-3 ${isResyncing ? "animate-spin" : ""}`} />
                Re-sync replies
              </Button>
            )}
            {showSendEmail && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 gap-1"
                        disabled={emailableContacts.length === 0}
                        onClick={() => {
                          setReplyContext(undefined);
                          setEmailComposeOpen(true);
                        }}
                      >
                        <Send className="h-3.5 w-3.5" /> Send Email
                        <span className="ml-1 text-[10px] opacity-80 tabular-nums">
                          {emailableContacts.length}
                        </span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {emailableContacts.length === 0
                      ? "No campaign contacts have an email address. Add one in Contacts."
                      : `${emailableContacts.length} of ${campaignContacts.length} contacts have an email address.`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {showLogActivity && (
              (() => {
                const reach = outreachTab === "linkedin" ? reachableCounts.linkedin : reachableCounts.phone;
                const channelLabel = outreachTab === "linkedin" ? "LinkedIn" : "phone";
                return (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={reach === 0}
                            onClick={() => openLogModal(outreachTab === "linkedin" ? "LinkedIn" : "Call")}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            {outreachTab === "linkedin" ? "Log LinkedIn" : "Log Call"}
                            <span className="ml-1 text-[10px] opacity-80 tabular-nums">{reach}</span>
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {reach === 0
                          ? `No campaign contacts have a ${channelLabel}. Add one in Contacts.`
                          : `${reach} of ${campaignContacts.length} contacts reachable on ${channelLabel}.`}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })()
            )}
            {isCampaignEnded && (
              <Badge variant="destructive" className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Ended</Badge>
            )}
          </div>
        </div>

        {/* EMAIL TAB — always threaded */}
        <TabsContent value="email" className="mt-2 space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-muted/30 text-[11px] text-muted-foreground">
            <Mail className="h-3 w-3 text-primary" />
            <span>
              Reaching <span className="font-semibold text-foreground tabular-nums">{reachableCounts.email}</span> of{" "}
              <span className="tabular-nums">{campaignContacts.length}</span> campaign contacts via Email
              {emailStats.bounced > 0 && (
                <> · <span className="text-destructive font-medium tabular-nums">{emailStats.bounced} bounced</span></>
              )}
              {emailStats.replied > 0 && (
                <> · <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">{emailStats.replied} replied</span></>
              )}
            </span>
          </div>
          {emailThreadsFiltered.length === 0 && hasAnyFilter ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No emails match the current filters.</p>
              <Button variant="link" size="sm" className="text-xs h-auto p-0 mt-1" onClick={clearAllFilters}>Clear filters</Button>
            </div>
          ) : (
            renderEmailThreadsView()
          )}
        </TabsContent>

        {/* LINKEDIN TAB */}
        <TabsContent value="linkedin" className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-muted/30 text-[11px] text-muted-foreground flex-1 min-w-[280px]">
              <Linkedin className="h-3 w-3 text-primary" />
              <span>
                Reaching <span className="font-semibold text-foreground tabular-nums">{reachableCounts.linkedin}</span> of{" "}
                <span className="tabular-nums">{campaignContacts.length}</span> campaign contacts via LinkedIn
                {linkedinStats.responded > 0 && (
                  <> · <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">{linkedinStats.responded} responded</span></>
                )}
              </span>
            </div>
            {/* B1: Eligible | Touched | All */}
            <ToggleGroup type="single" value={linkedinScope} onValueChange={(v) => v && setLinkedinScope(v as any)} size="sm" className="h-7">
              <ToggleGroupItem value="all" className="h-6 px-2 text-[11px]">All <span className="ml-1 tabular-nums opacity-70">{linkedinComms.length}</span></ToggleGroupItem>
              <ToggleGroupItem value="eligible" className="h-6 px-2 text-[11px]">Eligible <span className="ml-1 tabular-nums opacity-70">{eligibleNotTouched.linkedin.length}</span></ToggleGroupItem>
              <ToggleGroupItem value="touched" className="h-6 px-2 text-[11px]">Touched <span className="ml-1 tabular-nums opacity-70">{touchedContactIds.linkedin.size}</span></ToggleGroupItem>
            </ToggleGroup>
          </div>
          {linkedinScope === "eligible" ? (
            renderEligibleContactsList(eligibleNotTouched.linkedin, "LinkedIn")
          ) : linkedinScope === "touched" ? (
            renderCommTable(linkedinFiltered.filter((c: any) => touchedContactIds.linkedin.has(c.contact_id)), linkedinColumns, false)
          ) : linkedinFiltered.length === 0 && hasAnyFilter ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No LinkedIn touches match the current filters.</p>
              <Button variant="link" size="sm" className="text-xs h-auto p-0 mt-1" onClick={clearAllFilters}>Clear filters</Button>
            </div>
          ) : (
            renderCommTable(linkedinFiltered, linkedinColumns, false)
          )}
        </TabsContent>

        {/* CALL TAB */}
        <TabsContent value="call" className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-muted/30 text-[11px] text-muted-foreground flex-1 min-w-[280px]">
              <Phone className="h-3 w-3 text-primary" />
              <span>
                Reaching <span className="font-semibold text-foreground tabular-nums">{reachableCounts.phone}</span> of{" "}
                <span className="tabular-nums">{campaignContacts.length}</span> campaign contacts via Phone
                {callStats.interested > 0 && (
                  <> · <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">{callStats.interested} interested</span></>
                )}
              </span>
            </div>
            {/* B1: Eligible | Touched | All */}
            <ToggleGroup type="single" value={callScope} onValueChange={(v) => v && setCallScope(v as any)} size="sm" className="h-7">
              <ToggleGroupItem value="all" className="h-6 px-2 text-[11px]">All <span className="ml-1 tabular-nums opacity-70">{callComms.length}</span></ToggleGroupItem>
              <ToggleGroupItem value="eligible" className="h-6 px-2 text-[11px]">Eligible <span className="ml-1 tabular-nums opacity-70">{eligibleNotTouched.call.length}</span></ToggleGroupItem>
              <ToggleGroupItem value="touched" className="h-6 px-2 text-[11px]">Touched <span className="ml-1 tabular-nums opacity-70">{touchedContactIds.call.size}</span></ToggleGroupItem>
            </ToggleGroup>
          </div>
          {callScope === "eligible" ? (
            renderEligibleContactsList(eligibleNotTouched.call, "Call")
          ) : callScope === "touched" ? (
            renderCommTable(callFiltered.filter((c: any) => touchedContactIds.call.has(c.contact_id)), callColumns, false)
          ) : callFiltered.length === 0 && hasAnyFilter ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No calls match the current filters.</p>
              <Button variant="link" size="sm" className="text-xs h-auto p-0 mt-1" onClick={clearAllFilters}>Clear filters</Button>
            </div>
          ) : (
            renderCommTable(callFiltered, callColumns, false)
          )}
          {renderPhoneScripts()}
        </TabsContent>
      </Tabs>

      {/* Email Compose Modal */}
      <EmailComposeModal
        open={emailComposeOpen}
        onOpenChange={(v) => { setEmailComposeOpen(v); if (!v) setReplyContext(undefined); }}
        campaignId={campaignId}
        contacts={campaignContacts as any}
        replyTo={replyContext}
        onEmailSent={handleEmailSent}
        onBatchComplete={handleBatchComplete}
      />

      {/* Re-sync result dialog */}
      <Dialog open={!!resyncResult} onOpenChange={(v) => { if (!v) setResyncResult(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base">Re-sync complete</DialogTitle>
          </DialogHeader>
          {resyncResult && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-xs text-muted-foreground">New replies attached</div>
                  <div className="text-2xl font-semibold text-foreground">{resyncResult.inserted ?? 0}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Messages scanned</div>
                  <div className="text-2xl font-semibold text-foreground">{resyncResult.scanned ?? 0}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Skipped by guard</div>
                <div className="rounded-md border divide-y">
                  {(["chronology","subject_mismatch","contact_mismatch","ambiguous_candidates","no_eligible_parent"] as const).map((k) => {
                    const labels: Record<string, string> = {
                      chronology: "Chronology",
                      subject_mismatch: "Subject mismatch",
                      contact_mismatch: "Contact mismatch",
                      ambiguous_candidates: "Ambiguous candidates",
                      no_eligible_parent: "No eligible parent",
                    };
                    const count = (resyncResult.skipped as any)?.[k] ?? 0;
                    return (
                      <div key={k} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="text-muted-foreground">{labels[k]}</span>
                        <span className={`tabular-nums font-medium ${count > 0 ? "text-destructive" : "text-muted-foreground"}`}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {resyncResult.scope?.contact_id && (
                <p className="text-[11px] text-muted-foreground">
                  Scope: a single contact thread.
                </p>
              )}
              {resyncResult.durationMs != null && (
                <p className="text-[11px] text-muted-foreground">
                  Completed in {Math.max(1, Math.round(resyncResult.durationMs))} ms.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {resyncResult?.correlation_id ? (
              <Link
                to={`/settings/email-skip-audit?correlation_id=${resyncResult.correlation_id}`}
                className="text-xs text-primary hover:underline"
                onClick={() => setResyncResult(null)}
              >
                View skipped replies →
              </Link>
            ) : <span />}
            <Button size="sm" onClick={() => setResyncResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View full email modal — Outlook-style: metadata, new text, quoted block, errors */}
      <Dialog open={!!viewFullEmail} onOpenChange={(v) => { if (!v) setViewFullEmail(null); }}>
        <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{viewFullEmail?.subject || "Email"}</DialogTitle>
          </DialogHeader>
          {viewFullEmail && (() => {
            const parsed = parseEmailBody(viewFullEmail.body);
            const isInbound = viewFullEmail.sent_via === "graph-sync";
            const isFailed = viewFullEmail.email_status === "Failed" || viewFullEmail.delivery_status === "failed";
            const fromLabel = isInbound
              ? (viewFullEmail.contacts?.contact_name || "Contact")
              : (viewFullEmail.owner ? (displayNames[viewFullEmail.owner] || "You") : "You");
            const toLabel = isInbound
              ? (viewFullEmail.owner ? (displayNames[viewFullEmail.owner] || "You") : "You")
              : (viewFullEmail.contacts?.contact_name || "Recipient");
            return (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-12">From:</span>
                    <span className="font-medium">{fromLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-12">To:</span>
                    <span>{toLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-12">Date:</span>
                    <span>{viewFullEmail.communication_date ? format(new Date(viewFullEmail.communication_date), "dd MMM yyyy, HH:mm") : "—"}</span>
                    {viewFullEmail.email_status && (
                      <Badge variant={isFailed ? "destructive" : "secondary"} className="text-[10px] ml-2">
                        {viewFullEmail.email_status}
                      </Badge>
                    )}
                  </div>
                </div>

                {parsed.newText ? (
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{parsed.newText}</div>
                ) : viewFullEmail.body && /^\s*<.+>/.test(viewFullEmail.body) ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: viewFullEmail.body }}
                  />
                ) : (
                  <p className="text-xs italic text-muted-foreground">No message body.</p>
                )}

                {parsed.quotedText && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show quoted text</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans bg-muted/30 border-l-2 border-muted pl-3 py-2 rounded-sm text-muted-foreground">
                      {parsed.quotedText}
                    </pre>
                  </details>
                )}

                {viewFullEmail.notes && (
                  <div className={`text-xs rounded-sm px-2 py-1.5 ${isFailed ? "border border-destructive/30 bg-destructive/5 text-destructive" : "border-t pt-2 text-muted-foreground italic"}`}>
                    {isFailed ? viewFullEmail.notes : `Note: ${viewFullEmail.notes}`}
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewFullEmail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Outreach Modal */}
      <Dialog open={logModalOpen} onOpenChange={setLogModalOpen}>
        <DialogContent className={`${logForm.communication_type === "Call" && phoneScripts.length > 0 ? "sm:max-w-[900px]" : "sm:max-w-[500px]"} max-h-[85vh] overflow-y-auto`}>
          <DialogHeader><DialogTitle>Log Outreach</DialogTitle></DialogHeader>
          <div className="rounded-md border border-border bg-muted/30 p-2.5 mb-2 space-y-1.5">
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Emails sent from the app are tracked automatically. Use this form to log Calls and LinkedIn touches only.</span>
            </p>
            {primaryChannel && (
              <p className="text-[11px] text-muted-foreground">
                Primary channel: <span className="font-medium text-foreground">{primaryChannel}</span>
              </p>
            )}
          </div>
          {/* Channel mismatch warning — Phone/Call normalized so users never see "Phone vs Call" */}
          {(() => {
            const primaryNorm = normalizeChannel(primaryChannel);
            const loggedNorm = normalizeChannel(logForm.communication_type);
            if (!primaryNorm || !loggedNorm || primaryNorm === loggedNorm) return null;
            return (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  This contact is being logged on <span className="font-medium">{channelLabel(logForm.communication_type)}</span>, but the campaign's primary channel is{" "}
                  <span className="font-medium">{channelLabel(primaryChannel)}</span>.
                </span>
              </div>
            );
          })()}
          <div className={logForm.communication_type === "Call" && phoneScripts.length > 0 ? "grid grid-cols-2 gap-6" : ""}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Channel *</Label>
                <Select
                  value={logForm.communication_type}
                  onValueChange={(v) => {
                    // Reset contact if it's no longer reachable on the new channel
                    const stillEligible = logForm.contact_id
                      ? campaignContacts.some(
                          (cc: any) =>
                            cc.contact_id === logForm.contact_id &&
                            reachableFor(v as any, cc),
                        )
                      : true;
                    setLogForm({
                      ...logForm,
                      communication_type: v,
                      contact_id: stillEligible ? logForm.contact_id : "",
                      // Reset channel-specific status so a stale value (e.g. "Connection Sent")
                      // doesn't persist when switching from LinkedIn to Call.
                      linkedin_status: v === "LinkedIn" ? logForm.linkedin_status : "Connection Sent",
                      call_outcome: v === "Call" ? logForm.call_outcome : "",
                    });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Call">Call</SelectItem>
                    <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <span>Contact</span>
                  {(() => {
                    const eligible = campaignContacts.filter((cc: any) =>
                      reachableFor(logForm.communication_type as any, cc),
                    );
                    return (
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {eligible.length} of {campaignContacts.length} reachable on{" "}
                        {logForm.communication_type === "LinkedIn" ? "LinkedIn" : "Call"}
                      </span>
                    );
                  })()}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 ml-auto px-1.5 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                    title="Refresh contact & account info from the database"
                    onClick={() => {
                      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
                      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
                      toast({ title: "Refreshing dropdowns…" });
                    }}
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </Button>
                </Label>
                {(() => {
                  const eligibleContacts = [...campaignContacts]
                    .filter((cc: any) => reachableFor(logForm.communication_type as any, cc))
                    .sort((a: any, b: any) =>
                      (a.contacts?.contact_name || "").localeCompare(b.contacts?.contact_name || ""),
                    );
                  if (eligibleContacts.length === 0) {
                    const what =
                      logForm.communication_type === "LinkedIn"
                        ? "a LinkedIn URL"
                        : "a phone number";
                    return (
                      <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                        No campaign contacts have {what}. Add one in the Contacts module, then it will appear here.
                      </div>
                    );
                  }
                  return (
                    <Select
                      value={logForm.contact_id}
                      onValueChange={(v) => setLogForm({ ...logForm, contact_id: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select contact" /></SelectTrigger>
                      <SelectContent>
                        {eligibleContacts.map((cc: any) => {
                          const detail =
                            logForm.communication_type === "LinkedIn"
                              ? (() => {
                                  try {
                                    return new URL(cc.contacts.linkedin).hostname.replace(/^www\./, "");
                                  } catch {
                                    return "LinkedIn";
                                  }
                                })()
                              : formatPhoneForDisplay(cc.contacts?.phone_no || cc.accounts?.phone || "");
                          return (
                            <SelectItem key={cc.contact_id} value={cc.contact_id}>
                              <span className="font-medium">{cc.contacts?.contact_name || cc.contact_id}</span>
                              {detail && (
                                <span className="ml-2 text-xs text-muted-foreground">· {detail}</span>
                              )}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  );
                })()}
                {/* Edit contact ↗ link — appears when the currently selected contact
                    is NOT reachable on the chosen channel, so the user can fix the
                    missing email / linkedin / phone without leaving the campaign. */}
                {logForm.contact_id && (() => {
                  const selected = campaignContacts.find(
                    (cc: any) => cc.contact_id === logForm.contact_id,
                  );
                  if (!selected) return null;
                  const reachable = reachableFor(logForm.communication_type as any, selected);
                  if (reachable) return null;
                  const what =
                    logForm.communication_type === "LinkedIn"
                      ? "LinkedIn URL"
                      : "phone number";
                  return (
                    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px]">
                      <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                      <span className="text-amber-700 dark:text-amber-400 flex-1">
                        This contact has no {what}.
                      </span>
                      <a
                        href={`/contacts?id=${selected.contact_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        Edit contact ↗
                      </a>
                    </div>
                  );
                })()}
              </div>
              {/* Per-contact outreach timeline (Previous touches) */}
              {logForm.contact_id && (
                <Collapsible open={showTimeline} onOpenChange={setShowTimeline}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs hover:bg-muted/50"
                    >
                      <span className="font-medium">
                        {timelineLoading
                          ? "Loading previous touches…"
                          : contactTimeline.length === 0
                          ? "No previous touches with this contact in this campaign."
                          : `${contactTimeline.length} previous touch${contactTimeline.length === 1 ? "" : "es"}`}
                      </span>
                      <span className="text-muted-foreground">{showTimeline ? "Hide" : "Show"}</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {contactTimeline.length > 0 && (
                      <div className="mt-1.5 rounded-md border bg-background overflow-hidden">
                        {/* Per-channel timeline tabs */}
                        <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/20">
                          {(["all", "Email", "LinkedIn", "Call"] as const).map((tab) => {
                            const count = timelineCounts[tab];
                            const active = timelineChannelTab === tab;
                            const Icon = tab === "Email" ? Mail : tab === "LinkedIn" ? Linkedin : tab === "Call" ? Phone : null;
                            return (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setTimelineChannelTab(tab)}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                                }`}
                              >
                                {Icon && <Icon className="h-2.5 w-2.5" />}
                                {tab === "all" ? "All" : tab}
                                <span className="tabular-nums opacity-80">{count}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="max-h-[180px] overflow-y-auto divide-y">
                        {filteredTimeline.length === 0 ? (
                          <div className="px-2.5 py-3 text-[11px] text-muted-foreground text-center">
                            No {timelineChannelTab === "all" ? "" : timelineChannelTab + " "}touches with this contact yet.
                          </div>
                        ) : filteredTimeline.map((t: any) => {
                          const Icon = t.communication_type === "Email" ? Mail : t.communication_type === "LinkedIn" ? Linkedin : Phone;
                          const status = t.email_status || t.linkedin_status || t.call_outcome || "";
                          const ownerLabel = t.owner ? (timelineOwnerNames[t.owner] || "—") : "—";
                          const isEmail = t.communication_type === "Email";
                          return (
                            <div key={t.id} className="flex items-start gap-2 px-2.5 py-1.5 text-[11px]">
                              <Icon className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium">{t.communication_type}</span>
                                  {status && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0">{status}</Badge>
                                  )}
                                  <span
                                    className="text-muted-foreground tabular-nums"
                                    title={t.communication_date ? new Date(t.communication_date).toLocaleString() : ""}
                                  >
                                    {t.communication_date
                                      ? formatDistanceToNow(new Date(t.communication_date), { addSuffix: true })
                                      : "—"}
                                  </span>
                                  <span className="text-muted-foreground">· {ownerLabel}</span>
                                </div>
                                {t.subject && (
                                  isEmail ? (
                                    <button
                                      type="button"
                                      className="truncate text-foreground/90 hover:underline text-left block w-full"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        setViewFullEmail(t);
                                      }}
                                      title="View full email"
                                    >
                                      {t.subject}
                                    </button>
                                  ) : (
                                    <p className="truncate text-foreground/90">{t.subject}</p>
                                  )
                                )}
                                {t.notes && (
                                  <p className="text-muted-foreground line-clamp-2">
                                    {t.notes.length > 80 ? `${t.notes.slice(0, 80)}…` : t.notes}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        </div>
                        <div className="px-2.5 py-1.5 bg-muted/30 text-[10px] text-muted-foreground text-right border-t">
                          Showing {filteredTimeline.length} of {contactTimeline.length}. View all in the Communications tab.
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )}
              {logForm.communication_type === "Call" && (
                <div className="space-y-2">
                  <Label>Outcome</Label>
                  <Select value={logForm.call_outcome} onValueChange={(v) => setLogForm({ ...logForm, call_outcome: v })}>
                    <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Interested">Interested</SelectItem><SelectItem value="Not Interested">Not Interested</SelectItem>
                      <SelectItem value="Call Later">Call Later</SelectItem><SelectItem value="Wrong Contact">Wrong Contact</SelectItem>
                      <SelectItem value="No Answer">No Answer</SelectItem><SelectItem value="Voicemail">Voicemail</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {logForm.communication_type === "LinkedIn" && (
                <>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={logForm.linkedin_status} onValueChange={(v) => setLogForm({ ...logForm, linkedin_status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Connection Sent">Connection Sent</SelectItem><SelectItem value="Connected">Connected</SelectItem>
                        <SelectItem value="Message Sent">Message Sent</SelectItem><SelectItem value="InMail Sent">InMail Sent</SelectItem>
                        <SelectItem value="Responded">Responded</SelectItem><SelectItem value="Not Interested">Not Interested</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Profile URL <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input
                      placeholder="https://linkedin.com/in/..."
                      value={logForm.linkedin_profile_url}
                      onChange={(e) => setLogForm({ ...logForm, linkedin_profile_url: e.target.value })}
                    />
                    <p className="text-[11px] text-muted-foreground">LinkedIn doesn't expose a public messaging API. Send the message in LinkedIn, then log it here.</p>
                  </div>
                </>
              )}
              <div className="space-y-2"><Label>Notes</Label><Textarea value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} rows={3} /></div>
            </div>

            {logForm.communication_type === "Call" && phoneScripts.length > 0 && (
              <div className="border-l border-border pl-6 py-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium"><Phone className="h-4 w-4 text-primary" /> Call Script Reference</div>
                {phoneScripts.map((script: any) => (
                  <Collapsible key={script.id} defaultOpen={phoneScripts.length === 1}>
                    <CollapsibleTrigger className="flex items-center gap-2 w-full text-left text-sm font-medium p-2 rounded hover:bg-muted/50">
                      <ChevronDown className="h-3.5 w-3.5" /> {script.script_name || "Script"}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-6 space-y-2 text-sm text-muted-foreground">
                      {script.opening_script && <div><p className="font-medium text-foreground text-xs">Opening</p><p className="whitespace-pre-wrap">{script.opening_script}</p></div>}
                      {script.key_talking_points && <div><p className="font-medium text-foreground text-xs">Key Points</p>{(() => { try { const pts = JSON.parse(script.key_talking_points); if (Array.isArray(pts)) return <ul className="list-disc ml-4">{pts.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>; } catch {} return <p className="whitespace-pre-wrap">{script.key_talking_points}</p>; })()}</div>}
                      {script.discovery_questions && <div><p className="font-medium text-foreground text-xs">Questions</p>{(() => { try { const qs = JSON.parse(script.discovery_questions); if (Array.isArray(qs)) return <ul className="list-disc ml-4">{qs.map((q: string, i: number) => <li key={i}>{q}</li>)}</ul>; } catch {} return <p className="whitespace-pre-wrap">{script.discovery_questions}</p>; })()}</div>}
                      {script.objection_handling && <div><p className="font-medium text-foreground text-xs">Objections</p>{(() => { try { const objs = JSON.parse(script.objection_handling); if (Array.isArray(objs)) return <div className="space-y-1">{objs.map((o: any, i: number) => <div key={i} className="border-l-2 border-muted pl-2"><p className="text-xs"><strong>Q:</strong> {o.objection}</p><p className="text-xs"><strong>A:</strong> {o.response}</p></div>)}</div>; } catch {} return <p className="whitespace-pre-wrap">{script.objection_handling}</p>; })()}</div>}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogModalOpen(false)}>Cancel</Button>
            <Button onClick={handleLogCommunication}>Log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Task Modal */}
      <Dialog open={taskModalOpen} onOpenChange={setTaskModalOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4" /> Create Follow-up Task</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            {taskContactId && (() => {
              const contact = campaignContacts.find((cc: any) => cc.contact_id === taskContactId);
              const contactName = contact?.contacts?.contact_name || "Unknown";
              const accountId = contact?.account_id;
              const account = accountId ? campaignAccounts.find((ca: any) => ca.account_id === accountId) : null;
              const accountName = account?.accounts?.account_name || "";
              return (
                <div className="flex flex-wrap gap-3 text-xs">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted">
                    <span className="text-muted-foreground">Contact:</span>
                    <span className="font-medium">{contactName}</span>
                  </div>
                  {accountName && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted">
                      <span className="text-muted-foreground">Account:</span>
                      <span className="font-medium">{accountName}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <Label className="text-xs">Title *</Label>
              <Input value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="Task title..." className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Additional details..." rows={2} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Due Date</Label>
                <Input type="date" value={taskForm.due_date} onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} className="text-sm h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Select value={taskForm.priority} onValueChange={v => setTaskForm({ ...taskForm, priority: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateTask}>Create Task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
