import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCampaigns, type CampaignFormData, type Campaign } from "@/hooks/useCampaigns";
import { supabase } from "@/integrations/supabase/client";
import { useAllUsers } from "@/hooks/useUserDisplayNames";

const CAMPAIGN_TYPES = ["Outreach", "Nurture", "Event"];

interface CampaignModalProps {
  open: boolean;
  onClose: () => void;
  campaign?: Campaign | null;
  isStrategyComplete?: boolean;
  onCreated?: (id: string) => void;
}

export function CampaignModal({ open, onClose, campaign, isStrategyComplete = false, onCreated }: CampaignModalProps) {
  const { user } = useAuth();
  const { createCampaign, updateCampaign } = useCampaigns();
  const { users: allUsers } = useAllUsers();
  const isEditing = !!campaign;

  const [formData, setFormData] = useState<CampaignFormData>({
    campaign_name: "",
    campaign_type: "Outreach",
    goal: "",
    owner: user?.id || "",
    start_date: "",
    end_date: "",
    status: "Draft",
    notes: "",
    description: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (campaign) {
      setFormData({
        campaign_name: campaign.campaign_name,
        campaign_type: campaign.campaign_type || "Outreach",
        goal: campaign.goal || "",
        owner: campaign.owner || user?.id || "",
        start_date: campaign.start_date || "",
        end_date: campaign.end_date || "",
        status: campaign.status || "Draft",
        notes: campaign.notes || "",
        description: campaign.description || "",
      });
    } else {
      setFormData({
        campaign_name: "",
        campaign_type: "Outreach",
        goal: "",
        owner: user?.id || "",
        start_date: "",
        end_date: "",
        status: "Draft",
        notes: "",
        description: "",
      });
    }
    setErrors({});
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
    if (isEditing && formData.status === "Active" && !isStrategyComplete) {
      newErrors.status = "Complete all Strategy sections before setting Active";
    }
    if (isEditing && campaign?.status === "Completed" && formData.status !== "Completed") {
      newErrors.status = "Completed campaigns cannot be reactivated";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const checkDuplicateName = async (): Promise<boolean> => {
    const trimmedName = formData.campaign_name.trim();
    const { data } = await supabase
      .from("campaigns")
      .select("id")
      .ilike("campaign_name", trimmedName);

    if (data && data.length > 0) {
      const duplicates = isEditing && campaign
        ? data.filter(d => d.id !== campaign.id)
        : data;
      if (duplicates.length > 0) {
        setErrors(prev => ({ ...prev, campaign_name: "A campaign with this name already exists" }));
        return true;
      }
    }
    return false;
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    const isDuplicate = await checkDuplicateName();
    if (isDuplicate) {
      setSubmitting(false);
      return;
    }

    if (isEditing && campaign) {
      updateCampaign.mutate({ id: campaign.id, ...formData }, { onSuccess: onClose, onSettled: () => setSubmitting(false) });
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

  const getAvailableStatuses = () => {
    if (isEditing && campaign?.status === "Completed") return ["Completed"];
    const statuses = ["Draft", "Paused", "Completed"];
    if (isStrategyComplete) statuses.splice(1, 0, "Active");
    return statuses;
  };

  const ownerOptions = allUsers.map((u) => ({ id: u.id, name: u.display_name }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEditing ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-3">
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
                  {CAMPAIGN_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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

          {isEditing && (
            <div className="space-y-1">
              <Label className="text-xs font-medium">Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {getAvailableStatuses().map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.status && <p className="text-xs text-destructive">{errors.status}</p>}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="description" className="text-xs font-medium">Description</Label>
            <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="What's this campaign about? Goals, audience, key notes..." rows={3} />
          </div>
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
