import { useState, useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, FileText, Eye, Paperclip, AlertTriangle, Search, Users, User, RotateCw, X, ExternalLink, Mail } from "lucide-react";
import { RichEmailBodyEditor, isEditorHtmlEmpty } from "./RichEmailBodyEditor";
import { toast } from "@/hooks/use-toast";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useAuth } from "@/hooks/useAuth";
import { useDuplicateSendGuard } from "@/hooks/useDuplicateSendGuard";
import { useCampaignSettings } from "@/hooks/useCampaignSettings";
import { isReachableEmail } from "@/lib/email";
import {
  AVAILABLE_VARIABLES,
  substituteVariables,
  findUnresolvedVariables,
  looksLikeHtml,
} from "@/utils/campaignVariables";

interface Contact {
  contact_id: string;
  account_id: string | null;
  contacts: {
    contact_name: string;
    email: string | null;
    company_name: string | null;
    position: string | null;
    region?: string | null;
  } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  contacts: Contact[];
  preselectedContactId?: string;
  replyTo?: { parent_id: string; thread_id: string | null; subject: string; contactId: string; internet_message_id?: string | null };
  onEmailSent: (contactId?: string) => void;
  onBatchComplete?: () => void;
}

interface SendResult {
  contactId: string;
  contactName: string;
  email: string;
  // "queued" = handed off to the durable backend queue; the cron runner
  // will deliver it within ~1 minute. The polling effect below upgrades
  // queued → success / failed once `campaign_send_job_items.status`
  // changes to a terminal value.
  status: "pending" | "sending" | "queued" | "success" | "failed" | "cancelled";
  error?: string;
  sentAt?: string;
  renderedSubject?: string;
  // C8: actual mailbox the message was sent from. Differs from `senderEmail` when
  // the user-mailbox send was denied and the function fell back to the shared mailbox.
  sentAs?: string;
  sentAsShared?: boolean;
  // Set for items that went through the durable queue so the UI can poll
  // for their real outcome instead of optimistically reporting success.
  jobItemId?: string;
}

// Detect placeholder/scratch text inside the body
const PLACEHOLDER_RE = /^\s*(test\s*\d*|todo|tbd|lorem ipsum|placeholder|xxx+)\s*$/im;

