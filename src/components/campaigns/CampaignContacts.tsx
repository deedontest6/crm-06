import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, Search, Trash2, Users, ArrowRightCircle, Mail, Phone, Linkedin, CheckCircle2, ListTodo } from "lucide-react";
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

interface Props {
  campaignId: string;
  isCampaignEnded: boolean;
  campaignName?: string;
  campaignOwner?: string | null;
  endDate?: string | null;
}

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

const stageRanks: Record<string, number> = {
  "Not Contacted": 0, "Email Sent": 1, "Phone Contacted": 2,
  "LinkedIn Contacted": 3, "Responded": 4, "Qualified": 5,
};

// Derive account status from all its contacts
function deriveAccountStatus(contacts: any[], accountId: string): string {
  const acContacts = contacts.filter((c: any) => c.account_id === accountId);
  if (acContacts.length === 0) return "Not Contacted";
  if (acContacts.some((c: any) => c.stage === "Qualified")) return "Deal Created";
  if (acContacts.some((c: any) => c.stage === "Responded")) return "Responded";
  if (acContacts.some((c: any) => c.stage !== "Not Contacted")) return "Contacted";
  return "Not Contacted";
}

async function recomputeAccountStatus(campaignId: string, accountId: string, queryClient: any) {
  // Fetch fresh contacts for this account
  const { data: contacts } = await supabase.from("campaign_contacts")
    .select("stage").eq("campaign_id", campaignId).eq("account_id", accountId);
  const status = deriveAccountStatus(contacts || [], accountId);
  await supabase.from("campaign_accounts").update({ status }).eq("campaign_id", campaignId).eq("account_id", accountId);
  queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
}

