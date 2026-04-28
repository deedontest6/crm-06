import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Search, ChevronRight, ChevronDown, Users, Mail, Phone, Linkedin, Building2, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { isReachableEmail, isReachableLinkedIn, isReachablePhone } from "@/lib/email";
import { MultiSelectChips } from "./segments/MultiSelectChips";
import {
  fetchScopedAccounts,
  fetchScopedContactsForAccounts,
  type ScopedAccount,
  type ScopedContact,
} from "@/utils/campaignAudienceScope";

/**
 * Add Audience picker — shows the FULL scoped universe (regions/countries),
 * including accounts/contacts already in the campaign. Already-added rows are
 * pre-checked. Unchecking removes them; checking adds them. The visible totals
 * never shrink when records are added because they reflect scope, not delta.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  selectedRegions?: string[];
  selectedCountries?: string[];
  existingAccountIds: string[];
  existingContactIds: string[];
}

async function fetchSuppressedEmails(): Promise<Set<string>> {
  const set = new Set<string>();
  const batchSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("campaign_suppression_list")
      .select("email")
      .range(from, from + batchSize - 1);
    if (error) throw error;
    for (const r of data || []) {
      if (r.email) set.add(r.email.trim().toLowerCase());
    }
    if (!data || data.length < batchSize) break;
    from += batchSize;
  }
  return set;
}

export function AddAudienceModal({
  open, onOpenChange, campaignId,
  selectedRegions = [], selectedCountries = [],
  existingAccountIds, existingContactIds,
}: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [industryFilter, setIndustryFilter] = useState<string[]>([]);
  const [positionFilter, setPositionFilter] = useState<string[]>([]);
  // Selection state — these reflect the FINAL desired membership in the
  // campaign (not just additions). They are seeded from existing campaign
  // membership when the modal opens or when the existing IDs change.
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // ---- Data ----
  const { data: scopedAccounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["audience-modal-accounts", selectedRegions.join(","), selectedCountries.join(",")],
    queryFn: () => fetchScopedAccounts(selectedRegions, selectedCountries),
    enabled: open,
    staleTime: 0,
  });
  const { data: scopedContacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ["audience-modal-contacts", scopedAccounts.map((a) => a.id).sort().join(",")],
    queryFn: () => fetchScopedContactsForAccounts(scopedAccounts),
    enabled: open && scopedAccounts.length > 0,
    staleTime: 0,
  });
  const { data: suppressedEmails } = useQuery({
    queryKey: ["audience-modal-suppression"],
    queryFn: fetchSuppressedEmails,
    enabled: open,
    staleTime: 60_000,
  });

  // Seed selection from existing campaign membership whenever the modal opens
  // (or membership changes while open).
  const existingAccountKey = existingAccountIds.join(",");
  const existingContactKey = existingContactIds.join(",");
  useEffect(() => {
    if (!open) return;
    setSelectedAccountIds(new Set(existingAccountIds));
    setSelectedContactIds(new Set(existingContactIds));
    setExpanded(new Set());
    setSearchTerm("");
    setIndustryFilter([]);
    setPositionFilter([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existingAccountKey, existingContactKey]);

  // contact lookup by lowercase company name
  const contactsByAccountName = useMemo(() => {
    const map: Record<string, ScopedContact[]> = {};
    for (const c of scopedContacts) {
      if (!c.company_name) continue;
      const k = c.company_name.toLowerCase();
      (map[k] ||= []).push(c);
    }
    return map;
  }, [scopedContacts]);

  // unique industry / position lists for the filter pickers
  const industryOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of scopedAccounts) if (a.industry) s.add(a.industry);
    return Array.from(s).sort();
  }, [scopedAccounts]);
  const positionOptions = useMemo(() => {
    const s = new Set<string>();
    const namesLower = new Set(scopedAccounts.map((a) => a.account_name.toLowerCase()));
    for (const c of scopedContacts) {
      if (!c.position) continue;
      if (c.company_name && namesLower.has(c.company_name.toLowerCase())) {
        s.add(c.position);
      }
    }
    return Array.from(s).sort();
  }, [scopedAccounts, scopedContacts]);

  // filtered list (industry + position + search)
  const filteredAccounts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const indSet = industryFilter.length ? new Set(industryFilter.map((s) => s.toLowerCase())) : null;
    const posSet = positionFilter.length ? new Set(positionFilter.map((s) => s.toLowerCase())) : null;
    return scopedAccounts.filter((a) => {
      if (indSet && (!a.industry || !indSet.has(a.industry.toLowerCase()))) return false;
      if (posSet) {
        const contacts = contactsByAccountName[a.account_name.toLowerCase()] || [];
        const hasMatch = contacts.some((c) => c.position && posSet.has(c.position.toLowerCase()));
        if (!hasMatch) return false;
      }
      if (q && !a.account_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [scopedAccounts, contactsByAccountName, industryFilter, positionFilter, searchTerm]);

  // Eligible contacts for an account = scoped contacts under that account that
  // pass the active position filter and are not in the suppression list (only
  // suppression-block NEW additions; already-in-campaign contacts stay
  // selectable so users can uncheck them).
  const eligibleContactsFor = (accountName: string): ScopedContact[] => {
    const all = contactsByAccountName[accountName.toLowerCase()] || [];
    return all.filter((c) => {
      if (positionFilter.length > 0) {
        const lc = (c.position || "").toLowerCase();
        if (!positionFilter.some((p) => p.toLowerCase() === lc)) return false;
      }
      // Suppression: hide only if not already in campaign
      const already = existingContactIds.includes(c.id);
      if (!already && c.email && suppressedEmails?.has(c.email.trim().toLowerCase())) return false;
      return true;
    });
  };

  // ---- Selection toggles ----
  const toggleAccount = (a: ScopedAccount) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      const eligible = eligibleContactsFor(a.account_name);
      if (next.has(a.id)) {
        // Uncheck → also uncheck all of this account's contacts
        next.delete(a.id);
        setSelectedContactIds((cs) => {
          const m = new Set(cs);
          for (const c of eligible) m.delete(c.id);
          return m;
        });
      } else {
        next.add(a.id);
        // Checking an account auto-selects its eligible contacts
        setSelectedContactIds((cs) => {
          const m = new Set(cs);
          for (const c of eligible) m.add(c.id);
          return m;
        });
      }
      return next;
    });
  };

  const toggleContact = (a: ScopedAccount, contactId: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
    // Auto-select the parent account when first contact is picked.
    setSelectedAccountIds((s) => {
      if (s.has(a.id)) return s;
      const next = new Set(s); next.add(a.id); return next;
    });
  };

  const toggleIncludeAllContacts = (a: ScopedAccount, include: boolean) => {
    const eligible = eligibleContactsFor(a.account_name);
    setSelectedContactIds((cs) => {
      const m = new Set(cs);
      if (include) for (const c of eligible) m.add(c.id);
      else for (const c of eligible) m.delete(c.id);
      return m;
    });
    if (include) {
      setSelectedAccountIds((s) => {
        const next = new Set(s); next.add(a.id); return next;
      });
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Select all visible — toggles every filtered account + its eligible contacts.
  const handleSelectAllVisible = () => {
    const allVisibleSelected = filteredAccounts.length > 0 &&
      filteredAccounts.every((a) => selectedAccountIds.has(a.id));
    if (allVisibleSelected) {
      setSelectedAccountIds((prev) => {
        const next = new Set(prev);
        for (const a of filteredAccounts) next.delete(a.id);
        return next;
      });
      setSelectedContactIds((prev) => {
        const next = new Set(prev);
        for (const a of filteredAccounts) {
          for (const c of eligibleContactsFor(a.account_name)) next.delete(c.id);
        }
        return next;
      });
    } else {
      setSelectedAccountIds((prev) => {
        const next = new Set(prev);
        for (const a of filteredAccounts) next.add(a.id);
        return next;
      });
      setSelectedContactIds((prev) => {
        const next = new Set(prev);
        for (const a of filteredAccounts) {
          for (const c of eligibleContactsFor(a.account_name)) next.add(c.id);
        }
        return next;
      });
    }
  };

  // ---- Counts shown in footer ----
  const totalScopedAccounts = scopedAccounts.length;
  const totalScopedContacts = scopedContacts.length;
  const selectedAccountsCount = selectedAccountIds.size;
  const selectedContactsCount = selectedContactIds.size;
  const existingAccountSet = useMemo(() => new Set(existingAccountIds), [existingAccountKey]);
  const existingContactSet = useMemo(() => new Set(existingContactIds), [existingContactKey]);
  const accountsToAdd = [...selectedAccountIds].filter((id) => !existingAccountSet.has(id));
  const accountsToRemove = [...existingAccountSet].filter((id) => !selectedAccountIds.has(id));
  const contactsToAdd = [...selectedContactIds].filter((id) => !existingContactSet.has(id));
  const contactsToRemove = [...existingContactSet].filter((id) => !selectedContactIds.has(id));
  const hasChanges =
    accountsToAdd.length + accountsToRemove.length +
    contactsToAdd.length + contactsToRemove.length > 0;

  const handleApply = async () => {
    if (!user?.id || !hasChanges) return;
    setSubmitting(true);
    try {
      // Removals first (safe even if FK cascades exist).
      if (contactsToRemove.length > 0) {
        const { error } = await supabase
          .from("campaign_contacts")
          .delete()
          .eq("campaign_id", campaignId)
          .in("contact_id", contactsToRemove);
        if (error) throw error;
      }
      if (accountsToRemove.length > 0) {
        const { error } = await supabase
          .from("campaign_accounts")
          .delete()
          .eq("campaign_id", campaignId)
          .in("account_id", accountsToRemove);
        if (error) throw error;
      }

      // Additions
      if (accountsToAdd.length > 0) {
        const accountInserts = accountsToAdd.map((account_id) => ({
          campaign_id: campaignId, account_id, created_by: user.id, status: "Not Contacted",
        }));
        const { error } = await supabase.from("campaign_accounts").insert(accountInserts);
        if (error) throw error;
      }
      if (contactsToAdd.length > 0) {
        // Map contact -> its parent account id (when in scope).
        const accountIdByName = new Map<string, string>();
        for (const a of scopedAccounts) accountIdByName.set(a.account_name.toLowerCase(), a.id);
        const contactRows = contactsToAdd.map((cid) => {
          const c = scopedContacts.find((x) => x.id === cid);
          const accId = c?.company_name ? accountIdByName.get(c.company_name.toLowerCase()) || null : null;
          return {
            campaign_id: campaignId,
            contact_id: cid,
            account_id: accId,
            created_by: user.id,
            stage: "Not Contacted" as const,
          };
        });
        const { error } = await supabase.from("campaign_contacts").insert(contactRows);
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId, "detail"] });

      const parts: string[] = [];
      if (accountsToAdd.length) parts.push(`+${accountsToAdd.length} account${accountsToAdd.length === 1 ? "" : "s"}`);
      if (contactsToAdd.length) parts.push(`+${contactsToAdd.length} contact${contactsToAdd.length === 1 ? "" : "s"}`);
      if (accountsToRemove.length) parts.push(`−${accountsToRemove.length} account${accountsToRemove.length === 1 ? "" : "s"}`);
      if (contactsToRemove.length) parts.push(`−${contactsToRemove.length} contact${contactsToRemove.length === 1 ? "" : "s"}`);
      toast({ title: "Audience updated", description: parts.join(" · ") || "No changes" });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Couldn't update audience", description: err?.message || "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => onOpenChange(o)}>
      <DialogContent className="sm:max-w-[960px] max-h-[88vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="space-y-0 px-5 pt-5 pb-3 border-b pr-12">
          <DialogTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Manage Audience
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            Showing every account/contact in the selected scope. Already-added items are pre-checked. Uncheck to remove from the campaign.
          </p>
        </DialogHeader>

        <div className="px-5 pt-4 pb-3 flex-shrink-0 bg-muted/20 border-b">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="min-w-0">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Search
              </label>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search accounts..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
            <MultiSelectChips
              label="Industry"
              placeholder="Any industry"
              options={industryOptions}
              values={industryFilter}
              onChange={setIndustryFilter}
            />
            <MultiSelectChips
              label="Position"
              placeholder="Any position"
              options={positionOptions}
              values={positionFilter}
              onChange={setPositionFilter}
            />
          </div>
        </div>

        {/* Select-all + counts strip */}
        <div className="flex items-center gap-3 flex-shrink-0 text-xs px-5 py-2 border-b">
          {filteredAccounts.length > 0 ? (
            <div
              className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/50"
              onClick={handleSelectAllVisible}
            >
              <Checkbox
                checked={
                  filteredAccounts.length > 0 &&
                  filteredAccounts.every((a) => selectedAccountIds.has(a.id))
                }
              />
              <span className="font-medium whitespace-nowrap">
                Select all ({filteredAccounts.length})
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground px-2 py-1">No accounts to select</span>
          )}
          <span className="text-muted-foreground ml-auto tabular-nums">
            {totalScopedAccounts} account{totalScopedAccounts === 1 ? "" : "s"} · {totalScopedContacts} contact{totalScopedContacts === 1 ? "" : "s"} in scope ·{" "}
            <span className="font-medium text-foreground">
              {selectedAccountsCount} / {selectedContactsCount} selected
            </span>
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto min-h-0 mx-5 my-3 border rounded-md divide-y divide-border">
          {(accountsLoading || contactsLoading) && scopedAccounts.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="text-center py-8 space-y-1 text-xs text-muted-foreground">
              {scopedAccounts.length === 0
                ? "No accounts available in the selected region(s) / countries."
                : "No accounts match the current filters."}
            </div>
          ) : filteredAccounts.map((a) => {
            const isExpanded = expanded.has(a.id);
            const isAccountSelected = selectedAccountIds.has(a.id);
            const eligible = eligibleContactsFor(a.account_name);
            const allContactsChecked = eligible.length > 0 && eligible.every((c) => selectedContactIds.has(c.id));
            const isAlreadyInCampaign = existingAccountSet.has(a.id);
            return (
              <div key={a.id}>
                <div className="flex items-center gap-2 px-2.5 py-2 hover:bg-muted/40">
                  <button
                    type="button"
                    className="p-0.5 hover:bg-muted rounded flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); toggleExpand(a.id); }}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  <Checkbox
                    checked={isAccountSelected}
                    onCheckedChange={() => toggleAccount(a)}
                  />
                  <Building2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <div
                    className="flex-1 min-w-0 grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)] gap-3 text-sm items-center cursor-pointer"
                    onClick={() => toggleAccount(a)}
                  >
                    <span className="font-medium truncate flex items-center gap-1.5">
                      {a.account_name}
                      {isAlreadyInCampaign && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">In campaign</Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">{a.industry || "—"}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {[a.region, a.country].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 flex-shrink-0 gap-1">
                    <Users className="h-2.5 w-2.5" />{eligible.length}
                  </Badge>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5 pl-2 border-l ml-1">
                          <Switch
                            checked={allContactsChecked}
                            onCheckedChange={(v) => toggleIncludeAllContacts(a, v)}
                            disabled={eligible.length === 0}
                            aria-label="Include all contacts"
                          />
                          <span className="text-[11px] text-muted-foreground hidden sm:inline">All contacts</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        {eligible.length === 0
                          ? "No eligible contacts"
                          : "Toggle to include/exclude all of this account's contacts"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                {isExpanded && (
                  <div className="pl-12 pr-2.5 pb-2 bg-muted/20">
                    {eligible.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic py-1.5">
                        No eligible contacts (suppressed or position filter excludes them).
                      </p>
                    ) : eligible.map((c) => {
                      const isAlreadyContact = existingContactSet.has(c.id);
                      return (
                        <div
                          key={c.id}
                          className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 cursor-pointer"
                          onClick={() => toggleContact(a, c.id)}
                        >
                          <Checkbox checked={selectedContactIds.has(c.id)} />
                          <div className="flex-1 min-w-0 grid grid-cols-3 gap-2 text-xs items-center">
                            <span className="font-medium truncate flex items-center gap-1.5">
                              {c.contact_name || "—"}
                              {isAlreadyContact && (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">In campaign</Badge>
                              )}
                            </span>
                            <span className="text-muted-foreground truncate">{c.position || "—"}</span>
                            <span className="text-muted-foreground truncate">{c.email || "—"}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 text-muted-foreground">
                            {isReachableEmail(c.email) && <Mail className="h-3 w-3" />}
                            {isReachablePhone(c.phone_no) && <Phone className="h-3 w-3" />}
                            {isReachableLinkedIn(c.linkedin) && <Linkedin className="h-3 w-3" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 flex-shrink-0 px-5 py-3 border-t bg-muted/20">
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {hasChanges ? (
              <span>
                Changes:
                {accountsToAdd.length > 0 && <> +{accountsToAdd.length} acc</>}
                {contactsToAdd.length > 0 && <> +{contactsToAdd.length} con</>}
                {accountsToRemove.length > 0 && <> −{accountsToRemove.length} acc</>}
                {contactsToRemove.length > 0 && <> −{contactsToRemove.length} con</>}
              </span>
            ) : (
              <span>No changes</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply} disabled={!hasChanges || submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Apply changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
