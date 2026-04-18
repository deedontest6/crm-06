import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useState, useMemo } from "react";
import { Globe, Plus, Pencil, Trash2 } from "lucide-react";

interface RegionCard {
  country: string;
  region: string;
  timezone: string;
  messaging_note: string;
}

const COMMON_TIMEZONES = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];

function parseRegions(campaign: Campaign): RegionCard[] {
  // Try parsing from region field as JSON array
  if (campaign.region) {
    try {
      const arr = JSON.parse(campaign.region);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch {}
  }
  // Legacy: single region
  if (campaign.country || campaign.region) {
    const tz = campaign.notes?.match(/\[timezone:(.+?)\]/)?.[1] || "";
    return [{ country: campaign.country || "", region: (campaign.region && !campaign.region.startsWith("[")) ? campaign.region : "", timezone: tz, messaging_note: "" }];
  }
  return [];
}

interface Props {
  campaign: Campaign;
}

export function CampaignMARTRegion({ campaign }: Props) {
  const { updateCampaign } = useCampaigns();
  const [regions, setRegions] = useState<RegionCard[]>(() => parseRegions(campaign));
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RegionCard>({ country: "", region: "", timezone: "", messaging_note: "" });
  const [saving, setSaving] = useState(false);

  const allTimezones = useMemo(() => {
    try { return (Intl as any).supportedValuesOf("timeZone") as string[]; } catch { return COMMON_TIMEZONES; }
  }, []);

  const openAdd = () => {
    setForm({ country: "", region: "", timezone: "", messaging_note: "" });
    setEditIndex(null);
    setFormOpen(true);
  };

  const openEdit = (i: number) => {
    setForm({ ...regions[i] });
    setEditIndex(i);
    setFormOpen(true);
  };

  const saveCard = () => {
    if (!form.country) return;
    const updated = [...regions];
    if (editIndex !== null) { updated[editIndex] = form; } else { updated.push(form); }
    setRegions(updated);
    setFormOpen(false);
    persistRegions(updated);
  };

  const deleteCard = (i: number) => {
    const updated = regions.filter((_, idx) => idx !== i);
    setRegions(updated);
    persistRegions(updated);
  };

  const persistRegions = (regs: RegionCard[]) => {
    setSaving(true);
    // Remove old timezone tag from notes
    let notes = campaign.notes || "";
    notes = notes.replace(/\[timezone:.+?\]\s*/g, "").trim();
    updateCampaign.mutate(
      { id: campaign.id, region: JSON.stringify(regs), country: regs[0]?.country || null, notes },
      { onSettled: () => setSaving(false) }
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" /> Region Targeting</CardTitle>
        <Button variant="outline" size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Region</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {regions.length === 0 && !formOpen && (
          <p className="text-sm text-muted-foreground">No regions defined yet. Add regions to specify geographic targeting.</p>
        )}

        {/* Region cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {regions.map((r, i) => (
            <div key={i} className="border border-border rounded-lg p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{r.country}{r.region ? ` — ${r.region}` : ""}</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteCard(i)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                </div>
              </div>
              {r.timezone && <p className="text-xs text-muted-foreground">{r.timezone.replace(/_/g, " ")}</p>}
              {r.messaging_note && <p className="text-xs text-muted-foreground italic mt-1">{r.messaging_note}</p>}
            </div>
          ))}
        </div>

        {/* Inline form */}
        {formOpen && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Country *</Label>
                <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="e.g. India" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Region / State</Label>
                <Input value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} placeholder="e.g. Maharashtra" className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Timezone</Label>
                <Select value={form.timezone} onValueChange={v => setForm({ ...form, timezone: v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {COMMON_TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>)}
                    <SelectItem value="__sep" disabled>──── All ────</SelectItem>
                    {allTimezones.filter(tz => !COMMON_TIMEZONES.includes(tz)).map(tz => <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Messaging Note</Label>
              <Textarea value={form.messaging_note} onChange={e => setForm({ ...form, messaging_note: e.target.value })} placeholder="Region-specific messaging variations..." rows={2} className="text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={saveCard} disabled={!form.country}>{editIndex !== null ? "Update" : "Add"}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
