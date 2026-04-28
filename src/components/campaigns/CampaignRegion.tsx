import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useState, useMemo, useEffect } from "react";
import { Globe, Plus, Pencil, Trash2, Building2, Users, MoreHorizontal } from "lucide-react";
import { regions, countries, countryToRegion, getCountriesForRegion, getFormattedTimezoneList, getTimezonesForCountry, getTimezoneLabel } from "@/utils/countryRegionMapping";
import { fetchScopedAccounts, fetchScopedContactsForAccounts } from "@/utils/campaignAudienceScope";
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
  // Pass enableLists:false — on the detail page we only need the mutation,
  // not the full campaigns list (which would re-fire the list waterfall).
  const { updateCampaign } = useCampaigns({ enableLists: false });
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
  const selectedCountryNames = useMemo(
    () => Array.from(new Set(regionCards.map(r => r.country).filter(Boolean))),
    [regionCards]
  );

  // Live counts of accounts/contacts in selected regions/countries — uses the
  // SAME scope helper as the Add Audience modal so the two views always agree.
  const { data: counts } = useQuery({
    queryKey: ["region-audience-counts", selectedRegionNames.join(","), selectedCountryNames.join(",")],
    queryFn: async () => {
      if (selectedRegionNames.length === 0 && selectedCountryNames.length === 0) {
        return { accounts: 0, contacts: 0 };
      }
      const accounts = await fetchScopedAccounts(selectedRegionNames, selectedCountryNames);
      const contacts = await fetchScopedContactsForAccounts(accounts);
      return { accounts: accounts.length, contacts: contacts.length };
    },
    enabled: selectedRegionNames.length > 0 || selectedCountryNames.length > 0,
    staleTime: 30_000,
    placeholderData: { accounts: 0, contacts: 0 },
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
    // Persist ALL distinct countries (comma-joined) to campaigns.country, not just the first.
    // Multiple region cards may share a region but target different countries — all need to be
    // discoverable for downstream filters and template region matching.
    const countryList = Array.from(
      new Set(regs.map(r => (r.country || "").trim()).filter(Boolean))
    ).join(", ");
    updateCampaign.mutate(
      { id: campaign.id, region: JSON.stringify(regs), country: countryList || null, notes: notes || null },
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
          <span><span className="font-medium text-foreground">{selectedRegionNames.length}</span> region{selectedRegionNames.length === 1 ? "" : "s"}</span>
          {(() => {
            const cc = regionCards.filter(r => r.country).length;
            return (
              <span>· <span className="font-medium text-foreground">{cc}</span> countr{cc === 1 ? "y" : "ies"}</span>
            );
          })()}
          {selectedRegionNames.length > 0 && (
            <>
              <span className="flex items-center gap-1">· <Building2 className="h-3 w-3" /><span className="font-medium text-foreground">{counts?.accounts ?? 0}</span> accounts</span>
              <span className="flex items-center gap-1">· <Users className="h-3 w-3" /><span className="font-medium text-foreground">{counts?.contacts ?? 0}</span> contacts</span>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {Object.entries(
          regionCards.reduce<Record<string, { card: RegionCard; index: number }[]>>((acc, card, idx) => {
            const key = card.region || "(no region)";
            (acc[key] ||= []).push({ card, index: idx });
            return acc;
          }, {})
        ).map(([regionName, group]) => (
          <div key={regionName} className="group/region border border-border rounded-md px-2.5 py-1.5">
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
              <div className="flex items-center gap-0.5 opacity-0 group-hover/region:opacity-100 transition-opacity shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Add country"
                  onClick={() => openAddCountryToRegion(regionName)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Delete region"
                  onClick={() => {
                    const updated = regionCards.filter(c => c.region !== regionName);
                    setRegionCards(updated);
                    persistRegions(updated);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="border-t border-border pt-2 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
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
