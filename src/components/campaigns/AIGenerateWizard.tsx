import { useEffect, useMemo, useState } from "react";
import type { Channel } from "./channelVisibility";
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

type AiKind = "email" | "linkedin-connection" | "linkedin-followup" | "phone";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  enabledChannels?: Channel[];
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

const CHANNEL_TO_KINDS: Record<Channel, AiKind[]> = {
  Email: ["email"],
  LinkedIn: ["linkedin-connection", "linkedin-followup"],
  Phone: ["phone"],
};

const KIND_OPTIONS: { id: AiKind; label: string; icon: typeof Mail }[] = [
  { id: "email", label: "Email", icon: Mail },
  { id: "linkedin-connection", label: "LinkedIn Connection", icon: Linkedin },
  { id: "linkedin-followup", label: "LinkedIn Follow-up", icon: Linkedin },
  { id: "phone", label: "Call Script", icon: Phone },
];

const KIND_LABEL: Record<AiKind, string> = {
  email: "Email",
  "linkedin-connection": "LinkedIn Connection",
  "linkedin-followup": "LinkedIn Follow-up",
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

export function AIGenerateWizard({ open, onOpenChange, campaignId, campaignContext, enabledChannels }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const allowedKinds = useMemo(() => {
    const channels: Channel[] = enabledChannels && enabledChannels.length > 0
      ? enabledChannels
      : ["Email", "LinkedIn", "Phone"];
    const set = new Set<AiKind>();
    channels.forEach((c) => CHANNEL_TO_KINDS[c]?.forEach((k) => set.add(k)));
    return set;
  }, [enabledChannels]);

  const visibleKindOptions = useMemo(
    () => KIND_OPTIONS.filter((o) => allowedKinds.has(o.id)),
    [allowedKinds]
  );

  const buildDefaultSelected = (): Record<AiKind, boolean> => {
    const base: Record<AiKind, boolean> = {
      email: false, "linkedin-connection": false, "linkedin-followup": false, phone: false,
    };
    if (visibleKindOptions.length === 0) return base;
    const first = allowedKinds.has("email") ? "email" : visibleKindOptions[0].id;
    base[first] = true;
    return base;
  };

  const [step, setStep] = useState<"form" | "preview">("form");
  const [selected, setSelected] = useState<Record<AiKind, boolean>>(buildDefaultSelected);
  const [context, setContext] = useState("");
  const [tone, setTone] = useState("Professional");
  const [length, setLength] = useState("Short");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);

  // Re-sync default selection whenever the dialog opens or channel set changes,
  // so legacy initial state cannot leak disabled-channel options into the UI.
  useEffect(() => {
    if (!open) return;
    setSelected(buildDefaultSelected());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allowedKinds]);

  const toggle = (k: AiKind) => {
    if (!allowedKinds.has(k)) return;
    setSelected((prev) => ({ ...prev, [k]: !prev[k] }));
  };
  const anySelected = (Object.keys(selected) as AiKind[]).some((k) => selected[k] && allowedKinds.has(k));

  const reset = () => {
    setStep("form");
    setSelected(buildDefaultSelected());
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
    const kinds = (Object.keys(selected) as AiKind[]).filter(k => selected[k] && allowedKinds.has(k));
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
    } else if (kind === "linkedin-followup") {
      await supabase.from("campaign_email_templates").insert({
        template_name: `AI – LinkedIn Follow-up – ${nameSuffix}`,
        body: result.body || "",
        email_type: "LinkedIn-Followup",
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
      <DialogContent className="sm:max-w-[760px] h-[90vh] max-h-[90vh] flex flex-col">
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
              {visibleKindOptions.length === 0 ? (
                <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
                  No channels are enabled for this campaign. Enable at least one channel in Setup → Strategy to use AI generation.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {visibleKindOptions.map(({ id, label, icon: Icon }) => (
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
              )}
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
          <div className="flex-1 min-h-0 -mx-2 overflow-y-auto px-2">
            <div className="flex min-h-full flex-col gap-3 py-2">
              {previews.map((item, idx) => (
                <div key={idx} className={`border rounded-lg p-3 space-y-2 ${previews.length === 1 ? "flex flex-1 flex-col min-h-0" : ""} ${item.include && !item.error ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                  <div className="flex shrink-0 items-center justify-between">
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
                    <div className={`space-y-2 ${previews.length === 1 ? "flex flex-1 flex-col min-h-0" : ""}`}>
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Subject</Label>
                        <Input value={item.result.subject || ""} onChange={(e) => updatePreview(idx, { subject: e.target.value })} className="h-8 text-sm" />
                      </div>
                      <div className={previews.length === 1 ? "flex flex-1 flex-col min-h-0" : undefined}>
                        <Label className="text-[11px] text-muted-foreground">Body</Label>
                        <Textarea value={item.result.body || ""} onChange={(e) => updatePreview(idx, { body: e.target.value })} rows={14} className={previews.length === 1 ? "flex-1 resize-none text-sm leading-6" : "text-sm leading-6"} />
                      </div>
                    </div>
                  )}

                  {item.result && (item.kind === "linkedin-connection" || item.kind === "linkedin-followup") && (
                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Message ({(item.result.body || "").length} / 300)
                      </Label>
                      <Textarea value={item.result.body || ""} onChange={(e) => updatePreview(idx, { body: e.target.value })} rows={previews.length === 1 ? 16 : 8} className={previews.length === 1 ? "min-h-[420px] resize-none text-sm leading-6" : "text-sm leading-6"} />
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
          </div>
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
