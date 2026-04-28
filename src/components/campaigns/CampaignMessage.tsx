import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { RichEmailBodyEditor, looksLikeHtml, plainTextToHtml } from "./RichEmailBodyEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Pencil, Download, X, Copy, CopyPlus, ChevronDown, ChevronRight, Wand2, MoreHorizontal, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Campaign } from "@/hooks/useCampaigns";
import { AIGenerateWizard } from "./AIGenerateWizard";
import { getEnabledChannels } from "./channelVisibility";

interface Props {
  campaignId: string;
  campaign?: Campaign;
  selectedRegions?: string[];
  audienceCounts?: { accounts: number; contacts: number };
  /** When true, all create/edit/delete/AI actions are hidden so a Completed
   * campaign can be reviewed but not modified. */
  isReadOnly?: boolean;
}

function DynamicList({ items, onChange, placeholder }: { items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  const addItem = () => onChange([...items, ""]);
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, val: string) => onChange(items.map((item, idx) => idx === i ? val : item));

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={item} onChange={(e) => updateItem(i, e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeItem(i)}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
    </div>
  );
}

function ObjectionList({ items, onChange }: { items: { objection: string; response: string }[]; onChange: (items: { objection: string; response: string }[]) => void }) {
  const addItem = () => onChange([...items, { objection: "", response: "" }]);
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: "objection" | "response", val: string) =>
    onChange(items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="border border-border rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Objection {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(i)}><X className="h-3 w-3" /></Button>
          </div>
          <Input value={item.objection} onChange={(e) => updateItem(i, "objection", e.target.value)} placeholder="Objection..." className="h-8 text-sm" />
          <Input value={item.response} onChange={(e) => updateItem(i, "response", e.target.value)} placeholder="Response..." className="h-8 text-sm" />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" /> Add Objection</Button>
    </div>
  );
}

function parseJsonArray(text: string | null): string[] {
  if (!text) return [];
  try { const arr = JSON.parse(text); return Array.isArray(arr) ? arr : [text]; } catch { return text ? text.split("\n").filter(Boolean) : []; }
}

function parseObjectionArray(text: string | null): { objection: string; response: string }[] {
  if (!text) return [];
  try { const arr = JSON.parse(text); return Array.isArray(arr) ? arr : []; } catch { return text ? [{ objection: text, response: "" }] : []; }
}

function countWordsFromHtml(html: string) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
  return text ? text.split(/\s+/).length : 0;
}