const MAX_ATTACHMENT_BYTES = 9 * 1024 * 1024; // 9 MB

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function EmailComposeModal({ open, onOpenChange, campaignId, contacts: contactsProp, preselectedContactId, replyTo, onEmailSent, onBatchComplete }: Props) {
  const isReplyMode = !!replyTo;
  const { user } = useAuth();

  // Send mode: single (one recipient) or bulk (many). Reply forces single.
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [singleContactId, setSingleContactId] = useState<string>("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const cancelRef = useRef(false);
  const [sendResults, setSendResults] = useState<SendResult[]>([]);
  // Preview pane is always visible (side-by-side with editor) — no tabs.
  const [previewContactId, setPreviewContactId] = useState<string>("");
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [bounceConfirmOpen, setBounceConfirmOpen] = useState(false);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{ ids: string[]; recentIds: Set<string> } | null>(null);
  // Set when bulk-enqueue hands the batch to the cron runner. We poll the
  // job's items to surface real per-recipient delivery status — never trust
  // the enqueue ack as proof of delivery.
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // Optional schedule for bulk send (datetime-local string e.g. "2026-04-28T09:00").
  // Empty/blank = send as soon as the cron picks the job up.
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [sendingTest, setSendingTest] = useState(false);

  const { windowDays: dupWindowDays, getRecentlyEmailedIds } = useDuplicateSendGuard(campaignId);
  const { settings: campaignSettings } = useCampaignSettings();

  // Active recipient list derived from mode
  const activeRecipientIds = useMemo(
    () => (isReplyMode || mode === "single" ? (singleContactId ? [singleContactId] : []) : selectedContactIds),
    [mode, isReplyMode, singleContactId, selectedContactIds]
  );

  // Initialize on open / reply / preselect
  useEffect(() => {
    if (!open) return;
    if (replyTo) {
      setMode("single");
      setSingleContactId(replyTo.contactId);
      setSelectedContactIds([replyTo.contactId]);
      const stripped = (replyTo.subject || "").replace(/^(\s*re\s*:\s*)+/i, "").trim();
      setSubject(stripped ? `Re: ${stripped}` : "Re:");
      setBody("\n\n\nKind Regards,\n{owner_name}");
    } else if (preselectedContactId) {
      setMode("single");
      setSingleContactId(preselectedContactId);
      setSelectedContactIds([preselectedContactId]);
    } else {
      setMode("single");
    }
  }, [open, preselectedContactId, replyTo]);

  // Reset when closing
  useEffect(() => {
    if (!open) {
      setSelectedAttachmentIds([]);
      setRecipientSearch("");
      setPreviewContactId("");
      
      setScheduledAt("");
      // Keep sendResults so user can review last batch after reopen — cleared on next send.
    }
  }, [open]);

  // Keep previewContactId valid
  useEffect(() => {
    if (activeRecipientIds.length === 0) {
      setPreviewContactId("");
    } else if (!activeRecipientIds.includes(previewContactId)) {
      setPreviewContactId(activeRecipientIds[0]);
    }
  }, [activeRecipientIds, previewContactId]);

  const queryClient = useQueryClient();

  // Live-refetch the underlying contacts for this campaign while the modal is
  // open. The parent passes a snapshot via `contacts`, but contacts can be
  // edited elsewhere (Contacts module, Audience tab) while the user is composing
  // — those edits should reflect here within ~2s without reopening the modal.
  const { data: liveCampaignContacts = [] } = useQuery({
    queryKey: ["compose-live-campaign-contacts", campaignId],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("contact_id, account_id, contacts(contact_name, email, company_name, position, region)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Merge live contact info onto the snapshot from the parent so reachability
  // (email validity) reflects the latest edits without changing the parent's
  // selection logic.
  const liveContactById = useMemo(() => {
    const map = new Map<string, any>();
    for (const r of liveCampaignContacts) map.set(r.contact_id, r);
    return map;
  }, [liveCampaignContacts]);

  // Merge live contact info onto the snapshot from the parent so reachability
  // (email validity) reflects the latest edits without changing parent's
  // selection logic. Selection IDs from the parent stay valid because we only
  // override the inner `contacts` field, never the contact_id.
  const contacts = useMemo<Contact[]>(() => {
    return contactsProp.map((c) => {
      const live = liveContactById.get(c.contact_id);
      if (!live?.contacts) return c;
      return {
        ...c,
        contacts: { ...c.contacts, ...live.contacts },
      };
    });
  }, [contactsProp, liveContactById]);

  // Realtime: invalidate the live-contacts query on any contacts/campaign_contacts change.
  // D6: bumped 500ms → 2s so a bulk import (hundreds of INSERTs) doesn't cause a refetch storm
  // and UI flicker mid-send. The `contacts` subscription is unfiltered (global), so the longer
  // debounce keeps modal interaction smooth even when other tenants edit contacts simultaneously.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedInvalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["compose-live-campaign-contacts", campaignId] });
        timer = null;
      }, 2000);
    };
    const channel = supabase
      .channel(`compose-live-${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, debouncedInvalidate)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaign_contacts", filter: `campaign_id=eq.${campaignId}` },
        debouncedInvalidate,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [open, campaignId, queryClient]);

  // ── Bulk job poller ───────────────────────────────────────────
  // When a bulk batch is enqueued we hold its job_id in `activeJobId`.
  // Every 3s we read `campaign_send_job_items` and project the real
  // delivery state back onto each `sendResults` row. We stop polling once
  // every queued row has reached a terminal state (sent / failed /
  // skipped / cancelled). This is the single source of truth for the UI.
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const { data, error } = await supabase
        .from("campaign_send_job_items")
        .select("contact_id, status, last_error_code, last_error_message, communication_id, id")
        .eq("job_id", activeJobId);
      if (cancelled) return;
      if (error || !data) {
        timer = setTimeout(tick, 5000);
        return;
      }
      const byContact = new Map(data.map((r: any) => [r.contact_id, r]));
      const newlySent: string[] = [];
      setSendResults((prev) => {
        const next = prev.map((r) => {
          const item = byContact.get(r.contactId);
          if (!item) return r;
          if (item.status === "sent" && r.status !== "success") {
            newlySent.push(r.contactId);
            return { ...r, status: "success" as const, sentAt: new Date().toISOString(), jobItemId: item.id };
          }
          if (item.status === "failed") {
            return {
              ...r,
              status: "failed" as const,
              error: item.last_error_message || item.last_error_code || "Send failed",
              jobItemId: item.id,
            };
          }
          if (item.status === "skipped") {
            return {
              ...r,
              status: "failed" as const,
              error: item.last_error_message || item.last_error_code || "Skipped",
              jobItemId: item.id,
            };
          }
          if (item.status === "cancelled") {
            return { ...r, status: "cancelled" as const, jobItemId: item.id };
          }
          // queued / sending — keep the queued visual state.
          return { ...r, status: "queued" as const, jobItemId: item.id };
        });
        return next;
      });
      // Fire onEmailSent only for newly-delivered contacts so analytics
      // refresh exactly once per contact, never on the queue ack.
      for (const cid of newlySent) onEmailSent(cid);
      if (newlySent.length > 0) onBatchComplete?.();

      const allDone = data.every((r: any) =>
        ["sent", "failed", "skipped", "cancelled"].includes(r.status),
      );
      if (allDone) {
        setActiveJobId(null);
        return;
      }
      timer = setTimeout(tick, 3000);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId, onEmailSent, onBatchComplete]);

  const { data: templates = [] } = useQuery({
    queryKey: ["campaign-email-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_email_templates")
        .select("*")
        .eq("campaign_id", campaignId)
        .not("email_type", "in", '("LinkedIn-Connection","LinkedIn-Followup")');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const { data: campaignData } = useQuery({
    queryKey: ["campaign-owner-meta", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("owner")
        .eq("id", campaignId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const ownerIds = campaignData?.owner ? [campaignData.owner] : [];
  const { displayNames } = useUserDisplayNames(ownerIds);
  const ownerName = campaignData?.owner ? displayNames[campaignData.owner] || "" : "";

  // Sender identity (mailbox the email will appear FROM)
  const { data: senderProfile } = useQuery({
    queryKey: ["compose-sender-email", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("profiles")
        .select('"Email ID", full_name')
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: open && !!user?.id,
  });
  const senderEmail = (senderProfile as any)?.["Email ID"] || user?.email || "";

  const { data: materials = [] } = useQuery({
    queryKey: ["campaign-materials", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_materials")
        .select("id, file_name, file_path, file_type")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Batch-fetch country for ALL accounts referenced by selected contacts (avoids N+1).
  const accountIdsForSelected = useMemo(() => {
    const ids = new Set<string>();
    for (const cid of activeRecipientIds) {
      const c = contacts.find(x => x.contact_id === cid);
      if (c?.account_id) ids.add(c.account_id);
    }
    return Array.from(ids);
  }, [activeRecipientIds, contacts]);

  const { data: countryByAccount = {}, isLoading: countriesLoading } = useQuery({
    queryKey: ["bulk-account-countries", campaignId, accountIdsForSelected.sort().join(",")],
    queryFn: async () => {
      if (accountIdsForSelected.length === 0) return {} as Record<string, string | null>;
      const { data, error } = await supabase
        .from("accounts")
        .select("id, country")
        .in("id", accountIdsForSelected);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const row of data || []) map[row.id] = row.country || null;
      return map;
    },
    enabled: open && accountIdsForSelected.length > 0,
  });

  const ownerNamesLoading = !!campaignData?.owner && !ownerName;

  // Aggregate bounce counts + latest bounce metadata for selected contacts
  const { data: bounceMetaByContact = {} } = useQuery<Record<string, { bounced_at: string | null; reason: string | null; count: number }>>({
    queryKey: ["campaign-bounced-contacts-meta", campaignId, activeRecipientIds.sort().join(",")],
    queryFn: async () => {
      if (activeRecipientIds.length === 0) return {};
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("contact_id, communication_date, notes")
        .eq("campaign_id", campaignId)
        .eq("email_status", "Bounced")
        .in("contact_id", activeRecipientIds)
        .order("communication_date", { ascending: false });
      if (error) return {};
      const map: Record<string, { bounced_at: string | null; reason: string | null; count: number }> = {};
      for (const row of (data || []) as any[]) {
        if (!row.contact_id) continue;
        if (!map[row.contact_id]) {
          map[row.contact_id] = {
            bounced_at: row.communication_date || null,
            reason: row.notes || null,
            count: 0,
          };
        }
        map[row.contact_id].count++;
      }
      return map;
    },
    enabled: open && activeRecipientIds.length > 0,
  });

  const bouncedContactIds = useMemo(() => Object.keys(bounceMetaByContact), [bounceMetaByContact]);

  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [focusedField, setFocusedField] = useState<"subject" | "body">("body");

  const handleTemplateSelect = (tid: string) => {
    setTemplateId(tid);
    const tpl = templates.find(t => t.id === tid);
    if (tpl) {
      setSubject(tpl.subject || "");
      setBody(tpl.body || "");
    }
  };

  const renderForContact = (text: string, contact: Contact | undefined) =>
    substituteVariables(text, {
      contact: contact?.contacts ?? null,
      ownerName,
      accountCountry: contact?.account_id ? countryByAccount[contact.account_id] || null : null,
    });

  const insertVariable = (v: string) => {
    if (focusedField === "subject") {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + v + subject.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        const pos = start + v.length;
        el?.setSelectionRange(pos, pos);
      });
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? body.length;
      const end = el?.selectionEnd ?? body.length;
      setBody(body.slice(0, start) + v + body.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        const pos = start + v.length;
        el?.setSelectionRange(pos, pos);
      });
    }
  };

  const toggleAttachment = (id: string) => {
    setSelectedAttachmentIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectedAttachments = useMemo(
    () => materials.filter((m: any) => selectedAttachmentIds.includes(m.id)),
    [materials, selectedAttachmentIds]
  );

  // Try to estimate attachment bytes (file size not always present — best effort)
  const attachmentSizeBytes = useMemo(() => {
    return selectedAttachments.reduce((sum: number, m: any) => sum + (m.file_size || 0), 0);
  }, [selectedAttachments]);

  // Recipient list filtering (bulk mode)
  const filteredContacts = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c => {
      const n = c.contacts?.contact_name?.toLowerCase() || "";
      const e = c.contacts?.email?.toLowerCase() || "";
      const co = c.contacts?.company_name?.toLowerCase() || "";
      return n.includes(q) || e.includes(q) || co.includes(q);
    });
  }, [contacts, recipientSearch]);

  const selectableFiltered = useMemo(
    () => filteredContacts.filter(c => isReachableEmail(c.contacts?.email)),
    [filteredContacts]
  );

  const allFilteredSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every(c => selectedContactIds.includes(c.contact_id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(selectableFiltered.map(c => c.contact_id));
      setSelectedContactIds(prev => prev.filter(id => !filteredIds.has(id)));
    } else {
      const next = new Set(selectedContactIds);
      selectableFiltered.forEach(c => next.add(c.contact_id));
      setSelectedContactIds(Array.from(next));
    }
  };

  const toggleContact = (id: string) => {
    setSelectedContactIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const previewContact = contacts.find(c => c.contact_id === previewContactId);
  const selectedBouncedCount = bouncedContactIds.length;

  // C9: compute the worst-case subject length across ALL selected recipients —
  // a 70-char template with `{company_name}` may render to 95+ chars for one
  // contact while looking fine for another. Use the longest rendering.
  const selectedContactsForLen = useMemo(
    () => contacts.filter(c => selectedContactIds.includes(c.contact_id)),
    [contacts, selectedContactIds],
  );
  const { subjectLen, subjectWorstContact } = useMemo(() => {
    const pool = selectedContactsForLen.length > 0
      ? selectedContactsForLen
      : (previewContact ? [previewContact] : []);
    let worst = subject.length;
    let who: typeof previewContact | undefined = undefined;
    for (const c of pool) {
      const len = renderForContact(subject, c).length;
      if (len > worst) { worst = len; who = c; }
    }
    return { subjectLen: worst, subjectWorstContact: who };
  }, [selectedContactsForLen, previewContact, subject]);
  const subjectTooLong = subjectLen > 78;
  const subjectWarn = subjectLen > 70 && !subjectTooLong;

  // Detect placeholder/scratch text in body lines
  const placeholderLines = useMemo(() => {
    return body.split(/\n/).filter(l => PLACEHOLDER_RE.test(l)).map(l => l.trim()).filter(Boolean);
  }, [body]);

  const performSend = async (contactIdsToSend: string[]) => {
    if (sendingRef.current) return;
    if (contactIdsToSend.length === 0) { toast({ title: "Select at least one recipient" }); return; }
    if (!subject.trim()) { toast({ title: "Subject is required" }); return; }
    if (isEditorHtmlEmpty(body)) { toast({ title: "Body is required" }); return; }
    if (countriesLoading || ownerNamesLoading) {
      toast({ title: "Still loading owner / account info — please wait a moment." });
      return;
    }

    const recipients = contactIdsToSend
      .map(id => contacts.find(c => c.contact_id === id))
      .filter((c): c is Contact => !!c);

    const missingEmail = recipients.filter(c => !c.contacts?.email);
    if (missingEmail.length > 0) {
      toast({ title: `${missingEmail.length} contact(s) have no email and will be skipped.`, variant: "destructive" });
    }
    const sendable = recipients.filter(c => !!c.contacts?.email);
    if (sendable.length === 0) { toast({ title: "No recipients with valid email.", variant: "destructive" }); return; }

    // Reply mode is strictly single-recipient: a reply that fans out to many
    // contacts would silently break thread headers for everyone except the
    // first contact (parent_id only matches one conversation).
    if (isReplyMode && sendable.length !== 1) {
      toast({
        title: "Reply mode only supports one recipient.",
        description: "Switch to Bulk to send a new email to multiple contacts.",
        variant: "destructive",
      });
      return;
    }

    // Per-contact unresolved variable check
    const unresolvedReport: string[] = [];
    for (const c of sendable) {
      const s = renderForContact(subject, c);
      const b = renderForContact(body, c);
      const u = Array.from(new Set([...findUnresolvedVariables(s), ...findUnresolvedVariables(b)]));
      if (u.length > 0) unresolvedReport.push(`${c.contacts?.contact_name}: ${u.join(", ")}`);
    }
    if (unresolvedReport.length > 0) {
      toast({
        title: `Unresolved variables for ${unresolvedReport.length} contact(s). First: ${unresolvedReport[0]}`,
        variant: "destructive",
        duration: 8000,
      });
      return;
    }

    sendingRef.current = true;
    cancelRef.current = false;
    setSending(true);

    // Initialize / merge results: keep previous successes if retrying failures
    setSendResults(prev => {
      const map = new Map(prev.map(r => [r.contactId, r]));
      for (const c of sendable) {
        map.set(c.contact_id, {
          contactId: c.contact_id,
          contactName: c.contacts?.contact_name || "Unknown",
          email: c.contacts?.email || "",
          status: "pending",
          renderedSubject: renderForContact(subject, c),
        });
      }
      return Array.from(map.values());
    });

    const attachmentsPayload = selectedAttachments.map((m: any) => ({
      file_path: m.file_path,
      file_name: m.file_name,
    }));

    // ── Bulk-enqueue path ─────────────────────────────────────────
    // For larger bulk sends (>= configured threshold) and not in reply mode, hand the
    // batch off to the durable backend send queue instead of looping in the
    // browser. Threshold is per-tenant (B11) — defaults to 25.
    // For >1000 recipients we chunk on the client (B10) because the edge
    // function caps each call at MAX_ITEMS=1000.
    const ENQUEUE_THRESHOLD = campaignSettings.enqueueThreshold;
    const ENQUEUE_CHUNK = 1000; // matches enqueue-campaign-send MAX_ITEMS
    // Always route through the queue when a schedule is set — the runner +
    // claim_send_job_items RPC honour campaign_send_jobs.scheduled_at, but
    // the direct per-recipient send path below does not.
    const mustEnqueueForSchedule = !isReplyMode && mode === "bulk" && !!scheduledAt;
    if (!isReplyMode && mode === "bulk" && (sendable.length >= ENQUEUE_THRESHOLD || mustEnqueueForSchedule)) {
      try {
        const items = sendable.map((c) => {
          const finalSubject = renderForContact(subject, c);
          const finalBody = renderForContact(body, c);
          return {
            contact_id: c.contact_id,
            account_id: c.account_id || null,
            recipient_email: c.contacts!.email!,
            recipient_name: c.contacts!.contact_name || "",
            subject: finalSubject,
            body: finalBody,
            idempotency_key: `${campaignId}:${c.contact_id}:${templateId || "custom"}:${finalSubject}:${finalBody}`,
          };
        });
        const scheduledIso = scheduledAt ? new Date(scheduledAt).toISOString() : null;
        const totalChunks = Math.ceil(items.length / ENQUEUE_CHUNK);

        let queuedTotal = 0;
        let skippedDupsTotal = 0;
        let firstJobId: string | null = null;
        const chunkErrors: string[] = [];

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          if (cancelRef.current) break;
          const chunk = items.slice(chunkIdx * ENQUEUE_CHUNK, (chunkIdx + 1) * ENQUEUE_CHUNK);
          if (totalChunks > 1) {
            // Surface progress for very large batches.
            toast({
              title: `Queueing batch ${chunkIdx + 1} of ${totalChunks}…`,
              description: `${chunk.length} recipient(s)`,
              duration: 2500,
            });
          }
          const { data, error } = await supabase.functions.invoke("enqueue-campaign-send", {
            body: {
              campaign_id: campaignId,
              template_id: templateId || undefined,
              attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
              items: chunk,
              scheduled_at: scheduledIso,
              dup_window_days: dupWindowDays,
            },
          });
          // Recover structured JSON body from FunctionsHttpError (non-2xx throws).
          let payload: any = data;
          if (error) {
            payload = null;
            const ctx = (error as any)?.context;
            if (ctx && typeof ctx.json === "function") {
              try { payload = await ctx.json(); } catch { /* ignore */ }
            }
            if (!payload && ctx && typeof ctx.text === "function") {
              try {
                const txt = await ctx.text();
                try { payload = JSON.parse(txt); } catch { payload = { error: txt }; }
              } catch { /* ignore */ }
            }
            if (!payload) payload = { error: (error as any)?.message || "Edge function error" };
          }
          if (payload?.errorCode === "CAMPAIGN_NOT_ACTIVE") {
            cancelRef.current = true;
            chunkErrors.push(payload?.error || "Campaign is not active");
            toast({
              title: "Campaign is paused, completed or archived — queueing stopped.",
              description: payload?.error,
              variant: "destructive",
            });
            break;
          }
          if (error || !payload?.success) {
            chunkErrors.push(payload?.error || error?.message || `Batch ${chunkIdx + 1} failed`);
            continue;
          }
          queuedTotal += Number(payload.queued_count || chunk.length);
          skippedDupsTotal += Number(payload.skipped_duplicates || 0);
          if (!firstJobId && payload.job_id) firstJobId = payload.job_id as string;
          // Mark this chunk's contacts as queued in the results table.
          const chunkContactIds = new Set(chunk.map((it) => it.contact_id));
          setSendResults((prev) =>
            prev.map((r) =>
              chunkContactIds.has(r.contactId) ? { ...r, status: "queued" } : r,
            ),
          );
        }

        if (queuedTotal === 0) {
          throw new Error(chunkErrors[0] || "Failed to enqueue any recipients");
        }
        if (firstJobId) setActiveJobId(firstJobId);
        toast({
          title: scheduledIso
            ? `Scheduled ${queuedTotal} email(s) for ${new Date(scheduledIso).toLocaleString()}.`
            : `Queued ${queuedTotal} email(s) for background send${totalChunks > 1 ? ` across ${totalChunks} batches` : ""}.`,
          description: [
            skippedDupsTotal > 0 ? `${skippedDupsTotal} skipped (duplicates within ${dupWindowDays} day(s)).` : "",
            chunkErrors.length > 0 ? `${chunkErrors.length} batch(es) failed — see toast(s) above.` : "",
            "Live status updates will appear below — you can close this modal anytime.",
          ].filter(Boolean).join(" "),
        });
        if (chunkErrors.length > 0) {
          toast({
            title: `${chunkErrors.length} batch(es) failed`,
            description: chunkErrors[0],
            variant: "destructive",
          });
        }
        sendingRef.current = false;
        setSending(false);
        // Keep modal open so the user sees real per-recipient progress.
        return;
      } catch (e: any) {
        sendingRef.current = false;
        setSending(false);
        toast({ title: e?.message || "Failed to enqueue batch", variant: "destructive" });
        return;
      }
    }

    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;
    let sharedFallbackCount = 0; // C8: how many sends fell back to the shared mailbox.

    for (let i = 0; i < sendable.length; i++) {
      if (cancelRef.current) {
        // Mark remaining as cancelled
        const remainingIds = sendable.slice(i).map(c => c.contact_id);
        cancelledCount += remainingIds.length;
        setSendResults(prev =>
          prev.map(r => remainingIds.includes(r.contactId) ? { ...r, status: "cancelled" } : r)
        );
        break;
      }
      const c = sendable[i];
      setSendResults(prev =>
        prev.map(r => r.contactId === c.contact_id ? { ...r, status: "sending" } : r)
      );
      try {
        const finalSubject = renderForContact(subject, c);
        const finalBody = renderForContact(body, c);

        const { data, error } = await supabase.functions.invoke("send-campaign-email", {
          body: {
            campaign_id: campaignId,
            contact_id: c.contact_id,
            account_id: c.account_id,
            idempotency_key: `${campaignId}:${c.contact_id}:${templateId || "custom"}:${replyTo?.parent_id || "root"}:${finalSubject}:${finalBody}`,
            template_id: templateId || undefined,
            subject: finalSubject,
            body: finalBody,
            recipient_email: c.contacts!.email,
            recipient_name: c.contacts!.contact_name,
            attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
            ...(replyTo
              ? {
                  parent_id: replyTo.parent_id,
                  thread_id: replyTo.thread_id || replyTo.parent_id,
                  ...(replyTo.internet_message_id
                    ? { parent_internet_message_id: replyTo.internet_message_id }
                    : {}),
                }
              : {}),
          },
        });

        // supabase.functions.invoke() throws on any non-2xx, leaving `data` null.
        // Recover the structured JSON body (with errorCode) from the thrown
        // FunctionsHttpError so the CAMPAIGN_NOT_ACTIVE branch below can run
        // instead of bubbling up as an unhandled runtime error.
        let payload: any = data;
        if (error) {
          payload = null;
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            try { payload = await ctx.json(); } catch { /* not JSON */ }
          }
          if (!payload && ctx && typeof ctx.text === "function") {
            try {
              const txt = await ctx.text();
              try { payload = JSON.parse(txt); } catch { payload = { error: txt }; }
            } catch { /* ignore */ }
          }
          if (!payload) payload = { error: (error as any)?.message || "Edge function error" };
        }

        if (payload?.success) {
          successCount++;
          if (payload?.sent_as_shared) sharedFallbackCount++;
          setSendResults(prev =>
            prev.map(r => r.contactId === c.contact_id
              ? {
                  ...r,
                  status: "success",
                  sentAt: new Date().toISOString(),
                  sentAs: payload?.sent_as,
                  sentAsShared: !!payload?.sent_as_shared,
                }
              : r)
          );
          onEmailSent(c.contact_id);
        } else {
          failCount++;
          const msg = payload?.error || payload?.errorCode || "Unknown error";
          setSendResults(prev =>
            prev.map(r => r.contactId === c.contact_id ? { ...r, status: "failed", error: msg } : r)
          );
          // Campaign is no longer active — abort the rest of the batch instantly
          // so we don't hammer the function with the same blocking error.
          if (payload?.errorCode === "CAMPAIGN_NOT_ACTIVE") {
            const remainingIds = sendable.slice(i + 1).map(x => x.contact_id);
            cancelledCount += remainingIds.length;
            setSendResults(prev =>
              prev.map(r => remainingIds.includes(r.contactId) ? { ...r, status: "cancelled" } : r)
            );
            cancelRef.current = true;
            toast({ title: "Campaign is paused, completed or archived — sending stopped.", variant: "destructive" });
            break;
          }
        }
      } catch (err: any) {
        failCount++;
        setSendResults(prev =>
          prev.map(r => r.contactId === c.contact_id ? { ...r, status: "failed", error: err?.message || "Send failed" } : r)
        );
      }

      if (i < sendable.length - 1 && !cancelRef.current) {
        await new Promise(res => setTimeout(res, 250));
      }
    }

    sendingRef.current = false;
    setSending(false);
    onBatchComplete?.();

    if (failCount === 0 && cancelledCount === 0) {
      // C8: surface shared-mailbox fallback in the success toast.
      toast({
        title:
          sharedFallbackCount > 0
            ? `All ${successCount} email(s) sent (${sharedFallbackCount} via shared mailbox).`
            : `All ${successCount} email(s) sent successfully.`,
      });
      if (sendable.length === 1 && !isReplyMode) {
        // Keep modal open for review of single send too? Close for clean UX.
        onOpenChange(false);
        resetForm();
      } else if (sendable.length === 1 && isReplyMode) {
        onOpenChange(false);
        resetForm();
      }
      // For bulk all-success, also close
      if (sendable.length > 1) {
        onOpenChange(false);
        resetForm();
      }
    } else if (cancelledCount > 0) {
      toast({ title: `Sent ${successCount}, ${cancelledCount} cancelled${failCount ? `, ${failCount} failed` : ""}.` });
    } else {
      toast({ title: `Sent ${successCount}, failed ${failCount}. Review the list and retry failures.`, variant: "destructive" });
    }
  };

  const handleSendClick = async () => {
    // Schedule sanity: block if the chosen time is already in the past
    // (modal may have been open for several minutes).
    if (!isReplyMode && mode === "bulk" && scheduledAt) {
      const scheduledMs = new Date(scheduledAt).getTime();
      if (!Number.isFinite(scheduledMs) || scheduledMs <= Date.now() + 30_000) {
        toast({
          title: "Scheduled time is in the past",
          description: "Pick a future time at least a minute from now, or clear the schedule to send immediately.",
          variant: "destructive",
        });
        return;
      }
    }
    if (!isReplyMode && selectedBouncedCount > 0) {
      setBounceConfirmOpen(true);
      return;
    }
    // Duplicate-send guard: warn if any recipient was emailed in the last N days for this campaign.
    if (!isReplyMode && activeRecipientIds.length > 0) {
      const recent = await getRecentlyEmailedIds(activeRecipientIds);
      if (recent.size > 0) {
        setDuplicateConfirm({ ids: activeRecipientIds, recentIds: recent });
        return;
      }
    }
    void performSend(activeRecipientIds);
  };

  const handleRetryFailed = () => {
    const failedIds = sendResults.filter(r => r.status === "failed").map(r => r.contactId);
    void performSend(failedIds);
  };

  const handleRetryOne = (contactId: string) => {
    void performSend([contactId]);
  };

  const handleCancel = () => {
    cancelRef.current = true;
    toast({ title: "Cancelling remaining sends…" });
  };

  const resetForm = () => {
    setSelectedContactIds([]);
    setSingleContactId("");
    setTemplateId("");
    setSubject("");
    setBody("");
    setSelectedAttachmentIds([]);
    setSendResults([]);
    setRecipientSearch("");
    setMode("single");
    setScheduledAt("");
    setPreviewOpen(false);
    setRecipientsExpanded(true);
  };

  // Preview-as-recipient modal (replaces inline preview pane)
  const [previewOpen, setPreviewOpen] = useState(false);
  // Collapse recipient list once user has picked some — saves vertical space.
  const [recipientsExpanded, setRecipientsExpanded] = useState(true);

  // Schedule "min" — re-tick every 30 s so a long-open modal can't accept a
  // value that's already in the past by the time Send is clicked.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open]);
  const scheduleMin = useMemo(
    () => new Date(nowTick + 60_000).toISOString().slice(0, 16),
    [nowTick]
  );
  const scheduleMax = useMemo(
    () => new Date(nowTick + 365 * 24 * 60 * 60_000).toISOString().slice(0, 16),
    [nowTick]
  );

  // ── Recipient list: 10-second idle auto-collapse ─────────────────
  // Earlier behaviour collapsed the list 350 ms after every checkbox
  // toggle, which made multi-select feel broken. New behaviour: only
  // collapse after 10 s of NO interaction — checkbox toggles, search
  // typing, "All/Clear" clicks, hover, or scroll all reset the timer.
  const recipientsHoverRef = useRef(false);
  const recipientsSearchFocusRef = useRef(false);
  const [recipientsActivityTick, setRecipientsActivityTick] = useState(0);
  const bumpRecipientActivity = () => setRecipientsActivityTick((n) => n + 1);

  // Re-expand whenever selection drops to zero.
  useEffect(() => {
    if (mode !== "bulk") return;
    if (selectedContactIds.length === 0) {
      setRecipientsExpanded(true);
    }
  }, [selectedContactIds, mode]);

  // Idle-collapse timer.
  useEffect(() => {
    if (!open) return;
    if (mode !== "bulk") return;
    if (!recipientsExpanded) return;
    if (selectedContactIds.length === 0) return;
    if (recipientSearch) return; // never collapse while searching
    const t = setTimeout(() => {
      // Re-check guards at fire time — state may have changed.
      if (recipientsHoverRef.current) return;
      if (recipientsSearchFocusRef.current) return;
      setRecipientsExpanded(false);
    }, 10_000);
    return () => clearTimeout(t);
  }, [
    open,
    mode,
    recipientsExpanded,
    selectedContactIds.length,
    recipientSearch,
    recipientsActivityTick,
  ]);

  // Whether the auto-collapse timer is currently armed (drives the hint label).
  const autoCollapseArmed =
    mode === "bulk" &&
    recipientsExpanded &&
    selectedContactIds.length > 0 &&
    !recipientSearch;

  // Keep previewContactId valid: if it points to a no-longer-active recipient,
  // snap to the first active one (or clear).
  useEffect(() => {
    if (previewContactId && !activeRecipientIds.includes(previewContactId)) {
      setPreviewContactId(activeRecipientIds[0] ?? "");
    }
  }, [activeRecipientIds, previewContactId]);

  // Strip HTML so the test mailto: actually shows readable text instead of raw <p> tags.
  const htmlToText = (html: string): string => {
    if (!html) return "";
    const tmp = typeof document !== "undefined" ? document.createElement("div") : null;
    if (!tmp) return html;
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  };


  const sentSoFar = sendResults.filter(r => r.status === "success" || r.status === "failed" || r.status === "cancelled").length;
  const totalToSend = sendResults.length;
  const progressPct = totalToSend > 0 ? (sentSoFar / totalToSend) * 100 : 0;
  const currentlySendingName = sendResults.find(r => r.status === "sending")?.contactName;
  const failedCount = sendResults.filter(r => r.status === "failed").length;
  const queuedCount = sendResults.filter(r => r.status === "queued").length;

  const contactsWithEmail = useMemo(() => contacts.filter(c => isReachableEmail(c.contacts?.email)), [contacts]);

  // One-click clear for unreachable selections (bulk only).
  const removeUnreachable = () => {
    setSelectedContactIds(prev =>
      prev.filter(id => {
        const c = contacts.find(x => x.contact_id === id);
        return c && isReachableEmail(c.contacts?.email);
      })
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v && !sending) { resetForm(); onOpenChange(v); } else if (!sending) onOpenChange(v); }}>
        <DialogContent className="w-[92vw] sm:max-w-[560px] lg:max-w-[600px] max-h-[92vh] overflow-y-auto p-3">
          <DialogHeader className="pb-1 pr-10">
            <DialogTitle className="flex items-center gap-2 text-sm flex-wrap">
              <Send className="h-3.5 w-3.5 shrink-0" />
              <span className="shrink-0">{isReplyMode ? "Reply to Email" : "Compose Campaign Email"}</span>
              {!isReplyMode && (
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(v) => { if (v === "single" || v === "bulk") setMode(v); }}
                  size="sm"
                  className="ml-2 border rounded-md p-0.5 bg-muted/40"
                >
                  <ToggleGroupItem
                    value="single"
                    className="text-[11px] h-5 px-2 gap-1 rounded-sm data-[state=on]:bg-background data-[state=on]:shadow-sm"
                  >
                    <User className="h-3 w-3" /> Single
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="bulk"
                    className="text-[11px] h-5 px-2 gap-1 rounded-sm data-[state=on]:bg-background data-[state=on]:shadow-sm"
                  >
                    <Users className="h-3 w-3" /> Bulk
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
              <div className="ml-auto flex items-center gap-2 min-w-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px] gap-1 shrink-0"
                  onClick={() => setPreviewOpen(true)}
                  disabled={!subject.trim() && !body}
                >
                  <Eye className="h-3 w-3" /> Preview
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-2 py-0">
            {/* Send mode now lives in the dialog header (above) */}

            {/* Recipients (full-width row) — Reply mode pairs Recipient with Template */}
            {isReplyMode ? (
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,260px)_1fr] gap-2 items-end">
                <div className="space-y-1 min-w-0">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Users className="h-3 w-3" />
                    Recipient *
                  </Label>
                  <div className="border rounded-md px-2.5 h-8 flex items-center text-sm bg-muted/30 truncate">
                    <span className="font-medium truncate">
                      {previewContact?.contacts?.contact_name || "Recipient"}
                    </span>
                    {previewContact?.contacts?.email && (
                      <span className="text-xs text-muted-foreground ml-1.5 truncate">
                        &lt;{previewContact.contacts.email}&gt;
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-1 min-w-0">
                  <Label className="text-xs flex items-center gap-1.5">
                    <FileText className="h-3 w-3" />
                    Template
                  </Label>
                  <Select value={templateId} onValueChange={handleTemplateSelect}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Optional…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-3 w-3" />
                            <span className="truncate">{t.template_name}</span>
                            {t.email_type && <Badge variant="secondary" className="text-[10px] px-1 py-0">{t.email_type}</Badge>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2 items-end">
              <div className="space-y-1 min-w-0">
              {mode === "single" && (
                <Label className="text-xs flex items-center gap-1.5">
                  <Users className="h-3 w-3" />
                  Recipient *
                </Label>
              )}

              {mode === "single" ? (
                <Select value={singleContactId} onValueChange={setSingleContactId}>
                  <SelectTrigger className="h-8 text-sm w-full">
                    <SelectValue placeholder="Select a contact..." />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">No contacts.</div>
                    )}
                    {contacts.map(c => {
                      const reachable = isReachableEmail(c.contacts?.email);
                      return (
                        <SelectItem key={c.contact_id} value={c.contact_id} disabled={!reachable}>
                          <span className={`text-sm font-medium ${!reachable ? "opacity-60" : ""}`}>
                            {c.contacts?.contact_name}
                          </span>
                          {reachable ? (
                            <span className="text-xs text-muted-foreground ml-2">{c.contacts?.email}</span>
                          ) : (
                            <Badge variant="destructive" className="ml-2 text-[9px] px-1 py-0">No email</Badge>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  {/* Combined header: label + count badges + search + select-all + collapse toggle */}
                  <div className="flex items-center gap-1.5 px-2 py-1 border-b bg-muted/40">
                    <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] font-medium shrink-0">Recipients *</span>
                    {selectedContactIds.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                        {selectedContactIds.length} selected
                      </Badge>
                    )}
                    {selectedBouncedCount > 0 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500 text-amber-700 dark:text-amber-400 shrink-0">
                        {selectedBouncedCount} bounced
                      </Badge>
                    )}
                    {recipientsExpanded && (
                      <>
                        <div className="flex-1 flex items-center gap-1 min-w-0">
                          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                          <Input
                            value={recipientSearch}
                            onChange={e => { setRecipientSearch(e.target.value); bumpRecipientActivity(); }}
                            onFocus={() => { recipientsSearchFocusRef.current = true; bumpRecipientActivity(); }}
                            onBlur={() => { recipientsSearchFocusRef.current = false; bumpRecipientActivity(); }}
                            placeholder="Search…"
                            className="h-6 border-0 bg-transparent text-xs px-1 focus-visible:ring-0 focus-visible:ring-offset-0 min-w-0"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] px-2 shrink-0"
                          onClick={() => { toggleSelectAllFiltered(); bumpRecipientActivity(); }}
                          disabled={selectableFiltered.length === 0}
                        >
                          {allFilteredSelected ? "Clear" : "All"}
                        </Button>
                      </>
                    )}
                    {!recipientsExpanded && selectedContactIds.length > 0 && (
                      <div className="flex-1 flex items-center gap-1 min-w-0 overflow-hidden">
                        {selectedContactIds.slice(0, 3).map(id => {
                          const c = contacts.find(x => x.contact_id === id);
                          return (
                            <Badge key={id} variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 max-w-[140px] truncate">
                              {c?.contacts?.contact_name || id}
                            </Badge>
                          );
                        })}
                        {selectedContactIds.length > 3 && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            +{selectedContactIds.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                    {autoCollapseArmed && (
                      <span className="text-[9px] text-muted-foreground shrink-0 hidden md:inline" title="Recipient list auto-collapses after 10 seconds of no activity">
                        auto-collapse 10s
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2 shrink-0 gap-1"
                      onClick={() => { setRecipientsExpanded(v => !v); bumpRecipientActivity(); }}
                    >
                      {recipientsExpanded ? "Collapse" : "Edit"}
                    </Button>
                  </div>
                  {recipientsExpanded && (
                    <div
                      className="max-h-[180px] overflow-y-auto divide-y bg-background"
                      onMouseEnter={() => { recipientsHoverRef.current = true; bumpRecipientActivity(); }}
                      onMouseLeave={() => { recipientsHoverRef.current = false; bumpRecipientActivity(); }}
                      onScroll={bumpRecipientActivity}
                    >
                      {filteredContacts.length === 0 && (
                        <p className="text-xs text-muted-foreground p-2">No contacts.</p>
                      )}
                      {filteredContacts.map(c => {
                        const noEmail = !isReachableEmail(c.contacts?.email);
                        const bounced = bouncedContactIds.includes(c.contact_id);
                        return (
                          <div
                            key={c.contact_id}
                            role="checkbox"
                            aria-checked={selectedContactIds.includes(c.contact_id)}
                            aria-disabled={noEmail}
                            tabIndex={noEmail ? -1 : 0}
                            onClick={() => { if (!noEmail) { toggleContact(c.contact_id); bumpRecipientActivity(); } }}
                            onKeyDown={(e) => {
                              if (!noEmail && (e.key === " " || e.key === "Enter")) {
                                e.preventDefault();
                                toggleContact(c.contact_id);
                                bumpRecipientActivity();
                              }
                            }}
                            className={`flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/50 ${noEmail ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                          >
                            <Checkbox
                              checked={selectedContactIds.includes(c.contact_id)}
                              disabled={noEmail}
                              tabIndex={-1}
                              className="pointer-events-none"
                            />
                            <span className="flex-1 truncate">
                              <span className="font-medium">{c.contacts?.contact_name}</span>
                              {c.contacts?.email && (
                                <span className="text-muted-foreground ml-1">{c.contacts.email}</span>
                              )}
                            </span>
                            {noEmail && <Badge variant="destructive" className="text-[9px] px-1 py-0">No email</Badge>}
                            {bounced && <Badge variant="outline" className="text-[9px] px-1 py-0 border-destructive text-destructive">Bounced</Badge>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {recipientsExpanded && selectedContactIds.some(id => {
                    const c = contacts.find(x => x.contact_id === id);
                    return !c || !isReachableEmail(c.contacts?.email);
                  }) && (
                    <div className="flex items-center justify-end px-2 py-0.5 border-t bg-muted/30">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 text-[10px] gap-1"
                        onClick={removeUnreachable}
                      >
                        <X className="h-3 w-3" /> Remove unreachable
                      </Button>
                    </div>
                  )}
                </div>
              )}
              </div>
              <div className="space-y-1 min-w-0">
                <Label className="text-xs flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  Template
                </Label>
                <Select value={templateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Optional…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center gap-2">
                          <FileText className="h-3 w-3" />
                          <span className="truncate">{t.template_name}</span>
                          {t.email_type && <Badge variant="secondary" className="text-[10px] px-1 py-0">{t.email_type}</Badge>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            )}

            {/* Subject — full width (Template now paired with Recipient above) */}
            <div>
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="text-xs flex items-center gap-1.5">
                    Subject *
                  </Label>
                  {(subjectWarn || subjectTooLong) && (
                    <span
                      className={`text-[10px] ${subjectTooLong ? "text-destructive font-medium" : "text-amber-600"}`}
                      title="Subjects over ~60 chars get truncated in Gmail/Outlook previews; over ~78 chars may be cut entirely."
                    >
                      {subjectLen} chars{subjectTooLong ? " — may be truncated" : " — long"}
                    </span>
                  )}
                </div>
                <Input
                  ref={subjectRef}
                  value={subject}
                  onChange={e => { if (!isReplyMode) setSubject(e.target.value); }}
                  onFocus={() => setFocusedField("subject")}
                  placeholder="Email subject..."
                  className="h-8 text-sm"
                  readOnly={isReplyMode}
                  title={isReplyMode ? "Subject is locked in reply mode to keep the email in the same thread" : undefined}
                />
                {isReplyMode && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Locked to keep the reply in the same email thread (Outlook behavior).
                  </p>
                )}
              </div>
            </div>

            {/* Body editor — full width (preview lives in a dedicated modal) */}
            <div className="space-y-0.5 min-w-0">
              <Label className="text-xs flex items-center gap-1.5">
                Body *
                {placeholderLines.length > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500 text-amber-700 dark:text-amber-400 gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Placeholder text
                  </Badge>
                )}
              </Label>
              <div onFocus={() => setFocusedField("body")}>
                <RichEmailBodyEditor value={body} onChange={setBody} minHeightPx={220} />
              </div>
            </div>

            {/* (Per-recipient subject preview removed — live preview on the right
                already shows the resolved subject for the selected recipient.) */}

            {/* Attachments */}
            {materials.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3" /> Attachments
                  {selectedAttachmentIds.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {selectedAttachmentIds.length} selected
                    </Badge>
                  )}
                </Label>
                <div className="border rounded-md divide-y max-h-[140px] overflow-y-auto">
                  {materials.map((m: any) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selectedAttachmentIds.includes(m.id)}
                        onCheckedChange={() => toggleAttachment(m.id)}
                      />
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate text-xs">{m.file_name}</span>
                      {m.file_size && (
                        <span className="text-[10px] text-muted-foreground">{formatBytes(m.file_size)}</span>
                      )}
                      {m.file_type && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">{m.file_type}</Badge>
                      )}
                    </label>
                  ))}
                </div>
                <p className={`text-[10px] ${attachmentSizeBytes > MAX_ATTACHMENT_BYTES ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {attachmentSizeBytes > 0
                    ? `Total: ${formatBytes(attachmentSizeBytes)} / ${formatBytes(MAX_ATTACHMENT_BYTES)}`
                    : `Total attachment size limit: ~9 MB.`}
                </p>
              </div>
            )}

            {/* Send progress / per-recipient results */}
            {sendResults.length > 0 && (
              <div className="space-y-1.5 rounded-md border p-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">
                    {sending
                      ? `Sending ${sentSoFar} / ${totalToSend}${currentlySendingName ? ` — ${currentlySendingName}` : "…"}`
                      : `Send results (${totalToSend})`}
                  </Label>
                  <div className="flex gap-2 items-center">
                    <Badge variant="secondary" className="text-[10px]">
                      {sendResults.filter(r => r.status === "success").length} sent
                    </Badge>
                    {failedCount > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {failedCount} failed
                      </Badge>
                    )}
                    {queuedCount > 0 && (
                      <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">
                        {queuedCount} queued
                      </Badge>
                    )}
                    {sendResults.some(r => r.status === "cancelled") && (
                      <Badge variant="outline" className="text-[10px]">
                        {sendResults.filter(r => r.status === "cancelled").length} cancelled
                      </Badge>
                    )}
                    {sending && (
                      <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={handleCancel}>
                        <X className="h-3 w-3" /> Cancel remaining
                      </Button>
                    )}
                    {!sending && failedCount > 0 && (
                      <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={handleRetryFailed}>
                        <RotateCw className="h-3 w-3" /> Retry failed
                      </Button>
                    )}
                  </div>
                </div>
                <Progress value={progressPct} className="h-1.5" />
                <div className="max-h-[120px] overflow-y-auto divide-y text-xs">
                  {sendResults.map(r => (
                    <div key={r.contactId} className="flex items-center justify-between py-1 gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{r.contactName}</span>
                          <span className="text-muted-foreground truncate text-[10px]">{r.email}</span>
                        </div>
                        {r.renderedSubject && (
                          <div className="text-[10px] text-muted-foreground truncate">→ {r.renderedSubject}</div>
                        )}
                        {r.status === "success" && r.sentAs && (
                          <div className="text-[10px] text-muted-foreground truncate">
                            from {r.sentAs}
                            {r.sentAsShared && (
                              <span className="ml-1 text-amber-600">(shared mailbox fallback)</span>
                            )}
                          </div>
                        )}
                        {r.error && (
                          <div className="text-[10px] text-destructive truncate" title={r.error}>{r.error}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={
                          r.status === "success" ? "text-green-600" :
                          r.status === "failed" ? "text-destructive" :
                          r.status === "cancelled" ? "text-muted-foreground" :
                          r.status === "queued" ? "text-amber-600" :
                          r.status === "sending" ? "text-primary" : "text-muted-foreground"
                        }>
                          {r.status === "success" ? "✓ Sent" :
                           r.status === "failed" ? "✗ Failed" :
                           r.status === "cancelled" ? "⊘ Cancelled" :
                           r.status === "queued" ? "⏳ Queued" :
                           r.status === "sending" ? "Sending…" : "Pending"}
                        </span>
                        {r.status === "failed" && !sending && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0"
                            onClick={() => handleRetryOne(r.contactId)}
                            title="Retry this recipient"
                          >
                            <RotateCw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row items-center gap-2 sm:gap-2 sm:justify-between flex-wrap pt-2">
            {/* Inline schedule (bulk only, not in reply mode) — pushed left */}
            {!isReplyMode && mode === "bulk" && activeRecipientIds.length > 0 ? (
              <div className="flex items-center gap-1.5 mr-auto text-xs">
                <Label htmlFor="bulk-schedule" className="text-[11px] whitespace-nowrap text-muted-foreground">
                  Schedule
                </Label>
                <Input
                  id="bulk-schedule"
                  type="datetime-local"
                  value={scheduledAt}
                  min={scheduleMin}
                  max={scheduleMax}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="h-7 text-xs w-[170px]"
                  disabled={sending}
                />
                {scheduledAt && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => setScheduledAt("")}
                    disabled={sending}
                  >
                    Clear
                  </Button>
                )}
              </div>
            ) : (
              <span className="mr-auto" />
            )}

            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>
              {sendResults.length > 0 && !sending ? "Close" : "Cancel"}
            </Button>
            {/* Send test to me — icon-only on small, label on sm+ */}
            {!isReplyMode && senderEmail && activeRecipientIds.length > 0 && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={sending || sendingTest || !subject.trim() || isEditorHtmlEmpty(body)}
                      onClick={() => {
                        const firstId = activeRecipientIds[0];
                        const c = contacts.find((x) => x.contact_id === firstId);
                        const renderedSubject = renderForContact(subject, c);
                        const renderedBodyHtml = renderForContact(body, c);
                        const renderedBodyText = looksLikeHtml(renderedBodyHtml) ? htmlToText(renderedBodyHtml) : renderedBodyHtml;
                        // Outlook silently drops mailto: links over ~2KB. Cap body to keep the draft openable.
                        const renderedBody = renderedBodyText.length > 1500
                          ? renderedBodyText.slice(0, 1500) + "\n\n…[truncated for test draft]"
                          : renderedBodyText;
                        const href = `mailto:${encodeURIComponent(senderEmail)}?subject=${encodeURIComponent("[TEST] " + renderedSubject)}&body=${encodeURIComponent(renderedBody)}`;
                        window.open(href, "_blank");
                        toast({ title: "Test draft opened in your mail client", description: `Sent to ${senderEmail} (no campaign tracking applied).` });
                      }}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Test</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Send a test email to yourself ({senderEmail})</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {(() => {
              const reachable = activeRecipientIds
                .map((id) => contacts.find((c) => c.contact_id === id))
                .filter((c) => isReachableEmail(c?.contacts?.email)).length;
              const noReachable = reachable === 0 && activeRecipientIds.length > 0;
              const sendDisabled =
                sending ||
                sendingRef.current ||
                activeRecipientIds.length === 0 ||
                noReachable ||
                subjectTooLong ||
                attachmentSizeBytes > MAX_ATTACHMENT_BYTES;
              const isScheduled = !isReplyMode && mode === "bulk" && !!scheduledAt;
              const labelEl = sending ? (
                `Sending ${sentSoFar}/${totalToSend}…`
              ) : noReachable ? (
                "0 valid emails"
              ) : isScheduled ? (
                activeRecipientIds.length <= 1
                  ? "Schedule Send"
                  : `Schedule ${reachable} email${reachable === 1 ? "" : "s"}`
              ) : activeRecipientIds.length <= 1 ? (
                "Send Email"
              ) : (() => {
                const skipped = activeRecipientIds.length - reachable;
                return skipped > 0 ? `Send to ${reachable} (${skipped} skipped)` : `Send to ${reachable}`;
              })();
              return (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button size="sm" onClick={handleSendClick} disabled={sendDisabled} className="gap-1.5">
                          <Send className="h-3.5 w-3.5" />
                          {labelEl}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {noReachable ? (
                      <TooltipContent>0 recipients with valid email — Send disabled</TooltipContent>
                    ) : isScheduled ? (
                      <TooltipContent>Will be sent at {new Date(scheduledAt).toLocaleString()}</TooltipContent>
                    ) : null}
                  </Tooltip>
                </TooltipProvider>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bounceConfirmOpen} onOpenChange={setBounceConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to recipients with previous bounces?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedBouncedCount} of your selected recipient{selectedBouncedCount > 1 ? "s have" : " has"} bounced before.
              Sending again may further damage your sender reputation. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setBounceConfirmOpen(false); void performSend(activeRecipientIds); }}>
              Send anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!duplicateConfirm} onOpenChange={(o) => !o && setDuplicateConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recent email already sent</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicateConfirm?.recentIds.size} of your {duplicateConfirm?.ids.length} recipient(s) were already emailed in this campaign within the last {dupWindowDays} day{dupWindowDays === 1 ? "" : "s"}. Sending again may feel spammy. Continue anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const ids = duplicateConfirm?.ids || [];
              setDuplicateConfirm(null);
              void performSend(ids);
            }}>Send anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full email preview — replaces the inline preview pane */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="w-[96vw] sm:max-w-[760px] max-h-[88vh] overflow-y-auto p-0">
          <DialogHeader className="px-4 py-3 border-b pr-10">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Eye className="h-4 w-4" />
              Email Preview
              {activeRecipientIds.length > 1 && (
                <div className="ml-auto">
                  <Select value={previewContactId} onValueChange={setPreviewContactId}>
                    <SelectTrigger className="h-7 text-xs max-w-[220px]">
                      <SelectValue placeholder="Preview as…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeRecipientIds.map(id => {
                        const c = contacts.find(x => x.contact_id === id);
                        return (
                          <SelectItem key={id} value={id}>
                            {c?.contacts?.contact_name || id}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const previewSubject = previewContact ? renderForContact(subject, previewContact) : subject;
            const previewBody = previewContact ? renderForContact(body, previewContact) : body;
            const unresolved = Array.from(new Set([
              ...findUnresolvedVariables(previewSubject),
              ...findUnresolvedVariables(previewBody),
            ]));
            const hasAcct = !!previewContact?.account_id;
            const acctCountry = hasAcct ? countryByAccount[previewContact!.account_id!] : null;
            const toLine = previewContact
              ? `${previewContact.contacts?.contact_name || ""} <${previewContact.contacts?.email || ""}>`
              : "(select a recipient)";
            return (
              <div className="px-4 py-3 space-y-3">
                {/* Email-client-style header */}
                <div className="rounded-md border bg-muted/30 text-xs divide-y">
                  <div className="flex gap-2 px-3 py-1.5">
                    <span className="text-muted-foreground w-14 shrink-0">From:</span>
                    <span className="truncate">{senderEmail || "(no sender)"}</span>
                  </div>
                  <div className="flex gap-2 px-3 py-1.5">
                    <span className="text-muted-foreground w-14 shrink-0">To:</span>
                    <span className="truncate">{toLine}</span>
                  </div>
                  <div className="flex gap-2 px-3 py-1.5">
                    <span className="text-muted-foreground w-14 shrink-0">Subject:</span>
                    <span className="font-medium truncate">{previewSubject || <em className="text-muted-foreground">(empty)</em>}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{subjectLen}/78</span>
                  </div>
                </div>

                {/* Notes */}
                {!previewContact && (
                  <p className="text-[11px] text-muted-foreground italic">
                    Showing template as-is. Pick a recipient above to preview merged values.
                  </p>
                )}
                {(countriesLoading || ownerNamesLoading) && previewContact && (
                  <span className="text-[11px] text-muted-foreground">Loading owner / country…</span>
                )}
                {previewContact && !countriesLoading && !acctCountry && hasAcct && (
                  <p className="text-[11px] text-destructive">
                    Country not set on linked account — {"{country}"} will be empty.
                  </p>
                )}
                {previewContact && !hasAcct && (
                  <p className="text-[11px] text-muted-foreground">
                    Contact has no linked account — {"{country}"} will be empty.
                  </p>
                )}
                {unresolved.length > 0 && (
                  <Badge variant="destructive" className="gap-1 text-[10px]">
                    <AlertTriangle className="h-3 w-3" />
                    {unresolved.length} unresolved: {unresolved.join(", ")}
                  </Badge>
                )}

                {/* Body */}
                <div className="rounded-md border bg-background p-4 min-h-[260px]">
                  {looksLikeHtml(previewBody) ? (
                    <div
                      className="text-sm leading-6 email-preview-body"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewBody) }}
                    />
                  ) : previewBody ? (
                    <div className="text-sm whitespace-pre-wrap leading-6">{previewBody}</div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Email body is empty.</p>
                  )}
                </div>
              </div>
            );
          })()}
          <style>{`
            .email-preview-body p { margin: 0 0 0.85em 0; }
            .email-preview-body p:last-child { margin-bottom: 0; }
            .email-preview-body ul, .email-preview-body ol { margin: 0 0 0.85em 1.25em; padding-left: 1rem; }
            .email-preview-body ul { list-style: disc; }
            .email-preview-body ol { list-style: decimal; }
            .email-preview-body strong { font-weight: 600; }
            .email-preview-body a { color: hsl(var(--primary)); text-decoration: underline; }
          `}</style>
          <DialogFooter className="px-4 py-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
