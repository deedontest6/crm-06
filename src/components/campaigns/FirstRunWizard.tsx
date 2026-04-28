import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useCampaigns } from "@/hooks/useCampaigns";
import { CAMPAIGN_TYPE_OPTIONS } from "@/utils/campaignTypeLabel";
import { Sparkles } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const PRIORITY_OPTIONS = [
  { v: "Low", l: "Low" },
  { v: "Medium", l: "Medium" },
  { v: "High", l: "High" },
];

const CHANNEL_OPTIONS = [
  { v: "Email", l: "Email" },
  { v: "Phone", l: "Phone" },
  { v: "LinkedIn", l: "LinkedIn" },
];

const DEFAULT_TYPE = CAMPAIGN_TYPE_OPTIONS[0]?.value || "New Outreach";

export function FirstRunWizard({ open, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { createCampaign } = useCampaigns({ enableLists: false });
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState(DEFAULT_TYPE);
  const [priority, setPriority] = useState("Medium");
  const [description, setDescription] = useState("");
  const [primaryChannel, setPrimaryChannel] = useState("Email");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10);
  });

  const reset = () => {
    setName("");
    setType(DEFAULT_TYPE);
    setPriority("Medium");
    setDescription("");
    setPrimaryChannel("Email");
    setStartDate(new Date().toISOString().slice(0, 10));
    const d = new Date(); d.setDate(d.getDate() + 30);
    setEndDate(d.toISOString().slice(0, 10));
    setConfirmingDiscard(false);
  };

  const isDirty = () =>
    name.trim().length > 0 || description.trim().length > 0;

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCancel = () => {
    if (isDirty() && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    handleClose();
  };

  const datesValid = !!startDate && !!endDate && startDate <= endDate;
  const canSubmit = name.trim().length > 0 && datesValid && !createCampaign.isPending;

  const handleCreate = () => {
    if (!user?.id || !canSubmit) return;
    createCampaign.mutate(
      {
        campaign_name: name.trim(),
        campaign_type: type,
        priority,
        description: description.trim() || null,
        primary_channel: primaryChannel,
        enabled_channels: [primaryChannel],
        start_date: startDate,
        end_date: endDate,
        status: "Draft",
        owner: user.id,
        target_audience: null,
        goal: null,
        message_strategy: null,
        notes: null,
      } as any,
      {
        onSuccess: (result: any) => {
          queryClient.invalidateQueries({ queryKey: ["campaigns"] });
          const target = result?.row?.slug || result?.row?.id || result?.id;
          reset();
          onClose();
          if (target) navigate(`/campaigns/${target}`);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            New Campaign
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q2 EMEA Outreach"
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAMPAIGN_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITY_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Channel</Label>
              <Select value={primaryChannel} onValueChange={setPrimaryChannel}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{CHANNEL_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          {!datesValid && (startDate && endDate) && (
            <p className="text-xs text-destructive">End date must be on or after start date.</p>
          )}

          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional"
              className="text-sm"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Saved as Draft. Set up audience and message after creating.
          </p>
        </div>

        <DialogFooter className="gap-1.5">
          {confirmingDiscard ? (
            <>
              <span className="text-xs text-muted-foreground mr-auto self-center">Discard?</span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDiscard(false)}>Keep</Button>
              <Button variant="destructive" size="sm" onClick={handleClose}>Discard</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={handleCancel}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={!canSubmit}>
                {createCampaign.isPending ? "Creating…" : "Create"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
