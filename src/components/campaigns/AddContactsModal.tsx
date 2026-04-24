import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Mail, Linkedin, Phone } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

// F3: Normalize a company name for fuzzy matching — strips suffixes like
// ", HQ", ", Germany", "Inc.", "GmbH" and collapses whitespace/punctuation.
// Without this, contacts whose `company_name` differs by punctuation from
// `account_name` (e.g. "Eberspaecher, HQ" vs "Eberspaecher") silently fail
// to attach.
function normalizeCompany(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|company|hq|headquarters)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .join(" ");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  forAccount: { id: string; name: string } | null;
  existingContactIds: string[];
  campaignAccounts: any[];
  selectedCountries?: string[];
  /** Active channel filter on the parent Audience view — surfaced as a banner. */
  audienceChannelFilter?: "all" | "Email" | "LinkedIn" | "Phone";
}

async function fetchAllContacts(filterCompanyNames: string[] | null) {
  const batchSize = 1000;
  let allData: any[] = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from("contacts")
      .select("id, contact_name, email, position, company_name, phone_no, linkedin");
    if (filterCompanyNames && filterCompanyNames.length > 0) {
      q = q.in("company_name", filterCompanyNames);
    }
    const { data, error } = await q.range(from, from + batchSize - 1);
    if (error) throw error;
    allData.push(...(data || []));
    if (!data || data.length < batchSize) break;
    from += batchSize;
  }
  return allData;
}

