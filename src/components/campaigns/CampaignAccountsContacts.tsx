import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Plus, Search, Trash2, Building2, Users, ArrowRightCircle, Mail, Phone,
  Linkedin, CheckCircle2, ListTodo, ChevronRight, ChevronDown, ExternalLink,
  AlertCircle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { expandRegionsForDb } from "@/utils/countryRegionMapping";

interface Props {
  campaignId: string;
  isCampaignEnded: boolean;
  campaignName?: string;
  campaignOwner?: string | null;
  endDate?: string | null;
  compact?: boolean;
  selectedRegions?: string[];
}

const statusColors: Record<string, string> = {
  "Not Contacted": "bg-muted text-muted-foreground",
  "Contacted": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Responded": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "Deal Created": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const stageColors: Record<string, string> = {
  "Not Contacted": "bg-muted text-muted-foreground",
  "Email Sent": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "Phone Contacted": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "LinkedIn Contacted": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  "Responded": "bg-blue-200 text-blue-900 dark:bg-blue-800/30 dark:text-blue-300",
  "Qualified": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const linkedinStatusColors: Record<string, string> = {
  "Not Contacted": "bg-muted text-muted-foreground",
  "Connection Sent": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Connected": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "Message Sent": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  "Responded": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

import { stageRanks, deriveAccountStatus, recomputeAccountStatus } from "./campaignUtils";

function deriveAccountStatusForAccount(contacts: any[], accountId: string): string {
  const acContacts = contacts.filter((c: any) => c.account_id === accountId);
  return deriveAccountStatus(acContacts);
}

/** Fetch all records from contacts table using paginated batches */
async function fetchAllContacts() {
  const batchSize = 1000;
  let allData: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, contact_name, email, position, company_name, phone_no, linkedin")
      .range(from, from + batchSize - 1);
    if (error) throw error;
    allData.push(...(data || []));
    if (!data || data.length < batchSize) break;
    from += batchSize;
  }
  return allData;
}

export function CampaignAccountsContacts({ campaignId, isCampaignEnded, campaignName, campaignOwner, endDate, compact = false, selectedRegions = [] }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // UI states
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [addContactModalOpen, setAddContactModalOpen] = useState(false);
  const [addContactForAccount, setAddContactForAccount] = useState<{ id: string; name: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [removeConfirm, setRemoveConfirm] = useState<{ type: "account" | "contact"; id: string; name: string } | null>(null);
  const [selectedContactIdsForAccounts, setSelectedContactIdsForAccounts] = useState<string[]>([]);
  const [expandedModalAccounts, setExpandedModalAccounts] = useState<Set<string>>(new Set());

  // Slide-over states
  const [emailSlideOpen, setEmailSlideOpen] = useState(false);
  const [callSlideOpen, setCallSlideOpen] = useState(false);
  const [linkedinSlideOpen, setLinkedinSlideOpen] = useState(false);
  const [slideContact, setSlideContact] = useState<any>(null);
  const [interestedPrompt, setInterestedPrompt] = useState(false);

  // Convert to deal
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [convertContact, setConvertContact] = useState<any>(null);
  const [dealOwner, setDealOwner] = useState("");

  // Forms
  const [emailForm, setEmailForm] = useState({ template_id: "", subject: "", body: "", signature: "" });
  const [callForm, setCallForm] = useState({ datetime: new Date().toISOString().slice(0, 16), duration: "", outcome: "", notes: "" });
  const [linkedinForm, setLinkedinForm] = useState({ profile_url: "", message_type: "Connection Request", message: "", status: "Connection Sent", date: new Date().toISOString().split("T")[0], notes: "" });

  // ─── Queries ───
  const { data: campaignAccounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("*, accounts(account_name, industry, region, country)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: campaignContacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("*, contacts(contact_name, email, position, company_name, phone_no, linkedin)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: communications = [] } = useQuery({
    queryKey: ["campaign-communications", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("contact_id, communication_date, communication_type")
        .eq("campaign_id", campaignId)
        .order("communication_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: campaignDeals = [] } = useQuery({
    queryKey: ["campaign-deals", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("deals").select("id, source_campaign_contact_id").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: emailTemplates = [] } = useQuery({
    queryKey: ["campaign-email-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_email_templates").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: phoneScripts = [] } = useQuery({
    queryKey: ["campaign-phone-scripts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_phone_scripts").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  // All accounts for add modal — server-side filter by selectedRegions when provided
  const { data: allAccounts = [] } = useQuery({
    queryKey: ["all-accounts", selectedRegions.join(",")],
    queryFn: async () => {
      let q = supabase.from("accounts").select("id, account_name, industry, region, country");
      if (selectedRegions.length > 0) q = q.in("region", expandRegionsForDb(selectedRegions));
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: addAccountModalOpen,
  });

  // All contacts - paginated fetch (filter client-side by linked-account region after fetch)
  const { data: allContacts = [] } = useQuery({
    queryKey: ["all-contacts-paginated"],
    queryFn: fetchAllContacts,
    enabled: addContactModalOpen || addAccountModalOpen,
  });

  // Users for deal owner
  const allOwnerIds = [...new Set([campaignOwner, user?.id].filter(Boolean))] as string[];
  const { displayNames } = useUserDisplayNames(allOwnerIds);
  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-profiles-for-deal-owner"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name");
      return data || [];
    },
    enabled: convertModalOpen,
  });

  // ─── Derived data ───
  const campaignAccountNames = campaignAccounts.map((ca: any) => ca.accounts?.account_name).filter(Boolean);
  const existingAccountIds = campaignAccounts.map((ca: any) => ca.account_id);
  const existingContactIds = campaignContacts.map((cc: any) => cc.contact_id);

  const getContactsForAccount = (accountId: string) =>
    campaignContacts.filter((cc: any) => cc.account_id === accountId);

  const unlinkedContacts = campaignContacts.filter((cc: any) => !cc.account_id);

  const getLastActivity = (contactId: string) => {
    const comm = communications.find((c: any) => c.contact_id === contactId);
    return comm ? format(new Date(comm.communication_date), "dd MMM yyyy") : "—";
  };

  const hasDeal = (ccId: string) => campaignDeals.some((d: any) => d.source_campaign_contact_id === ccId);
  const canConvert = (stage: string) => stage === "Responded" || stage === "Qualified";

  // ─── Account actions ───
  const filteredAccounts = campaignAccounts.filter((ca: any) => {
    const derived = deriveAccountStatusForAccount(campaignContacts, ca.account_id);
    if (statusFilter !== "all" && derived !== statusFilter) return false;
    if (searchTerm) {
      const name = ca.accounts?.account_name?.toLowerCase() || "";
      if (!name.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  });

  const availableAccounts = useMemo(() => allAccounts.filter(
    (a) => !existingAccountIds.includes(a.id) && a.account_name.toLowerCase().includes(searchTerm.toLowerCase())
  ), [allAccounts, existingAccountIds, searchTerm]);

  // Contact counts per account for the Add Accounts modal
  const contactsByAccountName = useMemo(() => {
    const map: Record<string, typeof allContacts> = {};
    for (const c of allContacts) {
      if (c.company_name) {
        const key = c.company_name.toLowerCase();
        if (!map[key]) map[key] = [];
        map[key].push(c);
      }
    }
    return map;
  }, [allContacts]);

  const getModalContactsForAccount = (accountName: string) => {
    return contactsByAccountName[accountName.toLowerCase()] || [];
  };

  const toggleModalAccountExpand = (accountId: string) => {
    setExpandedModalAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      return next;
    });
  };

  const toggleContactForAccount = (contactId: string) => {
    setSelectedContactIdsForAccounts((prev) =>
      prev.includes(contactId) ? prev.filter((x) => x !== contactId) : [...prev, contactId]
    );
  };

  const availableContacts = useMemo(() => {
    return allContacts.filter((c) => {
      if (existingContactIds.includes(c.id)) return false;
      if (!c.contact_name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (addContactForAccount) {
        return c.company_name && c.company_name.toLowerCase() === addContactForAccount.name.toLowerCase();
      }
      // When adding without account scope, show contacts from campaign accounts
      if (campaignAccountNames.length > 0) {
        return c.company_name && campaignAccountNames.some((name: string) => name.toLowerCase() === c.company_name!.toLowerCase());
      }
      return true;
    });
  }, [allContacts, existingContactIds, searchTerm, addContactForAccount, campaignAccountNames]);

  const handleAddAccounts = async () => {
    if (selectedIds.length === 0) return;
    const accountInserts = selectedIds.map((account_id) => ({
      campaign_id: campaignId, account_id, created_by: user!.id, status: "Not Contacted",
    }));
    const { error } = await supabase.from("campaign_accounts").insert(accountInserts);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    // Also insert selected contacts
    if (selectedContactIdsForAccounts.length > 0) {
      const contactInserts = selectedContactIdsForAccounts
        .filter((cid) => !existingContactIds.includes(cid))
        .map((contact_id) => {
          const contact = allContacts.find((c) => c.id === contact_id);
          let accountId: string | null = null;
          if (contact?.company_name) {
            // Match against newly added accounts or existing
            const matchedNew = allAccounts.find((a) => selectedIds.includes(a.id) && a.account_name.toLowerCase() === contact.company_name!.toLowerCase());
            const matchedExisting = campaignAccounts.find((ca: any) => ca.accounts?.account_name?.toLowerCase() === contact.company_name!.toLowerCase());
            accountId = matchedNew?.id || matchedExisting?.account_id || null;
          }
          return { campaign_id: campaignId, contact_id, account_id: accountId, created_by: user!.id, stage: "Not Contacted" as const };
        });
      if (contactInserts.length > 0) {
        const { error: cErr } = await supabase.from("campaign_contacts").insert(contactInserts);
        if (cErr) { toast({ title: "Error adding contacts", description: cErr.message, variant: "destructive" }); }
      }
    }

    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    setAddAccountModalOpen(false);
    setSelectedIds([]);
    setSelectedContactIdsForAccounts([]);
    setExpandedModalAccounts(new Set());
    setSearchTerm("");
    const contactCount = selectedContactIdsForAccounts.filter((cid) => !existingContactIds.includes(cid)).length;
    toast({ title: `${selectedIds.length} account(s)${contactCount > 0 ? ` and ${contactCount} contact(s)` : ""} added` });
  };

  const handleAddContacts = async () => {
    if (selectedIds.length === 0) return;
    const inserts = selectedIds.map((contact_id) => {
      const contact = allContacts.find((c) => c.id === contact_id);
      let accountId: string | null = null;
      if (contact?.company_name) {
        const matched = campaignAccounts.find((ca: any) => ca.accounts?.account_name?.toLowerCase() === contact.company_name!.toLowerCase());
        if (matched) accountId = matched.account_id;
      }
      return { campaign_id: campaignId, contact_id, account_id: accountId, created_by: user!.id, stage: "Not Contacted" };
    });
    const { error } = await supabase.from("campaign_contacts").insert(inserts);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    setAddContactModalOpen(false);
    setAddContactForAccount(null);
    setSelectedIds([]);
    setSearchTerm("");
    toast({ title: `${inserts.length} contact(s) added` });
  };

  const confirmRemove = async () => {
    if (!removeConfirm) return;
    if (removeConfirm.type === "account") {
      await supabase.from("campaign_accounts").delete().eq("id", removeConfirm.id);
      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    } else {
      await supabase.from("campaign_contacts").delete().eq("id", removeConfirm.id);
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    }
    setRemoveConfirm(null);
    toast({ title: `${removeConfirm.type === "account" ? "Account" : "Contact"} removed` });
  };

  const updateStage = async (id: string, stage: string) => {
    await supabase.from("campaign_contacts").update({ stage }).eq("id", id);
    const cc = campaignContacts.find((c: any) => c.id === id);
    if (cc?.account_id) await recomputeAccountStatus(campaignId, cc.account_id, queryClient);
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
  };

  const toggleExpand = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleSelectAll = (items: any[]) => {
    setSelectedIds(selectedIds.length === items.length ? [] : items.map((i) => i.id));
  };

  // ─── Channel validation & slide-over openers ───
  const openEmailSlide = (cc: any) => {
    if (isCampaignEnded) { toast({ title: "Campaign ended", description: "Outreach is closed.", variant: "destructive" }); return; }
    if (!cc.contacts?.email) {
      toast({ title: "No email address", description: `${cc.contacts?.contact_name || "This contact"} has no email address. Please update the contact first.`, variant: "destructive" });
      return;
    }
    const regularTemplates = emailTemplates.filter((t) => t.email_type !== "LinkedIn-Connection" && t.email_type !== "LinkedIn-Followup");
    if (regularTemplates.length === 0) {
      toast({ title: "No templates", description: "Add email templates in Setup → Message first.", variant: "destructive" });
      return;
    }
    setSlideContact(cc);
    setEmailForm({ template_id: "", subject: "", body: "", signature: "" });
    setEmailSlideOpen(true);
  };

  const openCallSlide = (cc: any) => {
    if (isCampaignEnded) { toast({ title: "Campaign ended", description: "Outreach is closed.", variant: "destructive" }); return; }
    if (!cc.contacts?.phone_no) {
      toast({ title: "No phone number", description: `${cc.contacts?.contact_name || "This contact"} has no phone number. Please update the contact first.`, variant: "destructive" });
      return;
    }
    setSlideContact(cc);
    setCallForm({ datetime: new Date().toISOString().slice(0, 16), duration: "", outcome: "", notes: "" });
    setInterestedPrompt(false);
    setCallSlideOpen(true);
  };

  const openLinkedinSlide = (cc: any) => {
    if (isCampaignEnded) { toast({ title: "Campaign ended", description: "Outreach is closed.", variant: "destructive" }); return; }
    if (!cc.contacts?.linkedin) {
      toast({ title: "No LinkedIn profile", description: `${cc.contacts?.contact_name || "This contact"} has no LinkedIn URL. Please update the contact first.`, variant: "destructive" });
      return;
    }
    setSlideContact(cc);
    setLinkedinForm({ profile_url: cc.contacts.linkedin || "", message_type: "Connection Request", message: "", status: "Connection Sent", date: new Date().toISOString().split("T")[0], notes: "" });
    setLinkedinSlideOpen(true);
  };

  const handleTemplateSelect = (templateId: string) => {
    const tmpl = emailTemplates.find((t) => t.id === templateId);
    if (!tmpl) return;
    let body = tmpl.body || "";
    let sig = "";
    const sigIdx = body.indexOf("---SIGNATURE---");
    if (sigIdx !== -1) { sig = body.substring(sigIdx + 15).trim(); body = body.substring(0, sigIdx).trim(); }
    setEmailForm({ template_id: templateId, subject: tmpl.subject || "", body, signature: sig });
  };

  const handleSendEmail = async () => {
    if (!slideContact) return;
    if (!slideContact.contacts?.email) {
      toast({ title: "No email address", variant: "destructive" }); return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("send-campaign-email", {
        body: {
          campaign_id: campaignId,
          contact_id: slideContact.contact_id,
          account_id: slideContact.account_id || undefined,
          template_id: emailForm.template_id || undefined,
          subject: emailForm.subject,
          body: emailForm.body,
          recipient_email: slideContact.contacts.email,
          recipient_name: slideContact.contacts.contact_name,
        },
      });
      if (error) throw error;
      if (!data?.success) {
        const isInactive = data?.errorCode === "CAMPAIGN_NOT_ACTIVE";
        toast({
          title: isInactive ? "Campaign not active" : "Email send failed",
          description: isInactive
            ? "This campaign is paused, completed or archived. Reactivate it before sending."
            : (data?.error || "Unknown error"),
          variant: "destructive",
        });
        return;
      }
      const currentRank = stageRanks[slideContact.stage || "Not Contacted"] ?? 0;
      if (1 > currentRank) {
        await supabase.from("campaign_contacts").update({ stage: "Email Sent" }).eq("campaign_id", campaignId).eq("contact_id", slideContact.contact_id);
      }
      if (slideContact.account_id) await recomputeAccountStatus(campaignId, slideContact.account_id, queryClient);
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
      setEmailSlideOpen(false);
      toast({ title: `Email sent to ${slideContact.contacts?.contact_name || "contact"}` });
    } catch (err: any) {
      toast({ title: "Error sending email", description: err.message, variant: "destructive" });
    }
  };

  const handleLogCall = async (markResponded?: boolean) => {
    if (!slideContact) return;
    await supabase.from("campaign_communications").insert({
      campaign_id: campaignId, contact_id: slideContact.contact_id, account_id: slideContact.account_id,
      communication_type: "Call", call_outcome: callForm.outcome,
      notes: callForm.notes || null, owner: user!.id, created_by: user!.id,
      communication_date: callForm.datetime ? new Date(callForm.datetime).toISOString() : new Date().toISOString(),
    });
    const currentRank = stageRanks[slideContact.stage || "Not Contacted"] ?? 0;
    const targetStage = markResponded ? "Responded" : "Phone Contacted";
    const targetRank = stageRanks[targetStage];
    if (targetRank > currentRank) {
      await supabase.from("campaign_contacts").update({ stage: targetStage }).eq("campaign_id", campaignId).eq("contact_id", slideContact.contact_id);
    }
    if (slideContact.account_id) await recomputeAccountStatus(campaignId, slideContact.account_id, queryClient);
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
    setCallSlideOpen(false);
    setInterestedPrompt(false);
    toast({ title: `Call logged for ${slideContact.contacts?.contact_name || "contact"}` });
  };

  const handleCallSave = () => {
    if (callForm.outcome === "Interested") setInterestedPrompt(true);
    else handleLogCall(false);
  };

  const handleLogLinkedin = async () => {
    if (!slideContact) return;
    await supabase.from("campaign_communications").insert({
      campaign_id: campaignId, contact_id: slideContact.contact_id, account_id: slideContact.account_id,
      communication_type: "LinkedIn", linkedin_status: linkedinForm.status,
      notes: linkedinForm.notes || null, owner: user!.id, created_by: user!.id,
      communication_date: linkedinForm.date ? new Date(linkedinForm.date).toISOString() : new Date().toISOString(),
    });
    await supabase.from("campaign_contacts").update({ linkedin_status: linkedinForm.status }).eq("campaign_id", campaignId).eq("contact_id", slideContact.contact_id);
    const currentRank = stageRanks[slideContact.stage || "Not Contacted"] ?? 0;
    if (3 > currentRank) {
      await supabase.from("campaign_contacts").update({ stage: "LinkedIn Contacted" }).eq("campaign_id", campaignId).eq("contact_id", slideContact.contact_id);
    }
    if (slideContact.account_id) await recomputeAccountStatus(campaignId, slideContact.account_id, queryClient);
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
    setLinkedinSlideOpen(false);
    toast({ title: `LinkedIn activity logged for ${slideContact.contacts?.contact_name || "contact"}` });
  };

  const openConvertModal = (cc: any) => {
    setConvertContact(cc);
    setDealOwner(campaignOwner || user?.id || "");
    setConvertModalOpen(true);
  };

  const handleConvertToDeal = async () => {
    if (!convertContact) return;
    const contactName = convertContact.contacts?.contact_name || "Unknown";
    const dealName = `${contactName} — ${campaignName || "Campaign"}`;
    try {
      const { data: deal, error } = await supabase.from("deals").insert({
        deal_name: dealName, stage: "Lead", created_by: user!.id, lead_owner: dealOwner || user!.id,
        campaign_id: campaignId, account_id: convertContact.account_id || null,
        source_campaign_contact_id: convertContact.id,
        customer_name: convertContact.contacts?.company_name || contactName,
      }).select().single();
      if (error) throw error;
      const { error: e2 } = await supabase.from("campaign_contacts").update({ stage: "Qualified" }).eq("id", convertContact.id);
      if (e2) { await supabase.from("deals").delete().eq("id", deal.id); throw e2; }
      if (convertContact.account_id) {
        await supabase.from("campaign_accounts").update({ status: "Deal Created" }).eq("campaign_id", campaignId).eq("account_id", convertContact.account_id);
      }
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-deals", campaignId] });
      setConvertModalOpen(false);
      setConvertContact(null);
      toast({ title: `Deal created for ${contactName}` });
    } catch (err: any) {
      toast({ title: "Deal creation failed", description: err.message, variant: "destructive" });
    }
  };

  const regularTemplates = emailTemplates.filter((t) => t.email_type !== "LinkedIn-Connection" && t.email_type !== "LinkedIn-Followup");

  const parseJsonArr = (text: string | null): string[] => {
    if (!text) return [];
    try { const a = JSON.parse(text); return Array.isArray(a) ? a : [text]; } catch { return text ? text.split("\n").filter(Boolean) : []; }
  };

  // ─── Channel icon with validation ───
  const ChannelIcon = ({ cc, channel, icon: Icon, label, onClick }: { cc: any; channel: "email" | "phone" | "linkedin"; icon: any; label: string; onClick: () => void }) => {
    const fieldMap = { email: "email", phone: "phone_no", linkedin: "linkedin" };
    const hasField = !!cc.contacts?.[fieldMap[channel]];
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon" className={`h-7 w-7 ${!hasField ? "opacity-40" : ""}`}
              disabled={isCampaignEnded}
              onClick={onClick}
            >
              {!hasField && <AlertCircle className="h-2 w-2 absolute top-0.5 right-0.5 text-destructive" />}
              <Icon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {hasField ? label : `No ${label.toLowerCase()} — update contact`}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // ─── Contact row renderer ───
  const ContactRow = ({ cc }: { cc: any }) => (
    <TableRow key={cc.id} className="hover:bg-muted/30">
      <TableCell className="font-medium pl-10">{cc.contacts?.contact_name || "—"}</TableCell>
      <TableCell className="text-sm">{cc.contacts?.position || "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{cc.contacts?.email || "—"}</TableCell>
      <TableCell>
        <Select value={cc.stage || "Not Contacted"} onValueChange={(v) => updateStage(cc.id, v)}>
          <SelectTrigger className="h-7 w-[140px] text-xs">
            <Badge className={stageColors[cc.stage || "Not Contacted"]} variant="secondary">{cc.stage || "Not Contacted"}</Badge>
          </SelectTrigger>
          <SelectContent>
            {Object.keys(stageColors).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Badge className={linkedinStatusColors[cc.linkedin_status || "Not Contacted"]} variant="secondary">
          {cc.linkedin_status || "Not Contacted"}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{getLastActivity(cc.contact_id)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-0.5">
          <ChannelIcon cc={cc} channel="email" icon={Mail} label="Email" onClick={() => openEmailSlide(cc)} />
          <ChannelIcon cc={cc} channel="phone" icon={Phone} label="Phone" onClick={() => openCallSlide(cc)} />
          <ChannelIcon cc={cc} channel="linkedin" icon={Linkedin} label="LinkedIn" onClick={() => openLinkedinSlide(cc)} />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
            const event = new CustomEvent('campaign-add-task', { detail: { contactId: cc.contact_id, accountId: cc.account_id } });
            window.dispatchEvent(event);
          }} title="Add Task"><ListTodo className="h-3.5 w-3.5" /></Button>
          {hasDeal(cc.id) ? (
            <Badge variant="outline" className="text-xs flex items-center gap-1 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" /> Deal
            </Badge>
          ) : canConvert(cc.stage) ? (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openConvertModal(cc)}>
              <ArrowRightCircle className="h-3 w-3 mr-1" /> Deal
            </Button>
          ) : null}
          {!isCampaignEnded && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRemoveConfirm({ type: "contact", id: cc.id, name: cc.contacts?.contact_name || "this contact" })}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      {isCampaignEnded && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive text-sm">
          This campaign ended on {endDate || "an earlier date"}. Outreach is closed.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Accounts & Contacts
            <span className="text-sm font-normal text-muted-foreground">
              ({campaignAccounts.length} accounts · {campaignContacts.length} contacts)
            </span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-8 w-[150px] text-xs" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.keys(statusColors).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {!isCampaignEnded && (
              <>
                <Button size="sm" variant="outline" onClick={() => { setSearchTerm(""); setSelectedIds([]); setAddAccountModalOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Add Accounts
                </Button>
                <Button size="sm" onClick={() => { setSearchTerm(""); setSelectedIds([]); setAddContactForAccount(null); setAddContactModalOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Add Contacts
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredAccounts.length === 0 && unlinkedContacts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No accounts or contacts added yet.</p>
              {!isCampaignEnded && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSearchTerm(""); setSelectedIds([]); setAddAccountModalOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Add your first account
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Title / Industry</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>LinkedIn</TableHead>
                    <TableHead>Last Activity</TableHead>
                    <TableHead className="w-[240px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((ca: any) => {
                    const derived = deriveAccountStatusForAccount(campaignContacts, ca.account_id);
                    const accountContacts = getContactsForAccount(ca.account_id);
                    const isExpanded = expandedAccounts.has(ca.account_id);
                    return (
                      <Collapsible key={ca.id} open={isExpanded} onOpenChange={() => toggleExpand(ca.account_id)} asChild>
                        <>
                          <CollapsibleTrigger asChild>
                            <TableRow className="cursor-pointer hover:bg-muted/50 bg-muted/20">
                              <TableCell className="font-semibold">
                                <div className="flex items-center gap-2">
                                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                                  <Building2 className="h-4 w-4 text-muted-foreground" />
                                  {ca.accounts?.account_name || "—"}
                                  <span className="text-xs font-normal text-muted-foreground">({accountContacts.length} contacts)</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{ca.accounts?.industry || "—"}</TableCell>
                              <TableCell />
                              <TableCell>
                                <Badge className={statusColors[derived]} variant="secondary">{derived}</Badge>
                              </TableCell>
                              <TableCell />
                              <TableCell className="text-sm text-muted-foreground">
                                {ca.created_at ? new Date(ca.created_at).toLocaleDateString() : "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {!isCampaignEnded && (
                                    <>
                                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => {
                                        e.stopPropagation();
                                        setSearchTerm(""); setSelectedIds([]);
                                        setAddContactForAccount({ id: ca.account_id, name: ca.accounts?.account_name || "" });
                                        setAddContactModalOpen(true);
                                      }}>
                                        <Plus className="h-3 w-3 mr-1" /> Contacts
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                                        e.stopPropagation();
                                        setRemoveConfirm({ type: "account", id: ca.id, name: ca.accounts?.account_name || "this account" });
                                      }}>
                                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          </CollapsibleTrigger>
                          <CollapsibleContent asChild>
                            <>
                              {accountContacts.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="pl-10 text-sm text-muted-foreground italic py-2">
                                    No contacts from this account yet.
                                    {!isCampaignEnded && (
                                      <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => {
                                        setSearchTerm(""); setSelectedIds([]);
                                        setAddContactForAccount({ id: ca.account_id, name: ca.accounts?.account_name || "" });
                                        setAddContactModalOpen(true);
                                      }}>Add contacts</Button>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ) : accountContacts.map((cc: any) => (
                                <ContactRow key={cc.id} cc={cc} />
                              ))}
                            </>
                          </CollapsibleContent>
                        </>
                      </Collapsible>
                    );
                  })}

                  {/* Unlinked contacts */}
                  {unlinkedContacts.length > 0 && (
                    <>
                      <TableRow className="bg-muted/10">
                        <TableCell colSpan={7} className="text-sm font-medium text-muted-foreground py-2">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" /> Unlinked Contacts ({unlinkedContacts.length})
                          </div>
                        </TableCell>
                      </TableRow>
                      {unlinkedContacts.map((cc: any) => (
                        <ContactRow key={cc.id} cc={cc} />
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Email Slide-over ─── */}
      <Sheet open={emailSlideOpen} onOpenChange={setEmailSlideOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader><SheetTitle>Send Email</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="text-sm"><span className="text-muted-foreground">To:</span> {slideContact?.contacts?.contact_name} &lt;{slideContact?.contacts?.email || "no email"}&gt;</div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={emailForm.template_id} onValueChange={handleTemplateSelect}>
                <SelectTrigger><SelectValue placeholder="Select template..." /></SelectTrigger>
                <SelectContent>
                  {regularTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.template_name} ({t.email_type})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} /></div>
            <div className="space-y-2"><Label>Body</Label><Textarea value={emailForm.body} onChange={e => setEmailForm({ ...emailForm, body: e.target.value })} rows={6} /></div>
            {emailForm.signature && <div className="text-sm text-muted-foreground italic">{emailForm.signature}</div>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEmailSlideOpen(false)}>Cancel</Button>
              <Button onClick={handleSendEmail} disabled={!emailForm.subject}>Send Email</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Call Slide-over ─── */}
      <Sheet open={callSlideOpen} onOpenChange={setCallSlideOpen}>
        <SheetContent className="w-[900px] sm:max-w-[900px] overflow-y-auto">
          <SheetHeader><SheetTitle>Log Call</SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div className="border-r border-border pr-6 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2"><Phone className="h-4 w-4 text-primary" /> Call Script</h3>
              {phoneScripts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No call scripts available.</p>
              ) : phoneScripts.map((script: any) => (
                <div key={script.id} className="space-y-2 text-sm">
                  <p className="font-medium">{script.script_name}</p>
                  {script.opening_script && <div><p className="text-xs font-medium text-muted-foreground">Opening</p><p className="whitespace-pre-wrap">{script.opening_script}</p></div>}
                  {script.key_talking_points && (
                    <div><p className="text-xs font-medium text-muted-foreground">Talking Points</p>
                      <ul className="list-disc list-inside text-muted-foreground">
                        {parseJsonArr(script.key_talking_points).map((p: string, i: number) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {script.discovery_questions && (
                    <div><p className="text-xs font-medium text-muted-foreground">Questions</p>
                      <ul className="list-disc list-inside text-muted-foreground">
                        {parseJsonArr(script.discovery_questions).map((q: string, i: number) => <li key={i}>{q}</li>)}
                      </ul>
                    </div>
                  )}
                  {script.objection_handling && (() => {
                    let objs: any[] = [];
                    try { objs = JSON.parse(script.objection_handling); } catch {}
                    return Array.isArray(objs) && objs.length > 0 ? (
                      <div><p className="text-xs font-medium text-muted-foreground">Objections</p>
                        {objs.map((o: any, i: number) => (
                          <div key={i} className="text-muted-foreground ml-2 mb-1">
                            <p className="italic">"{o.objection}"</p><p>→ {o.response}</p>
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>
              ))}
            </div>
            <div className="space-y-4">
              <div className="text-sm"><span className="text-muted-foreground">Contact:</span> {slideContact?.contacts?.contact_name}</div>
              <div className="text-sm"><span className="text-muted-foreground">Phone:</span> {slideContact?.contacts?.phone_no || "—"}</div>
              <div className="space-y-2"><Label>Call Date/Time</Label><Input type="datetime-local" value={callForm.datetime} onChange={e => setCallForm({ ...callForm, datetime: e.target.value })} /></div>
              <div className="space-y-2"><Label>Duration (min)</Label><Input type="number" value={callForm.duration} onChange={e => setCallForm({ ...callForm, duration: e.target.value })} placeholder="Optional" /></div>
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select value={callForm.outcome} onValueChange={v => setCallForm({ ...callForm, outcome: v })}>
                  <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Interested">Interested</SelectItem>
                    <SelectItem value="Not Interested">Not Interested</SelectItem>
                    <SelectItem value="Call Later">Call Later</SelectItem>
                    <SelectItem value="Wrong Contact">Wrong Contact</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={callForm.notes} onChange={e => setCallForm({ ...callForm, notes: e.target.value })} rows={3} /></div>
              {interestedPrompt ? (
                <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg space-y-2">
                  <p className="text-sm font-medium">Mark {slideContact?.contacts?.contact_name} as Responded?</p>
                  <div className="flex gap-2"><Button size="sm" onClick={() => handleLogCall(true)}>Yes</Button><Button size="sm" variant="outline" onClick={() => handleLogCall(false)}>No</Button></div>
                </div>
              ) : (
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setCallSlideOpen(false)}>Cancel</Button>
                  <Button onClick={handleCallSave}>Save Call Log</Button>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── LinkedIn Slide-over ─── */}
      <Sheet open={linkedinSlideOpen} onOpenChange={setLinkedinSlideOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader><SheetTitle>Log LinkedIn Activity</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="text-sm"><span className="text-muted-foreground">Contact:</span> {slideContact?.contacts?.contact_name}</div>
            <div className="space-y-2"><Label>Profile URL</Label><Input value={linkedinForm.profile_url} onChange={e => setLinkedinForm({ ...linkedinForm, profile_url: e.target.value })} placeholder="https://linkedin.com/in/..." /></div>
            <div className="space-y-2">
              <Label>Message Type</Label>
              <Select value={linkedinForm.message_type} onValueChange={v => setLinkedinForm({ ...linkedinForm, message_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Connection Request">Connection Request</SelectItem>
                  <SelectItem value="Follow-up">Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Message Sent</Label><Textarea value={linkedinForm.message} onChange={e => setLinkedinForm({ ...linkedinForm, message: e.target.value })} rows={3} /></div>
            <div className="space-y-2">
              <Label>Current Status</Label>
              <Select value={linkedinForm.status} onValueChange={v => setLinkedinForm({ ...linkedinForm, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Not Contacted">Not Contacted</SelectItem>
                  <SelectItem value="Connection Sent">Connection Sent</SelectItem>
                  <SelectItem value="Connected">Connected</SelectItem>
                  <SelectItem value="Message Sent">Message Sent</SelectItem>
                  <SelectItem value="Responded">Responded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Date</Label><Input type="date" value={linkedinForm.date} onChange={e => setLinkedinForm({ ...linkedinForm, date: e.target.value })} /></div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={linkedinForm.notes} onChange={e => setLinkedinForm({ ...linkedinForm, notes: e.target.value })} rows={2} /></div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setLinkedinSlideOpen(false)}>Cancel</Button>
              <Button onClick={handleLogLinkedin}>Save</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Remove Confirmation ─── */}
      <AlertDialog open={!!removeConfirm} onOpenChange={(open) => !open && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeConfirm?.type === "account" ? "Account" : "Contact"}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {removeConfirm?.name} from this campaign? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Add Accounts Modal ─── */}
      <Dialog open={addAccountModalOpen} onOpenChange={(open) => {
        setAddAccountModalOpen(open);
        if (!open) { setSelectedContactIdsForAccounts([]); setExpandedModalAccounts(new Set()); }
      }}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Add Accounts to Campaign</DialogTitle></DialogHeader>
          <div className="relative mb-2 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search accounts..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
          {availableAccounts.length > 0 && (
            <div className="flex items-center gap-3 p-2 border-b border-border mb-1 cursor-pointer flex-shrink-0" onClick={() => handleSelectAll(availableAccounts)}>
              <Checkbox checked={selectedIds.length === availableAccounts.length && availableAccounts.length > 0} />
              <span className="text-sm font-medium">Select All ({availableAccounts.length})</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto min-h-0">
            {availableAccounts.map((account) => {
              const accountContacts = getModalContactsForAccount(account.account_name);
              const contactCount = accountContacts.length;
              const isExpanded = expandedModalAccounts.has(account.id);
              const nonExistingContacts = accountContacts.filter((c) => !existingContactIds.includes(c.id));
              return (
                <div key={account.id} className="border-b border-border last:border-b-0">
                  <div className="flex items-center gap-2 p-2 rounded hover:bg-muted/50">
                    <button
                      type="button"
                      className="p-0.5 hover:bg-muted rounded"
                      onClick={(e) => { e.stopPropagation(); toggleModalAccountExpand(account.id); }}
                    >
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                    <div className="cursor-pointer flex items-center gap-2 flex-1" onClick={() => toggleSelect(account.id)}>
                      <Checkbox checked={selectedIds.includes(account.id)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{account.account_name}</p>
                          <Badge variant="secondary" className="text-xs">
                            <Users className="h-3 w-3 mr-1" />{contactCount} contact{contactCount !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{[account.industry, account.region].filter(Boolean).join(" • ")}</p>
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="pl-10 pr-2 pb-2 space-y-0.5">
                      {nonExistingContacts.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic py-1">
                          {contactCount === 0 ? "No contacts found" : "All contacts already in campaign"}
                        </p>
                      ) : (
                        nonExistingContacts.map((contact) => (
                          <div
                            key={contact.id}
                            className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/30 cursor-pointer"
                            onClick={() => toggleContactForAccount(contact.id)}
                          >
                            <Checkbox checked={selectedContactIdsForAccounts.includes(contact.id)} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{contact.contact_name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {[contact.position, contact.email].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {contact.email && (
                                <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger><Mail className="h-3 w-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Has email</TooltipContent></Tooltip></TooltipProvider>
                              )}
                              {contact.phone_no && (
                                <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger><Phone className="h-3 w-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Has phone</TooltipContent></Tooltip></TooltipProvider>
                              )}
                              {contact.linkedin && (
                                <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger><Linkedin className="h-3 w-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Has LinkedIn</TooltipContent></Tooltip></TooltipProvider>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {availableAccounts.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No available accounts</p>}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border flex-shrink-0">
            <span className="text-xs text-muted-foreground">
              {selectedIds.length} account{selectedIds.length !== 1 ? "s" : ""}
              {selectedContactIdsForAccounts.length > 0 && `, ${selectedContactIdsForAccounts.length} contact${selectedContactIdsForAccounts.length !== 1 ? "s" : ""}`} selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAddAccountModalOpen(false)}>Cancel</Button>
              <Button onClick={handleAddAccounts} disabled={selectedIds.length === 0}>
                Add {selectedIds.length} Account{selectedIds.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Add Contacts Modal ─── */}
      <Dialog open={addContactModalOpen} onOpenChange={(open) => { setAddContactModalOpen(open); if (!open) setAddContactForAccount(null); }}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {addContactForAccount ? `Add Contacts from ${addContactForAccount.name}` : "Add Contacts to Campaign"}
            </DialogTitle>
            {!addContactForAccount && campaignAccountNames.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">Showing contacts from campaign accounts</p>
            )}
          </DialogHeader>
          <div className="relative mb-4 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search contacts..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
          {availableContacts.length > 0 && (
            <div className="flex items-center gap-3 p-2 border-b border-border mb-1 cursor-pointer flex-shrink-0" onClick={() => handleSelectAll(availableContacts)}>
              <Checkbox checked={selectedIds.length === availableContacts.length && availableContacts.length > 0} />
              <span className="text-sm font-medium">Select All ({availableContacts.length})</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {availableContacts.map((contact) => (
              <div key={contact.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => toggleSelect(contact.id)}>
                <Checkbox checked={selectedIds.includes(contact.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{contact.contact_name}</p>
                  <p className="text-xs text-muted-foreground">{[contact.position, contact.company_name].filter(Boolean).join(" at ")}</p>
                  <div className="flex gap-3 mt-0.5">
                    {contact.email && <span className="text-xs text-muted-foreground truncate">📧 {contact.email}</span>}
                    {contact.phone_no && <span className="text-xs text-muted-foreground">📞 {contact.phone_no}</span>}
                    {contact.linkedin && <span className="text-xs text-primary">🔗 LinkedIn</span>}
                  </div>
                </div>
              </div>
            ))}
            {availableContacts.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {addContactForAccount ? `No contacts found for ${addContactForAccount.name}` : campaignAccountNames.length === 0 ? "Add accounts first." : "No matching contacts found."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddContactModalOpen(false); setAddContactForAccount(null); }}>Cancel</Button>
            <Button onClick={handleAddContacts} disabled={selectedIds.length === 0}>Add {selectedIds.length} Contact(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Convert to Deal Modal ─── */}
      <Dialog open={convertModalOpen} onOpenChange={setConvertModalOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader><DialogTitle>Convert to Deal</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid grid-cols-[120px_1fr] gap-2 items-center text-sm">
              <span className="text-muted-foreground">Account</span>
              <span className="font-medium">{convertContact?.contacts?.company_name || "—"}</span>
              <span className="text-muted-foreground">Contact</span>
              <span className="font-medium">{convertContact?.contacts?.contact_name || "—"}</span>
              <span className="text-muted-foreground">Campaign Source</span>
              <span className="font-medium">{campaignName || "—"}</span>
              <span className="text-muted-foreground">Deal Stage</span>
              <Badge variant="outline">Lead</Badge>
            </div>
            <div className="space-y-2">
              <Label>Deal Owner</Label>
              <Select value={dealOwner} onValueChange={setDealOwner}>
                <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                <SelectContent>
                  {allUsers.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Deal name: <strong>{convertContact?.contacts?.contact_name} — {campaignName}</strong></p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertModalOpen(false)}>Cancel</Button>
            <Button onClick={handleConvertToDeal}><ArrowRightCircle className="h-4 w-4 mr-1" /> Create Deal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
