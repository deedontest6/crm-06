import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, ChevronRight, ChevronDown, Users, Mail, Phone, Linkedin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { expandRegionsForDb } from "@/utils/countryRegionMapping";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  selectedRegions?: string[];
  existingAccountIds: string[];
  existingContactIds: string[];
  campaignAccounts: any[];
}

async function fetchAllContacts() {
  const batchSize = 1000;
  let allData: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, contact_name, email, position, company_name, phone_no, linkedin")
      .range(from, from + batchSize - 1);
    if (error) throw error;
    allData.push(...(data || []));
    if (!data || data.length < batchSize) break;
    from += batchSize;
  }
  return allData;
}

export function AddAccountsModal({ open, onOpenChange, campaignId, selectedRegions = [], existingAccountIds, existingContactIds, campaignAccounts }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  const { data: allAccounts = [] } = useQuery({
    queryKey: ["all-accounts", selectedRegions.join(",")],
    queryFn: async () => {
      let q = supabase.from("accounts").select("id, account_name, industry, region, country");
      if (selectedRegions.length > 0) q = q.in("region", expandRegionsForDb(selectedRegions));
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const { data: allContacts = [] } = useQuery({
    queryKey: ["all-contacts-paginated"],
    queryFn: fetchAllContacts,
    enabled: open,
  });

  const contactsByAccountName = useMemo(() => {
    const map: Record<string, typeof allContacts> = {};
    for (const c of allContacts) {
      if (c.company_name) {
        const key = c.company_name.toLowerCase();
        if (!map[key]) map[key] = [];
        map[key].push(c);
      }
    }
    return map;
  }, [allContacts]);

  const availableAccounts = useMemo(
    () => allAccounts.filter(
      (a) => !existingAccountIds.includes(a.id) && a.account_name.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [allAccounts, existingAccountIds, searchTerm]
  );

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleContact = (id: string) =>
    setSelectedContactIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleExpand = (id: string) =>
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const handleSelectAll = () => {
    if (selectedIds.length === availableAccounts.length) setSelectedIds([]);
    else setSelectedIds(availableAccounts.map((a) => a.id));
  };

  const reset = () => {
    setSearchTerm(""); setSelectedIds([]); setSelectedContactIds([]); setExpandedAccounts(new Set());
  };

  const handleAdd = async () => {
    if (selectedIds.length === 0) return;
    const accountInserts = selectedIds.map((account_id) => ({
      campaign_id: campaignId, account_id, created_by: user!.id, status: "Not Contacted",
    }));
    const { error } = await supabase.from("campaign_accounts").insert(accountInserts);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    if (selectedContactIds.length > 0) {
      const contactInserts = selectedContactIds
        .filter((cid) => !existingContactIds.includes(cid))
        .map((contact_id) => {
          const contact = allContacts.find((c) => c.id === contact_id);
          let accountId: string | null = null;
          if (contact?.company_name) {
            const matchedNew = allAccounts.find((a) => selectedIds.includes(a.id) && a.account_name.toLowerCase() === contact.company_name!.toLowerCase());
            const matchedExisting = campaignAccounts.find((ca: any) => ca.accounts?.account_name?.toLowerCase() === contact.company_name!.toLowerCase());
            accountId = matchedNew?.id || matchedExisting?.account_id || null;
          }
          return { campaign_id: campaignId, contact_id, account_id: accountId, created_by: user!.id, stage: "Not Contacted" as const };
        });
      if (contactInserts.length > 0) {
        const { error: cErr } = await supabase.from("campaign_contacts").insert(contactInserts);
        if (cErr) toast({ title: "Error adding contacts", description: cErr.message, variant: "destructive" });
      }
    }

    queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
    onOpenChange(false);
    reset();
    const cCount = selectedContactIds.filter((cid) => !existingContactIds.includes(cid)).length;
    toast({ title: `${selectedIds.length} account(s)${cCount > 0 ? ` and ${cCount} contact(s)` : ""} added` });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-[840px] max-h-[80vh] flex flex-col overflow-hidden p-4 gap-3">
        <DialogHeader className="space-y-0">
          <DialogTitle className="text-base">Add Accounts to Campaign</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search accounts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {availableAccounts.length > 0 && (
            <div
              className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/50"
              onClick={handleSelectAll}
            >
              <Checkbox checked={selectedIds.length === availableAccounts.length && availableAccounts.length > 0} />
              <span className="text-xs font-medium whitespace-nowrap">Select All ({availableAccounts.length})</span>
            </div>
          )}
          {(selectedIds.length > 0 || selectedContactIds.length > 0) && (
            <span className="text-xs text-muted-foreground ml-auto">
              {selectedIds.length} account{selectedIds.length !== 1 ? "s" : ""}
              {selectedContactIds.length > 0 && `, ${selectedContactIds.length} contact${selectedContactIds.length !== 1 ? "s" : ""}`}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 border rounded-md divide-y divide-border">
          {availableAccounts.map((account) => {
            const accountContacts = contactsByAccountName[account.account_name.toLowerCase()] || [];
            const isExpanded = expandedAccounts.has(account.id);
            const nonExisting = accountContacts.filter((c) => !existingContactIds.includes(c.id));
            return (
              <div key={account.id}>
                <div className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/50">
                  <button type="button" className="p-0.5 hover:bg-muted rounded flex-shrink-0" onClick={(e) => { e.stopPropagation(); toggleExpand(account.id); }}>
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  <div className="cursor-pointer flex items-center gap-2 flex-1 min-w-0" onClick={() => toggleSelect(account.id)}>
                    <Checkbox checked={selectedIds.includes(account.id)} />
                    <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 text-sm items-center">
                      <span className="font-medium truncate">{account.account_name}</span>
                      <span className="text-xs text-muted-foreground truncate">{account.industry || "—"}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {[account.region, account.country].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 flex-shrink-0">
                      <Users className="h-2.5 w-2.5 mr-1" />{accountContacts.length}
                    </Badge>
                  </div>
                </div>
                {isExpanded && (
                  <div className="pl-10 pr-2.5 pb-2 bg-muted/20">
                    {nonExisting.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-1.5">
                        {accountContacts.length === 0 ? "No contacts found" : "All contacts already in campaign"}
                      </p>
                    ) : nonExisting.map((contact) => (
                      <div key={contact.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 cursor-pointer" onClick={() => toggleContact(contact.id)}>
                        <Checkbox checked={selectedContactIds.includes(contact.id)} />
                        <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 text-xs items-center">
                          <span className="font-medium truncate">{contact.contact_name}</span>
                          <span className="text-muted-foreground truncate">{contact.position || "—"}</span>
                          <span className="text-muted-foreground truncate">{contact.email || "—"}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {contact.email && <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger><Mail className="h-3 w-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Has email</TooltipContent></Tooltip></TooltipProvider>}
                          {contact.phone_no && <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger><Phone className="h-3 w-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Has phone</TooltipContent></Tooltip></TooltipProvider>}
                          {contact.linkedin && <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger><Linkedin className="h-3 w-3 text-muted-foreground" /></TooltipTrigger><TooltipContent>Has LinkedIn</TooltipContent></Tooltip></TooltipProvider>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {availableAccounts.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No available accounts</p>}
        </div>
        <div className="flex items-center justify-end gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleAdd} disabled={selectedIds.length === 0}>
            Add {selectedIds.length > 0 ? selectedIds.length : ""} Account{selectedIds.length === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
