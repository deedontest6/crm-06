import { useState, useEffect, KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCampaigns, type CampaignFormData, type Campaign } from "@/hooks/useCampaigns";
import { supabase } from "@/integrations/supabase/client";
import { useAllUsers } from "@/hooks/useUserDisplayNames";
import { CAMPAIGN_TYPE_OPTIONS, PRIORITY_OPTIONS, CHANNEL_OPTIONS, campaignTypeLabel } from "@/utils/campaignTypeLabel";
import { X } from "lucide-react";

interface CampaignModalProps {
  open: boolean;
  onClose: () => void;
  campaign?: Campaign | null;
  isStrategyComplete?: boolean;
  onCreated?: (id: string) => void;
}

export function CampaignModal({ open, onClose, campaign, onCreated }: CampaignModalProps) {
  const { user } = useAuth();
  const { createCampaign, updateCampaign } = useCampaigns();
  const { users: allUsers } = useAllUsers();
  const isEditing = !!campaign;

  const emptyForm: CampaignFormData = {
    campaign_name: "",
    campaign_type: "New Outreach",
    goal: "",
    owner: user?.id || "",
    start_date: "",
    end_date: "",
    status: "Draft",
    notes: "",
    description: "",
    priority: "Medium",
    primary_channel: "",
    tags: [],
  };

  const [formData, setFormData] = useState<CampaignFormData>(emptyForm);
  const [tagInput, setTagInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (campaign) {
      const c = campaign as any;
      // Normalize legacy types to new options when present
      const rawType = campaign.campaign_type || "New Outreach";
      const normalizedType = CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === rawType)
        ? rawType
        : campaignTypeLabel(rawType);
      setFormData({
        campaign_name: campaign.campaign_name,
        campaign_type: normalizedType,
        goal: campaign.goal || "",
        owner: campaign.owner || user?.id || "",
        start_date: campaign.start_date || "",
        end_date: campaign.end_date || "",
        status: campaign.status || "Draft",
        notes: campaign.notes || "",
        description: campaign.description || "",
        priority: c.priority || "Medium",
        primary_channel: c.primary_channel || "",
        tags: Array.isArray(c.tags) ? c.tags : [],
      });
    } else {
      setFormData({ ...emptyForm, owner: user?.id || "" });
    }
    setTagInput("");
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, open, user?.id]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.campaign_name.trim() || formData.campaign_name.trim().length < 2) newErrors.campaign_name = "Campaign name is required (min 2 chars)";
    if (!formData.campaign_type) newErrors.campaign_type = "Type is required";
    if (!formData.owner) newErrors.owner = "Owner is required";
    if (!formData.start_date) newErrors.start_date = "Start date is required";
    if (!formData.end_date) newErrors.end_date = "End date is required";
    if (formData.start_date && formData.end_date && formData.start_date >= formData.end_date) {
      newErrors.end_date = "End date must be after start date";
    }
    if (formData.goal && formData.goal.length > 1000) newErrors.goal = "Goal must be under 1000 chars";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const checkDuplicateName = async (): Promise<boolean> => {
    const trimmedName = formData.campaign_name.trim();
    const { data } = await supabase.from("campaigns").select("id").ilike("campaign_name", trimmedName);
    if (data && data.length > 0) {
      const duplicates = isEditing && campaign ? data.filter((d) => d.id !== campaign.id) : data;
      if (duplicates.length > 0) {
        setErrors((prev) => ({ ...prev, campaign_name: "A campaign with this name already exists" }));
        return true;
      }
    }
    return false;
  };

  const addTagFromInput = () => {
    const raw = tagInput.trim().replace(/,$/, "").trim();
    if (!raw) return;
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const next = Array.from(new Set([...(formData.tags || []), ...parts])).slice(0, 10);
    setFormData({ ...formData, tags: next });
    setTagInput("");
  };

  const removeTag = (t: string) => {
    setFormData({ ...formData, tags: (formData.tags || []).filter((x) => x !== t) });
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (tagInput.trim()) {
        e.preventDefault();
        addTagFromInput();
      }
    } else if (e.key === "Backspace" && !tagInput && (formData.tags || []).length) {
      const next = [...(formData.tags || [])];
      next.pop();
      setFormData({ ...formData, tags: next });
    }
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    const isDuplicate = await checkDuplicateName();
    if (isDuplicate) {
      setSubmitting(false);
      return;
    }
    if (isEditing && campaign) {
      // Strip status (it's read-only/gated by header)
      const { status, ...rest } = formData;
      updateCampaign.mutate({ id: campaign.id, ...rest } as any, { onSuccess: onClose, onSettled: () => setSubmitting(false) });
    } else {
      createCampaign.mutate(formData, {
        onSuccess: (data) => {
          onClose();
          if (onCreated && data?.id) onCreated(data.id);
        },
        onSettled: () => setSubmitting(false),
      });
    }
  };

  const ownerOptions = allUsers.map((u) => ({ id: u.id, name: u.display_name }));
  const priorityDot = PRIORITY_OPTIONS.find((p) => p.value === formData.priority)?.dot || "bg-muted";

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-1">{children}</div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEditing ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {/* BASICS */}
          <SectionLabel>Basics</SectionLabel>
          <div className="space-y-1">
            <Label htmlFor="campaign_name" className="text-xs font-medium">Name *</Label>
            <Input id="campaign_name" className="h-9" value={formData.campaign_name} onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })} placeholder="Campaign name" />
            {errors.campaign_name && <p className="text-xs text-destructive">{errors.campaign_name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Type *</Label>
              <Select value={formData.campaign_type} onValueChange={(v) => setFormData({ ...formData, campaign_type: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex flex-col">
                        <span>{t.label}</span>
                        <span className="text-[10px] text-muted-foreground">{t.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.campaign_type && <p className="text-xs text-destructive">{errors.campaign_type}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Owner *</Label>
              <Select value={formData.owner} onValueChange={(v) => setFormData({ ...formData, owner: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select owner" /></SelectTrigger>
                <SelectContent>
                  {ownerOptions.length > 0 ? (
                    ownerOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)
                  ) : (
                    <SelectItem value={user?.id || ""}>{user?.user_metadata?.full_name || user?.email || "Me"}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {errors.owner && <p className="text-xs text-destructive">{errors.owner}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Priority</Label>
            <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
              <SelectTrigger className="h-9">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${priorityDot}`} />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${p.dot}`} />
                      <span>{p.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* SCHEDULE */}
          <SectionLabel>Schedule</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="start_date" className="text-xs font-medium">Start Date *</Label>
              <Input id="start_date" type="date" className="h-9" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
              {errors.start_date && <p className="text-xs text-destructive">{errors.start_date}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="end_date" className="text-xs font-medium">End Date *</Label>
              <Input id="end_date" type="date" className="h-9" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
              {errors.end_date && <p className="text-xs text-destructive">{errors.end_date}</p>}
            </div>
          </div>

          {/* REACH */}
          <SectionLabel>Reach</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Primary Channel</Label>
              <Select value={formData.primary_channel || "none"} onValueChange={(v) => setFormData({ ...formData, primary_channel: v === "none" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select channel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not set —</SelectItem>
                  {CHANNEL_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal" className="text-xs font-medium">Goal</Label>
              <Input id="goal" className="h-9" value={formData.goal} onChange={(e) => setFormData({ ...formData, goal: e.target.value })} placeholder="e.g. 50 demos booked" />
              {errors.goal && <p className="text-xs text-destructive">{errors.goal}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Tags</Label>
            <div className="min-h-9 flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-md border border-input bg-background">
              {(formData.tags || []).map((t) => (
                <Badge key={t} variant="secondary" className="gap-1 pr-1">
                  {t}
                  <button type="button" onClick={() => removeTag(t)} className="hover:bg-muted rounded p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTagFromInput}
                placeholder={(formData.tags || []).length === 0 ? "Type and press Enter or comma" : ""}
                className="flex-1 min-w-[120px] text-sm bg-transparent outline-none"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">Up to 10 tags. Use Enter or comma to add.</p>
          </div>

          {/* DETAILS */}
          <SectionLabel>Details</SectionLabel>
          <div className="space-y-1">
            <Label htmlFor="description" className="text-xs font-medium">Description</Label>
            <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="What's this campaign about? Audience, key notes..." rows={3} />
          </div>

          {isEditing && (
            <div className="space-y-1">
              <Label className="text-xs font-medium">Status</Label>
              <Input className="h-9 bg-muted/50" value={formData.status} disabled readOnly />
              <p className="text-[10px] text-muted-foreground">Change status from the campaign header to ensure proper transitions.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting || createCampaign.isPending || updateCampaign.isPending}>
            {submitting || createCampaign.isPending || updateCampaign.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
