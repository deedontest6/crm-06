import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Building2, Users, ChevronRight, ChevronDown, Linkedin, Globe, Search, ChevronsDownUp, ChevronsUpDown, Phone, Mail, MoreHorizontal, AlertCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { AddAccountsModal } from "./AddAccountsModal";
import { AddContactsModal } from "./AddContactsModal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { buildReachabilityData, exportReachabilityCSV, exportReachabilityPDF } from "./reachabilityReport";
import { isReachableEmail, isReachableLinkedIn, isReachablePhone, whyUnreachable, formatPhoneForDisplay } from "@/lib/email";
import { toast as sonnerToast } from "sonner";

type ChannelFilter = "all" | "Email" | "LinkedIn" | "Phone";

interface Props {
  campaignId: string;
  isCampaignEnded: boolean;
  selectedRegions?: string[];
  selectedCountries?: string[];
  focusMode?: "accounts" | "contacts";
  regionsMissing?: boolean;
}

const COLS = 6;

export function CampaignAudienceTable({ campaignId, isCampaignEnded, selectedRegions = [], selectedCountries = [], focusMode, regionsMissing = false }: Props) {
  const queryClient = useQueryClient();
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [addContactModalOpen, setAddContactModalOpen] = useState(false);
  const [addContactForAccount, setAddContactForAccount] = useState<{ id: string; name: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ type: "account" | "contact"; id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [exportScope, setExportScope] = useState<"filtered" | "all">("filtered");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState(false);

  // Lightweight fetch of the campaign's primary channel — used to flag contacts
  // unreachable on the campaign's preferred outreach method.
  const { data: campaignMeta } = useQuery({
    queryKey: ["campaign-primary-channel", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("primary_channel, campaign_name, enabled_channels")
        .eq("id", campaignId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const primaryChannel = (campaignMeta?.primary_channel || "").trim();
  const campaignName = (campaignMeta as any)?.campaign_name || "campaign";
  // Resolve enabled channels (legacy fallback to primary_channel; default to all 3)
  const enabledChannels = useMemo<string[]>(() => {
    const raw = (campaignMeta as any)?.enabled_channels as string[] | null | undefined;
    const norm = (v: string) => (v === "Call" ? "Phone" : v);
    if (raw && raw.length > 0) return raw.map(norm).filter((v) => ["Email", "Phone", "LinkedIn"].includes(v));
    if (primaryChannel) return [norm(primaryChannel)];
    return ["Email", "Phone", "LinkedIn"];
  }, [campaignMeta, primaryChannel]);
  const showEmail = enabledChannels.includes("Email");
  const showPhone = enabledChannels.includes("Phone");
  const showLinkedIn = enabledChannels.includes("LinkedIn");

  // Snap channel filter back to "all" if the chosen channel was disabled on the campaign.
  useEffect(() => {
    if (channelFilter === "all") return;
    const stillEnabled =
      (channelFilter === "Email" && showEmail) ||
      (channelFilter === "LinkedIn" && showLinkedIn) ||
      (channelFilter === "Phone" && showPhone);
    if (!stillEnabled) setChannelFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmail, showLinkedIn, showPhone]);

  const { data: campaignAccounts = [], isFetching: accountsFetching } = useQuery({
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

  const { data: campaignContacts = [], isFetching: contactsFetching } = useQuery({
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

  // B4: Scope realtime to ONLY contact/account ids actually in this campaign
  // so unrelated edits elsewhere don't churn this campaign's React Query cache.
  // Filters update whenever the underlying ID lists change.
  const accountIdFilter = useMemo(() => existingAccountIds.filter(Boolean).join(","), [existingAccountIds]);
  const contactIdFilter = useMemo(() => existingContactIds.filter(Boolean).join(","), [existingContactIds]);

  // C: Diff-toast — keep a snapshot of contact reachability so we can detect
  // when an edit elsewhere flips a contact from unreachable -> reachable on a
  // channel and surface a brief toast.
  const reachSnapshotRef = useRef<Map<string, { email: boolean; linkedin: boolean; phone: boolean; name: string }>>(new Map());

  // Realtime sync — scoped to this campaign's contact/account IDs.
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
      // B9: only mark "synced" on actual realtime events, not on every fetch.
      setLastSyncedAt(new Date());
      setSyncError(false);
    };

    const channel = supabase.channel(`campaign-audience-${campaignId}`);

    if (contactIdFilter) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contacts", filter: `id=in.(${contactIdFilter})` },
        invalidate,
      );
    }
    if (accountIdFilter) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts", filter: `id=in.(${accountIdFilter})` },
        invalidate,
      );
    }
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_contacts", filter: `campaign_id=eq.${campaignId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_accounts", filter: `campaign_id=eq.${campaignId}` }, invalidate)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, queryClient, contactIdFilter, accountIdFilter]);

  // B9: previously, lastSyncedAt was set on every fetch completion which made
  // the pill always read "just now". Now it's only updated on realtime events
  // (above) and on the very first successful load.
  useEffect(() => {
    if (!accountsFetching && !contactsFetching && !lastSyncedAt) {
      setLastSyncedAt(new Date());
    }
  }, [accountsFetching, contactsFetching, lastSyncedAt]);

  // C: detect channel-reachability flips after each contact data refresh.
  useEffect(() => {
    const next = new Map<string, { email: boolean; linkedin: boolean; phone: boolean; name: string }>();
    const accountPhoneById = new Map<string, string | null>();
    for (const ca of campaignAccounts as any[]) {
      accountPhoneById.set(ca.account_id, ca.accounts?.phone || null);
    }
    for (const cc of campaignContacts as any[]) {
      const c = cc.contacts || {};
      const acctPhone = cc.account_id ? accountPhoneById.get(cc.account_id) : null;
      next.set(cc.contact_id, {
        email: isReachableEmail(c.email),
        linkedin: isReachableLinkedIn(c.linkedin),
        phone: isReachablePhone(c.phone_no) || isReachablePhone(acctPhone),
        name: c.contact_name || "Contact",
      });
    }
    if (reachSnapshotRef.current.size > 0) {
      for (const [id, cur] of next.entries()) {
        const prev = reachSnapshotRef.current.get(id);
        if (!prev) continue;
        if (!prev.email && cur.email) sonnerToast(`${cur.name} is now reachable on Email`);
        if (!prev.linkedin && cur.linkedin) sonnerToast(`${cur.name} is now reachable on LinkedIn`);
        if (!prev.phone && cur.phone) sonnerToast(`${cur.name} is now reachable on Phone`);
      }
    }
    reachSnapshotRef.current = next;
  }, [campaignContacts, campaignAccounts]);

  const isSyncing = accountsFetching || contactsFetching;

  const handleExport = async (kind: "csv" | "pdf") => {
    const useFiltered = exportScope === "filtered";
    const data = buildReachabilityData({
      campaignAccounts,
      campaignContacts,
      primaryChannel,
      searchQuery: useFiltered ? searchQuery : "",
      channelFilter: useFiltered ? channelFilter : "all",
    });
    if (data.rows.length === 0) {
      toast({ title: "Nothing to export", description: "No contacts match the current filters." });
      return;
    }
    try {
      if (kind === "csv") {
        exportReachabilityCSV({ campaignName, primaryChannel, data, filteredView: useFiltered });
      } else {
        await exportReachabilityPDF({ campaignName, primaryChannel, data, filteredView: useFiltered });
      }
      toast({ title: "Export ready", description: `${kind.toUpperCase()} downloaded.` });
    } catch (err) {
      console.error("[reachability-export] failed", err);
      toast({ title: "Export failed", description: "Could not generate the report.", variant: "destructive" });
    }
  };

  const getContactsForAccount = (accountId: string) =>
    campaignContacts.filter((cc: any) => cc.account_id === accountId);

  const q = searchQuery.trim().toLowerCase();
  // Channel-reachability predicate (shared with the report builder).
  const ccReachable = (cc: any, channel: ChannelFilter) => {
    if (channel === "all") return true;
    const c = cc.contacts || {};
    const a = campaignAccounts.find((ca: any) => ca.account_id === cc.account_id)?.accounts;
    if (channel === "Email") return isReachableEmail(c.email);
    if (channel === "LinkedIn") return isReachableLinkedIn(c.linkedin);
    return isReachablePhone(c.phone_no) || isReachablePhone(a?.phone);
  };
  const matchContact = (cc: any) => {
    if (!ccReachable(cc, channelFilter)) return false;
    if (!q) return true;
    const c = cc.contacts || {};
    return [c.contact_name, c.email, c.position, c.industry, c.phone_no]
      .some((v: string | null) => v && v.toLowerCase().includes(q));
  };
  const matchAccount = (ca: any) => {
    // Account is shown only if at least one of its contacts passes (search + channel filter).
    const acctContacts = getContactsForAccount(ca.account_id);
    const anyContactPasses = acctContacts.some(matchContact);
    if (channelFilter !== "all") return anyContactPasses;
    if (!q) return true;
    const a = ca.accounts || {};
    if ([a.account_name, a.industry, a.region, a.country].some((v: string | null) => v && v.toLowerCase().includes(q))) return true;
    return anyContactPasses;
  };

  const filteredAccounts = useMemo(() => campaignAccounts.filter(matchAccount), [campaignAccounts, campaignContacts, q, channelFilter]);
  const unlinkedContacts = useMemo(
    () => campaignContacts.filter((cc: any) => !cc.account_id && matchContact(cc)),
    [campaignContacts, q, channelFilter],
  );

  // Auto-expand all matching accounts when searching or channel-filtering so
  // results aren't hidden inside collapsed rows.
  useEffect(() => {
    if (!q && channelFilter === "all") return;
    setExpandedAccounts(new Set(filteredAccounts.map((ca: any) => ca.account_id)));
  }, [q, channelFilter, filteredAccounts]);

  useEffect(() => {
    if (focusMode !== "contacts") return;
    setExpandedAccounts(new Set(filteredAccounts.map((ca: any) => ca.account_id)));
  }, [focusMode, filteredAccounts]);

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

  const ContactRow = ({ cc, indented = true }: { cc: any; indented?: boolean }) => {
    const orphan = !cc.contacts;
    const c = cc.contacts || {};
    const a = campaignAccounts.find((ca: any) => ca.account_id === cc.account_id)?.accounts;
    const phoneFromContact = isReachablePhone(c.phone_no);
    const phoneFromAccount = isReachablePhone(a?.phone);
    const phoneReachable = phoneFromContact || phoneFromAccount;
    const phoneSourceLabel = phoneFromContact ? "Phone from contact" : phoneFromAccount ? "Phone from account" : "";
    const emailReachable = isReachableEmail(c.email);
    const linkedInReachable = isReachableLinkedIn(c.linkedin);
    const primaryReachable =
      !primaryChannel ||
      (primaryChannel === "Email" && emailReachable) ||
      (primaryChannel === "LinkedIn" && linkedInReachable) ||
      ((primaryChannel === "Phone" || primaryChannel === "Call") && phoneReachable) ||
      // unknown / multi-channel campaigns — don't warn
      !["Email", "LinkedIn", "Phone", "Call"].includes(primaryChannel);
    if (orphan) {
      return (
        <TableRow className="hover:bg-muted/30">
          <TableCell className={indented ? "pl-10" : ""} colSpan={5}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive/70 shrink-0" />
              <span className="text-sm italic text-muted-foreground">Orphaned — contact deleted</span>
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Orphaned</Badge>
            </div>
          </TableCell>
          <TableCell>
            {!isCampaignEnded && (
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setRemoveConfirm({ type: "contact", id: cc.id, name: "this orphaned contact" })}>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
          </TableCell>
        </TableRow>
      );
    }
    // D: tooltips include WHY a channel is unreachable (matches CSV export hints).
    const emailMissingHint = emailReachable
      ? "Email available"
      : `No email — ${whyUnreachable("Email", { email: c.email })}.`;
    const linkedinMissingHint = linkedInReachable
      ? "LinkedIn available"
      : `No LinkedIn — ${whyUnreachable("LinkedIn", { linkedin: c.linkedin })}.`;
    const phoneMissingHint = phoneReachable
      ? phoneSourceLabel
      : `No phone — ${whyUnreachable("Phone", { phone: c.phone_no || a?.phone })}.`;
    // B11: when the contact has no own phone but the account does, show the
    // inherited phone in the contact's phone cell with an "(account)" suffix
    // so the column matches the green Phone-dot tooltip.
    const phoneCellDisplay = c.phone_no
      ? c.phone_no
      : (phoneFromAccount ? `${a?.phone} (account)` : "—");
    return (
      <TableRow className="hover:bg-muted/30">
        <TableCell className={indented ? "pl-10" : ""}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
            <span className="text-sm font-medium">{c.contact_name || "—"}</span>
            {!primaryReachable && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" aria-label="Not reachable on primary channel" />
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    Not reachable on the campaign's primary channel ({primaryChannel}).
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{c.position || "—"}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {c.email ? (
            <a href={`mailto:${c.email}`} className="hover:text-primary hover:underline">{c.email}</a>
          ) : "—"}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {phoneCellDisplay === "—" ? (
            "—"
          ) : c.phone_no ? (
            phoneCellDisplay
          ) : (
            <span title="Inherited from linked account">
              {a?.phone}{" "}
              <span className="text-[10px] text-muted-foreground/70">(account)</span>
            </span>
          )}
        </TableCell>
        <TableCell>
          {c.linkedin ? (
            <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline">
              <Linkedin className="h-4 w-4" />
            </a>
          ) : <span className="text-muted-foreground text-sm">—</span>}
        </TableCell>
        <TableCell>
          {!isCampaignEnded && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRemoveConfirm({ type: "contact", id: cc.id, name: c.contact_name || "this contact" })}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
        </TableCell>
      </TableRow>
    );
  };

  const totalAccounts = campaignAccounts.length;
  const totalContacts = campaignContacts.length;

  // B5: dedupe reachability counts so a contact linked to multiple
  // campaign_contacts rows (e.g. listed under 2 accounts) is only counted once.
  const reach = useMemo(() => {
    let email = 0, linkedin = 0, phone = 0;
    const seen = new Set<string>();
    for (const cc of campaignContacts as any[]) {
      if (!cc.contact_id || seen.has(cc.contact_id)) continue;
      seen.add(cc.contact_id);
      const c = cc.contacts || {};
      const acct = campaignAccounts.find((ca: any) => ca.account_id === cc.account_id)?.accounts;
      if (isReachableEmail(c.email)) email++;
      if (isReachableLinkedIn(c.linkedin)) linkedin++;
      if (isReachablePhone(c.phone_no) || isReachablePhone(acct?.phone)) phone++;
    }
    return { email, linkedin, phone };
  }, [campaignContacts, campaignAccounts]);

  return (
    <div className="space-y-3">
      {/* Toolbar — single tidy row */}
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search accounts & contacts…"
                className="h-8 w-64 pl-8 text-xs"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {focusMode && (
                <span className="text-foreground/80 font-medium">Focused on {focusMode} · </span>
              )}
              {totalAccounts} account{totalAccounts !== 1 ? "s" : ""} · {totalContacts} contact{totalContacts !== 1 ? "s" : ""}
              {regionsMissing && totalContacts > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">· no regions selected</span>
              )}
            </div>
            {totalContacts > 0 && (
              <ToggleGroup
                type="single"
                value={channelFilter}
                onValueChange={(v) => v && setChannelFilter(v as ChannelFilter)}
                size="sm"
                className="gap-0.5 rounded-md border bg-card p-0.5"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem value="all" className="h-7 px-2 text-[11px]">All</ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">All contacts</TooltipContent>
                </Tooltip>
                {showEmail && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem value="Email" className="h-7 px-2 text-[11px] gap-1 tabular-nums">
                        <Mail className="h-3 w-3" /> {reach.email}
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Email · {reach.email} reachable</TooltipContent>
                  </Tooltip>
                )}
                {showLinkedIn && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem value="LinkedIn" className="h-7 px-2 text-[11px] gap-1 tabular-nums">
                        <Linkedin className="h-3 w-3" /> {reach.linkedin}
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">LinkedIn · {reach.linkedin} reachable</TooltipContent>
                  </Tooltip>
                )}
                {showPhone && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ToggleGroupItem value="Phone" className="h-7 px-2 text-[11px] gap-1 tabular-nums">
                        <Phone className="h-3 w-3" /> {reach.phone}
                      </ToggleGroupItem>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Phone · {reach.phone} reachable</TooltipContent>
                  </Tooltip>
                )}
              </ToggleGroup>
            )}
          </div>
          <div className="flex items-center gap-1">
            {filteredAccounts.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={toggleExpandAll} aria-label={allExpanded ? "Collapse all" : "Expand all"}>
                    {allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">{allExpanded ? "Collapse all" : "Expand all"}</TooltipContent>
              </Tooltip>
            )}
            {(campaignContacts.length > 0 || campaignAccounts.length > 0) && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">More actions</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Export scope
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={(e) => { e.preventDefault(); setExportScope("filtered"); }}
                    className="gap-2"
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${exportScope === "filtered" ? "bg-primary" : "bg-muted-foreground/30"}`} />
                    Filtered view
                    {(searchQuery || channelFilter !== "all") && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {channelFilter === "all" ? "search" : channelFilter}
                      </span>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => { e.preventDefault(); setExportScope("all"); }}
                    className="gap-2"
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${exportScope === "all" ? "bg-primary" : "bg-muted-foreground/30"}`} />
                    All contacts
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("csv")} className="gap-2">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Reachability CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")} className="gap-2">
                    <FileText className="h-3.5 w-3.5" /> Reachability PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!isCampaignEnded && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-8 text-xs gap-1">
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem onClick={() => setAddAccountModalOpen(true)} className="gap-2">
                    <Building2 className="h-3.5 w-3.5" /> Add accounts
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => { setAddContactForAccount(null); setAddContactModalOpen(true); }}
                    className="gap-2"
                  >
                    <Users className="h-3.5 w-3.5" /> Add contacts
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </TooltipProvider>

      {/* Table */}
      {totalAccounts === 0 && totalContacts === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground space-y-2">
          <p>No accounts or contacts yet. Use the <span className="font-medium text-foreground">+ Add</span> button above to get started.</p>
          {regionsMissing && (
            <p className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3.5 w-3.5" />
              No regions selected — add modals will show every account/contact.
            </p>
          )}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-[24%]">Contact Name</TableHead>
                <TableHead className="w-[16%]">Title</TableHead>
                <TableHead className="w-[24%]">Email</TableHead>
                <TableHead className="w-[16%]">Phone</TableHead>
                <TableHead className="w-[10%]">LinkedIn</TableHead>
                <TableHead className="w-[10%]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.map((ca: any) => {
                const accountContacts = getContactsForAccount(ca.account_id);
                const isExpanded = expandedAccounts.has(ca.account_id);
                const a = ca.accounts || {};
                const locationParts = [a.region, a.country].filter(Boolean);
                const visibleContacts = accountContacts.filter(matchContact);
                // Aggregate reachability across this account's contacts
                const accReach = accountContacts.reduce(
                  (acc: { email: number; linkedin: number; phone: number }, cc: any) => {
                    const c = cc.contacts || {};
                    if (isReachableEmail(c.email)) acc.email++;
                    if (isReachableLinkedIn(c.linkedin)) acc.linkedin++;
                    if (isReachablePhone(c.phone_no) || isReachablePhone(a?.phone)) acc.phone++;
                    return acc;
                  },
                  { email: 0, linkedin: 0, phone: 0 }
                );
                return (
                  <Fragment key={ca.id}>
                    {/* Account banner row */}
                    <TableRow
                      className="bg-muted/40 hover:bg-muted/60 cursor-pointer border-l-2 border-l-primary/50"
                      onClick={() => toggleExpand(ca.account_id)}
                    >
                      <TableCell colSpan={COLS} className="py-2">
                        <TooltipProvider delayDuration={200}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {/* Line 1: name + meta + website */}
                              <div className="flex items-center gap-2 min-w-0">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <Building2 className="h-4 w-4 text-primary shrink-0" />
                                <span className="font-semibold text-sm truncate">{a.account_name || "—"}</span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {[a.industry, locationParts.join(" / ")].filter(Boolean).join(" · ") || "No industry"}
                                </span>
                                {a.website && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a
                                        href={a.website.startsWith("http") ? a.website : `https://${a.website}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-muted-foreground hover:text-primary shrink-0"
                                        aria-label="Website"
                                      >
                                        <Globe className="h-3.5 w-3.5" />
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">{a.website}</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              {/* Line 2: contact count + compact reach counters */}
                              <div className="flex items-center gap-3 mt-0.5 pl-10 text-[11px] text-muted-foreground tabular-nums">
                                <span>
                                  {accountContacts.length} contact{accountContacts.length !== 1 ? "s" : ""}
                                </span>
                                {accountContacts.length > 0 && (
                                  <>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1">
                                          <Mail className="h-3 w-3" /> {accReach.email}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="text-xs">
                                        {accReach.email}/{accountContacts.length} reachable on Email
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1">
                                          <Linkedin className="h-3 w-3" /> {accReach.linkedin}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="text-xs">
                                        {accReach.linkedin}/{accountContacts.length} have LinkedIn
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex items-center gap-1">
                                          <Phone className="h-3 w-3" /> {accReach.phone}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent className="text-xs">
                                        {accReach.phone}/{accountContacts.length} reachable on Phone
                                        {a.phone ? ` · account phone: ${a.phone}` : ""}
                                      </TooltipContent>
                                    </Tooltip>
                                  </>
                                )}
                              </div>
                            </div>
                            {!isCampaignEnded && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAddContactForAccount({ id: ca.account_id, name: a.account_name || "" });
                                        setAddContactModalOpen(true);
                                      }}
                                      aria-label="Add contact to this account"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">Add contact</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRemoveConfirm({ type: "account", id: ca.id, name: a.account_name || "this account" });
                                      }}
                                      aria-label="Remove account"
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">Remove from campaign</TooltipContent>
                                </Tooltip>
                              </div>
                            )}
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </TableRow>

                    {/* Contact rows */}
                    {isExpanded && (
                      visibleContacts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={COLS} className="pl-10 text-sm text-muted-foreground italic py-2">
                            No contacts from this account yet.
                            {!isCampaignEnded && (
                              <Button
                                variant="link"
                                size="sm"
                                className="ml-2 p-0 h-auto"
                                onClick={() => {
                                  setAddContactForAccount({ id: ca.account_id, name: a.account_name || "" });
                                  setAddContactModalOpen(true);
                                }}
                              >
                                Add contacts
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ) : (
                        visibleContacts.map((cc: any) => <ContactRow key={cc.id} cc={cc} />)
                      )
                    )}
                  </Fragment>
                );
              })}

              {unlinkedContacts.length > 0 && (
                <>
                  <TableRow className="bg-muted/40 border-l-2 border-l-muted-foreground/40">
                    <TableCell colSpan={COLS} className="py-2.5">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold text-sm">Unlinked Contacts</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                          {unlinkedContacts.length}
                        </Badge>
                        <span className="text-xs text-muted-foreground italic">— not linked to any campaign account</span>
                      </div>
                    </TableCell>
                  </TableRow>
                  {unlinkedContacts.map((cc: any) => <ContactRow key={cc.id} cc={cc} />)}
                </>
              )}

              {filteredAccounts.length === 0 && unlinkedContacts.length === 0 && q && (
                <TableRow>
                  <TableCell colSpan={COLS} className="text-center text-sm text-muted-foreground py-6">
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
        selectedCountries={selectedCountries}
        existingAccountIds={existingAccountIds}
        existingContactIds={existingContactIds}
        campaignAccounts={campaignAccounts}
        audienceChannelFilter={channelFilter}
      />

      <AddContactsModal
        open={addContactModalOpen}
        onOpenChange={(o) => { setAddContactModalOpen(o); if (!o) setAddContactForAccount(null); }}
        campaignId={campaignId}
        forAccount={addContactForAccount}
        existingContactIds={existingContactIds}
        campaignAccounts={campaignAccounts}
        selectedCountries={selectedCountries}
        audienceChannelFilter={channelFilter}
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
