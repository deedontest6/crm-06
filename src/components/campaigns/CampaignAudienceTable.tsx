import { useState, useMemo, useEffect, useRef, Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Building2, Users, ChevronRight, ChevronDown, Linkedin, Globe, Search, ChevronsDownUp, ChevronsUpDown, Phone, Mail, MoreHorizontal, AlertCircle, ThumbsUp, ThumbsDown, RotateCcw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { AddAudienceModal } from "./AddAudienceModal";
import { VirtualizedAudienceTable } from "./VirtualizedAudienceTable";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { buildReachabilityData, exportReachabilityCSV, exportReachabilityPDF } from "./reachabilityReport";
import { isReachableEmail, isReachableLinkedIn, isReachablePhone, whyUnreachable, formatPhoneForDisplay } from "@/lib/email";
import { CONTACT_STAGE_BADGE, DISPOSITION_BADGE } from "@/utils/campaignStatus";
// Audience filter shape — previously imported from the deleted
// AudienceFilterBar. Kept here so the table's internal narrowing logic
// (used by external embedders) compiles unchanged. The Setup screen no
// longer passes this prop, so the filter is effectively a no-op there.
type AudienceFilter = {
  accountIds: string[];
  contactIds: string[];
  industries: string[];
  positions: string[];
};

type ChannelFilter = "all" | "Email" | "LinkedIn" | "Phone";

interface Props {
  campaignId: string;
  isCampaignEnded: boolean;
  selectedRegions?: string[];
  selectedCountries?: string[];
  focusMode?: "accounts" | "contacts";
  regionsMissing?: boolean;
  /**
   * "setup" hides outreach-progress fields (stage, disposition, ★ engagement score,
   * disposition menu, reachability flip toasts) so the Setup tab stays focused on
   * "who is in this campaign". "monitoring" (default) shows everything.
   */
  mode?: "setup" | "monitoring";
  /**
   * Optional inline audience filter (Account / Contact / Industry / Position).
   * When provided, accounts and contacts are narrowed before search/channel
   * filtering is applied.
   */
  audienceFilter?: AudienceFilter;
  /**
   * Optional slot rendered between the toolbar and the table.
   * Used by Setup mode to drop the AudienceFilterBar in the right position
   * without making the table own the filter state.
   */
  audienceFilterSlot?: ReactNode;
  /**
   * Whether any audience filter (besides search/channel) is active. Used to
   * show a smarter "no matches" empty state ("Clear filters" CTA).
   */
  hasActiveAudienceFilter?: boolean;
  /** Called when the user clicks "Clear filters" in the empty state. */
  onClearAudienceFilter?: () => void;
}

// COLS is now derived dynamically inside the component (depends on enabled channels).

export function CampaignAudienceTable({ campaignId, isCampaignEnded, selectedRegions = [], selectedCountries = [], focusMode, regionsMissing = false, mode = "monitoring", audienceFilter, audienceFilterSlot, hasActiveAudienceFilter = false, onClearAudienceFilter }: Props) {
  const isSetupMode = mode === "setup";
  const queryClient = useQueryClient();
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [addAudienceOpen, setAddAudienceOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{ type: "account" | "contact"; id: string; name: string } | null>(null);
  const [bulkRemoveConfirm, setBulkRemoveConfirm] = useState<null | { kind: "accounts" | "contacts"; count: number; alsoContacts?: number }>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [exportScope, setExportScope] = useState<"filtered" | "all">("filtered");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState(false);
  // Bulk selection — separate sets so removing accounts doesn't affect contact selection.
  const [selectedAccountRowIds, setSelectedAccountRowIds] = useState<Set<string>>(new Set());
  const [selectedContactRowIds, setSelectedContactRowIds] = useState<Set<string>>(new Set());

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

  // Dynamic column count for the contacts table:
  //   Select + Contact name + Position (always) + Email/Phone/LinkedIn (only when enabled) + Actions.
  const COLS = 4 + (showEmail ? 1 : 0) + (showPhone ? 1 : 0) + (showLinkedIn ? 1 : 0);

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
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const { data: campaignContacts = [], isFetching: contactsFetching } = useQuery({
    queryKey: ["campaign-audience-contacts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("id, contact_id, account_id, stage, disposition, engagement_score, attempt_count, last_activity_at, contacts(contact_name, email, position, linkedin, industry, phone_no)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
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
    // D6: debounce realtime invalidations (2s) so bulk imports / sends don't
    // cause a refetch storm. The IDs are already scoped per-campaign so the
    // event volume is small, but we still coalesce bursts.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Invalidate BOTH the table's own queries and the parent CampaignDetail
        // queries so the header counts ("N accounts · N contacts") stay in sync
        // with the table body. Forgetting either set causes header/table drift.
        queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
        queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
        queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId, "detail"] });
        queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId, "detail"] });
        // B9: only mark "synced" on actual realtime events, not on every fetch.
        setLastSyncedAt(new Date());
        setSyncError(false);
        timer = null;
      }, 2000);
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
      if (timer) clearTimeout(timer);
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
  // Skipped in setup mode — flip toasts are an outreach-monitoring concern.
  useEffect(() => {
    if (isSetupMode) return;
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
        if (!prev.email && cur.email) toast({ title: `${cur.name} is now reachable on Email` });
        if (!prev.linkedin && cur.linkedin) toast({ title: `${cur.name} is now reachable on LinkedIn` });
        if (!prev.phone && cur.phone) toast({ title: `${cur.name} is now reachable on Phone` });
      }
    }
    reachSnapshotRef.current = next;
  }, [campaignContacts, campaignAccounts, isSetupMode]);

  const isSyncing = accountsFetching || contactsFetching;

  const handleExport = async (kind: "csv" | "pdf") => {
    const useFiltered = exportScope === "filtered";
    const data = buildReachabilityData({
      campaignAccounts,
      campaignContacts,
      primaryChannel,
      searchQuery: useFiltered ? searchQuery : "",
      channelFilter: useFiltered ? channelFilter : "all",
      enabledChannels,
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
  // Inline audience filter (Account / Contact / Industry / Position).
  const af = audienceFilter;
  const ciNorm = (v: any) => (v == null ? "" : String(v).toLowerCase());
  const ciEqAny = (v: any, list?: string[]) =>
    !list || list.length === 0 || (v && list.some((x) => ciNorm(x) === ciNorm(v)));
  const ciIncludesAny = (v: any, list?: string[]) =>
    !list || list.length === 0 || (v && list.some((x) => ciNorm(v).includes(ciNorm(x))));

  const passesAudienceFilter = (cc: any) => {
    const c: any = cc.contacts || {};
    const a: any = campaignAccounts.find((ca: any) => ca.account_id === cc.account_id)?.accounts || {};
    if (!af) return true;
    if (af.accountIds.length > 0 && !af.accountIds.includes(cc.account_id)) return false;
    if (af.contactIds.length > 0 && !af.contactIds.includes(cc.contact_id)) return false;
    const industry = c.industry || a.industry;
    if (!ciEqAny(industry, af.industries)) return false;
    if (af.positions.length > 0 && !ciIncludesAny(c.position, af.positions)) return false;
    return true;
  };

  const matchContact = (cc: any) => {
    if (!ccReachable(cc, channelFilter)) return false;
    if (!passesAudienceFilter(cc)) return false;
    if (!q) return true;
    const c = cc.contacts || {};
    return [c.contact_name, c.email, c.position, c.industry, c.phone_no]
      .some((v: string | null) => v && v.toLowerCase().includes(q));
  };
  const matchAccount = (ca: any) => {
    const acctContacts = getContactsForAccount(ca.account_id);
    const anyContactPasses = acctContacts.some(matchContact);
    // If any audience filter or channel filter is active, an account row only
    // shows when at least one of its contacts passes — this keeps the table
    // honest with the result count and avoids ghost rows.
    const audienceActive = !!af && (af.accountIds.length > 0 || af.contactIds.length > 0 || af.industries.length > 0 || af.positions.length > 0);
    if (audienceActive) return anyContactPasses;
    if (channelFilter !== "all") return anyContactPasses;
    if (!q) return true;
    const a = ca.accounts || {};
    if ([a.account_name, a.industry, a.region, a.country].some((v: string | null) => v && v.toLowerCase().includes(q))) return true;
    return anyContactPasses;
  };

  const filteredAccounts = useMemo(() => campaignAccounts.filter(matchAccount), [campaignAccounts, campaignContacts, q, channelFilter, audienceFilter]);
  const unlinkedContacts = useMemo(
    () => campaignContacts.filter((cc: any) => !cc.account_id && matchContact(cc)),
    [campaignContacts, q, channelFilter, audienceFilter],
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
    } else {
      await supabase.from("campaign_contacts").delete().eq("id", removeConfirm.id);
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId, "detail"] });
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId, "detail"] });
    setRemoveConfirm(null);
    toast({ title: `${removeConfirm.type === "account" ? "Account" : "Contact"} removed` });
  };

  // -------- Bulk selection helpers --------
  const toggleAccountSelected = (id: string) => {
    setSelectedAccountRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleContactSelected = (id: string) => {
    setSelectedContactRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedAccountRowIds(new Set());
    setSelectedContactRowIds(new Set());
  };
  const performBulkRemove = async (alsoContacts: boolean) => {
    const accountRowIds = Array.from(selectedAccountRowIds);
    const contactRowIds = new Set(selectedContactRowIds);
    // Optionally cascade: remove all contacts under the selected accounts.
    if (alsoContacts && accountRowIds.length > 0) {
      const accountIds = new Set(
        (campaignAccounts as any[])
          .filter((ca: any) => accountRowIds.includes(ca.id))
          .map((ca: any) => ca.account_id),
      );
      for (const cc of campaignContacts as any[]) {
        if (cc.account_id && accountIds.has(cc.account_id)) contactRowIds.add(cc.id);
      }
    }
    try {
      if (contactRowIds.size > 0) {
        const { error } = await supabase
          .from("campaign_contacts")
          .delete()
          .in("id", Array.from(contactRowIds));
        if (error) throw error;
      }
      if (accountRowIds.length > 0) {
        const { error } = await supabase
          .from("campaign_accounts")
          .delete()
          .in("id", accountRowIds);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-accounts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId, "detail"] });
      toast({
        title: "Removed from campaign",
        description: `${accountRowIds.length} account(s), ${contactRowIds.size} contact(s)`,
      });
      clearSelection();
      setBulkRemoveConfirm(null);
    } catch (err: any) {
      toast({ title: "Bulk remove failed", description: err?.message || "Try again.", variant: "destructive" });
    }
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
        <TableRow className="hover:bg-muted/30 [&>td]:py-1.5 [&>td]:px-3" data-state={selectedContactRowIds.has(cc.id) ? "selected" : undefined}>
          <TableCell className={indented ? "pl-10 w-[36px]" : "w-[36px]"}>
            {!isCampaignEnded && (
              <Checkbox
                checked={selectedContactRowIds.has(cc.id)}
                onCheckedChange={() => toggleContactSelected(cc.id)}
                aria-label="Select orphaned contact"
              />
            )}
          </TableCell>
          <TableCell colSpan={Math.max(1, COLS - 2)}>
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
    const stage = cc.stage || "Not Contacted";
    const disposition = cc.disposition as ("Interested" | "Not Interested" | null | undefined);
    const score = Number(cc.engagement_score || 0);
    const scoreTone =
      score >= 8 ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
      : score >= 4 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      : score >= 1 ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    const scoreTooltip = score >= 8 ? "Hot lead" : score >= 4 ? "Warm" : score >= 1 ? "Engaged" : "Cold";

    const setDisposition = async (next: "Interested" | "Not Interested" | null) => {
      const { error } = await supabase
        .from("campaign_contacts")
        .update({ disposition: next })
        .eq("id", cc.id);
      if (error) {
        toast({ title: "Couldn't update disposition", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: next ? `Marked ${next}` : "Disposition cleared" });
      queryClient.invalidateQueries({ queryKey: ["campaign-audience-contacts", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    };
    return (
      <TableRow className="hover:bg-muted/30 [&>td]:py-1.5 [&>td]:px-3" data-state={selectedContactRowIds.has(cc.id) ? "selected" : undefined}>
        <TableCell className={indented ? "pl-10 w-[36px]" : "w-[36px]"}>
          {!isCampaignEnded && (
            <Checkbox
              checked={selectedContactRowIds.has(cc.id)}
              onCheckedChange={() => toggleContactSelected(cc.id)}
              aria-label={`Select ${c.contact_name || "contact"}`}
            />
          )}
        </TableCell>
        <TableCell>
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
            {!isSetupMode && (
              <>
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-1.5 py-0 font-normal border-transparent ${CONTACT_STAGE_BADGE[stage] || ""}`}
                >
                  {stage}
                </Badge>
                {disposition && (
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 py-0 font-normal border-transparent ${DISPOSITION_BADGE[disposition] || ""}`}
                  >
                    {disposition}
                  </Badge>
                )}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 font-normal border-transparent ${scoreTone}`}
                      >
                        ★ {score}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      Engagement score: {score} · {scoreTooltip}
                      {cc.attempt_count ? ` · ${cc.attempt_count} touch${cc.attempt_count === 1 ? "" : "es"}` : ""}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{c.position || "—"}</TableCell>
        {showEmail && (
          <TableCell className="text-sm text-muted-foreground">
            {c.email ? (
              <a href={`mailto:${c.email}`} className="hover:text-primary hover:underline">{c.email}</a>
            ) : "—"}
          </TableCell>
        )}
        {showPhone && (
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
        )}
        {showLinkedIn && (
          <TableCell>
            {c.linkedin ? (
              <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline">
                <Linkedin className="h-4 w-4" />
              </a>
            ) : <span className="text-muted-foreground text-sm">—</span>}
          </TableCell>
        )}
        <TableCell>
          {!isCampaignEnded && (
            <div className="flex items-center justify-end gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Contact actions">
                    <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  {!isSetupMode && (
                    <>
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Disposition
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => setDisposition("Interested")}
                        disabled={disposition === "Interested"}
                        className="gap-2"
                      >
                        <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />
                        Mark Interested
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDisposition("Not Interested")}
                        disabled={disposition === "Not Interested"}
                        className="gap-2"
                      >
                        <ThumbsDown className="h-3.5 w-3.5 text-rose-600" />
                        Mark Not Interested
                      </DropdownMenuItem>
                      {disposition && (
                        <DropdownMenuItem onClick={() => setDisposition(null)} className="gap-2">
                          <RotateCcw className="h-3.5 w-3.5" />
                          Clear disposition
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    onClick={() => setRemoveConfirm({ type: "contact", id: cc.id, name: c.contact_name || "this contact" })}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove from campaign
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
    <div className="space-y-2">
      {/* Toolbar — single tidy row */}
      <TooltipProvider delayDuration={200}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search accounts & contacts…"
                className="h-8 w-full pl-8 text-xs"
              />
            </div>
            {regionsMissing && totalContacts > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" /> No regions selected
              </span>
            )}
            {(selectedAccountRowIds.size > 0 || selectedContactRowIds.size > 0) && !isCampaignEnded && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
                <span className="text-[11px] font-medium">
                  {selectedAccountRowIds.size > 0 && `${selectedAccountRowIds.size} account${selectedAccountRowIds.size === 1 ? "" : "s"}`}
                  {selectedAccountRowIds.size > 0 && selectedContactRowIds.size > 0 && " · "}
                  {selectedContactRowIds.size > 0 && `${selectedContactRowIds.size} contact${selectedContactRowIds.size === 1 ? "" : "s"}`}
                  {" selected"}
                </span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={clearSelection}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={() => {
                    const accountIds = new Set(
                      (campaignAccounts as any[])
                        .filter((ca: any) => selectedAccountRowIds.has(ca.id))
                        .map((ca: any) => ca.account_id),
                    );
                    const cascade = (campaignContacts as any[]).filter(
                      (cc: any) => cc.account_id && accountIds.has(cc.account_id) && !selectedContactRowIds.has(cc.id),
                    ).length;
                    if (selectedAccountRowIds.size > 0) {
                      setBulkRemoveConfirm({ kind: "accounts", count: selectedAccountRowIds.size, alsoContacts: cascade });
                    } else {
                      setBulkRemoveConfirm({ kind: "contacts", count: selectedContactRowIds.size });
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!isCampaignEnded && (
              <>
                <span className="h-5 w-px bg-border mx-0.5" aria-hidden />
                <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setAddAudienceOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add Audience
                </Button>
              </>
            )}
          </div>
        </div>
      </TooltipProvider>

      {/* Audience filter slot — sits between toolbar and table so layout reads
          Toolbar → Filters → Table per the agreed spec. */}
      {audienceFilterSlot}

      {/* Table */}
      {(accountsFetching || contactsFetching) && totalAccounts === 0 && totalContacts === 0 ? (
        <div className="border rounded-md p-3 space-y-2" aria-busy="true">
          <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-muted/70 animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-muted/70 animate-pulse" />
        </div>
      ) : totalAccounts === 0 && totalContacts === 0 ? (
        <div className="border rounded-md py-6 px-3 text-center text-xs text-muted-foreground">
          <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground/60" />
          No accounts or contacts yet — use{" "}
          <span className="font-medium text-foreground">+ Add</span> above to get started.
        </div>
      ) : (
        (() => {
          // Build a flat list of row descriptors so we can virtualize when the
          // audience grows large. Order matches the previous non-virtualized
          // render exactly: account banner → its visible contacts (or empty
          // hint) → unlinked header → unlinked contacts → empty-state.
          type RowItem =
            | { kind: "account"; ca: any }
            | { kind: "account-empty"; ca: any }
            | { kind: "contact"; cc: any }
            | { kind: "unlinked-header" }
            | { kind: "unlinked-contact"; cc: any }
            | { kind: "empty-state" };

          const rowItems: RowItem[] = [];
          for (const ca of filteredAccounts as any[]) {
            rowItems.push({ kind: "account", ca });
            const isExpanded = expandedAccounts.has(ca.account_id);
            if (isExpanded) {
              const visibleContacts = getContactsForAccount(ca.account_id).filter(matchContact);
              if (visibleContacts.length === 0) rowItems.push({ kind: "account-empty", ca });
              else for (const cc of visibleContacts) rowItems.push({ kind: "contact", cc });
            }
          }
          if (unlinkedContacts.length > 0) {
            rowItems.push({ kind: "unlinked-header" });
            for (const cc of unlinkedContacts as any[]) rowItems.push({ kind: "unlinked-contact", cc });
          }
          if (filteredAccounts.length === 0 && unlinkedContacts.length === 0 && (q || channelFilter !== "all" || hasActiveAudienceFilter)) {
            rowItems.push({ kind: "empty-state" });
          }

          // Threshold: virtualize only beyond ~60 rows so small lists stay
          // simple and printable. Above that we render a windowed slice.
          const VIRTUALIZE_THRESHOLD = 60;
          const shouldVirtualize = rowItems.length > VIRTUALIZE_THRESHOLD;

          const renderRow = (item: RowItem, key: string | number): ReactNode => {
            if (item.kind === "account") {
              const ca = item.ca;
              const accountContacts = getContactsForAccount(ca.account_id);
              const isExpanded = expandedAccounts.has(ca.account_id);
              const a = ca.accounts || {};
              const locationParts = [a.region, a.country].filter(Boolean);
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
                <TableRow
                  key={key}
                  className="bg-muted/40 hover:bg-muted/60 cursor-pointer border-l-2 border-l-primary/50"
                  data-state={selectedAccountRowIds.has(ca.id) ? "selected" : undefined}
                  onClick={() => toggleExpand(ca.account_id)}
                >
                  <TableCell className="w-[36px] py-2" onClick={(e) => e.stopPropagation()}>
                    {!isCampaignEnded && (
                      <Checkbox
                        checked={selectedAccountRowIds.has(ca.id)}
                        onCheckedChange={() => toggleAccountSelected(ca.id)}
                        aria-label={`Select account ${a.account_name || ""}`}
                      />
                    )}
                  </TableCell>
                  <TableCell colSpan={COLS - 1} className="py-2">
                    <TooltipProvider delayDuration={200}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
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
                          <div className="flex items-center gap-3 mt-0.5 pl-10 text-[11px] text-muted-foreground tabular-nums">
                            <span>
                              {accountContacts.length} contact{accountContacts.length !== 1 ? "s" : ""}
                            </span>
                            {accountContacts.length > 0 && (
                              <>
                                {showEmail && (
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
                                )}
                                {showLinkedIn && (
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
                                )}
                                {showPhone && (
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
                                )}
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
              );
            }
            if (item.kind === "account-empty") {
              return (
                <TableRow key={key}>
                  <TableCell colSpan={COLS} className="pl-10 text-sm text-muted-foreground italic py-2">
                    No contacts from this account yet.
                    {!isCampaignEnded && (
                      <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={() => setAddAudienceOpen(true)}>
                        Add contacts
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            }
            if (item.kind === "contact" || item.kind === "unlinked-contact") {
              return <ContactRow key={key} cc={item.cc} />;
            }
            if (item.kind === "unlinked-header") {
              return (
                <TableRow key={key} className="bg-muted/40 border-l-2 border-l-muted-foreground/40">
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
              );
            }
            // empty-state
            return (
              <TableRow key={key}>
                <TableCell colSpan={COLS} className="text-center text-sm text-muted-foreground py-6">
                  {(() => {
                    const af = audienceFilter;
                    const accountNameById = new Map<string, string>();
                    for (const ca of campaignAccounts as any[]) {
                      if (ca.account_id) accountNameById.set(ca.account_id, ca.accounts?.account_name || "Unnamed");
                    }
                    const contactNameById = new Map<string, string>();
                    for (const cc of campaignContacts as any[]) {
                      if (cc.contact_id) contactNameById.set(cc.contact_id, cc.contacts?.contact_name || "Unnamed");
                    }
                    const fmtList = (vals: string[], max = 2) => {
                      if (vals.length <= max) return vals.join(", ");
                      return `${vals.slice(0, max).join(", ")} +${vals.length - max}`;
                    };
                    const facets: string[] = [];
                    if (af?.accountIds?.length) {
                      const names = af.accountIds.map((id) => accountNameById.get(id) || "selected account");
                      facets.push(`Account: ${fmtList(names)}`);
                    }
                    if (af?.contactIds?.length) {
                      const names = af.contactIds.map((id) => contactNameById.get(id) || "selected contact");
                      facets.push(`Contact: ${fmtList(names)}`);
                    }
                    if (af?.industries?.length) facets.push(`Industry: ${fmtList(af.industries)}`);
                    if (af?.positions?.length) facets.push(`Position: ${fmtList(af.positions)}`);
                    if (q) facets.push(`Search: "${searchQuery}"`);
                    if (channelFilter !== "all") facets.push(`Channel: ${channelFilter}`);
                    if (facets.length === 0) return <>No contacts match the current filters.</>;
                    if (facets.length === 1) return <>No contacts match <span className="font-medium text-foreground">{facets[0]}</span>.</>;
                    return (
                      <>
                        No contacts match all of:{" "}
                        <span className="font-medium text-foreground">{facets.join(" + ")}</span>.
                        <div className="text-xs mt-1 opacity-80">Try removing a filter to widen the result.</div>
                      </>
                    );
                  })()}
                  {hasActiveAudienceFilter && onClearAudienceFilter && (
                    <Button variant="link" size="sm" className="ml-2 p-0 h-auto" onClick={onClearAudienceFilter}>
                      Clear filters
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          };

          const headerEl = (
            <TableHeader>
              <TableRow className="bg-muted/30 [&>th]:h-9 [&>th]:py-0">
                <TableHead className="sticky left-0 bg-muted/30 z-10 w-[36px]">
                  {!isCampaignEnded && (() => {
                    const visibleAccountRowIds = filteredAccounts.map((ca: any) => ca.id);
                    const visibleContactRowIds: string[] = [];
                    for (const ca of filteredAccounts as any[]) {
                      for (const cc of getContactsForAccount(ca.account_id)) {
                        if (matchContact(cc)) visibleContactRowIds.push(cc.id);
                      }
                    }
                    for (const cc of unlinkedContacts as any[]) visibleContactRowIds.push(cc.id);
                    const total = visibleAccountRowIds.length + visibleContactRowIds.length;
                    if (total === 0) return null;
                    const selectedCount =
                      visibleAccountRowIds.filter((id) => selectedAccountRowIds.has(id)).length +
                      visibleContactRowIds.filter((id) => selectedContactRowIds.has(id)).length;
                    const allSelected = selectedCount === total;
                    const someSelected = selectedCount > 0 && !allSelected;
                    return (
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(v) => {
                          if (v) {
                            setSelectedAccountRowIds(new Set(visibleAccountRowIds));
                            setSelectedContactRowIds(new Set(visibleContactRowIds));
                          } else {
                            clearSelection();
                          }
                        }}
                        aria-label="Select all visible rows"
                      />
                    );
                  })()}
                </TableHead>
                <TableHead>Contact Name</TableHead>
                <TableHead>Position</TableHead>
                {showEmail && <TableHead>Email</TableHead>}
                {showPhone && <TableHead>Phone</TableHead>}
                {showLinkedIn && <TableHead>LinkedIn</TableHead>}
                <TableHead className="w-[10%]">Actions</TableHead>
              </TableRow>
            </TableHeader>
          );

          if (!shouldVirtualize) {
            return (
              <div className="border rounded-lg overflow-x-auto">
                <Table className="min-w-[760px]">
                  {headerEl}
                  <TableBody>
                    {rowItems.map((item, i) => renderRow(item, i))}
                  </TableBody>
                </Table>
              </div>
            );
          }

          return (
            <VirtualizedAudienceTable
              rowItems={rowItems}
              renderRow={renderRow}
              header={headerEl}
            />
          );
        })()
      )}

      <AddAudienceModal
        open={addAudienceOpen}
        onOpenChange={setAddAudienceOpen}
        campaignId={campaignId}
        selectedRegions={selectedRegions}
        selectedCountries={selectedCountries}
        existingAccountIds={existingAccountIds}
        existingContactIds={existingContactIds}
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

      {/* Bulk-action controls moved inline next to the search bar */}

      <AlertDialog open={!!bulkRemoveConfirm} onOpenChange={(open) => !open && setBulkRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove selected from campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkRemoveConfirm?.kind === "accounts" ? (
                <>
                  This will remove <span className="font-medium text-foreground">{bulkRemoveConfirm.count} account(s)</span>
                  {selectedContactRowIds.size > 0 && <> and <span className="font-medium text-foreground">{selectedContactRowIds.size} explicitly-selected contact(s)</span></>}
                  {" "}from this campaign.
                  {(bulkRemoveConfirm.alsoContacts ?? 0) > 0 && (
                    <div className="mt-2 text-foreground">
                      Also remove the <span className="font-medium">{bulkRemoveConfirm.alsoContacts}</span> contact(s) under these accounts?
                    </div>
                  )}
                </>
              ) : (
                <>This will remove <span className="font-medium text-foreground">{bulkRemoveConfirm?.count}</span> contact(s) from this campaign.</>
              )}
              <div className="mt-2 text-xs">This cannot be undone.</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {bulkRemoveConfirm?.kind === "accounts" && (bulkRemoveConfirm.alsoContacts ?? 0) > 0 && (
              <Button variant="outline" onClick={() => performBulkRemove(false)}>
                Keep contacts
              </Button>
            )}
            <AlertDialogAction
              onClick={() => performBulkRemove(bulkRemoveConfirm?.kind === "accounts" && (bulkRemoveConfirm.alsoContacts ?? 0) > 0)}
            >
              {bulkRemoveConfirm?.kind === "accounts" && (bulkRemoveConfirm.alsoContacts ?? 0) > 0 ? "Remove with contacts" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
