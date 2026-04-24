import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useState, useMemo, useEffect } from "react";
import { Globe, Plus, Pencil, Trash2, Building2, Users, MoreHorizontal } from "lucide-react";
import { regions, countries, countryToRegion, getCountriesForRegion, getFormattedTimezoneList, getTimezonesForCountry, getTimezoneLabel, expandRegionsForDb } from "@/utils/countryRegionMapping";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface RegionCard {
  country: string;
  region: string;
  timezone: string;
}

function parseRegions(campaign: Campaign): RegionCard[] {
  if (campaign.region) {
    try {
      const arr = JSON.parse(campaign.region);
      if (Array.isArray(arr) && arr.length > 0) {
        // Strip out legacy messaging_note field
        return arr.map((r: any) => ({ country: r.country || "", region: r.region || "", timezone: r.timezone || "" }));
      }
    } catch {}
  }
  if (campaign.country || campaign.region) {
    const tz = campaign.notes?.match(/\[timezone:(.+?)\]/)?.[1] || "";
    return [{ country: campaign.country || "", region: (campaign.region && !campaign.region.startsWith("[")) ? campaign.region : "", timezone: tz }];
  }
  return [];
}

interface Props {
  campaign: Campaign;
}

export function CampaignRegion({ campaign }: Props) {
  const { updateCampaign } = useCampaigns();
  const [regionCards, setRegionCards] = useState<RegionCard[]>(() => parseRegions(campaign));
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RegionCard>({ country: "", region: "", timezone: "" });
  const [saving, setSaving] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  useEffect(() => {
    setRegionCards(parseRegions(campaign));
  }, [campaign.region]);

  const selectedRegionNames = useMemo(
    () => Array.from(new Set(regionCards.map(r => r.region).filter(Boolean))),
    [regionCards]
  );

  // Live counts of accounts/contacts in selected regions
  const { data: counts } = useQuery({
    queryKey: ["region-audience-counts", selectedRegionNames.join(",")],
    queryFn: async () => {
      if (selectedRegionNames.length === 0) return { accounts: 0, contacts: 0 };
      const codes = expandRegionsForDb(selectedRegionNames);
      const [{ count: accountCount }, { data: regionAccounts }] = await Promise.all([
        supabase.from("accounts").select("id", { count: "exact", head: true }).in("region", codes),
        supabase.from("accounts").select("account_name").in("region", codes),
      ]);
      let contactCount = 0;
      if (regionAccounts && regionAccounts.length > 0) {
        const names = regionAccounts.map((a: any) => a.account_name).filter(Boolean);
        if (names.length > 0) {
          const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).in("company_name", names);
          contactCount = count || 0;
        }
      }
      return { accounts: accountCount || 0, contacts: contactCount };
    },
    enabled: selectedRegionNames.length > 0,
  });

  const filteredCountries = useMemo(() => {
    if (!form.region) return countries;
    return getCountriesForRegion(form.region);
  }, [form.region]);

  const filteredTimezones = useMemo(() => {
    if (form.country) return getTimezonesForCountry(form.country);
    return getFormattedTimezoneList();
  }, [form.country]);

  const openAdd = () => {
    setForm({ country: "", region: "", timezone: "" });
    setEditIndex(null);
    setFormOpen(true);
  };

  const openEdit = (i: number) => {
    setForm({ ...regionCards[i] });
    setEditIndex(i);
    setFormOpen(true);
  };

  const handleRegionChange = (value: string) => {
    const newForm = { ...form, region: value };
    if (form.country && countryToRegion[form.country] !== value) {
      newForm.country = "";
    }
    setForm(newForm);
  };

  const handleCountryChange = (value: string) => {
    const newForm = { ...form, country: value };
    const region = countryToRegion[value];
    if (region) {
      newForm.region = region;
    }
    const validTzs = getTimezonesForCountry(value);
    if (!newForm.timezone || !validTzs.some(tz => tz.value === newForm.timezone)) {
      newForm.timezone = validTzs.length === 1 ? validTzs[0].value : "";
    }
    setForm(newForm);
  };

  const saveCard = () => {
    if (!form.region) return;
    const updated = [...regionCards];
    if (editIndex !== null) {
      updated[editIndex] = form;
    } else {
      // Prevent duplicate (same region + country)
      const dup = updated.some(r => r.region === form.region && (r.country || "") === (form.country || ""));
      if (dup) {
        toast({ title: "Already added", description: `${form.region}${form.country ? ` — ${form.country}` : ""} is already in the list.`, variant: "destructive" });
        return;
      }
      updated.push(form);
    }
    setRegionCards(updated);
    setFormOpen(false);
    persistRegions(updated);
  };

  const openAddCountryToRegion = (regionName: string) => {
    setForm({ region: regionName, country: "", timezone: "" });
    setEditIndex(null);
    setFormOpen(true);
  };

  const confirmDeleteCard = (i: number) => {
    setDeleteIndex(i);
  };

  const handleDeleteConfirm = () => {
    if (deleteIndex === null) return;
    const updated = regionCards.filter((_, idx) => idx !== deleteIndex);
    setRegionCards(updated);
    persistRegions(updated);
    setDeleteIndex(null);
  };

  const persistRegions = (regs: RegionCard[]) => {
    setSaving(true);
    let notes = campaign.notes || "";
    notes = notes.replace(/\[timezone:.+?\]\s*/g, "").trim();
    updateCampaign.mutate(
      { id: campaign.id, region: JSON.stringify(regs), country: regs[0]?.country || null, notes },
      { onSettled: () => setSaving(false) }
    );
  };

  const getTimezoneDisplay = (tz: string) => {
    return getTimezoneLabel(tz);
  };

  return (
    <div className="space-y-2">
      {/* Unified toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <Globe className="h-3.5 w-3.5" />
          <span><span className="font-medium text-foreground">{regionCards.length === 0 ? 0 : selectedRegionNames.length}</span> region{selectedRegionNames.length === 1 ? "" : "s"}</span>
          <span>· <span className="font-medium text-foreground">{regionCards.length}</span> countr{regionCards.length === 1 ? "y" : "ies"}</span>
          {selectedRegionNames.length > 0 && (
            <>
              <span className="flex items-center gap-1">· <Building2 className="h-3 w-3" /><span className="font-medium text-foreground">{counts?.accounts ?? "…"}</span> accounts</span>
              <span className="flex items-center gap-1">· <Users className="h-3 w-3" /><span className="font-medium text-foreground">{counts?.contacts ?? "…"}</span> contacts</span>
            </>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" /> Add</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={openAdd}>Add region</DropdownMenuItem>
            {selectedRegionNames.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Add country to region…</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {selectedRegionNames.map(r => (
                      <DropdownMenuItem key={r} onClick={() => openAddCountryToRegion(r)}>{r}</DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {regionCards.length === 0 && !formOpen && (
        <p className="text-xs text-muted-foreground">No regions defined yet. Add regions to specify geographic targeting.</p>
      )}

      <div className="space-y-1.5">
        {Object.entries(
          regionCards.reduce<Record<string, { card: RegionCard; index: number }[]>>((acc, card, idx) => {
            const key = card.region || "(no region)";
            (acc[key] ||= []).push({ card, index: idx });
            return acc;
          }, {})
        ).map(([regionName, group]) => (
          <div key={regionName} className="border border-border rounded-md px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  {regionName}
                </div>
                {group.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {group.map(({ card, index }, i) => (
                      <span key={index} className="group inline-flex items-center gap-1">
                        {i > 0 && <span className="text-muted-foreground/50">·</span>}
                        <span className="text-foreground/90">{card.country || "—"}</span>
                        {card.timezone && <span>· {getTimezoneDisplay(card.timezone)}</span>}
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex">
                          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => openEdit(index)} title="Edit"><Pencil className="h-2.5 w-2.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => confirmDeleteCard(index)} title="Delete"><Trash2 className="h-2.5 w-2.5 text-muted-foreground" /></Button>
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openAddCountryToRegion(regionName)}>
                    <Plus className="h-3.5 w-3.5 mr-2" /> Add country
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      // delete all cards in this region
                      const updated = regionCards.filter(c => c.region !== regionName);
                      setRegionCards(updated);
                      persistRegions(updated);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete region
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="border border-border rounded-md p-2.5 space-y-2 bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Region *</Label>
              <Select value={form.region} onValueChange={handleRegionChange}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select region..." /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {regions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Country</Label>
              <Select value={form.country} onValueChange={handleCountryChange}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select country..." /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {filteredCountries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Timezone</Label>
              <Select value={form.timezone} onValueChange={v => setForm({ ...form, timezone: v })}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select timezone..." /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {filteredTimezones.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={saveCard} disabled={!form.region}>{editIndex !== null ? "Update" : "Add"}</Button>
          </div>
        </div>
      )}

      <AlertDialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this region?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteIndex !== null && regionCards[deleteIndex] && (
                <>Remove "{regionCards[deleteIndex].region}{regionCards[deleteIndex].country ? ` — ${regionCards[deleteIndex].country}` : ""}"? This cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