export function AddContactsModal({ open, onOpenChange, campaignId, forAccount, existingContactIds, campaignAccounts, selectedCountries = [], audienceChannelFilter = "all" }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [channelFilter, setChannelFilter] = useState<"all" | "Email" | "LinkedIn" | "Phone">(audienceChannelFilter);
  // B12: keep chip in sync if Audience filter changes between opens.
  useEffect(() => { if (open) setChannelFilter(audienceChannelFilter); }, [open, audienceChannelFilter]);

  const campaignAccountNames = campaignAccounts.map((ca: any) => ca.accounts?.account_name).filter(Boolean);

  // Limit contacts to companies that are part of the campaign (the only sensible scope).
  // selectedCountries already filtered campaign accounts upstream, so this transitively respects countries.
  const filterCompanyNames = useMemo(() => {
    if (forAccount) return [forAccount.name];
    if (campaignAccountNames.length > 0) return campaignAccountNames;
    return null;
  }, [forAccount, campaignAccountNames.join("|")]);

  const { data: allContacts = [] } = useQuery({
    queryKey: ["campaign-eligible-contacts", filterCompanyNames?.join("|") || "all", selectedCountries.join(",")],
    queryFn: () => fetchAllContacts(filterCompanyNames),
    enabled: open,
  });

  const availableContacts = useMemo(() => {
    const accountNorm = forAccount ? normalizeCompany(forAccount.name) : "";
    const campaignNormSet = new Set(campaignAccountNames.map((n: string) => normalizeCompany(n)));
    return allContacts.filter((c) => {
      if (existingContactIds.includes(c.id)) return false;
      if (!c.contact_name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (channelFilter === "Email" && !c.email?.trim()) return false;
      if (channelFilter === "LinkedIn" && !c.linkedin?.trim()) return false;
      if (channelFilter === "Phone" && !c.phone_no?.trim()) return false;
      const contactNorm = normalizeCompany(c.company_name);
      if (forAccount) {
        return !!contactNorm && contactNorm === accountNorm;
      }
      if (campaignAccountNames.length > 0) {
        return !!contactNorm && campaignNormSet.has(contactNorm);
      }
      return true;
    });
  }, [allContacts, existingContactIds, searchTerm, forAccount, campaignAccountNames, channelFilter]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleSelectAll = () => {
    if (selectedIds.length === availableContacts.length) setSelectedIds([]);
    else setSelectedIds(availableContacts.map((c) => c.id));
  };

  const reset = () => { setSearchTerm(""); setSelectedIds([]); setChannelFilter("all"); };

  const handleAdd = async () => {
    if (selectedIds.length === 0) return;
    const inserts = selectedIds.map((contact_id) => {
      const contact = allContacts.find((c) => c.id === contact_id);
      let accountId: string | null = null;
      if (contact?.company_name) {
        const contactNorm = normalizeCompany(contact.company_name);
        const matched = campaignAccounts.find((ca: any) => normalizeCompany(ca.accounts?.account_name) === contactNorm);
        if (matched) accountId = matched.account_id;
      }
      return { campaign_id: campaignId, contact_id, account_id: accountId, created_by: user!.id, stage: "Not Contacted" };
    });
    const { error } = await supabase.from("campaign_contacts").insert(inserts);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
    onOpenChange(false);
    reset();
    toast({ title: `${inserts.length} contact(s) added` });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-[720px] max-h-[80vh] flex flex-col overflow-hidden p-4 gap-3">
        <DialogHeader className="space-y-0.5">
          <DialogTitle className="text-base">{forAccount ? `Add Contacts from ${forAccount.name}` : "Add Contacts to Campaign"}</DialogTitle>
          {!forAccount && campaignAccountNames.length > 0 && (
            <p className="text-xs text-muted-foreground">Showing contacts from campaign accounts</p>
          )}
        </DialogHeader>
        {audienceChannelFilter !== "all" && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            Audience is filtered to <span className="font-medium">{audienceChannelFilter}</span>-reachable contacts. The list below shows all contacts — use the channel toggle to narrow it.
          </div>
        )}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <ToggleGroup
            type="single"
            value={channelFilter}
            onValueChange={(v) => setChannelFilter((v as any) || "all")}
            size="sm"
            className="h-8"
          >
            <ToggleGroupItem value="all" className="h-7 px-2 text-[11px]">All</ToggleGroupItem>
            <ToggleGroupItem value="Email" className="h-7 px-2 text-[11px] gap-1" aria-label="Reachable via email">
              <Mail className="h-3 w-3" />
            </ToggleGroupItem>
            <ToggleGroupItem value="LinkedIn" className="h-7 px-2 text-[11px] gap-1" aria-label="Reachable on LinkedIn">
              <Linkedin className="h-3 w-3" />
            </ToggleGroupItem>
            <ToggleGroupItem value="Phone" className="h-7 px-2 text-[11px] gap-1" aria-label="Reachable via phone">
              <Phone className="h-3 w-3" />
            </ToggleGroupItem>
          </ToggleGroup>
          {availableContacts.length > 0 && (
            <div
              className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/50"
              onClick={handleSelectAll}
            >
              <Checkbox checked={selectedIds.length === availableContacts.length && availableContacts.length > 0} />
              <span className="text-xs font-medium whitespace-nowrap">Select All ({availableContacts.length})</span>
            </div>
          )}
          {selectedIds.length > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">{selectedIds.length} selected</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 border rounded-md divide-y divide-border">
          {availableContacts.map((contact) => (
            <div
              key={contact.id}
              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50 cursor-pointer"
              onClick={() => toggleSelect(contact.id)}
            >
              <Checkbox checked={selectedIds.includes(contact.id)} />
              <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 text-sm items-center">
                <span className="font-medium truncate">{contact.contact_name}</span>
                <span className="text-xs text-muted-foreground truncate">{contact.company_name || "—"}</span>
                <span className="text-xs text-muted-foreground truncate">{contact.email || "—"}</span>
              </div>
              <span className="inline-flex items-center gap-1 flex-shrink-0">
                <Mail className={`h-3 w-3 ${contact.email ? "text-primary" : "text-muted-foreground/40"}`} />
                <Linkedin className={`h-3 w-3 ${contact.linkedin ? "text-primary" : "text-muted-foreground/40"}`} />
                <Phone className={`h-3 w-3 ${contact.phone_no ? "text-primary" : "text-muted-foreground/40"}`} />
              </span>
            </div>
          ))}
          {availableContacts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              {forAccount ? `No contacts found for ${forAccount.name}` : campaignAccountNames.length === 0 ? "Add accounts first." : "No matching contacts found."}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleAdd} disabled={selectedIds.length === 0}>
            Add {selectedIds.length > 0 ? selectedIds.length : ""} Contact{selectedIds.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