export function CampaignMessage({ campaignId, campaign, selectedRegions = [], audienceCounts, isReadOnly = false }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [editEmailId, setEditEmailId] = useState<string | null>(null);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [editScriptId, setEditScriptId] = useState<string | null>(null);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [editLinkedinId, setEditLinkedinId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set());
  const [aiWizardOpen, setAiWizardOpen] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string; name: string; filePath?: string } | null>(null);

  // Helpers ---------------------------------------------------------------
  const showError = (action: string, err: unknown) => {
    const message = (err as any)?.message || (typeof err === "string" ? err : "Network or permission error. Please retry.");
    toast({ title: `${action} failed`, description: message, variant: "destructive" });
  };

  const fallbackCopy = (text: string) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  // Sample industries from selected accounts and positions from selected contacts
  // — feeds AI context so generated copy mentions sectors/seniorities the user actually targets.
  const { data: audienceSamples } = useQuery({
    queryKey: ["campaign-ai-samples", campaignId],
    queryFn: async () => {
      const [{ data: accs }, { data: cons }] = await Promise.all([
        supabase.from("campaign_accounts").select("accounts(industry)").eq("campaign_id", campaignId).limit(50),
        supabase.from("campaign_contacts").select("contacts(position)").eq("campaign_id", campaignId).limit(50),
      ]);
      const industries = Array.from(new Set(((accs as any) || []).map((r: any) => r.accounts?.industry).filter(Boolean))).slice(0, 5);
      const positions = Array.from(new Set(((cons as any) || []).map((r: any) => r.contacts?.position).filter(Boolean))).slice(0, 5);
      return { industries: industries as string[], positions: positions as string[] };
    },
    enabled: !!campaignId,
  });

  const buildAiContext = () => ({
    campaign_name: campaign?.campaign_name || "Campaign",
    campaign_type: campaign?.campaign_type || undefined,
    goal: campaign?.goal || undefined,
    regions: selectedRegions,
    selectedCountries: (campaign?.country || "").split(",").map((c) => c.trim()).filter(Boolean),
    accountCount: audienceCounts?.accounts || 0,
    contactCount: audienceCounts?.contacts || 0,
    sampleIndustries: audienceSamples?.industries || [],
    samplePositions: audienceSamples?.positions || [],
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

  const { data: materials = [] } = useQuery({
    queryKey: ["campaign-materials", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from("campaign_materials").select("*").eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const linkedinTemplates = emailTemplates.filter((t) => t.email_type === "LinkedIn-Connection" || t.email_type === "LinkedIn-Followup");
  const regularEmailTemplates = emailTemplates.filter((t) => t.email_type !== "LinkedIn-Connection" && t.email_type !== "LinkedIn-Followup");

  // Email template form
  const [emailForm, setEmailForm] = useState({ template_name: "", subject: "", body: "", email_type: "Initial" });

  const openEmailEdit = (t: any) => {
    if (!t || !t.id || !t.template_name) {
      toast({ title: "Cannot edit", description: "Record is incomplete.", variant: "destructive" });
      return;
    }
    const cleaned = (t.body || "").replace(/\n?---SIGNATURE---\s*/g, "\n\n").trim();
    // If the stored body is plain text (no HTML tags), convert paragraph/line
    // breaks to HTML so the rich-text editor preserves the original formatting
    // (blank lines → <p>, single newlines → <br>). AI-generated templates are
    // saved as plain text and would otherwise collapse onto one line.
    const body = looksLikeHtml(cleaned) ? cleaned : plainTextToHtml(cleaned);
    setEmailForm({ template_name: t.template_name, subject: t.subject || "", body, email_type: t.email_type || "Initial" });
    setEditEmailId(t.id);
    setEmailModalOpen(true);
  };

  const openEmailCreate = () => {
    setEmailForm({ template_name: "", subject: "", body: "", email_type: "Initial" });
    setEditEmailId(null);
    setEmailModalOpen(true);
  };

  const saveEmailTemplate = async () => {
    const payload = {
      template_name: emailForm.template_name.trim(),
      subject: emailForm.subject.trim(),
      body: emailForm.body.trim(),
      email_type: emailForm.email_type,
      audience_segment: null,
      campaign_id: campaignId,
      created_by: user!.id,
    };

    try {
      if (editEmailId) {
        const { error } = await supabase.from("campaign_email_templates").update(payload).eq("id", editEmailId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("campaign_email_templates").insert(payload);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
      setEmailModalOpen(false);
      toast({ title: editEmailId ? "Template updated" : "Template saved" });
    } catch (err) {
      showError(editEmailId ? "Update" : "Save", err);
    }
  };

  const confirmDeleteEmailTemplate = (id: string, name: string) => {
    setDeleteConfirm({ type: "email", id, name });
  };

  const deleteEmailTemplate = async (id: string) => {
    const { error } = await supabase.from("campaign_email_templates").delete().eq("id", id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
  };

  const duplicateEmailTemplate = async (t: any) => {
    const newName = `${t.template_name} (Copy)`;
    const payload = {
      template_name: newName,
      subject: t.subject,
      body: t.body,
      email_type: t.email_type,
      audience_segment: null,
      campaign_id: campaignId,
      created_by: user!.id,
    };
    try {
      const { error } = await supabase.from("campaign_email_templates").insert(payload);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
      toast({ title: "Email duplicated", description: `Created \u201c${newName}\u201d.` });
    } catch (err) {
      showError("Duplicate", err);
    }
  };

  const duplicateLinkedinTemplate = async (t: any) => {
    const newName = `${t.template_name} (Copy)`;
    const payload = {
      template_name: newName,
      body: t.body,
      email_type: t.email_type,
      audience_segment: null,
      campaign_id: campaignId,
      created_by: user!.id,
    };
    try {
      const { error } = await supabase.from("campaign_email_templates").insert(payload);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
      toast({ title: "Template duplicated", description: `Created \u201c${newName}\u201d.` });
    } catch (err) {
      showError("Duplicate", err);
    }
  };

  const confirmDeleteLinkedinTemplate = (id: string, name: string) => {
    setDeleteConfirm({ type: "linkedin", id, name });
  };

  // Phone script form
  const [scriptForm, setScriptForm] = useState({
    script_name: "", opening_script: "", talking_points: [] as string[],
    questions: [] as string[], objections: [] as { objection: string; response: string }[],
  });

  const openScriptEdit = (s: any) => {
    if (!s || !s.id) {
      toast({ title: "Cannot edit", description: "Record is incomplete.", variant: "destructive" });
      return;
    }
    setScriptForm({
      script_name: s.script_name || "", opening_script: s.opening_script || "",
      talking_points: parseJsonArray(s.key_talking_points),
      questions: parseJsonArray(s.discovery_questions),
      objections: parseObjectionArray(s.objection_handling),
    });
    setEditScriptId(s.id);
    setScriptModalOpen(true);
  };

  const openScriptCreate = () => {
    setScriptForm({ script_name: "", opening_script: "", talking_points: [""], questions: [""], objections: [{ objection: "", response: "" }] });
    setEditScriptId(null);
    setScriptModalOpen(true);
  };

  const savePhoneScript = async () => {
    const payload = {
      script_name: scriptForm.script_name, opening_script: scriptForm.opening_script,
      key_talking_points: JSON.stringify(scriptForm.talking_points.filter(Boolean)),
      discovery_questions: JSON.stringify(scriptForm.questions.filter(Boolean)),
      objection_handling: JSON.stringify(scriptForm.objections.filter(o => o.objection || o.response)),
      audience_segment: null,
      campaign_id: campaignId, created_by: user!.id,
    };
    try {
      if (editScriptId) {
        const { error } = await supabase.from("campaign_phone_scripts").update(payload).eq("id", editScriptId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("campaign_phone_scripts").insert(payload);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
      setScriptModalOpen(false);
      toast({ title: editScriptId ? "Script updated" : "Script saved" });
    } catch (err) {
      showError(editScriptId ? "Update" : "Save", err);
    }
  };

  const confirmDeletePhoneScript = (id: string, name: string) => {
    setDeleteConfirm({ type: "script", id, name });
  };

  const deletePhoneScript = async (id: string) => {
    const { error } = await supabase.from("campaign_phone_scripts").delete().eq("id", id);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
  };

  const duplicatePhoneScript = async (s: any) => {
    const newName = `${s.script_name || "Script"} (Copy)`;
    const payload = {
      script_name: newName,
      opening_script: s.opening_script,
      key_talking_points: s.key_talking_points,
      discovery_questions: s.discovery_questions,
      objection_handling: s.objection_handling,
      audience_segment: null,
      campaign_id: campaignId,
      created_by: user!.id,
    };
    try {
      const { error } = await supabase.from("campaign_phone_scripts").insert(payload);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
      toast({ title: "Script duplicated", description: `Created \u201c${newName}\u201d.` });
    } catch (err) {
      showError("Duplicate", err);
    }
  };

  // LinkedIn template form
  const [linkedinForm, setLinkedinForm] = useState({ template_name: "", body: "", email_type: "LinkedIn-Connection" as string });
  const linkedinMaxChars = linkedinForm.email_type === "LinkedIn-Connection" ? 300 : 1000;
  const linkedinCharCount = linkedinForm.body.length;
  const linkedinOverLimit = linkedinCharCount > linkedinMaxChars;

  const openLinkedinEdit = (t: any) => {
    if (!t || !t.id || !t.template_name) {
      toast({ title: "Cannot edit", description: "Record is incomplete.", variant: "destructive" });
      return;
    }
    setLinkedinForm({ template_name: t.template_name, body: t.body || "", email_type: t.email_type || "LinkedIn-Connection" });
    setEditLinkedinId(t.id);
    setLinkedinModalOpen(true);
  };

  const openLinkedinCreate = () => {
    setLinkedinForm({ template_name: "", body: "", email_type: "LinkedIn-Connection" });
    setEditLinkedinId(null);
    setLinkedinModalOpen(true);
  };

  const saveLinkedinTemplate = async () => {
    if (linkedinOverLimit) { toast({ title: "Message too long", description: `Max ${linkedinMaxChars} characters.`, variant: "destructive" }); return; }
    const payload = {
      template_name: linkedinForm.template_name,
      body: linkedinForm.body,
      email_type: linkedinForm.email_type,
      audience_segment: null,
      campaign_id: campaignId,
      created_by: user!.id,
    };
    try {
      if (editLinkedinId) {
        const { error } = await supabase.from("campaign_email_templates").update(payload).eq("id", editLinkedinId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("campaign_email_templates").insert(payload);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
      setLinkedinModalOpen(false);
      toast({ title: editLinkedinId ? "Template updated" : "Template saved" });
    } catch (err) {
      showError(editLinkedinId ? "Update" : "Save", err);
    }
  };

  const copyToClipboard = async (
    text: string,
    opts?: { title?: string; description?: string },
  ) => {
    const title = opts?.title || "Copied to clipboard";
    const description = opts?.description;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else if (!fallbackCopy(text)) {
        throw new Error("Clipboard unavailable in this browser context.");
      }
      toast({ title, description });
    } catch (err) {
      // try fallback once more, then surface error
      if (fallbackCopy(text)) {
        toast({ title, description });
        return;
      }
      showError("Copy", err);
    }
  };

  const toggleScriptExpand = (id: string) => {
    setExpandedScripts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Materials
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    let okCount = 0;
    let failCount = 0;
    for (const file of Array.from(files)) {
      const filePath = `${campaignId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("campaign-materials").upload(filePath, file);
      if (uploadError) { showError(`Upload \u201c${file.name}\u201d`, uploadError); failCount++; continue; }
      const { error: dbError } = await supabase.from("campaign_materials").insert({
        campaign_id: campaignId, file_name: file.name, file_path: filePath,
        file_type: "Other", created_by: user!.id,
      });
      if (dbError) { showError(`Save \u201c${file.name}\u201d`, dbError); failCount++; }
      else okCount++;
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
    setUploading(false);
    if (okCount > 0) toast({ title: `${okCount} material${okCount > 1 ? "s" : ""} uploaded` });
    e.target.value = "";
  };

  const confirmDeleteMaterial = (id: string, name: string, filePath: string) => {
    setDeleteConfirm({ type: "material", id, name, filePath });
  };

  const deleteMaterial = async (id: string, filePath: string) => {
    // Storage delete is best-effort; DB delete is the source of truth.
    const { error: storageErr } = await supabase.storage.from("campaign-materials").remove([filePath]);
    const { error: dbErr } = await supabase.from("campaign_materials").delete().eq("id", id);
    if (dbErr) throw dbErr;
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
    if (storageErr) {
      // Row removed but file lingered in storage — tell the user.
      toast({
        title: "File not removed from storage",
        description: storageErr.message || "The record was deleted but the file remains.",
        variant: "destructive",
      });
    }
  };

  const downloadMaterial = async (filePath: string, fileName: string) => {
    const { data } = await supabase.storage.from("campaign-materials").createSignedUrl(filePath, 300);
    if (data?.signedUrl) { window.open(data.signedUrl, "_blank"); }
  };

  const updateMaterialType = async (id: string, type: string) => {
    await supabase.from("campaign_materials").update({ file_type: type }).eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    const name = deleteConfirm.name;
    try {
      switch (deleteConfirm.type) {
        case "email":
        case "linkedin":
          await deleteEmailTemplate(deleteConfirm.id);
          break;
        case "script":
          await deletePhoneScript(deleteConfirm.id);
          break;
        case "material":
          await deleteMaterial(deleteConfirm.id, deleteConfirm.filePath || "");
          break;
      }
      setDeleteConfirm(null);
      toast({ title: "Deleted", description: `\u201c${name}\u201d removed.` });
    } catch (err) {
      showError("Delete", err);
      setDeleteConfirm(null);
    }
  };

  const MATERIAL_TYPES = ["One Pager", "Presentation", "Case Study", "Brochure", "Other"];

  const tabsConfig: Array<{ key: "emails" | "scripts" | "linkedin" | "materials"; visible: boolean }> = [
    { key: "emails", visible: true },
  ];
  const visibleTabKeys = tabsConfig.filter(t => t.visible).map(t => t.key);

  const [activeTab, setActiveTab] = useState<"emails" | "scripts" | "linkedin" | "materials">(
    () => (visibleTabKeys[0] as any) || "emails",
  );

  // Re-pin to a visible tab if the channel changes and the active tab gets hidden.
  if (visibleTabKeys.length > 0 && !visibleTabKeys.includes(activeTab)) {
    // Defer to next tick to avoid setState during render in StrictMode.
    queueMicrotask(() => setActiveTab(visibleTabKeys[0]));
  }

  const renderEmails = () => (
    <>
      {regularEmailTemplates.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No email templates yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {regularEmailTemplates.map((t) => {
              const typeLabel = t.email_type || "Initial";
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  title={`Open ${t.template_name}`}
                  aria-label={`Open email template ${t.template_name}`}
                  onClick={() => openEmailEdit(t)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEmailEdit(t);
                    }
                  }}
                  className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary/70 to-primary/30" />
                  <div className="flex items-start gap-3 pl-4 pr-2 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="secondary" className="text-[10px] font-medium px-1.5 py-0 shrink-0">{typeLabel}</Badge>
                        <span className="font-semibold text-sm truncate text-foreground group-hover:text-primary transition-colors">
                          {t.template_name}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        <span className="font-medium text-foreground/70">Subject:</span> {t.subject || <span className="italic">No subject</span>}
                      </p>
                    </div>
                    <div className="shrink-0" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${t.template_name}`}>
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEmailEdit(t)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyToClipboard(`Subject: ${t.subject}\n\n${(t.body || "").replace(/<[^>]+>/g, " ")}`, { title: "Email copied", description: "Subject and body copied to clipboard." })}><Copy className="h-3.5 w-3.5 mr-2" /> Copy</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicateEmailTemplate(t)}><CopyPlus className="h-3.5 w-3.5 mr-2" /> Duplicate</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => confirmDeleteEmailTemplate(t.id, t.template_name)} className="text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </>
  );

  const renderScripts = () => (
    <>
      {phoneScripts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No call scripts yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {phoneScripts.map((s) => {
              const points = parseJsonArray(s.key_talking_points);
              const qs = parseJsonArray(s.discovery_questions);
              const objs = parseObjectionArray(s.objection_handling);
              const isExpanded = expandedScripts.has(s.id);
              const hasDetails = points.length > 0 || qs.length > 0 || objs.length > 0;
              return (
                <div key={s.id} className="border border-border rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {hasDetails && (
                        <button onClick={() => toggleScriptExpand(s.id)} className="shrink-0 p-0.5 hover:bg-muted rounded">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      )}
                      <span className="font-medium text-xs truncate">{s.script_name || "Script"}</span>
                    </div>
                    <div className="flex items-center shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3 w-3" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openScriptEdit(s)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyToClipboard(
                            `${s.script_name}\n\nOpening: ${s.opening_script || ""}\n\nTalking Points:\n${points.join("\n")}\n\nQuestions:\n${qs.join("\n")}`,
                            { title: "Script copied", description: "Phone script copied to clipboard." }
                          )}><Copy className="h-3.5 w-3.5 mr-2" /> Copy</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicatePhoneScript(s)}><CopyPlus className="h-3.5 w-3.5 mr-2" /> Duplicate</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => confirmDeletePhoneScript(s.id, s.script_name || "Script")} className="text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {s.opening_script && <p className="text-[11px] text-muted-foreground mb-1 line-clamp-1">Opening: {s.opening_script}</p>}
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    {points.length > 0 && <span>{points.length} point{points.length > 1 ? "s" : ""}</span>}
                    {qs.length > 0 && <span>{qs.length} Q{qs.length > 1 ? "s" : ""}</span>}
                    {objs.length > 0 && <span>{objs.length} obj.</span>}
                  </div>
                  {/* Expandable details */}
                  {isExpanded && hasDetails && (
                    <div className="mt-2 pt-2 border-t border-border space-y-2">
                      {points.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium mb-0.5">Talking Points</p>
                          <ul className="list-disc list-inside text-[11px] text-muted-foreground space-y-0.5">
                            {points.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        </div>
                      )}
                      {qs.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium mb-0.5">Discovery Questions</p>
                          <ul className="list-disc list-inside text-[11px] text-muted-foreground space-y-0.5">
                            {qs.map((q, i) => <li key={i}>{q}</li>)}
                          </ul>
                        </div>
                      )}
                      {objs.length > 0 && (
                        <div>
                          <p className="text-[10px] font-medium mb-0.5">Objection Handling</p>
                          <div className="space-y-1">
                            {objs.map((o, i) => (
                              <div key={i} className="text-[11px]">
                                <span className="font-medium">"{o.objection}"</span>
                                {o.response && <span className="text-muted-foreground"> → {o.response}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </>
  );

  const renderLinkedIn = () => (
    <>
      {linkedinTemplates.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No LinkedIn message templates yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {linkedinTemplates.map((t) => {
              const maxChars = t.email_type === "LinkedIn-Connection" ? 300 : 1000;
              const charCount = (t.body || "").length;
              const isOver = charCount > maxChars;
              return (
                <div key={t.id} className="border border-border rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge variant="secondary" className="text-[10px] shrink-0 px-1.5 py-0">{t.email_type === "LinkedIn-Connection" ? "Connection" : "Follow-up"}</Badge>
                      <span className="font-medium text-xs truncate">{t.template_name}</span>
                      <Badge variant={isOver ? "destructive" : "outline"} className="text-[9px] px-1 py-0 shrink-0">
                        {charCount}/{maxChars}
                      </Badge>
                    </div>
                    <div className="flex items-center shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3 w-3" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openLinkedinEdit(t)}><Pencil className="h-3.5 w-3.5 mr-2" /> Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyToClipboard(t.body || "", { title: "Message copied", description: "LinkedIn message copied to clipboard." })}><Copy className="h-3.5 w-3.5 mr-2" /> Copy</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicateLinkedinTemplate(t)}><CopyPlus className="h-3.5 w-3.5 mr-2" /> Duplicate</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => confirmDeleteLinkedinTemplate(t.id, t.template_name)} className="text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{t.body}</p>
                </div>
              );
            })}
          </div>
        )}
    </>
  );

  const renderMaterials = () => (
    <>
      <input type="file" id="material-upload" className="hidden" multiple onChange={handleFileUpload} accept=".pdf,.pptx,.ppt,.doc,.docx,.png,.jpg,.jpeg" />
      {materials.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No marketing materials uploaded.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="text-xs py-1">Name</TableHead>
                <TableHead className="text-xs py-1">Type</TableHead>
                <TableHead className="text-xs py-1 w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((m) => (
                <TableRow key={m.id} className="h-9">
                  <TableCell className="text-xs py-1">{m.file_name}</TableCell>
                  <TableCell className="py-1">
                    <Select value={m.file_type || "Other"} onValueChange={(v) => updateMaterialType(m.id, v)}>
                      <SelectTrigger className="h-6 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MATERIAL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="py-1">
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => downloadMaterial(m.file_path, m.file_name)} title="Download"><Download className="h-3 w-3" /></Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3 w-3" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => confirmDeleteMaterial(m.id, m.file_name, m.file_path)} className="text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
    </>
  );

  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-border bg-card/40 px-3 py-2">
          <TabsList className="h-9">
            <TabsTrigger value="emails" className="text-xs">Emails ({regularEmailTemplates.length})</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {!isReadOnly && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAiWizardOpen(true)}>
                    <Wand2 className="h-3.5 w-3.5" /> Generate with AI
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Uses campaign goal, regions and audience as context.</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <TabsContent value="emails" className="mt-3">{renderEmails()}</TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteConfirm?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. This will permanently delete this item.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Email Template Modal */}
      <Dialog open={emailModalOpen} onOpenChange={setEmailModalOpen}>
         <DialogContent className={emailPreviewOpen ? "sm:max-w-[900px] max-h-[88vh] overflow-hidden p-0" : "sm:max-w-[560px] max-h-[88vh] overflow-hidden p-0"}>
          <DialogHeader className="px-3 py-2 border-b flex-row items-center justify-between gap-2 space-y-0">
            <DialogTitle className="text-sm font-medium">{editEmailId ? "Edit" : "Add"} Email Template</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 mr-6 gap-1 text-xs shrink-0 px-2"
              onClick={() => setEmailPreviewOpen((v) => !v)}
              title={emailPreviewOpen ? "Hide email preview" : "Show email preview"}
            >
              {emailPreviewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {emailPreviewOpen ? "Hide preview" : "Preview"}
            </Button>
          </DialogHeader>
          <div className={emailPreviewOpen ? "grid md:grid-cols-2 gap-0 max-h-[calc(88vh-92px)]" : "max-h-[calc(88vh-92px)]"}>
            {/* Editor */}
            <div className="p-3 space-y-2.5 overflow-y-auto">
              <div className="space-y-1">
                <Label className="text-xs">Template name *</Label>
                <Input className="h-8" value={emailForm.template_name} onChange={(e) => setEmailForm({ ...emailForm, template_name: e.target.value })} placeholder="Initial outreach for automotive prospects" />
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                <div className="space-y-1 relative">
                  <Label className="text-xs">Subject *</Label>
                  <Input className="h-8 pr-12" value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} placeholder="Boosting results at {company_name}" />
                  <span className="absolute right-2 top-[26px] text-[10px] text-muted-foreground pointer-events-none">{emailForm.subject.length}/60</span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={emailForm.email_type} onValueChange={(v) => setEmailForm({ ...emailForm, email_type: v })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Initial">Initial</SelectItem>
                      <SelectItem value="Follow-up">Follow-up</SelectItem>
                      <SelectItem value="Final">Final</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Body *</Label>
                  <span className="text-[10px] text-muted-foreground">{countWordsFromHtml(emailForm.body)} words</span>
                </div>
                <RichEmailBodyEditor
                  value={emailForm.body}
                  onChange={(body) => setEmailForm({ ...emailForm, body })}
                />
              </div>
            </div>

            {/* Preview */}
            {emailPreviewOpen && (
              <div className="border-l bg-muted/30 overflow-y-auto">
                <div className="p-3 space-y-2">
                  <div className="rounded-md border bg-background">
                    <div className="px-3 py-2 border-b">
                      <div className="text-[10px] uppercase text-muted-foreground">Subject</div>
                      <div className="text-sm font-medium break-words">{emailForm.subject || <span className="text-muted-foreground italic">No subject</span>}</div>
                    </div>
                    {emailForm.body ? (
                      <div className="email-preview-body px-3 py-2 text-sm leading-6 break-words min-h-[180px] max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailForm.body) }} />
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground italic min-h-[180px]">Body preview will appear here…</div>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Placeholders like {"{first_name}"} are replaced per recipient at send time.</p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="px-3 py-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setEmailModalOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={saveEmailTemplate} disabled={!emailForm.template_name.trim() || !emailForm.subject.trim() || !emailForm.body.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phone Script Modal */}
      <Dialog open={scriptModalOpen} onOpenChange={setScriptModalOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editScriptId ? "Edit" : "Add"} Call Script</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Script Name *</Label>
              <Input value={scriptForm.script_name} onChange={(e) => setScriptForm({ ...scriptForm, script_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Opening Script</Label>
              <Textarea value={scriptForm.opening_script} onChange={(e) => setScriptForm({ ...scriptForm, opening_script: e.target.value })} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Talking Points</Label>
              <DynamicList items={scriptForm.talking_points} onChange={(items) => setScriptForm({ ...scriptForm, talking_points: items })} placeholder="Talking point..." />
            </div>
            <div className="space-y-2">
              <Label>Discovery Questions</Label>
              <DynamicList items={scriptForm.questions} onChange={(items) => setScriptForm({ ...scriptForm, questions: items })} placeholder="Question..." />
            </div>
            <div className="space-y-2">
              <Label>Objection Handling</Label>
              <ObjectionList items={scriptForm.objections} onChange={(items) => setScriptForm({ ...scriptForm, objections: items })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScriptModalOpen(false)}>Cancel</Button>
            <Button onClick={savePhoneScript} disabled={!scriptForm.script_name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LinkedIn Template Modal */}
      <Dialog open={linkedinModalOpen} onOpenChange={setLinkedinModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editLinkedinId ? "Edit" : "Add"} LinkedIn Message</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Template Name *</Label>
              <Input value={linkedinForm.template_name} onChange={(e) => setLinkedinForm({ ...linkedinForm, template_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={linkedinForm.email_type} onValueChange={(v) => setLinkedinForm({ ...linkedinForm, email_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LinkedIn-Connection">Connection Request (max 300 chars)</SelectItem>
                  <SelectItem value="LinkedIn-Followup">Follow-up Message (max 1000 chars)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Message *</Label>
              <Textarea value={linkedinForm.body} onChange={(e) => setLinkedinForm({ ...linkedinForm, body: e.target.value })} rows={5} placeholder="Write your LinkedIn message..." />
              <div className="space-y-1">
                <Progress value={Math.min((linkedinCharCount / linkedinMaxChars) * 100, 100)} className="h-1.5" />
                <div className={`text-xs text-right ${linkedinOverLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {linkedinCharCount} / {linkedinMaxChars} characters
                  {linkedinOverLimit && " — Too long!"}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkedinModalOpen(false)}>Cancel</Button>
            <Button onClick={saveLinkedinTemplate} disabled={!linkedinForm.template_name || !linkedinForm.body || linkedinOverLimit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Generate Wizard */}
      <AIGenerateWizard
        open={aiWizardOpen}
        onOpenChange={setAiWizardOpen}
        campaignId={campaignId}
        campaignContext={buildAiContext()}
        enabledChannels={getEnabledChannels(campaign)}
      />
    </div>
    </TooltipProvider>
  );
}
