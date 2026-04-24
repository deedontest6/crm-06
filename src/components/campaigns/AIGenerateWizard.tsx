import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Mail, Linkedin, Phone, ArrowLeft, Check, X, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

type AiKind = "email" | "linkedin-connection" | "phone";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  campaignContext: {
    campaign_name: string;
    campaign_type?: string;
    goal?: string;
    regions?: string[];
    selectedCountries?: string[];
    accountCount?: number;
    contactCount?: number;
    sampleIndustries?: string[];
    samplePositions?: string[];
  };
}

const KIND_OPTIONS: { id: AiKind; label: string; icon: typeof Mail }[] = [
  { id: "email", label: "Email", icon: Mail },
  { id: "linkedin-connection", label: "LinkedIn Connection", icon: Linkedin },
  { id: "phone", label: "Call Script", icon: Phone },
];

const KIND_LABEL: Record<AiKind, string> = {
  email: "Email",
  "linkedin-connection": "LinkedIn Connection",
  phone: "Call Script",
};

interface PreviewItem {
  kind: AiKind;
  result: any;
  include: boolean;
  error?: string;
}

function shortLabel(text: string, max = 30): string {
  const t = text.trim();
  if (!t) return "Generated";
  return t.length > max ? t.slice(0, max).trim() + "…" : t;
}

