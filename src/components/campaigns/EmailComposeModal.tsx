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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, FileText, Eye, Paperclip, AlertTriangle, Search, Users, User, RotateCw, X, ExternalLink, Mail } from "lucide-react";
import { toast } from "sonner";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useAuth } from "@/hooks/useAuth";
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
  status: "pending" | "sending" | "success" | "failed" | "cancelled";
  error?: string;
  sentAt?: string;
  renderedSubject?: string;
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
  const [previewTab, setPreviewTab] = useState("edit");
  const [previewContactId, setPreviewContactId] = useState<string>("");
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [showVariables, setShowVariables] = useState(false);
  const [showPerRecipientPreview, setShowPerRecipientPreview] = useState(false);
  const [bounceConfirmOpen, setBounceConfirmOpen] = useState(false);

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
      setShowPerRecipientPreview(false);
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
  // Debounced ~500ms so a bulk import (hundreds of INSERTs) doesn't cause a refetch storm
  // and UI flicker mid-send.
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedInvalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["compose-live-campaign-contacts", campaignId] });
        timer = null;
      }, 500);
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

  // Compute subject length on the resolved subject for the active preview
  // contact — variable substitution can balloon a 70-char template past 100.
  const resolvedSubjectForLen = previewContact ? renderForContact(subject, previewContact) : subject;
  const subjectLen = resolvedSubjectForLen.length;
  const subjectTooLong = subjectLen > 78;
  const subjectWarn = subjectLen > 70 && !subjectTooLong;

  // Detect placeholder/scratch text in body lines
  const placeholderLines = useMemo(() => {
    return body.split(/\n/).filter(l => PLACEHOLDER_RE.test(l)).map(l => l.trim()).filter(Boolean);
  }, [body]);

  const performSend = async (contactIdsToSend: string[]) => {
    if (sendingRef.current) return;
    if (contactIdsToSend.length === 0) { toast.warning("Select at least one recipient"); return; }
    if (!subject.trim()) { toast.warning("Subject is required"); return; }
    if (!body.trim()) { toast.warning("Body is required"); return; }
    if (countriesLoading || ownerNamesLoading) {
      toast.warning("Still loading owner / account info — please wait a moment.");
      return;
    }

    const recipients = contactIdsToSend
      .map(id => contacts.find(c => c.contact_id === id))
      .filter((c): c is Contact => !!c);

    const missingEmail = recipients.filter(c => !c.contacts?.email);
    if (missingEmail.length > 0) {
      toast.error(`${missingEmail.length} contact(s) have no email and will be skipped.`);
    }
    const sendable = recipients.filter(c => !!c.contacts?.email);
    if (sendable.length === 0) { toast.error("No recipients with valid email."); return; }

    // Per-contact unresolved variable check
    const unresolvedReport: string[] = [];
    for (const c of sendable) {
      const s = renderForContact(subject, c);
      const b = renderForContact(body, c);
      const u = Array.from(new Set([...findUnresolvedVariables(s), ...findUnresolvedVariables(b)]));
      if (u.length > 0) unresolvedReport.push(`${c.contacts?.contact_name}: ${u.join(", ")}`);
    }
    if (unresolvedReport.length > 0) {
      toast.error(
        `Unresolved variables for ${unresolvedReport.length} contact(s). First: ${unresolvedReport[0]}`,
        { duration: 8000 }
      );
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

    let successCount = 0;
    let failCount = 0;
    let cancelledCount = 0;

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
            template_id: templateId || undefined,
            subject: finalSubject,
            body: finalBody,
            recipient_email: c.contacts!.email,
            recipient_name: c.contacts!.contact_name,
            attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
            ...(replyTo && i === 0
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

        if (error) throw error;
        if (data?.success) {
          successCount++;
          setSendResults(prev =>
            prev.map(r => r.contactId === c.contact_id
              ? { ...r, status: "success", sentAt: new Date().toISOString() }
              : r)
          );
          onEmailSent(c.contact_id);
        } else {
          failCount++;
          const msg = data?.error || data?.errorCode || "Unknown error";
          setSendResults(prev =>
            prev.map(r => r.contactId === c.contact_id ? { ...r, status: "failed", error: msg } : r)
          );
          // Campaign is no longer active — abort the rest of the batch instantly
          // so we don't hammer the function with the same blocking error.
          if (data?.errorCode === "CAMPAIGN_NOT_ACTIVE") {
            const remainingIds = sendable.slice(i + 1).map(x => x.contact_id);
            cancelledCount += remainingIds.length;
            setSendResults(prev =>
              prev.map(r => remainingIds.includes(r.contactId) ? { ...r, status: "cancelled" } : r)
            );
            cancelRef.current = true;
            toast.error("Campaign is paused, completed or archived — sending stopped.");
            break;
          }
        }
      } catch (err: any) {
        failCount++;
        setSendResults(prev =>
          prev.map(r => r.contactId === c.contact_id ? { ...r, status: "failed", error: err.message } : r)
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
      toast.success(`All ${successCount} email(s) sent successfully.`);
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
      toast.warning(`Sent ${successCount}, ${cancelledCount} cancelled${failCount ? `, ${failCount} failed` : ""}.`);
    } else {
      toast.error(`Sent ${successCount}, failed ${failCount}. Review the list and retry failures.`);
    }
  };

  const handleSendClick = () => {
    if (!isReplyMode && selectedBouncedCount > 0) {
      setBounceConfirmOpen(true);
      return;
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
    toast.info("Cancelling remaining sends…");
  };

  const resetForm = () => {
    setSelectedContactIds([]);
    setSingleContactId("");
    setTemplateId("");
    setSubject("");
    setBody("");
    setPreviewTab("edit");
    setSelectedAttachmentIds([]);
    setSendResults([]);
    setRecipientSearch("");
    setMode("single");
  };

  const sentSoFar = sendResults.filter(r => r.status === "success" || r.status === "failed" || r.status === "cancelled").length;
  const totalToSend = sendResults.length;
  const progressPct = totalToSend > 0 ? (sentSoFar / totalToSend) * 100 : 0;
  const currentlySendingName = sendResults.find(r => r.status === "sending")?.contactName;
  const failedCount = sendResults.filter(r => r.status === "failed").length;

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
        <DialogContent className="sm:max-w-[820px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> {isReplyMode ? "Reply to Email" : "Compose Campaign Email"}
            </DialogTitle>
            {senderEmail && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
                <Mail className="h-3 w-3" />
                Sending as: <span className="font-medium text-foreground">{senderEmail}</span>
              </div>
            )}
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Mode toggle (hidden in reply mode) */}
            {!isReplyMode && (
              <div className="flex items-center justify-between">
                <Label className="text-xs">Send mode</Label>
                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(v) => { if (v === "single" || v === "bulk") setMode(v); }}
                  size="sm"
                >
                  <ToggleGroupItem value="single" className="text-xs h-7 px-3 gap-1">
                    <User className="h-3 w-3" /> Single
                  </ToggleGroupItem>
                  <ToggleGroupItem value="bulk" className="text-xs h-7 px-3 gap-1">
                    <Users className="h-3 w-3" /> Bulk
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}

            {/* Recipients & Template */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Users className="h-3 w-3" />
                  Recipient{mode === "bulk" && !isReplyMode ? "s" : ""} *
                  {mode === "bulk" && !isReplyMode && selectedContactIds.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {selectedContactIds.length} selected
                    </Badge>
                  )}
                </Label>

                {isReplyMode ? (
                  <div className="border rounded-md px-2.5 py-1.5 text-sm bg-muted/30">
                    {previewContact?.contacts?.contact_name || "Recipient"}{" "}
                    <span className="text-xs text-muted-foreground">
                      {previewContact?.contacts?.email}
                    </span>
                  </div>
                ) : mode === "single" ? (
                  <Select value={singleContactId} onValueChange={setSingleContactId}>
                    <SelectTrigger className="h-8 text-sm">
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
                  <div className="border rounded-md">
                    <div className="flex items-center gap-1 px-2 py-1 border-b">
                      <Search className="h-3 w-3 text-muted-foreground" />
                      <Input
                        value={recipientSearch}
                        onChange={e => setRecipientSearch(e.target.value)}
                        placeholder="Search contacts..."
                        className="h-6 border-0 text-xs px-1 focus-visible:ring-0"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-1.5"
                        onClick={toggleSelectAllFiltered}
                        disabled={selectableFiltered.length === 0}
                      >
                        {allFilteredSelected ? "Clear" : "All"}
                      </Button>
                    </div>
                    <div className="max-h-[140px] overflow-y-auto divide-y">
                      {filteredContacts.length === 0 && (
                        <p className="text-xs text-muted-foreground p-2">No contacts.</p>
                      )}
                      {filteredContacts.map(c => {
                        const noEmail = !isReachableEmail(c.contacts?.email);
                        const bounced = bouncedContactIds.includes(c.contact_id);
                        return (
                          <label
                            key={c.contact_id}
                            className={`flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/50 ${noEmail ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                          >
                            <Checkbox
                              checked={selectedContactIds.includes(c.contact_id)}
                              disabled={noEmail}
                              onCheckedChange={() => !noEmail && toggleContact(c.contact_id)}
                            />
                            <span className="flex-1 truncate">
                              <span className="font-medium">{c.contacts?.contact_name}</span>
                              {c.contacts?.email && (
                                <span className="text-muted-foreground ml-1">{c.contacts.email}</span>
                              )}
                            </span>
                            {noEmail && <Badge variant="destructive" className="text-[9px] px-1 py-0">No email</Badge>}
                            {bounced && <Badge variant="outline" className="text-[9px] px-1 py-0 border-destructive text-destructive">Bounced</Badge>}
                          </label>
                        );
                      })}
                    </div>
                    {selectedContactIds.some(id => {
                      const c = contacts.find(x => x.contact_id === id);
                      return !c || !isReachableEmail(c.contacts?.email);
                    }) && (
                      <div className="flex items-center justify-end px-2 py-1 border-t bg-muted/30">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={removeUnreachable}
                        >
                          <X className="h-3 w-3" /> Remove unreachable
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Template</Label>
                <Select value={templateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select template (optional)" /></SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center gap-2">
                          <FileText className="h-3 w-3" />
                          <span>{t.template_name}</span>
                          {t.email_type && <Badge variant="secondary" className="text-[10px] px-1 py-0">{t.email_type}</Badge>}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Aggregated bounce warning (bulk only) */}
            {!isReplyMode && mode === "bulk" && selectedBouncedCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium text-destructive">
                    {selectedBouncedCount} of your selected contact{selectedBouncedCount > 1 ? "s have" : " has"} previous bounces.
                  </span>{" "}
                  <span className="text-muted-foreground">You'll be asked to confirm before sending.</span>
                </span>
              </div>
            )}

            {/* Recipients preview — per-contact reachability snapshot */}
            {!isReplyMode && activeRecipientIds.length > 0 && (() => {
              const recipients = activeRecipientIds
                .map((id) => contacts.find((c) => c.contact_id === id))
                .filter((c): c is Contact => !!c);
              const reachableCount = recipients.filter((c) => !!c.contacts?.email).length;
              const noEmailCount = recipients.length - reachableCount;
              const bouncedCount = selectedBouncedCount;
              return (
                <div className="rounded-md border bg-muted/20">
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b">
                    <span className="text-xs font-medium">Recipients preview</span>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <Badge variant="secondary" className="px-1.5 py-0">{reachableCount} reachable</Badge>
                      {bouncedCount > 0 && (
                        <Badge variant="outline" className="px-1.5 py-0 border-amber-500 text-amber-700 dark:text-amber-400">
                          {bouncedCount} bounced warning
                        </Badge>
                      )}
                      {noEmailCount > 0 && (
                        <Badge variant="destructive" className="px-1.5 py-0">{noEmailCount} unreachable</Badge>
                      )}
                    </div>
                  </div>
                  <div className="max-h-[140px] overflow-y-auto divide-y">
                    {recipients.map((c) => {
                      const email = c.contacts?.email || "";
                      const noEmail = !email;
                      const bounced = bouncedContactIds.includes(c.contact_id);
                      return (
                        <div
                          key={c.contact_id}
                          className={`flex items-center gap-2 px-3 py-1.5 text-xs ${noEmail ? "border-l-2 border-l-destructive bg-destructive/5" : bounced ? "border-l-2 border-l-amber-500 bg-amber-500/5" : ""}`}
                        >
                          {bounced ? (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-amber-600 cursor-help">⚠</span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs max-w-[260px]">
                                  {(() => {
                                    const meta = bounceMetaByContact[c.contact_id];
                                    if (!meta) return "Previously bounced";
                                    const when = meta.bounced_at
                                      ? new Date(meta.bounced_at).toLocaleString()
                                      : "unknown date";
                                    return (
                                      <div className="space-y-0.5">
                                        <div className="font-medium">Bounced {meta.count} time{meta.count > 1 ? "s" : ""}</div>
                                        <div>Last: {when}</div>
                                        {meta.reason && <div className="text-muted-foreground">Reason: {meta.reason.slice(0, 140)}</div>}
                                      </div>
                                    );
                                  })()}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className={noEmail ? "text-destructive" : "text-emerald-600"}>
                              {noEmail ? "⛔" : "✓"}
                            </span>
                          )}
                          <span className="font-medium truncate flex-1">{c.contacts?.contact_name || "—"}</span>
                          <span className="text-muted-foreground truncate">
                            {email || "— No email on file"}
                          </span>
                          {bounced && !noEmail && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500 text-amber-700 dark:text-amber-400 shrink-0">
                              Previously bounced
                            </Badge>
                          )}
                          {!isReplyMode && mode === "bulk" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0"
                              onClick={() => toggleContact(c.contact_id)}
                              title="Remove from recipients"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Placeholder/scratch text warning */}
            {placeholderLines.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    Body contains placeholder text:
                  </span>{" "}
                  <span className="text-muted-foreground">"{placeholderLines.slice(0, 3).join('", "')}". Remove before sending.</span>
                </span>
              </div>
            )}

            {/* Variables */}
            <div className="flex flex-wrap gap-1 items-center">
              <button
                type="button"
                onClick={() => setShowVariables(v => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                {showVariables ? "Hide variables" : "Show variables"}
              </button>
              {showVariables && (
                <>
                  <span className="text-[10px] text-muted-foreground ml-1">
                    Insert into <span className="font-semibold">{focusedField}</span>:
                  </span>
                  {AVAILABLE_VARIABLES.map(v => (
                    <Badge
                      key={v}
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted"
                      onMouseDown={(e) => { e.preventDefault(); insertVariable(v); }}
                    >
                      {v}
                    </Badge>
                  ))}
                </>
              )}
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Subject *</Label>
                <span className={`text-[10px] ${subjectTooLong ? "text-destructive font-medium" : subjectWarn ? "text-amber-600" : "text-muted-foreground"}`}>
                  {subjectLen} chars{subjectTooLong ? " — may be truncated by mail clients" : subjectWarn ? " — getting long" : ""}
                </span>
              </div>
              <Input
                ref={subjectRef}
                value={subject}
                onChange={e => setSubject(e.target.value)}
                onFocus={() => setFocusedField("subject")}
                placeholder="Email subject..."
                className="text-sm"
              />
            </div>

            {/* Body with edit/preview tabs */}
            <Tabs value={previewTab} onValueChange={setPreviewTab}>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Body *</Label>
                <TabsList className="h-7">
                  <TabsTrigger value="edit" className="text-xs h-6 px-2">Edit</TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs h-6 px-2 gap-1">
                    <Eye className="h-3 w-3" /> Preview
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="edit" className="mt-1.5">
                <Textarea
                  ref={bodyRef}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onFocus={() => setFocusedField("body")}
                  placeholder="Email body... (supports HTML)"
                  rows={8}
                  className="text-sm font-mono"
                />
              </TabsContent>
              <TabsContent value="preview" className="mt-1.5">
                <div className="border rounded-lg p-4 min-h-[200px] bg-background space-y-2">
                  {activeRecipientIds.length > 1 && (
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <Label className="text-[10px] text-muted-foreground">Preview as:</Label>
                      <Select value={previewContactId} onValueChange={setPreviewContactId}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
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
                  {previewContact ? (
                    (() => {
                      const previewSubject = renderForContact(subject, previewContact);
                      const previewBody = renderForContact(body, previewContact);
                      const unresolved = Array.from(new Set([
                        ...findUnresolvedVariables(previewSubject),
                        ...findUnresolvedVariables(previewBody),
                      ]));
                      const hasAcct = !!previewContact.account_id;
                      const acctCountry = hasAcct ? countryByAccount[previewContact.account_id!] : null;
                      return (
                        <>
                          <p className="text-xs text-muted-foreground">
                            To: {previewContact.contacts?.contact_name} &lt;{previewContact.contacts?.email}&gt;
                          </p>
                          {(countriesLoading || ownerNamesLoading) && (
                            <div className="flex items-center gap-2">
                              <Skeleton className="h-3 w-32" />
                              <span className="text-[10px] text-muted-foreground">Loading owner / country…</span>
                            </div>
                          )}
                          {!countriesLoading && !acctCountry && hasAcct && (
                            <p className="text-[10px] text-destructive">
                              Note: country not set on linked account — {"{country}"} will be empty.
                            </p>
                          )}
                          {!hasAcct && (
                            <p className="text-[10px] text-muted-foreground">
                              Note: contact has no linked account — {"{country}"} will be empty.
                            </p>
                          )}
                          {unresolved.length > 0 && (
                            <Badge variant="destructive" className="gap-1 text-[10px]">
                              <AlertTriangle className="h-3 w-3" />
                              {unresolved.length} unresolved: {unresolved.join(", ")}
                            </Badge>
                          )}
                          <p className="text-sm font-medium pt-1">{previewSubject}</p>
                          {looksLikeHtml(previewBody) ? (
                            <div
                              className="text-sm prose prose-sm dark:prose-invert max-w-none"
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewBody) }}
                            />
                          ) : (
                            <div className="text-sm whitespace-pre-wrap">{previewBody}</div>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <p className="text-sm text-muted-foreground">Select a recipient to preview variable substitution</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            {/* Per-recipient subject preview — shown for both single & bulk so the
                user always sees the resolved subject before clicking Send. */}
            {!isReplyMode && activeRecipientIds.length > 0 && (
              <div className="rounded-md border">
                <button
                  type="button"
                  onClick={() => setShowPerRecipientPreview(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/50"
                >
                  <span className="font-medium">
                    Per-recipient subject preview ({activeRecipientIds.length})
                  </span>
                  <span className="text-muted-foreground">{showPerRecipientPreview ? "Hide" : "Show"}</span>
                </button>
                {showPerRecipientPreview && (
                  <div className="max-h-[160px] overflow-y-auto divide-y border-t">
                    {activeRecipientIds.map(id => {
                      const c = contacts.find(x => x.contact_id === id);
                      if (!c) return null;
                      const s = renderForContact(subject, c);
                      const u = findUnresolvedVariables(s + " " + renderForContact(body, c));
                      return (
                        <div key={id} className="px-3 py-1.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate flex-1">{c.contacts?.contact_name}</span>
                            <span className="text-muted-foreground truncate">{c.contacts?.email}</span>
                            {u.length > 0 && (
                              <Badge variant="destructive" className="text-[9px] px-1 py-0">
                                {u.length} missing
                              </Badge>
                            )}
                          </div>
                          <div className="text-muted-foreground truncate mt-0.5">{s}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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
              <div className="space-y-2 rounded-md border p-3">
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
                <div className="max-h-[140px] overflow-y-auto divide-y text-xs">
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
                        {r.error && (
                          <div className="text-[10px] text-destructive truncate" title={r.error}>{r.error}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={
                          r.status === "success" ? "text-green-600" :
                          r.status === "failed" ? "text-destructive" :
                          r.status === "cancelled" ? "text-muted-foreground" :
                          r.status === "sending" ? "text-primary" : "text-muted-foreground"
                        }>
                          {r.status === "success" ? "✓ Sent" :
                           r.status === "failed" ? "✗ Failed" :
                           r.status === "cancelled" ? "⊘ Cancelled" :
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

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              {sendResults.length > 0 && !sending ? "Close" : "Cancel"}
            </Button>
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
              const labelEl = sending ? (
                `Sending ${sentSoFar}/${totalToSend}…`
              ) : noReachable ? (
                "0 recipients with valid email"
              ) : activeRecipientIds.length <= 1 ? (
                "Send Email"
              ) : (() => {
                const skipped = activeRecipientIds.length - reachable;
                return skipped > 0 ? `Send to ${reachable} reachable (${skipped} skipped)` : `Send to ${reachable} contacts`;
              })();
              return (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button onClick={handleSendClick} disabled={sendDisabled} className="gap-1.5">
                          <Send className="h-3.5 w-3.5" />
                          {labelEl}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {noReachable && (
                      <TooltipContent>0 recipients with valid email — Send disabled</TooltipContent>
                    )}
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
    </>
  );
}
