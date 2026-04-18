import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, Mail, Phone, MessageSquare, Upload, FileText, Pencil, Download, X, Copy, CopyPlus, ChevronDown, ChevronRight, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Campaign } from "@/hooks/useCampaigns";

interface Props {
  campaignId: string;
  campaign?: Campaign;
  selectedRegions?: string[];
  audienceCounts?: { accounts: number; contacts: number };
}

const SEGMENTS = ["C-Suite", "VP", "Director", "Manager", "Team Lead", "Individual Contributor"];

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

export function CampaignMessage({ campaignId, campaign, selectedRegions = [], audienceCounts }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [editEmailId, setEditEmailId] = useState<string | null>(null);
  const [scriptModalOpen, setScriptModalOpen] = useState(false);
  const [editScriptId, setEditScriptId] = useState<string | null>(null);
  const [linkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [editLinkedinId, setEditLinkedinId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set());
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string; name: string; filePath?: string } | null>(null);

  const buildAiContext = () => ({
    campaign_name: campaign?.campaign_name || "Campaign",
    campaign_type: campaign?.campaign_type || undefined,
    goal: campaign?.goal || undefined,
    regions: selectedRegions,
    accountCount: audienceCounts?.accounts || 0,
    contactCount: audienceCounts?.contacts || 0,
  });

  const generateWithAI = async (templateType: "email" | "linkedin-connection" | "linkedin-followup" | "phone", userInstructions?: string) => {
    setAiLoading(templateType);
    try {
      const { data, error } = await supabase.functions.invoke("generate-campaign-template", {
        body: { templateType, campaignContext: buildAiContext(), userInstructions },
      });
      if (error) throw error;
      if (!data?.success || !data?.result) throw new Error(data?.error || "AI generation failed");
      const r = data.result;
      if (templateType === "email") {
        setEmailForm(prev => ({ ...prev, subject: r.subject || prev.subject, body: r.body || prev.body }));
        toast({ title: "Email draft generated" });
      } else if (templateType === "linkedin-connection" || templateType === "linkedin-followup") {
        setLinkedinForm(prev => ({ ...prev, body: r.body || prev.body }));
        toast({ title: "LinkedIn draft generated" });
      } else if (templateType === "phone") {
        setScriptForm(prev => ({
          ...prev,
          opening_script: r.opening_script || prev.opening_script,
          talking_points: Array.isArray(r.talking_points) && r.talking_points.length > 0 ? r.talking_points : prev.talking_points,
          questions: Array.isArray(r.discovery_questions) && r.discovery_questions.length > 0 ? r.discovery_questions : prev.questions,
          objections: Array.isArray(r.objections) && r.objections.length > 0 ? r.objections : prev.objections,
        }));
        toast({ title: "Phone script generated" });
      }
    } catch (err: any) {
      toast({ title: "AI generation failed", description: err.message || "Please try again", variant: "destructive" });
    } finally {
      setAiLoading(null);
    }
  };

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
  const [emailForm, setEmailForm] = useState({ template_name: "", subject: "", body: "", email_type: "Initial", audience_segment: [] as string[], signature: "" });

  const openEmailEdit = (t: any) => {
    const segs = t.audience_segment ? t.audience_segment.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
    let body = t.body || "";
    let sig = "";
    const sigIdx = body.indexOf("---SIGNATURE---");
    if (sigIdx !== -1) { sig = body.substring(sigIdx + 15).trim(); body = body.substring(0, sigIdx).trim(); }
    setEmailForm({ template_name: t.template_name, subject: t.subject || "", body, email_type: t.email_type || "Initial", audience_segment: segs, signature: sig });
    setEditEmailId(t.id);
    setEmailModalOpen(true);
  };

  const openEmailCreate = () => {
    setEmailForm({ template_name: "", subject: "", body: "", email_type: "Initial", audience_segment: [], signature: "" });
    setEditEmailId(null);
    setEmailModalOpen(true);
  };

  const saveEmailTemplate = async () => {
    const bodyWithSig = emailForm.signature ? `${emailForm.body}\n---SIGNATURE---${emailForm.signature}` : emailForm.body;
    const segStr = emailForm.audience_segment.join(", ");
    const payload = { template_name: emailForm.template_name, subject: emailForm.subject, body: bodyWithSig, email_type: emailForm.email_type, audience_segment: segStr || null, campaign_id: campaignId, created_by: user!.id };

    if (editEmailId) {
      const { error } = await supabase.from("campaign_email_templates").update(payload).eq("id", editEmailId);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("campaign_email_templates").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
    setEmailModalOpen(false);
    toast({ title: editEmailId ? "Template updated" : "Template saved" });
  };

  const confirmDeleteEmailTemplate = (id: string, name: string) => {
    setDeleteConfirm({ type: "email", id, name });
  };

  const deleteEmailTemplate = async (id: string) => {
    await supabase.from("campaign_email_templates").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
  };

  const duplicateEmailTemplate = async (t: any) => {
    const payload = {
      template_name: `${t.template_name} (Copy)`,
      subject: t.subject,
      body: t.body,
      email_type: t.email_type,
      audience_segment: t.audience_segment,
      campaign_id: campaignId,
      created_by: user!.id,
    };
    const { error } = await supabase.from("campaign_email_templates").insert(payload);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
    toast({ title: "Template duplicated" });
  };

  const toggleSegment = (seg: string) => {
    setEmailForm(prev => ({
      ...prev,
      audience_segment: prev.audience_segment.includes(seg) ? prev.audience_segment.filter(s => s !== seg) : [...prev.audience_segment, seg]
    }));
  };

  // Phone script form
  const [scriptForm, setScriptForm] = useState({
    script_name: "", opening_script: "", talking_points: [] as string[],
    questions: [] as string[], objections: [] as { objection: string; response: string }[], audience_segments: [] as string[],
  });

  const openScriptEdit = (s: any) => {
    const segs = s.audience_segment ? s.audience_segment.split(",").map((seg: string) => seg.trim()).filter(Boolean) : [];
    setScriptForm({
      script_name: s.script_name || "", opening_script: s.opening_script || "",
      talking_points: parseJsonArray(s.key_talking_points),
      questions: parseJsonArray(s.discovery_questions),
      objections: parseObjectionArray(s.objection_handling),
      audience_segments: segs,
    });
    setEditScriptId(s.id);
    setScriptModalOpen(true);
  };

  const openScriptCreate = () => {
    setScriptForm({ script_name: "", opening_script: "", talking_points: [""], questions: [""], objections: [{ objection: "", response: "" }], audience_segments: [] });
    setEditScriptId(null);
    setScriptModalOpen(true);
  };

  const toggleScriptSegment = (seg: string) => {
    setScriptForm(prev => ({
      ...prev,
      audience_segments: prev.audience_segments.includes(seg) ? prev.audience_segments.filter(s => s !== seg) : [...prev.audience_segments, seg]
    }));
  };

  const savePhoneScript = async () => {
    const payload = {
      script_name: scriptForm.script_name, opening_script: scriptForm.opening_script,
      key_talking_points: JSON.stringify(scriptForm.talking_points.filter(Boolean)),
      discovery_questions: JSON.stringify(scriptForm.questions.filter(Boolean)),
      objection_handling: JSON.stringify(scriptForm.objections.filter(o => o.objection || o.response)),
      audience_segment: scriptForm.audience_segments.join(", ") || null,
      campaign_id: campaignId, created_by: user!.id,
    };
    if (editScriptId) {
      const { error } = await supabase.from("campaign_phone_scripts").update(payload).eq("id", editScriptId);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("campaign_phone_scripts").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
    setScriptModalOpen(false);
    toast({ title: editScriptId ? "Script updated" : "Script saved" });
  };

  const confirmDeletePhoneScript = (id: string, name: string) => {
    setDeleteConfirm({ type: "script", id, name });
  };

  const deletePhoneScript = async (id: string) => {
    await supabase.from("campaign_phone_scripts").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
  };

  const duplicatePhoneScript = async (s: any) => {
    const payload = {
      script_name: `${s.script_name || "Script"} (Copy)`,
      opening_script: s.opening_script,
      key_talking_points: s.key_talking_points,
      discovery_questions: s.discovery_questions,
      objection_handling: s.objection_handling,
      audience_segment: s.audience_segment,
      campaign_id: campaignId,
      created_by: user!.id,
    };
    const { error } = await supabase.from("campaign_phone_scripts").insert(payload);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
    toast({ title: "Script duplicated" });
  };

  // LinkedIn template form
  const [linkedinForm, setLinkedinForm] = useState({ template_name: "", body: "", email_type: "LinkedIn-Connection" as string });
  const linkedinMaxChars = linkedinForm.email_type === "LinkedIn-Connection" ? 300 : 1000;
  const linkedinCharCount = linkedinForm.body.length;
  const linkedinOverLimit = linkedinCharCount > linkedinMaxChars;

  const openLinkedinEdit = (t: any) => {
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
    const payload = { template_name: linkedinForm.template_name, body: linkedinForm.body, email_type: linkedinForm.email_type, campaign_id: campaignId, created_by: user!.id };
    if (editLinkedinId) {
      const { error } = await supabase.from("campaign_email_templates").update(payload).eq("id", editLinkedinId);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    } else {
      const { error } = await supabase.from("campaign_email_templates").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
    setLinkedinModalOpen(false);
    toast({ title: editLinkedinId ? "Template updated" : "Template saved" });
  };

  const copyToClipboard = (text: string, label?: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: label || "Copied to clipboard" });
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
    for (const file of Array.from(files)) {
      const filePath = `${campaignId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("campaign-materials").upload(filePath, file);
      if (uploadError) { toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" }); continue; }
      const { error: dbError } = await supabase.from("campaign_materials").insert({
        campaign_id: campaignId, file_name: file.name, file_path: filePath,
        file_type: "Other", created_by: user!.id,
      });
      if (dbError) toast({ title: "Error saving material", description: dbError.message, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
    setUploading(false);
    toast({ title: "Materials uploaded" });
    e.target.value = "";
  };

  const confirmDeleteMaterial = (id: string, name: string, filePath: string) => {
    setDeleteConfirm({ type: "material", id, name, filePath });
  };

  const deleteMaterial = async (id: string, filePath: string) => {
    await supabase.storage.from("campaign-materials").remove([filePath]);
    await supabase.from("campaign_materials").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-materials", campaignId] });
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
    toast({ title: "Deleted successfully" });
  };

  const MATERIAL_TYPES = ["One Pager", "Presentation", "Case Study", "Brochure", "Other"];

  return (
    <div className="space-y-4">
      {/* Email Templates */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground"><Mail className="h-3.5 w-3.5" /> Emails <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{regularEmailTemplates.length}</Badge></span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openEmailCreate}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </div>
        {regularEmailTemplates.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No email templates yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {regularEmailTemplates.map((t) => {
              let displayBody = t.body || "";
              const sigIdx = displayBody.indexOf("---SIGNATURE---");
              if (sigIdx !== -1) displayBody = displayBody.substring(0, sigIdx).trim();
              const segs = t.audience_segment ? t.audience_segment.split(",").map((s: string) => s.trim()) : [];
              return (
                <div key={t.id} className="border border-border rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge variant="secondary" className="text-[10px] shrink-0 px-1.5 py-0">{t.email_type || "Initial"}</Badge>
                      <span className="font-medium text-xs truncate">{t.template_name}</span>
                    </div>
                    <div className="flex items-center shrink-0">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(`Subject: ${t.subject}\n\n${displayBody}`, "Email copied")} title="Copy"><Copy className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicateEmailTemplate(t)} title="Duplicate"><CopyPlus className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEmailEdit(t)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => confirmDeleteEmailTemplate(t.id, t.template_name)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-0.5">Sub: {t.subject}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{displayBody}</p>
                  {segs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {segs.map(s => <Badge key={s} variant="outline" className="text-[9px] px-1 py-0">{s}</Badge>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* Call Scripts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3.5 w-3.5" /> Call Scripts <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{phoneScripts.length}</Badge></span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openScriptCreate}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </div>
        {phoneScripts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No call scripts yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {phoneScripts.map((s) => {
              const points = parseJsonArray(s.key_talking_points);
              const qs = parseJsonArray(s.discovery_questions);
              const objs = parseObjectionArray(s.objection_handling);
              const segs = s.audience_segment ? s.audience_segment.split(",").map((seg: string) => seg.trim()).filter(Boolean) : [];
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
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(
                        `${s.script_name}\n\nOpening: ${s.opening_script || ""}\n\nTalking Points:\n${points.join("\n")}\n\nQuestions:\n${qs.join("\n")}`,
                        "Script copied"
                      )} title="Copy"><Copy className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicatePhoneScript(s)} title="Duplicate"><CopyPlus className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openScriptEdit(s)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => confirmDeletePhoneScript(s.id, s.script_name || "Script")}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                    </div>
                  </div>
                  {s.opening_script && <p className="text-[11px] text-muted-foreground mb-1 line-clamp-1">Opening: {s.opening_script}</p>}
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    {points.length > 0 && <span>{points.length} point{points.length > 1 ? "s" : ""}</span>}
                    {qs.length > 0 && <span>{qs.length} Q{qs.length > 1 ? "s" : ""}</span>}
                    {objs.length > 0 && <span>{objs.length} obj.</span>}
                  </div>
                  {segs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {segs.map(seg => <Badge key={seg} variant="outline" className="text-[9px] px-1 py-0">{seg}</Badge>)}
                    </div>
                  )}
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
      </div>

      <hr className="border-border" />

      {/* LinkedIn Messages */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground"><MessageSquare className="h-3.5 w-3.5" /> LinkedIn <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{linkedinTemplates.length}</Badge></span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openLinkedinCreate}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
        </div>
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
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(t.body || "", "Message copied")} title="Copy"><Copy className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => duplicateEmailTemplate(t)} title="Duplicate"><CopyPlus className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openLinkedinEdit(t)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => confirmDeleteEmailTemplate(t.id, t.template_name)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{t.body}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* Marketing Materials */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground"><FileText className="h-3.5 w-3.5" /> Materials <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{materials.length}</Badge></span>
          <div>
            <input type="file" id="material-upload" className="hidden" multiple onChange={handleFileUpload} accept=".pdf,.pptx,.ppt,.doc,.docx,.png,.jpg,.jpeg" />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => document.getElementById("material-upload")?.click()} disabled={uploading}>
              <Upload className="h-3.5 w-3.5 mr-1" /> {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </div>
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
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => downloadMaterial(m.file_path, m.file_name)}><Download className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => confirmDeleteMaterial(m.id, m.file_name, m.file_path)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

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
        <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editEmailId ? "Edit" : "Add"} Email Template</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Template Name *</Label>
              <Input value={emailForm.template_name} onChange={(e) => setEmailForm({ ...emailForm, template_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Body *</Label>
              <Textarea value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} rows={5} />
            </div>
            <div className="space-y-2">
              <Label>Signature</Label>
              <Input value={emailForm.signature} onChange={(e) => setEmailForm({ ...emailForm, signature: e.target.value })} placeholder="e.g. Regards, Your Name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={emailForm.email_type} onValueChange={(v) => setEmailForm({ ...emailForm, email_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Initial">Initial</SelectItem>
                    <SelectItem value="Follow-up">Follow-up</SelectItem>
                    <SelectItem value="Final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Assign to Segments</Label>
              <div className="flex flex-wrap gap-2">
                {SEGMENTS.map(seg => (
                  <label key={seg} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={emailForm.audience_segment.includes(seg)} onCheckedChange={() => toggleSegment(seg)} />
                    {seg}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => generateWithAI("email")} disabled={aiLoading === "email"}>
              {aiLoading === "email" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Generate with AI
            </Button>
            <Button variant="outline" onClick={() => setEmailModalOpen(false)}>Cancel</Button>
            <Button onClick={saveEmailTemplate} disabled={!emailForm.template_name || !emailForm.subject || !emailForm.body}>Save</Button>
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
            <div className="space-y-2">
              <Label>Audience Segments</Label>
              <div className="flex flex-wrap gap-2">
                {SEGMENTS.map(seg => (
                  <label key={seg} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={scriptForm.audience_segments.includes(seg)} onCheckedChange={() => toggleScriptSegment(seg)} />
                    {seg}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => generateWithAI("phone")} disabled={aiLoading === "phone"}>
              {aiLoading === "phone" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Generate with AI
            </Button>
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
            <Button variant="outline" size="sm" onClick={() => generateWithAI(linkedinForm.email_type === "LinkedIn-Connection" ? "linkedin-connection" : "linkedin-followup")} disabled={aiLoading?.startsWith("linkedin")}>
              {aiLoading?.startsWith("linkedin") ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Generate with AI
            </Button>
            <Button variant="outline" onClick={() => setLinkedinModalOpen(false)}>Cancel</Button>
            <Button onClick={saveLinkedinTemplate} disabled={!linkedinForm.template_name || !linkedinForm.body || linkedinOverLimit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
