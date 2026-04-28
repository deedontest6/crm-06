import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCampaigns, type CampaignFormData, type Campaign } from "@/hooks/useCampaigns";
import { supabase } from "@/integrations/supabase/client";
import { useAllUsers } from "@/hooks/useUserDisplayNames";
import { CAMPAIGN_TYPE_OPTIONS, PRIORITY_OPTIONS, CHANNEL_OPTIONS, campaignTypeLabel } from "@/utils/campaignTypeLabel";

type RemovedChannel = "Email" | "Phone" | "LinkedIn";
interface ChannelImpact {
  channel: RemovedChannel;
  templates: number;
  comms: number;
  queued?: number;
}
async function countChannelImpact(campaignId: string, channel: RemovedChannel): Promise<ChannelImpact> {
  if (channel === "Phone") {
    const [{ count: scripts }, { count: comms }] = await Promise.all([
      supabase.from("campaign_phone_scripts").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId),
      supabase.from("campaign_communications").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).in("communication_type", ["Phone", "Call"]),
    ]);
    return { channel, templates: scripts ?? 0, comms: comms ?? 0 };
  }
  if (channel === "LinkedIn") {
    const [{ count: tpls }, { count: comms }] = await Promise.all([
      supabase.from("campaign_email_templates").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).like("email_type", "LinkedIn-%"),
      supabase.from("campaign_communications").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("communication_type", "LinkedIn"),
    ]);
    return { channel, templates: tpls ?? 0, comms: comms ?? 0 };
  }
  // Email
  const [{ count: tpls }, { count: comms }, { count: queued }] = await Promise.all([
    supabase.from("campaign_email_templates").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).not("email_type", "like", "LinkedIn-%"),
    supabase.from("campaign_communications").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("communication_type", "Email"),
    supabase.from("campaign_send_job_items").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).in("status", ["queued", "running"]),
  ]);
  return { channel, templates: tpls ?? 0, comms: comms ?? 0, queued: queued ?? 0 };
}
const channelLabel = (c: RemovedChannel) =>
  c === "Phone" ? "call scripts" : c === "LinkedIn" ? "LinkedIn templates" : "email templates";
const activityLabel = (c: RemovedChannel) =>
  c === "Phone" ? "phone activities" : c === "LinkedIn" ? "LinkedIn activities" : "email activities";

interface CampaignModalProps {
  open: boolean;
  onClose: () => void;
  campaign?: Campaign | null;
  isStrategyComplete?: boolean;
  onCreated?: (id: string) => void;
}

