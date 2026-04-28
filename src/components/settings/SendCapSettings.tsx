import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Gauge, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface SendCap {
  id: string;
  scope: "global" | "campaign";
  campaign_id: string | null;
  hourly_limit: number;
  daily_limit: number;
  is_enabled: boolean;
}

interface CampaignOption {
  id: string;
  campaign_name: string;
}

const SendCapSettings = () => {
  const { user } = useAuth();
  const [caps, setCaps] = useState<SendCap[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newCampaignId, setNewCampaignId] = useState("");
  const [newHourly, setNewHourly] = useState(50);
  const [newDaily, setNewDaily] = useState(200);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const [capsRes, campsRes] = await Promise.all([
      supabase
        .from("campaign_send_caps")
        .select("id, scope, campaign_id, hourly_limit, daily_limit, is_enabled")
        .order("scope", { ascending: true }),
      supabase
        .from("campaigns")
        .select("id, campaign_name")
        .is("archived_at", null)
        .order("campaign_name"),
    ]);

    if (capsRes.error) toast.error("Failed to load send caps");
    if (campsRes.error) toast.error("Failed to load campaigns");

    setCaps((capsRes.data || []) as SendCap[]);
    setCampaigns((campsRes.data || []) as CampaignOption[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const globalCap = caps.find((c) => c.scope === "global");
  const campaignCaps = caps.filter((c) => c.scope === "campaign");
  const usedCampaignIds = new Set(campaignCaps.map((c) => c.campaign_id));
  const availableCampaigns = campaigns.filter((c) => !usedCampaignIds.has(c.id));

  const updateCap = async (cap: SendCap, patch: Partial<SendCap>) => {
    setSavingId(cap.id);
    const { error } = await supabase
      .from("campaign_send_caps")
      .update(patch)
      .eq("id", cap.id);
    if (error) {
      toast.error(error.message || "Failed to update");
    } else {
      setCaps((prev) => prev.map((c) => (c.id === cap.id ? { ...c, ...patch } : c)));
      toast.success("Send cap updated");
    }
    setSavingId(null);
  };

  const ensureGlobalCap = async () => {
    if (!user || globalCap) return;
    const { data, error } = await supabase
      .from("campaign_send_caps")
      .insert({
        scope: "global",
        hourly_limit: 100,
        daily_limit: 500,
        is_enabled: true,
        created_by: user.id,
      })
      .select("id, scope, campaign_id, hourly_limit, daily_limit, is_enabled")
      .single();
    if (error) {
      toast.error(error.message || "Failed to create global cap");
      return;
    }
    setCaps((prev) => [...prev, data as SendCap]);
  };

  useEffect(() => {
    if (!loading && !globalCap && user) {
      ensureGlobalCap();
    }
  }, [loading, globalCap, user]);

  const handleAddOverride = async () => {
    if (!user || !newCampaignId) return;
    setAdding(true);
    const { data, error } = await supabase
      .from("campaign_send_caps")
      .insert({
        scope: "campaign",
        campaign_id: newCampaignId,
        hourly_limit: newHourly,
        daily_limit: newDaily,
        is_enabled: true,
        created_by: user.id,
      })
      .select("id, scope, campaign_id, hourly_limit, daily_limit, is_enabled")
      .single();
    if (error) {
      toast.error(error.message || "Failed to add override");
    } else {
      setCaps((prev) => [...prev, data as SendCap]);
      toast.success("Per-campaign cap added");
      setAddOpen(false);
      setNewCampaignId("");
      setNewHourly(50);
      setNewDaily(200);
    }
    setAdding(false);
  };

  const handleRemove = async (cap: SendCap) => {
    const { error } = await supabase
      .from("campaign_send_caps")
      .delete()
      .eq("id", cap.id);
    if (error) {
      toast.error(error.message || "Failed to remove");
      return;
    }
    setCaps((prev) => prev.filter((c) => c.id !== cap.id));
    toast.success("Send cap removed");
  };

  const campaignName = (id: string | null) =>
    campaigns.find((c) => c.id === id)?.campaign_name || "Unknown campaign";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" />
          Send Rate Limits
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Protect your sender reputation by capping how many campaign emails can be sent per hour and per day. The
          global cap applies to all campaigns; per-campaign overrides take precedence when set.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Global cap */}
            {globalCap && <GlobalCapEditor cap={globalCap} onSave={updateCap} saving={savingId === globalCap.id} />}

            {/* Per-campaign overrides */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Per-campaign overrides</h3>
                  <p className="text-xs text-muted-foreground">
                    Override the global cap for a specific campaign (e.g. high-volume launches).
                  </p>
                </div>
                <Dialog open={addOpen} onOpenChange={setAddOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-1.5" disabled={availableCampaigns.length === 0}>
                      <Plus className="h-3.5 w-3.5" /> Add override
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add per-campaign send cap</DialogTitle>
                      <DialogDescription>
                        This cap will replace the global cap for the selected campaign.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">Campaign</Label>
                        <Select value={newCampaignId} onValueChange={setNewCampaignId}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Select campaign" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableCampaigns.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.campaign_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">Hourly limit</Label>
                          <Input
                            type="number"
                            min={1}
                            value={newHourly}
                            onChange={(e) => setNewHourly(Math.max(1, parseInt(e.target.value) || 0))}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">Daily limit</Label>
                          <Input
                            type="number"
                            min={1}
                            value={newDaily}
                            onChange={(e) => setNewDaily(Math.max(1, parseInt(e.target.value) || 0))}
                            className="h-9"
                          />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={adding}>
                        Cancel
                      </Button>
                      <Button onClick={handleAddOverride} disabled={!newCampaignId || adding}>
                        {adding && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Add override
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="w-[140px]">Hourly</TableHead>
                      <TableHead className="w-[140px]">Daily</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="w-[80px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignCaps.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">
                          No per-campaign overrides. The global cap applies to all campaigns.
                        </TableCell>
                      </TableRow>
                    ) : (
                      campaignCaps.map((cap) => (
                        <CampaignCapRow
                          key={cap.id}
                          cap={cap}
                          campaignName={campaignName(cap.campaign_id)}
                          saving={savingId === cap.id}
                          onSave={updateCap}
                          onRemove={handleRemove}
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const GlobalCapEditor = ({
  cap,
  onSave,
  saving,
}: {
  cap: SendCap;
  saving: boolean;
  onSave: (cap: SendCap, patch: Partial<SendCap>) => Promise<void>;
}) => {
  const [hourly, setHourly] = useState(cap.hourly_limit);
  const [daily, setDaily] = useState(cap.daily_limit);
  const [enabled, setEnabled] = useState(cap.is_enabled);

  useEffect(() => {
    setHourly(cap.hourly_limit);
    setDaily(cap.daily_limit);
    setEnabled(cap.is_enabled);
  }, [cap]);

  const dirty = hourly !== cap.hourly_limit || daily !== cap.daily_limit || enabled !== cap.is_enabled;

  return (
    <div className="rounded-md border p-4 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Global cap</h3>
          <p className="text-xs text-muted-foreground">Applies to every campaign without an override.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="global-enabled" className="text-xs">Enabled</Label>
          <Switch id="global-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Hourly limit</Label>
          <Input
            type="number"
            min={1}
            value={hourly}
            onChange={(e) => setHourly(Math.max(1, parseInt(e.target.value) || 0))}
            className="h-9"
            disabled={!enabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Daily limit</Label>
          <Input
            type="number"
            min={1}
            value={daily}
            onChange={(e) => setDaily(Math.max(1, parseInt(e.target.value) || 0))}
            className="h-9"
            disabled={!enabled}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => onSave(cap, { hourly_limit: hourly, daily_limit: daily, is_enabled: enabled })}
          className="gap-1.5"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
};

const CampaignCapRow = ({
  cap,
  campaignName,
  saving,
  onSave,
  onRemove,
}: {
  cap: SendCap;
  campaignName: string;
  saving: boolean;
  onSave: (cap: SendCap, patch: Partial<SendCap>) => Promise<void>;
  onRemove: (cap: SendCap) => Promise<void>;
}) => {
  const [hourly, setHourly] = useState(cap.hourly_limit);
  const [daily, setDaily] = useState(cap.daily_limit);
  const [enabled, setEnabled] = useState(cap.is_enabled);

  useEffect(() => {
    setHourly(cap.hourly_limit);
    setDaily(cap.daily_limit);
    setEnabled(cap.is_enabled);
  }, [cap]);

  const dirty = hourly !== cap.hourly_limit || daily !== cap.daily_limit || enabled !== cap.is_enabled;

  return (
    <TableRow>
      <TableCell className="font-medium text-sm">{campaignName}</TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          value={hourly}
          onChange={(e) => setHourly(Math.max(1, parseInt(e.target.value) || 0))}
          className="h-8 w-24"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          value={daily}
          onChange={(e) => setDaily(Math.max(1, parseInt(e.target.value) || 0))}
          className="h-8 w-24"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          {enabled ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Active</Badge>
          ) : (
            <Badge variant="outline" className="bg-muted text-muted-foreground">Off</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={saving}
              onClick={() => onSave(cap, { hourly_limit: hourly, daily_limit: daily, is_enabled: enabled })}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this override?</AlertDialogTitle>
                <AlertDialogDescription>
                  <strong>{campaignName}</strong> will revert to using the global send cap.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onRemove(cap)}>Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
};

export default SendCapSettings;
