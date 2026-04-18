import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  forAccount: { id: string; name: string } | null;
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

export function AddContactsModal({ open, onOpenChange, campaignId, forAccount, existingContactIds, campaignAccounts }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const campaignAccountNames = campaignAccounts.map((ca: any) => ca.accounts?.account_name).filter(Boolean);

  const { data: allContacts = [] } = useQuery({
    queryKey: ["all-contacts-paginated"],
    queryFn: fetchAllContacts,
    enabled: open,
  });

  const availableContacts = useMemo(() => {
    return allContacts.filter((c) => {
      if (existingContactIds.includes(c.id)) return false;
      if (!c.contact_name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (forAccount) {
        return c.company_name && c.company_name.toLowerCase() === forAccount.name.toLowerCase();
      }
      if (campaignAccountNames.length > 0) {
        return c.company_name && campaignAccountNames.some((name: string) => name.toLowerCase() === c.company_name!.toLowerCase());
      }
      return true;
    });
  }, [allContacts, existingContactIds, searchTerm, forAccount, campaignAccountNames]);

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleSelectAll = () => {
    if (selectedIds.length === availableContacts.length) setSelectedIds([]);
    else setSelectedIds(availableContacts.map((c) => c.id));
  };

  const reset = () => { setSearchTerm(""); setSelectedIds([]); };

  const handleAdd = async () => {
    if (selectedIds.length === 0) return;
    const inserts = selectedIds.map((contact_id) => {
      const contact = allContacts.find((c) => c.id === contact_id);
      let accountId: string | null = null;
      if (contact?.company_name) {
        const matched = campaignAccounts.find((ca: any) => ca.accounts?.account_name?.toLowerCase() === contact.company_name!.toLowerCase());
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
              {contact.linkedin && (
                <span className="text-[10px] text-primary uppercase tracking-wide flex-shrink-0">in</span>
              )}
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