export function CampaignModal({ open, onClose, campaign, onCreated }: CampaignModalProps) {
  const { user } = useAuth();
  // Pass enableLists:false — opening the Edit modal on a detail page should
  // not re-fire the campaigns list / strategy queries.
  const { createCampaign, updateCampaign } = useCampaigns({ enableLists: false });
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
    primary_channel: "Email",
    enabled_channels: ["Email", "Phone", "LinkedIn"],
    tags: [],
  };

  const [formData, setFormData] = useState<CampaignFormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [originalEnabledChannels, setOriginalEnabledChannels] = useState<string[]>([]);
  const [originalPrimary, setOriginalPrimary] = useState<string>("");
  const [channelImpacts, setChannelImpacts] = useState<ChannelImpact[] | null>(null);
  const [primaryReassignedTo, setPrimaryReassignedTo] = useState<string | null>(null);

  useEffect(() => {
    if (campaign) {
      const c = campaign as any;
      const rawType = campaign.campaign_type || "New Outreach";
      const normalizedType = CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === rawType)
        ? rawType
        : campaignTypeLabel(rawType);
      // Resolve enabled_channels with legacy fallback to primary_channel
      const rawEnabled: string[] = Array.isArray(c.enabled_channels) && c.enabled_channels.length > 0
        ? c.enabled_channels.map((v: string) => (v === "Call" ? "Phone" : v))
        : (c.primary_channel ? [c.primary_channel === "Call" ? "Phone" : c.primary_channel] : ["Email", "Phone", "LinkedIn"]);
      const enabled = rawEnabled.filter((v) => ["Email", "Phone", "LinkedIn"].includes(v));
      const defaultCh = enabled.includes(c.primary_channel === "Call" ? "Phone" : c.primary_channel)
        ? (c.primary_channel === "Call" ? "Phone" : c.primary_channel)
        : enabled[0] || "Email";
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
        primary_channel: defaultCh,
        enabled_channels: enabled.length > 0 ? enabled : ["Email"],
        tags: Array.isArray(c.tags) ? c.tags : [],
      });
      setOriginalEnabledChannels(enabled);
      setOriginalPrimary(c.primary_channel === "Call" ? "Phone" : (c.primary_channel || ""));
    } else {
      setFormData({ ...emptyForm, owner: user?.id || "" });
      setOriginalEnabledChannels([]);
      setOriginalPrimary("");
    }
    setErrors({});
    setChannelImpacts(null);
    setPrimaryReassignedTo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, open, user?.id]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.campaign_name.trim() || formData.campaign_name.trim().length < 2) newErrors.campaign_name = "Name required (min 2 chars)";
    if (!formData.campaign_type) newErrors.campaign_type = "Type required";
    if (!formData.owner) newErrors.owner = "Owner required";
    if (!formData.start_date) newErrors.start_date = "Required";
    if (!formData.end_date) newErrors.end_date = "Required";
    if (formData.start_date && formData.end_date && formData.start_date >= formData.end_date) {
      newErrors.end_date = "Must be after start";
    }
    if (formData.goal && formData.goal.length > 1000) newErrors.goal = "Too long";
    if (!formData.enabled_channels || formData.enabled_channels.length === 0) {
      newErrors.enabled_channels = "Select at least one channel";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const checkDuplicateName = async (): Promise<boolean> => {
    const trimmedName = formData.campaign_name.trim();
    const { data } = await supabase.from("campaigns").select("id").ilike("campaign_name", trimmedName);
    if (data && data.length > 0) {
      const duplicates = isEditing && campaign ? data.filter((d) => d.id !== campaign.id) : data;
      if (duplicates.length > 0) {
        setErrors((prev) => ({ ...prev, campaign_name: "Name already exists" }));
        return true;
      }
    }
    return false;
  };

  const persistEdit = () => {
    if (!campaign) return;
    const { status, ...rest } = formData;
    const payload = { ...rest, campaign_name: rest.campaign_name.trim() };
    updateCampaign.mutate({ id: campaign.id, ...payload } as any, {
      onSuccess: () => {
        setChannelImpacts(null);
        setPrimaryReassignedTo(null);
        onClose();
      },
      onSettled: () => setSubmitting(false),
    });
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
      // Detect channels being removed and warn if they have data attached.
      const removed = originalEnabledChannels.filter(
        (c) => !(formData.enabled_channels || []).includes(c),
      ) as RemovedChannel[];
      if (removed.length > 0) {
        try {
          const impacts = await Promise.all(removed.map((c) => countChannelImpact(campaign.id, c)));
          const meaningful = impacts.filter((i) => (i.templates + i.comms + (i.queued ?? 0)) > 0);
          if (meaningful.length > 0) {
            // Detect primary-channel reassignment (informational note in same dialog)
            if (originalPrimary && !(formData.enabled_channels || []).includes(originalPrimary)) {
              setPrimaryReassignedTo(formData.primary_channel || (formData.enabled_channels || [])[0] || null);
            } else {
              setPrimaryReassignedTo(null);
            }
            setChannelImpacts(meaningful);
            setSubmitting(false);
            return; // wait for user to confirm
          }
        } catch (err) {
          // If counting fails, fall through and save — better than blocking.
          console.warn("[CampaignModal] channel-impact count failed", err);
        }
      }
      persistEdit();
    } else {
      createCampaign.mutate({ ...formData, campaign_name: formData.campaign_name.trim() }, {
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEditing ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2.5 py-1">
          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="campaign_name" className="text-xs font-medium">Name *</Label>
            <Input id="campaign_name" className="h-9" value={formData.campaign_name} onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })} placeholder="Campaign name" />
            {errors.campaign_name && <p className="text-xs text-destructive">{errors.campaign_name}</p>}
          </div>

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Type *</Label>
              <Select value={formData.campaign_type} onValueChange={(v) => setFormData({ ...formData, campaign_type: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.campaign_type && <p className="text-xs text-destructive">{errors.campaign_type}</p>}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Priority</Label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                <SelectTrigger className="h-9">
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${priorityDot}`} />
                      <span>{formData.priority}</span>
                    </div>
                  </SelectValue>
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
          </div>

          {/* Owner + Channel */}
          <div className="grid grid-cols-2 gap-2.5">
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

            <div className="space-y-1">
              <Label className="text-xs font-medium">Channels *</Label>
              <div className="flex flex-wrap gap-1.5">
                {CHANNEL_OPTIONS.map((c) => {
                  const active = formData.enabled_channels?.includes(c.value);
                  return (
                    <button
                      type="button"
                      key={c.value}
                      onClick={() => {
                        const cur = new Set(formData.enabled_channels || []);
                        if (cur.has(c.value)) cur.delete(c.value); else cur.add(c.value);
                        const next = Array.from(cur);
                        // Ensure default channel still in enabled set
                        let nextDefault = formData.primary_channel || "";
                        if (!next.includes(nextDefault)) nextDefault = next[0] || "";
                        setFormData({ ...formData, enabled_channels: next, primary_channel: nextDefault });
                      }}
                      className={`px-2.5 h-7 rounded-full text-xs border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {errors.enabled_channels && <p className="text-xs text-destructive">{errors.enabled_channels}</p>}
              {formData.enabled_channels && formData.enabled_channels.length > 1 && (
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-muted-foreground">Default:</span>
                  {formData.enabled_channels.map((ch) => (
                    <label key={ch} className="flex items-center gap-1 text-[10px] cursor-pointer">
                      <input
                        type="radio"
                        name="default-channel"
                        className="h-3 w-3"
                        checked={formData.primary_channel === ch}
                        onChange={() => setFormData({ ...formData, primary_channel: ch })}
                      />
                      {ch}
                    </label>
                  ))}
                </div>
              )}
              {isEditing && originalPrimary && formData.primary_channel && originalPrimary !== formData.primary_channel && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">
                  Default channel changed from {originalPrimary} → {formData.primary_channel}.
                </p>
              )}
              <p className="text-[10px] text-muted-foreground leading-tight">
                Disabled channels won't appear in Audience reachability or Monitoring tabs.
              </p>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2.5">
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

          {/* Goal */}
          <div className="space-y-1">
            <Label htmlFor="goal" className="text-xs font-medium">Goal</Label>
            <Input id="goal" className="h-9" value={formData.goal} onChange={(e) => setFormData({ ...formData, goal: e.target.value })} placeholder="e.g. 50 demos booked" />
            {errors.goal && <p className="text-xs text-destructive">{errors.goal}</p>}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label htmlFor="description" className="text-xs font-medium">Description</Label>
            <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="What's this campaign about?" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting || createCampaign.isPending || updateCampaign.isPending}>
            {submitting || createCampaign.isPending || updateCampaign.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Channel-removal data-loss warning */}
      <AlertDialog open={!!channelImpacts} onOpenChange={(o) => { if (!o) { setChannelImpacts(null); setPrimaryReassignedTo(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove channel{(channelImpacts?.length ?? 0) > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  Disabling these channels will hide existing data everywhere in this campaign
                  (Setup, Audience, Monitoring, Analytics). Records remain in the database but
                  are no longer surfaced.
                </p>
                {(channelImpacts ?? []).map((i) => (
                  <div key={i.channel} className="rounded-md border bg-muted/40 px-3 py-2">
                    <div className="font-medium text-foreground">Removing {i.channel} will hide:</div>
                    <ul className="list-disc pl-5 text-muted-foreground mt-1 space-y-0.5 text-xs">
                      {i.templates > 0 && <li>{i.templates} {channelLabel(i.channel)}</li>}
                      {i.comms > 0 && <li>{i.comms} {activityLabel(i.channel)} (monitoring &amp; analytics)</li>}
                      {!!i.queued && i.queued > 0 && (
                        <li className="text-amber-700 dark:text-amber-400">{i.queued} queued send job item{i.queued === 1 ? "" : "s"} will be cancelled</li>
                      )}
                    </ul>
                  </div>
                ))}
                {primaryReassignedTo && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Default channel was {originalPrimary}; it will switch to <strong>{primaryReassignedTo}</strong>.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setChannelImpacts(null); setPrimaryReassignedTo(null); }}>Keep channels</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setSubmitting(true); setChannelImpacts(null); persistEdit(); }}
            >
              Remove and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
