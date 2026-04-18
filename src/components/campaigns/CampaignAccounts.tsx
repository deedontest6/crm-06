import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Trash2, Building2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate } from "react-router-dom";

interface Props {
  campaignId: string;
  isCampaignEnded: boolean;
}

const statusColors: Record<string, string> = {
  "Not Contacted": "bg-muted text-muted-foreground",
  "Contacted": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Responded": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  "Deal Created": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export function CampaignAccounts({ campaignId, isCampaignEnded }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; name: string } | null>(null);

  const { data: campaignAccounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("*, accounts(account_name, industry, region, country)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  // Contacts count per account
  const { data: campaignContacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("contact_id, account_id, stage")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const getContactsCount = (accountId: string) =>
    campaignContacts.filter((cc: any) => cc.account_id === accountId).length;

  // Derive account status from contacts
  const getDerivedStatus = (accountId: string) => {
    const contacts = campaignContacts.filter((cc: any) => cc.account_id === accountId);
    if (contacts.length === 0) return "Not Contacted";
    // Check deals for this account in this campaign
    if (contacts.some((c: any) => c.stage === "Qualified")) return "Deal Created";
    if (contacts.some((c: any) => c.stage === "Responded")) return "Responded";
    if (contacts.some((c: any) => c.stage !== "Not Contacted")) return "Contacted";
    return "Not Contacted";
  };

  const { data: allAccounts = [] } = useQuery({
    queryKey: ["all-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("id, account_name, industry, region, country");
      if (error) throw error;
      return data;
    },
    enabled: addModalOpen,
  });

  const existingAccountIds = campaignAccounts.map((ca: any) => ca.account_id);
  const availableAccounts = allAccounts.filter(
    (a) => !existingAccountIds.includes(a.id) && a.account_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectAll = () => {
    if (selectedAccountIds.length === availableAccounts.length) {
      setSelectedAccountIds([]);
    } else {
      setSelectedAccountIds(availableAccounts.map((a) => a.id));
    }
  };

  const handleAddAccounts = async () => {
    if (selectedAccountIds.length === 0) return;
    const inserts = selectedAccountIds.map((account_id) => ({
      campaign_id: campaignId,
      account_id,
      created_by: user!.id,
      status: "Not Contacted",
    }));
    const { error } = await supabase.from("campaign_accounts").insert(inserts);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    setAddModalOpen(false);
    setSelectedAccountIds([]);
    setSearchTerm("");
    toast({ title: `${selectedAccountIds.length} account(s) added` });
  };

  const confirmRemoveAccount = async () => {
    if (!removeConfirm) return;
    await supabase.from("campaign_accounts").delete().eq("id", removeConfirm.id);
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    setRemoveConfirm(null);
    toast({ title: "Account removed from campaign" });
  };

  const toggleSelect = (id: string) => {
    setSelectedAccountIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  // Filter
  const filtered = campaignAccounts.filter((ca: any) => {
    const derived = getDerivedStatus(ca.account_id);
    if (statusFilter !== "all" && derived !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Campaign Accounts ({campaignAccounts.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.keys(statusColors).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isCampaignEnded && (
              <Button size="sm" onClick={() => setAddModalOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Accounts</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                {campaignAccounts.length === 0 ? "No accounts added yet. Add accounts to start targeting them in this campaign." : "No accounts match the selected filter."}
              </p>
              {campaignAccounts.length === 0 && !isCampaignEnded && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add your first account
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Contacts in Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((ca: any) => {
                  const derived = getDerivedStatus(ca.account_id);
                  return (
                    <TableRow key={ca.id}>
                      <TableCell className="font-medium">{ca.accounts?.account_name || "—"}</TableCell>
                      <TableCell>{ca.accounts?.industry || "—"}</TableCell>
                      <TableCell>{getContactsCount(ca.account_id)}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[derived]} variant="secondary">{derived}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ca.created_at ? new Date(ca.created_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/accounts`)}>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          {!isCampaignEnded && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRemoveConfirm({ id: ca.id, name: ca.accounts?.account_name || "this account" })}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Remove Confirmation */}
      <AlertDialog open={!!removeConfirm} onOpenChange={(open) => !open && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {removeConfirm?.name} from this campaign? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveAccount}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Accounts Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Add Accounts to Campaign</DialogTitle></DialogHeader>
          <div className="relative mb-4 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search accounts..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
          {availableAccounts.length > 0 && (
            <div className="flex items-center gap-3 p-2 border-b border-border mb-1 cursor-pointer flex-shrink-0" onClick={handleSelectAll}>
              <Checkbox checked={selectedAccountIds.length === availableAccounts.length && availableAccounts.length > 0} />
              <span className="text-sm font-medium">Select All ({availableAccounts.length})</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {availableAccounts.map((account) => (
              <div key={account.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => toggleSelect(account.id)}>
                <Checkbox checked={selectedAccountIds.includes(account.id)} />
                <div>
                  <p className="text-sm font-medium">{account.account_name}</p>
                  <p className="text-xs text-muted-foreground">{[account.industry, account.region].filter(Boolean).join(" • ")}</p>
                </div>
              </div>
            ))}
            {availableAccounts.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No available accounts</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAddAccounts} disabled={selectedAccountIds.length === 0}>
              Add {selectedAccountIds.length} Account(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