export function CampaignContacts({ campaignId, isCampaignEnded, campaignName, campaignOwner, endDate }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [convertContact, setConvertContact] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);

  // Slide-over states
  const [emailSlideOpen, setEmailSlideOpen] = useState(false);
  const [callSlideOpen, setCallSlideOpen] = useState(false);
  const [linkedinSlideOpen, setLinkedinSlideOpen] = useState(false);
  const [slideContact, setSlideContact] = useState<any>(null);
  const [interestedPrompt, setInterestedPrompt] = useState(false);

  // Deal owner for convert
  const [dealOwner, setDealOwner] = useState<string>("");

  // Email slide-over state
  const [emailForm, setEmailForm] = useState({ template_id: "", subject: "", body: "", signature: "" });
  // Call slide-over state
  const [callForm, setCallForm] = useState({ datetime: new Date().toISOString().slice(0, 16), duration: "", outcome: "", notes: "" });
  // LinkedIn slide-over state
  const [linkedinForm, setLinkedinForm] = useState({ profile_url: "", message_type: "Connection Request", message: "", status: "Connection Sent", date: new Date().toISOString().split("T")[0], notes: "" });

  const { data: campaignContacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_contacts").select("*, contacts(contact_name, email, position, company_name)").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: campaignAccounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_accounts").select("account_id, accounts(account_name)").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: communications = [] } = useQuery({
    queryKey: ["campaign-communications", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_communications").select("contact_id, communication_date, communication_type").eq("campaign_id", campaignId).order("communication_date", { ascending: false });
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

  // Email templates for slide-over
  const { data: emailTemplates = [] } = useQuery({
    queryKey: ["campaign-email-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_email_templates").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  // Phone scripts for call slide-over
  const { data: phoneScripts = [] } = useQuery({
    queryKey: ["campaign-phone-scripts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_phone_scripts").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  // Users for deal owner selector
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

  const getLastActivity = (contactId: string) => {
    const comm = communications.find((c: any) => c.contact_id === contactId);
    return comm ? format(new Date(comm.communication_date), "dd MMM yyyy") : "—";
  };

  const hasDeal = (ccId: string) => campaignDeals.some((d: any) => d.source_campaign_contact_id === ccId);
  const canConvert = (stage: string) => stage === "Responded" || stage === "Qualified";

  const campaignAccountNames = campaignAccounts.map((ca: any) => ca.accounts?.account_name).filter(Boolean);

  const { data: allContacts = [] } = useQuery({
    queryKey: ["all-contacts-for-campaign", campaignId, campaignAccountNames.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase.from("contacts").select("id, contact_name, email, position, company_name");
      if (error) throw error;
      return data;
    },
    enabled: addModalOpen,
  });

  const existingContactIds = campaignContacts.map((cc: any) => cc.contact_id);
  const availableContacts = allContacts.filter((c) => {
    if (existingContactIds.includes(c.id)) return false;
    if (!c.contact_name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (campaignAccountNames.length > 0) {
      return c.company_name && campaignAccountNames.some((name: string) => name.toLowerCase() === c.company_name!.toLowerCase());
    }
    return true;
  });

  const handleAddContacts = async () => {
    if (selectedContactIds.length === 0) return;
    const inserts = selectedContactIds.map((contact_id) => {
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
    setAddModalOpen(false);
    setSelectedContactIds([]);
    setSearchTerm("");
    toast({ title: `${selectedContactIds.length} contact(s) added` });
  };

  const confirmRemoveContact = async () => {
    if (!removeConfirm) return;
    await supabase.from("campaign_contacts").delete().eq("id", removeConfirm.id);
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    setRemoveConfirm(null);
    toast({ title: "Contact removed" });
  };

  const updateStage = async (id: string, stage: string) => {
    await supabase.from("campaign_contacts").update({ stage }).eq("id", id);
    const cc = campaignContacts.find((c: any) => c.id === id);
    if (cc?.account_id) await recomputeAccountStatus(campaignId, cc.account_id, queryClient);
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
  };

  const toggleSelect = (id: string) => {
    setSelectedContactIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    setSelectedContactIds(selectedContactIds.length === availableContacts.length ? [] : availableContacts.map((c) => c.id));
  };

  // --- Slide-over openers ---
  const openEmailSlide = (cc: any) => {
    if (isCampaignEnded) { toast({ title: "Campaign ended", description: "Outreach is closed.", variant: "destructive" }); return; }
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
    setSlideContact(cc);
    setCallForm({ datetime: new Date().toISOString().slice(0, 16), duration: "", outcome: "", notes: "" });
    setInterestedPrompt(false);
    setCallSlideOpen(true);
  };

  const openLinkedinSlide = (cc: any) => {
    if (isCampaignEnded) { toast({ title: "Campaign ended", description: "Outreach is closed.", variant: "destructive" }); return; }
    setSlideContact(cc);
    setLinkedinForm({ profile_url: "", message_type: "Connection Request", message: "", status: "Connection Sent", date: new Date().toISOString().split("T")[0], notes: "" });
    setLinkedinSlideOpen(true);
  };

  // Select email template
  const handleTemplateSelect = (templateId: string) => {
    const tmpl = emailTemplates.find((t) => t.id === templateId);
    if (!tmpl) return;
    let body = tmpl.body || "";
    let sig = "";
    const sigIdx = body.indexOf("---SIGNATURE---");
    if (sigIdx !== -1) { sig = body.substring(sigIdx + 15).trim(); body = body.substring(0, sigIdx).trim(); }
    setEmailForm({ template_id: templateId, subject: tmpl.subject || "", body, signature: sig });
  };

  // --- Send Email via Edge Function ---
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
        toast({ title: "Email send failed", description: data?.error || "Unknown error", variant: "destructive" }); return;
      }
      // Rank-based MAX stage
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

  // --- Log Call ---
  const handleLogCall = async (markResponded?: boolean) => {
    if (!slideContact) return;
    await supabase.from("campaign_communications").insert({
      campaign_id: campaignId, contact_id: slideContact.contact_id, account_id: slideContact.account_id,
      communication_type: "Call", call_outcome: callForm.outcome,
      notes: callForm.notes || null,
      owner: user!.id, created_by: user!.id,
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
    if (callForm.outcome === "Interested") {
      setInterestedPrompt(true);
    } else {
      handleLogCall(false);
    }
  };

  // --- Log LinkedIn ---
  const handleLogLinkedin = async () => {
    if (!slideContact) return;
    await supabase.from("campaign_communications").insert({
      campaign_id: campaignId, contact_id: slideContact.contact_id, account_id: slideContact.account_id,
      communication_type: "LinkedIn", linkedin_status: linkedinForm.status,
      notes: linkedinForm.notes || null,
      owner: user!.id, created_by: user!.id,
      communication_date: linkedinForm.date ? new Date(linkedinForm.date).toISOString() : new Date().toISOString(),
    });
    // Update linkedin_status on campaign_contacts
    await supabase.from("campaign_contacts").update({ linkedin_status: linkedinForm.status }).eq("campaign_id", campaignId).eq("contact_id", slideContact.contact_id);
    // Stage MAX
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

  // --- Convert to Deal ---
  const openConvertModal = (cc: any) => {
    setConvertContact(cc);
    setDealOwner(campaignOwner || user?.id || "");
    setConvertModalOpen(true);
  };

  const handleConvertToDeal = async () => {
    if (!convertContact) return;
    const contactName = convertContact.contacts?.contact_name || "Unknown";
    const dealName = `${contactName} — ${campaignName || "Campaign"}`;
    const contactAccountId = convertContact.account_id || null;

    try {
      const { data: deal, error } = await supabase.from("deals").insert({
        deal_name: dealName, stage: "Lead", created_by: user!.id, lead_owner: dealOwner || user!.id,
        campaign_id: campaignId, account_id: contactAccountId,
        source_campaign_contact_id: convertContact.id,
        customer_name: convertContact.contacts?.company_name || contactName,
      }).select().single();
      if (error) throw error;

      const { error: e2 } = await supabase.from("campaign_contacts").update({ stage: "Qualified" }).eq("id", convertContact.id);
      if (e2) { await supabase.from("deals").delete().eq("id", deal.id); throw e2; }

      if (contactAccountId) {
        await supabase.from("campaign_accounts").update({ status: "Deal Created" }).eq("campaign_id", campaignId).eq("account_id", contactAccountId);
      }

      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-deals", campaignId] });
      setConvertModalOpen(false);
      setConvertContact(null);
      toast({
        title: `Deal created for ${contactName}. Stage: Lead.`,
        description: "View the deal in the Deals module.",
        action: <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => navigate("/deals")}>View Deal →</Button>,
      });
    } catch (err: any) {
      toast({ title: "Deal creation failed", description: err.message || "Please try again.", variant: "destructive" });
    }
  };

  // Filters
  const filtered = campaignContacts.filter((cc: any) => {
    if (stageFilter !== "all" && cc.stage !== stageFilter) return false;
    if (accountFilter !== "all" && cc.account_id !== accountFilter) return false;
    if (searchTerm && !addModalOpen) {
      const name = cc.contacts?.contact_name?.toLowerCase() || "";
      const company = cc.contacts?.company_name?.toLowerCase() || "";
      const q = searchTerm.toLowerCase();
      if (!name.includes(q) && !company.includes(q)) return false;
    }
    return true;
  });

  const accountOptions = campaignAccounts.map((ca: any) => ({ id: ca.account_id, name: ca.accounts?.account_name || "Unknown" }));
  const regularTemplates = emailTemplates.filter((t) => t.email_type !== "LinkedIn-Connection" && t.email_type !== "LinkedIn-Followup");

  // Parse JSON call script fields for display
  const parseJsonArr = (text: string | null): string[] => {
    if (!text) return [];
    try { const a = JSON.parse(text); return Array.isArray(a) ? a : [text]; } catch { return text ? text.split("\n").filter(Boolean) : []; }
  };

  return (
    <div className="space-y-4">
      {/* Campaign ended banner */}
      {isCampaignEnded && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive text-sm">
          This campaign ended on {endDate || "an earlier date"}. Outreach is closed.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Campaign Contacts ({campaignContacts.length})</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-8 w-[150px] text-xs" />
            </div>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                {Object.keys(stageColors).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {accountOptions.length > 0 && (
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {accountOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {!isCampaignEnded && (
              <Button size="sm" onClick={() => setAddModalOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Contacts</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                {campaignContacts.length === 0
                  ? (campaignAccounts.length === 0 ? "Add accounts first, then add contacts from those accounts." : "No contacts added yet.")
                  : "No contacts match the selected filters."}
              </p>
              {campaignContacts.length === 0 && campaignAccounts.length > 0 && !isCampaignEnded && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add your first contacts
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact Name</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>LinkedIn Status</TableHead>
                    <TableHead>Last Activity</TableHead>
                    <TableHead className="w-[220px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((cc: any) => (
                    <TableRow key={cc.id}>
                      <TableCell className="font-medium">{cc.contacts?.contact_name || "—"}</TableCell>
                      <TableCell>{campaignAccounts.find((ca: any) => ca.account_id === cc.account_id)?.accounts?.account_name || cc.contacts?.company_name || "—"}</TableCell>
                      <TableCell>{cc.contacts?.position || "—"}</TableCell>
                      <TableCell>
                        <Select value={cc.stage || "Not Contacted"} onValueChange={(v) => updateStage(cc.id, v)}>
                          <SelectTrigger className="h-7 w-[150px] text-xs">
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
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isCampaignEnded}
                            onClick={() => openEmailSlide(cc)} title="Send Email"><Mail className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isCampaignEnded}
                            onClick={() => openCallSlide(cc)} title="Log Call"><Phone className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isCampaignEnded}
                            onClick={() => openLinkedinSlide(cc)} title="Log LinkedIn"><Linkedin className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => {
                              // Navigate to tasks tab - emit custom event or use URL param
                              const event = new CustomEvent('campaign-add-task', { detail: { contactId: cc.contact_id, accountId: cc.account_id } });
                              window.dispatchEvent(event);
                            }} title="Add Task"><ListTodo className="h-3.5 w-3.5" /></Button>
                          {hasDeal(cc.id) ? (
                            <Badge variant="outline" className="text-xs flex items-center gap-1 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3" /> Deal Created
                            </Badge>
                          ) : canConvert(cc.stage) ? (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openConvertModal(cc)}>
                              <ArrowRightCircle className="h-3 w-3 mr-1" /> Deal
                            </Button>
                          ) : null}
                          {!isCampaignEnded && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRemoveConfirm({ id: cc.id, name: cc.contacts?.contact_name || "this contact" })}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Slide-over */}
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

      {/* Call Slide-over */}
      <Sheet open={callSlideOpen} onOpenChange={setCallSlideOpen}>
        <SheetContent className="w-[900px] sm:max-w-[900px] overflow-y-auto">
          <SheetHeader><SheetTitle>Log Call</SheetTitle></SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-6">
            {/* Left: Call Script Reference */}
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
                            <p className="italic">"{o.objection}"</p>
                            <p>→ {o.response}</p>
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>
              ))}
            </div>

            {/* Right: Log Form */}
            <div className="space-y-4">
              <div className="text-sm"><span className="text-muted-foreground">Contact:</span> {slideContact?.contacts?.contact_name}</div>
              <div className="text-sm"><span className="text-muted-foreground">Account:</span> {slideContact?.contacts?.company_name || "—"}</div>
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
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleLogCall(true)}>Yes</Button>
                    <Button size="sm" variant="outline" onClick={() => handleLogCall(false)}>No</Button>
                  </div>
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

      {/* LinkedIn Slide-over */}
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

      {/* Remove Confirmation */}
      <AlertDialog open={!!removeConfirm} onOpenChange={(open) => !open && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Contact</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to remove {removeConfirm?.name} from this campaign? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveContact}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Contacts Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Contacts to Campaign</DialogTitle>
            {campaignAccountNames.length > 0 && <p className="text-xs text-muted-foreground mt-1">Showing contacts from campaign accounts: {campaignAccountNames.join(", ")}</p>}
          </DialogHeader>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search contacts..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
          {availableContacts.length > 0 && (
            <div className="flex items-center gap-3 p-2 border-b border-border mb-1 cursor-pointer" onClick={handleSelectAll}>
              <Checkbox checked={selectedContactIds.length === availableContacts.length && availableContacts.length > 0} />
              <span className="text-sm font-medium">Select All ({availableContacts.length})</span>
            </div>
          )}
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {availableContacts.map((contact) => (
              <div key={contact.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => toggleSelect(contact.id)}>
                <Checkbox checked={selectedContactIds.includes(contact.id)} />
                <div>
                  <p className="text-sm font-medium">{contact.contact_name}</p>
                  <p className="text-xs text-muted-foreground">{[contact.position, contact.company_name].filter(Boolean).join(" at ")}</p>
                </div>
              </div>
            ))}
            {availableContacts.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{campaignAccountNames.length === 0 ? "Add accounts first." : "No matching contacts found."}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAddContacts} disabled={selectedContactIds.length === 0}>Add {selectedContactIds.length} Contact(s)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Deal Modal — with deal owner selector */}
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