export function AIGenerateWizard({ open, onOpenChange, campaignId, campaignContext }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"form" | "preview">("form");
  const [selected, setSelected] = useState<Record<AiKind, boolean>>({
    email: true, "linkedin-connection": false, phone: false,
  });
  const [context, setContext] = useState("");
  const [tone, setTone] = useState("Professional");
  const [length, setLength] = useState("Short");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);

  const toggle = (k: AiKind) => setSelected(prev => ({ ...prev, [k]: !prev[k] }));
  const anySelected = Object.values(selected).some(Boolean);

  const reset = () => {
    setStep("form");
    setSelected({ email: true, "linkedin-connection": false, phone: false });
    setContext("");
    setTone("Professional");
    setLength("Short");
    setPreviews([]);
  };

  const runGeneration = async (kinds: AiKind[]): Promise<PreviewItem[]> => {
    const items: PreviewItem[] = [];
    for (const kind of kinds) {
      try {
        const { data, error } = await supabase.functions.invoke("generate-campaign-template", {
          body: { templateType: kind, campaignContext, userInstructions: context.trim(), tone, length },
        });
        if (error) throw error;
        if (!data?.success || !data?.result) throw new Error(data?.error || "AI returned no result");
        items.push({ kind, result: data.result, include: true });
      } catch (e: any) {
        items.push({ kind, result: null, include: false, error: e.message || "failed" });
      }
    }
    return items;
  };

  const handleGenerate = async () => {
    if (!anySelected) { toast({ title: "Pick at least one type", variant: "destructive" }); return; }
    if (!context.trim()) { toast({ title: "Add a short context to guide the AI", variant: "destructive" }); return; }

    setGenerating(true);
    const kinds = (Object.keys(selected) as AiKind[]).filter(k => selected[k]);
    const items = await runGeneration(kinds);
    setPreviews(items);
    setGenerating(false);
    setStep("preview");

    const failures = items.filter(i => i.error);
    if (failures.length === items.length) {
      toast({ title: "AI generation failed", description: failures.map(f => `${f.kind}: ${f.error}`).join("; "), variant: "destructive" });
    }
  };

  const handleRegenerate = async (idx: number) => {
    const item = previews[idx];
    setPreviews(prev => prev.map((p, i) => i === idx ? { ...p, error: "regenerating..." } : p));
    const [fresh] = await runGeneration([item.kind]);
    setPreviews(prev => prev.map((p, i) => i === idx ? fresh : p));
  };

  const updatePreview = (idx: number, patch: Partial<any>) => {
    setPreviews(prev => prev.map((p, i) => i === idx ? { ...p, result: { ...p.result, ...patch } } : p));
  };

  const togglePreviewInclude = (idx: number) => {
    setPreviews(prev => prev.map((p, i) => i === idx ? { ...p, include: !p.include } : p));
  };

  const saveResult = async (kind: AiKind, result: any) => {
    const nameSuffix = shortLabel(context || campaignContext.campaign_name || "Template");
    if (kind === "email") {
      await supabase.from("campaign_email_templates").insert({
        template_name: `AI – Email – ${nameSuffix}`,
        subject: result.subject || "",
        body: result.body || "",
        email_type: "Initial",
        campaign_id: campaignId,
        created_by: user!.id,
      });
    } else if (kind === "linkedin-connection") {
      await supabase.from("campaign_email_templates").insert({
        template_name: `AI – LinkedIn Conn – ${nameSuffix}`,
        body: result.body || "",
        email_type: "LinkedIn-Connection",
        campaign_id: campaignId,
        created_by: user!.id,
      });
    } else if (kind === "phone") {
      await supabase.from("campaign_phone_scripts").insert({
        script_name: `AI – Call Script – ${nameSuffix}`,
        opening_script: result.opening_script || "",
        key_talking_points: JSON.stringify(result.talking_points || []),
        discovery_questions: JSON.stringify(result.discovery_questions || []),
        objection_handling: JSON.stringify(result.objections || []),
        campaign_id: campaignId,
        created_by: user!.id,
      });
    }
  };

  const handleSaveSelected = async () => {
    const toSave = previews.filter(p => p.include && !p.error && p.result);
    if (toSave.length === 0) { toast({ title: "Nothing selected to save", variant: "destructive" }); return; }
    setSaving(true);
    let ok = 0, fail = 0;
    for (const item of toSave) {
      try { await saveResult(item.kind, item.result); ok++; } catch { fail++; }
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-email-templates", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-phone-scripts", campaignId] });
    setSaving(false);
    if (ok > 0) {
      toast({ title: `Saved ${ok} template${ok !== 1 ? "s" : ""}`, description: fail > 0 ? `${fail} failed.` : undefined });
      onOpenChange(false);
      reset();
    } else {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {step === "form" ? "Generate with AI" : "Review generated content"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {step === "form"
              ? <>Pick what to create and describe the angle. Templates use placeholders ({"{first_name}, {company_name}, {position}"}) so they auto-fill per recipient.</>
              : <>Review and edit each piece below. Uncheck any you don't want, then save the rest.</>}
          </DialogDescription>
        </DialogHeader>

        {step === "form" && (
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs">What to create</Label>
              <div className="grid grid-cols-2 gap-2">
                {KIND_OPTIONS.map(({ id, label, icon: Icon }) => (
                  <label
                    key={id}
                    className="flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={(e) => { e.preventDefault(); toggle(id); }}
                  >
                    <Checkbox checked={selected[id]} onCheckedChange={() => toggle(id)} />
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Context / angle *</Label>
              <Textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={4}
                placeholder='e.g. "Introduce our new SaaS analytics platform for mid-market manufacturers in Europe. Focus on cost savings and quick onboarding."'
                className="text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Professional">Professional</SelectItem>
                    <SelectItem value="Friendly">Friendly</SelectItem>
                    <SelectItem value="Direct">Direct</SelectItem>
                    <SelectItem value="Consultative">Consultative</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Length</Label>
                <Select value={length} onValueChange={setLength}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Short">Short</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Long">Long</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {step === "preview" && (
          <ScrollArea className="flex-1 -mx-2 px-2">
            <div className="space-y-3 py-2">
              {previews.map((item, idx) => (
                <div key={idx} className={`border rounded-lg p-3 space-y-2 ${item.include && !item.error ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox checked={item.include && !item.error} disabled={!!item.error} onCheckedChange={() => togglePreviewInclude(idx)} />
                      <span className="text-sm font-medium">{KIND_LABEL[item.kind]}</span>
                      {item.error && <span className="text-xs text-destructive">· {item.error}</span>}
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleRegenerate(idx)}>
                      <RefreshCw className="h-3 w-3 mr-1" /> Regenerate
                    </Button>
                  </div>

                  {item.result && item.kind === "email" && (
                    <div className="space-y-2">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Subject</Label>
                        <Input value={item.result.subject || ""} onChange={(e) => updatePreview(idx, { subject: e.target.value })} className="h-8 text-sm" />
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Body</Label>
                        <Textarea value={item.result.body || ""} onChange={(e) => updatePreview(idx, { body: e.target.value })} rows={6} className="text-sm" />
                      </div>
                    </div>
                  )}

                  {item.result && item.kind === "linkedin-connection" && (
                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Message ({(item.result.body || "").length} / 300)
                      </Label>
                      <Textarea value={item.result.body || ""} onChange={(e) => updatePreview(idx, { body: e.target.value })} rows={4} className="text-sm" />
                    </div>
                  )}

                  {item.result && item.kind === "phone" && (
                    <div className="space-y-2">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Opening Script</Label>
                        <Textarea value={item.result.opening_script || ""} onChange={(e) => updatePreview(idx, { opening_script: e.target.value })} rows={3} className="text-sm" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>{(item.result.talking_points || []).length} talking points</div>
                        <div>{(item.result.discovery_questions || []).length} discovery questions</div>
                        <div className="col-span-2">{(item.result.objections || []).length} objection responses</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          {step === "form" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={generating || !anySelected || !context.trim()} className="gap-1.5">
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {generating ? "Generating…" : "Generate Preview"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("form")} disabled={saving} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button variant="ghost" onClick={() => { onOpenChange(false); reset(); }} disabled={saving}>
                <X className="h-3.5 w-3.5 mr-1" /> Discard all
              </Button>
              <Button onClick={handleSaveSelected} disabled={saving || !previews.some(p => p.include && !p.error)} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : `Save ${previews.filter(p => p.include && !p.error).length} selected`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
