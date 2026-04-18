import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Building2, Users, ChevronRight, ChevronDown, Linkedin, Globe, Search, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { AddAccountsModal } from "./AddAccountsModal";
import { AddContactsModal } from "./AddContactsModal";

interface Props {
  campaignId: string;
  isCampaignEnded: boolean;
  selectedRegions?: string[];
}

export function CampaignAudienceTable({ campaignId, isCampaignEnded, selectedRegions = [] }: Props) {
  const queryClient = useQueryClient();
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [addContactModalOpen, setAddContactModalOpen] = useState(false);
  const [addContactForAccount, setAddContactForAccount] = useState<{ id: string; name: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ type: "account" | "contact"; id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: campaignAccounts = [] } = useQuery({
    queryKey: ["campaign-audience-accounts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("id, account_id, created_at, accounts(account_name, industry, region, country, website, phone)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: campaignContacts = [] } = useQuery({
    queryKey: ["campaign-audience-contacts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("id, contact_id, account_id, contacts(contact_name, email, position, linkedin, industry, phone_no)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const existingAccountIds = useMemo(() => campaignAccounts.map((ca: any) => ca.account_id), [campaignAccounts]);
  const existingContactIds = useMemo(() => campaignContacts.map((cc: any) => cc.contact_id), [campaignContacts]);

  // Realtime sync
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
    };

    const channel = supabase
      .channel(`campaign-audience-${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_contacts", filter: `campaign_id=eq.${campaignId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_accounts", filter: `campaign_id=eq.${campaignId}` }, invalidate)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, queryClient]);

  const getContactsForAccount = (accountId: string) =>
    campaignContacts.filter((cc: any) => cc.account_id === accountId);

  const q = searchQuery.trim().toLowerCase();
  const matchContact = (cc: any) => {
    if (!q) return true;
    const c = cc.contacts || {};
    return [c.contact_name, c.email, c.position, c.industry, c.phone_no]
      .some((v: string | null) => v && v.toLowerCase().includes(q));
  };
  const matchAccount = (ca: any) => {
    if (!q) return true;
    const a = ca.accounts || {};
    if ([a.account_name, a.industry, a.region, a.country].some((v: string | null) => v && v.toLowerCase().includes(q))) return true;
    // also keep account if any of its contacts match
    return getContactsForAccount(ca.account_id).some(matchContact);
  };

  const filteredAccounts = useMemo(() => campaignAccounts.filter(matchAccount), [campaignAccounts, campaignContacts, q]);
  const unlinkedContacts = useMemo(
    () => campaignContacts.filter((cc: any) => !cc.account_id && matchContact(cc)),
    [campaignContacts, q]
  );

  const allExpanded = filteredAccounts.length > 0 && filteredAccounts.every((ca: any) => expandedAccounts.has(ca.account_id));
  const toggleExpandAll = () => {
    if (allExpanded) setExpandedAccounts(new Set());
    else setExpandedAccounts(new Set(filteredAccounts.map((ca: any) => ca.account_id)));
  };

  const toggleExpand = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      return next;
    });
  };

  const confirmRemove = async () => {
    if (!removeConfirm) return;
    if (removeConfirm.type === "account") {
      await supabase.from("campaign_accounts").delete().eq("id", removeConfirm.id);
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
    } else {
      await supabase.from("campaign_contacts").delete().eq("id", removeConfirm.id);
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
    }
    setRemoveConfirm(null);
    toast({ title: `${removeConfirm.type === "account" ? "Account" : "Contact"} removed` });
  };

  const ContactRow = ({ cc }: { cc: any }) => (
    <TableRow className="bg-background/50">
      <TableCell className="pl-10 text-sm">
        <div>{cc.contacts?.contact_name || "—"}</div>
        {cc.contacts?.phone_no && (
          <div className="text-xs text-muted-foreground mt-0.5">{cc.contacts.phone_no}</div>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{cc.contacts?.industry || "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{cc.contacts?.position || "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{cc.contacts?.email || "—"}</TableCell>
      <TableCell>
        {cc.contacts?.linkedin ? (
          <a href={cc.contacts.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            <Linkedin className="h-4 w-4" />
          </a>
        ) : <span className="text-muted-foreground text-sm">—</span>}
      </TableCell>
      <TableCell>
        {!isCampaignEnded && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRemoveConfirm({ type: "contact", id: cc.id, name: cc.contacts?.contact_name || "this contact" })}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );

  const totalAccounts = campaignAccounts.length;
  const totalContacts = campaignContacts.length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs text-muted-foreground">
            {totalAccounts} account{totalAccounts !== 1 ? "s" : ""} · {totalContacts} contact{totalContacts !== 1 ? "s" : ""}
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search accounts & contacts…"
              className="h-8 w-64 pl-8 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {filteredAccounts.length > 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={toggleExpandAll}>
              {allExpanded ? <ChevronsDownUp className="h-3.5 w-3.5 mr-1" /> : <ChevronsUpDown className="h-3.5 w-3.5 mr-1" />}
              {allExpanded ? "Collapse all" : "Expand all"}
            </Button>
          )}
          {!isCampaignEnded && (
            <>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setAddAccountModalOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Accounts
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => { setAddContactForAccount(null); setAddContactModalOpen(true); }}>
                <Plus className="h-3 w-3 mr-1" /> Contacts
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      {totalAccounts === 0 && totalContacts === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
          No accounts or contacts yet. Use the buttons above to add some.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>LinkedIn</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.map((ca: any) => {
                const accountContacts = getContactsForAccount(ca.account_id);
                const isExpanded = expandedAccounts.has(ca.account_id);
                const a = ca.accounts || {};
                const metaParts = [a.region, a.country].filter(Boolean);
                return (
                  <Collapsible key={ca.id} open={isExpanded} onOpenChange={() => toggleExpand(ca.account_id)} asChild>
                    <>
                      <CollapsibleTrigger asChild>
                        <TableRow className="cursor-pointer hover:bg-muted/50 bg-muted/20">
                          <TableCell className="font-semibold">
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span>{a.account_name || "—"}</span>
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                                {accountContacts.length} contact{accountContacts.length !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{a.industry || "—"}</TableCell>
                          <TableCell colSpan={3} className="text-sm text-muted-foreground">
                            <div className="flex items-center gap-2 flex-wrap">
                              {metaParts.length > 0 && <span>{metaParts.join(" · ")}</span>}
                              {a.phone && <span className="text-xs">📞 {a.phone}</span>}
                              {a.website && (
                                <a
                                  href={a.website.startsWith("http") ? a.website : `https://${a.website}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center text-primary hover:underline"
                                  title={a.website}
                                >
                                  <Globe className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {metaParts.length === 0 && !a.phone && !a.website && <span>—</span>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {!isCampaignEnded && (
                                <>
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => {
                                    e.stopPropagation();
                                    setAddContactForAccount({ id: ca.account_id, name: a.account_name || "" });
                                    setAddContactModalOpen(true);
                                  }}>
                                    <Plus className="h-3 w-3 mr-1" /> Contacts
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                                    e.stopPropagation();
                                    setRemoveConfirm({ type: "account", id: ca.id, name: a.account_name || "this account" });
                                  }}>
                                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </CollapsibleTrigger>
                      <CollapsibleContent asChild>
                        <>
                          {accountContacts.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="pl-10 text-sm text-muted-foreground italic py-2">
                                No contacts from this account yet.
                                {!isCampaignEnded && (
                                  <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => {
                                    setAddContactForAccount({ id: ca.account_id, name: a.account_name || "" });
                                    setAddContactModalOpen(true);
                                  }}>Add contacts</Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ) : accountContacts.filter(matchContact).map((cc: any) => <ContactRow key={cc.id} cc={cc} />)}
                        </>
                      </CollapsibleContent>
                    </>
                  </Collapsible>
                );
              })}

              {unlinkedContacts.length > 0 && (
                <>
                  <TableRow className="bg-muted/10">
                    <TableCell colSpan={6} className="text-sm font-medium text-muted-foreground py-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" /> Unlinked Contacts ({unlinkedContacts.length})
                        <span className="text-xs font-normal italic">— not linked to any campaign account</span>
                      </div>
                    </TableCell>
                  </TableRow>
                  {unlinkedContacts.map((cc: any) => <ContactRow key={cc.id} cc={cc} />)}
                </>
              )}

              {filteredAccounts.length === 0 && unlinkedContacts.length === 0 && q && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                    No matches for "{searchQuery}".
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AddAccountsModal
        open={addAccountModalOpen}
        onOpenChange={setAddAccountModalOpen}
        campaignId={campaignId}
        selectedRegions={selectedRegions}
        existingAccountIds={existingAccountIds}
        existingContactIds={existingContactIds}
        campaignAccounts={campaignAccounts}
      />

      <AddContactsModal
        open={addContactModalOpen}
        onOpenChange={(o) => { setAddContactModalOpen(o); if (!o) setAddContactForAccount(null); }}
        campaignId={campaignId}
        forAccount={addContactForAccount}
        existingContactIds={existingContactIds}
        campaignAccounts={campaignAccounts}
      />

      <AlertDialog open={!!removeConfirm} onOpenChange={(open) => !open && setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeConfirm?.type === "account" ? "Account" : "Contact"}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {removeConfirm?.name} from this campaign? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
