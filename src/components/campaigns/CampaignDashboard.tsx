import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Megaphone, Zap, FileEdit, CheckCircle2, PauseCircle,
  Search, Users, Building2, MessageSquare, Mail,
  TrendingUp, Inbox, Edit2, Copy, Archive, Eye, RefreshCw, Download, Plus, X, Check,
  ChevronRight, ChevronDown, Phone, Linkedin, CornerDownRight, Activity, ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  PieChart, Pie, Cell,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { PRIORITY_BADGE_CLASS, campaignTypeLabel, CHANNEL_OPTIONS } from "@/utils/campaignTypeLabel";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { getExportFilename } from "@/utils/exportUtils";

interface Campaign {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  owner: string | null;
  archived_at: string | null;
  created_at: string | null;
  priority?: string | null;
  primary_channel?: string | null;
  slug?: string | null;
}

interface CampaignDashboardProps {
  campaigns: Campaign[];
  getStrategyProgress: (id: string) => { count: number; total: number };
  getStrategyDetail?: (id: string) => { message: boolean; audience: boolean; region: boolean; timing: boolean };
  archiveView?: "active" | "archived";
  onEdit?: (campaign: Campaign) => void;
  onClone?: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
  onCreate?: () => void;
  onOpenAccount?: (id: string) => void;
  onOpenContact?: (id: string) => void;
}

import { STATUS_BADGE } from "@/utils/campaignStatus";

const STAT_BORDER_COLORS: Record<string, string> = {
  Total: "border-l-indigo-500",
  Active: "border-l-emerald-500",
  Draft: "border-l-slate-400",
  Completed: "border-l-blue-500",
  Paused: "border-l-amber-500",
};
const STAT_ACTIVE_BG: Record<string, string> = {
  Total: "bg-indigo-50 dark:bg-indigo-950/30 ring-2 ring-indigo-500",
  Active: "bg-emerald-50 dark:bg-emerald-950/30 ring-2 ring-emerald-500",
  Draft: "bg-slate-100 dark:bg-slate-800/60 ring-2 ring-slate-400",
  Completed: "bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-500",
  Paused: "bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-500",
};
const STAT_ICON_BG: Record<string, string> = {
  Total: "bg-indigo-100 dark:bg-indigo-900/30",
  Active: "bg-emerald-100 dark:bg-emerald-900/30",
  Draft: "bg-slate-100 dark:bg-slate-800",
  Completed: "bg-blue-100 dark:bg-blue-900/30",
  Paused: "bg-amber-100 dark:bg-amber-900/30",
};
const STAT_VALUE_COLORS: Record<string, string> = {
  Total: "text-indigo-600 dark:text-indigo-400",
  Active: "text-emerald-600 dark:text-emerald-400",
  Draft: "text-slate-600 dark:text-slate-400",
  Completed: "text-blue-600 dark:text-blue-400",
  Paused: "text-amber-600 dark:text-amber-400",
};

const ENGAGEMENT_COLORS = {
  Sent: "hsl(217, 91%, 60%)",
  Replied: "hsl(142, 71%, 45%)",
  Failed: "hsl(0, 72%, 51%)",
};

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function CampaignDashboard({ campaigns, getStrategyProgress, getStrategyDetail, archiveView = "active", onEdit, onClone, onArchive, onRestore, onDelete, onCreate, onOpenAccount, onOpenContact }: CampaignDashboardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [engagementFilter, setEngagementFilter] = useState<"Replied" | "Failed" | "Sent" | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [statsPanel, setStatsPanel] = useState<null | "accounts" | "contacts" | "monitoring" | "avg">(null);
  const [panelSearch, setPanelSearch] = useState("");
  const [panelCampaignFilter, setPanelCampaignFilter] = useState<string>("all");
  const [monitoringTypeFilter, setMonitoringTypeFilter] = useState<"all" | "Email" | "Call" | "LinkedIn" | "Replied">("all");
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);

  // Reset panel search when switching panels
  useEffect(() => {
    setPanelSearch("");
    setPanelCampaignFilter("all");
    setExpandedAccount(null);
    setMonitoringTypeFilter("all");
    setMonitoringPageSize(100);
  }, [statsPanel]);

  // Active (non-archived) campaign IDs — all stat aggregates scope to these
  const activeCampaignIds = useMemo(
    () => campaigns.filter((c) => !c.archived_at).map((c) => c.id),
    [campaigns]
  );

  const ownerIds = useMemo(
    () => Array.from(new Set(campaigns.map((c) => c.owner).filter(Boolean) as string[])),
    [campaigns]
  );
  const { displayNames } = useUserDisplayNames(ownerIds);

  const { data: aggregates, isLoading: aggLoading, refetch: refetchAgg } = useQuery({
    queryKey: ["campaign-aggregates-v2", activeCampaignIds.join(",")],
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_campaign_aggregates_v2");
      if (error) throw error;
      const rows = (data || []) as Array<any>;
      const activeSet = new Set(activeCampaignIds);

      const accountsBycamp: Record<string, number> = {};
      const contactsBycamp: Record<string, number> = {};
      const touchesBycamp: Record<string, number> = {};
      const emailTouchedBycamp: Record<string, number> = {};
      const callTouchedBycamp: Record<string, number> = {};
      const linkedinTouchedBycamp: Record<string, number> = {};
      const emailThreadsBycamp: Record<string, number> = {};
      const repliedThreadsBycamp: Record<string, number> = {};
      const failedThreadsBycamp: Record<string, number> = {};
      const emailStatus = { Sent: 0, Replied: 0, Failed: 0 };
      let totalAccounts = 0, totalContacts = 0, totalTouches = 0;

      rows.forEach((r) => {
        const id = r.campaign_id;
        accountsBycamp[id] = Number(r.accounts_count) || 0;
        contactsBycamp[id] = Number(r.contacts_count) || 0;
        emailTouchedBycamp[id] = Number(r.email_touched_contacts) || 0;
        callTouchedBycamp[id] = Number(r.call_touched_contacts) || 0;
        linkedinTouchedBycamp[id] = Number(r.linkedin_touched_contacts) || 0;
        emailThreadsBycamp[id] = Number(r.email_threads) || 0;
        // Tile rule: email = thread count, call/linkedin = unique contacts.
        // Replies and follow-ups must NOT inflate this number.
        touchesBycamp[id] =
          (Number(r.email_threads) || 0) +
          (Number(r.call_touched_contacts) || 0) +
          (Number(r.linkedin_touched_contacts) || 0);
        repliedThreadsBycamp[id] = Number(r.email_replied_threads) || 0;
        failedThreadsBycamp[id] = Number(r.email_failed_threads) || 0;

        // Only count toward headline KPIs if campaign is active (non-archived)
        if (activeSet.has(id)) {
          totalAccounts += accountsBycamp[id];
          totalContacts += contactsBycamp[id];
          totalTouches += touchesBycamp[id];
          emailStatus.Sent += emailThreadsBycamp[id];
          emailStatus.Replied += repliedThreadsBycamp[id];
          emailStatus.Failed += failedThreadsBycamp[id];
        }
      });

      return {
        accountsBycamp, contactsBycamp,
        commsBycamp: touchesBycamp, // keep alias so downstream code stays compatible
        touchesBycamp,
        emailTouchedBycamp, callTouchedBycamp, linkedinTouchedBycamp,
        totalAccounts, totalContacts, totalComms: totalTouches,
        emailStatus,
        repliesBycamp: repliedThreadsBycamp,
        sentBycamp: emailThreadsBycamp,
        failedBycamp: failedThreadsBycamp,
      };
    },
  });

  // Distinct counts across all active campaigns — fixes inflated totals when
  // an account/contact belongs to multiple campaigns (per-campaign sums double-count).
  const { data: distinctTotals } = useQuery({
    queryKey: ["campaign-distinct-totals", activeCampaignIds.join(",")],
    enabled: activeCampaignIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const [accRes, conRes] = await Promise.all([
        supabase.from("campaign_accounts").select("account_id").in("campaign_id", activeCampaignIds),
        supabase.from("campaign_contacts").select("contact_id").in("campaign_id", activeCampaignIds),
      ]);
      if (accRes.error) throw accRes.error;
      if (conRes.error) throw conRes.error;
      const accSet = new Set<string>();
      (accRes.data || []).forEach((r: any) => r.account_id && accSet.add(r.account_id));
      const conSet = new Set<string>();
      (conRes.data || []).forEach((r: any) => r.contact_id && conSet.add(r.contact_id));
      return { accounts: accSet.size, contacts: conSet.size };
    },
  });

  // Distinct touches: unique email threads + unique (campaign, contact) for call/linkedin.
  // Paginated to avoid the 1000-row default cap; uses range() to walk the full set.
  const { data: distinctTouches } = useQuery({
    queryKey: ["campaign-distinct-touches", activeCampaignIds.join(",")],
    enabled: activeCampaignIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const PAGE = 1000;
      const emailThreads = new Set<string>();
      const otherTouches = new Set<string>();
      let from = 0;
      // Hard upper bound to keep this safe even on very busy tenants.
      while (from < 100_000) {
        const { data, error } = await supabase
          .from("campaign_communications")
          .select("id, campaign_id, contact_id, communication_type, conversation_id, sent_via")
          .in("campaign_id", activeCampaignIds)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = data || [];
        rows.forEach((r: any) => {
          const type = (r.communication_type || "").toLowerCase();
          if (type === "email") {
            if ((r.sent_via || "manual") === "graph-sync") return;
            emailThreads.add(r.conversation_id || `solo-${r.id}`);
          } else {
            const ch = type === "phone" ? "call" : type;
            otherTouches.add(`${r.campaign_id}|${r.contact_id || `row-${r.id}`}|${ch}`);
          }
        });
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return emailThreads.size + otherTouches.size;
    },
  });

  const agg = aggregates || {
    accountsBycamp: {}, contactsBycamp: {}, commsBycamp: {},
    touchesBycamp: {} as Record<string, number>,
    emailTouchedBycamp: {} as Record<string, number>,
    callTouchedBycamp: {} as Record<string, number>,
    linkedinTouchedBycamp: {} as Record<string, number>,
    totalAccounts: 0, totalContacts: 0, totalComms: 0,
    emailStatus: { Sent: 0, Replied: 0, Failed: 0 },
    repliesBycamp: {} as Record<string, number>,
    sentBycamp: {} as Record<string, number>,
    failedBycamp: {} as Record<string, number>,
  };

  // Override headline totals with distinct counts (fall back to summed values until loaded)
  const totalAccountsDistinct = distinctTotals?.accounts ?? agg.totalAccounts;
  const totalContactsDistinct = distinctTotals?.contacts ?? agg.totalContacts;
  const totalCommsDistinct = distinctTouches ?? agg.totalComms;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { Active: 0, Draft: 0, Completed: 0, Paused: 0 };
    campaigns.forEach((c) => { const s = c.status || "Draft"; if (counts[s] !== undefined) counts[s]++; });
    return counts;
  }, [campaigns]);

  const engagementData = useMemo(() => {
    return Object.entries(agg.emailStatus)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, fill: ENGAGEMENT_COLORS[name as keyof typeof ENGAGEMENT_COLORS] }));
  }, [agg.emailStatus]);

  // Denominator = total OUTBOUND threads (Sent already counts every outbound thread,
  // and a Replied/Failed thread is also an outbound thread — don't add them on top
  // or you double-count and the rate caps far below reality).
  const totalEmails = agg.emailStatus.Sent;
  const replyRate = totalEmails > 0 ? Math.round((agg.emailStatus.Replied / totalEmails) * 100) : 0;

  const topCampaigns = useMemo(() => {
    return [...campaigns]
      .map((c) => {
        const com = agg.commsBycamp[c.id] || 0;          // unique touches (display)
        const sent = agg.sentBycamp[c.id] || 0;          // email threads
        const replies = agg.repliesBycamp[c.id] || 0;    // replied threads
        // Reply rate = replied threads / sent threads (not rows / rows)
        const rate = sent > 0 ? Math.round((replies / sent) * 100) : 0;
        return { c, com, replies, sent, rate, strategy: getStrategyProgress(c.id) };
      })
      .filter((x) => x.com > 0)
      .sort((a, b) => b.com - a.com)
      .slice(0, 5);
  }, [campaigns, agg, getStrategyProgress]);

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter && (c.status || "Draft") !== statusFilter) return false;
      if (typeFilter && (c.campaign_type || "Unspecified") !== typeFilter) return false;
      if (priorityFilter !== "all" && (c.priority || "Medium") !== priorityFilter) return false;
      if (ownerFilter !== "all" && c.owner !== ownerFilter) return false;
      if (channelFilter !== "all" && (c.primary_channel || "") !== channelFilter) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const ownerName = c.owner ? (displayNames[c.owner] || "").toLowerCase() : "";
        const tagsStr = Array.isArray((c as any).tags) ? (c as any).tags.join(" ").toLowerCase() : "";
        const matches =
          c.campaign_name.toLowerCase().includes(q) ||
          (campaignTypeLabel(c.campaign_type) || "").toLowerCase().includes(q) ||
          (c.primary_channel || "").toLowerCase().includes(q) ||
          ownerName.includes(q) ||
          tagsStr.includes(q);
        if (!matches) return false;
      }
      if (engagementFilter === "Replied" && (agg.repliesBycamp[c.id] || 0) === 0) return false;
      if (engagementFilter === "Failed" && (agg.failedBycamp[c.id] || 0) === 0) return false;
      if (engagementFilter === "Sent" && (agg.sentBycamp[c.id] || 0) === 0) return false;
      return true;
    });
  }, [campaigns, statusFilter, typeFilter, priorityFilter, ownerFilter, channelFilter, debouncedSearch, engagementFilter, agg, displayNames]);

  const stats = [
    { label: "Total", value: campaigns.length, icon: Megaphone, color: "text-primary", filter: null as string | null },
    { label: "Active", value: statusCounts.Active, icon: Zap, color: "text-green-600 dark:text-green-400", filter: "Active" },
    { label: "Draft", value: statusCounts.Draft, icon: FileEdit, color: "text-muted-foreground", filter: "Draft" },
    { label: "Completed", value: statusCounts.Completed, icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400", filter: "Completed" },
    { label: "Paused", value: statusCounts.Paused, icon: PauseCircle, color: "text-yellow-600 dark:text-yellow-400", filter: "Paused" },
  ];

  const handleStatClick = (label: string, filter: string | null) => {
    if (label === "Total") {
      setStatusFilter(null);
      setTypeFilter(null);
      setEngagementFilter(null);
      return;
    }
    setStatusFilter((prev) => (prev === filter ? null : filter));
    setTypeFilter(null);
  };

  const activeCampaignsCount = activeCampaignIds.length;
  const avgComms = activeCampaignsCount > 0 ? (totalCommsDistinct / activeCampaignsCount).toFixed(1) : "0";
  const activeCount = statusCounts.Active;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    queryClient.invalidateQueries({ queryKey: ["campaign-aggregates-v2"] });
    queryClient.invalidateQueries({ queryKey: ["campaign-distinct-totals"] });
    queryClient.invalidateQueries({ queryKey: ["campaign-distinct-touches"] });
    refetchAgg();
  };

  const clearAllFilters = () => {
    setStatusFilter(null);
    setTypeFilter(null);
    setPriorityFilter("all");
    setOwnerFilter("all");
    setChannelFilter("all");
    setEngagementFilter(null);
    setSearch("");
  };

  const hasActiveFilters = statusFilter || typeFilter || priorityFilter !== "all" || ownerFilter !== "all" || channelFilter !== "all" || engagementFilter || search;

  const exportCsv = () => {
    const header = ["Name", "Type", "Priority", "Status", "Channel", "Tags", "Owner", "Start", "End", "Accounts", "Contacts", "Touches", "Email Threads", "Replied Threads"];
    const rows = filtered.map((c) => [
      c.campaign_name,
      campaignTypeLabel(c.campaign_type) || "",
      c.priority || "Medium",
      c.status || "Draft",
      c.primary_channel || "",
      Array.isArray((c as any).tags) ? (c as any).tags.join("; ") : "",
      c.owner ? displayNames[c.owner] || "" : "",
      c.start_date || "",
      c.end_date || "",
      agg.accountsBycamp[c.id] || 0,
      agg.contactsBycamp[c.id] || 0,
      agg.commsBycamp[c.id] || 0,
      agg.sentBycamp[c.id] || 0,
      agg.repliesBycamp[c.id] || 0,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getExportFilename("campaigns", "filtered");
    a.click();
    URL.revokeObjectURL(url);
  };

  // Monitoring sheet query — fetches enough rows to dedupe by conversation_id.
  // We page client-side after grouping so the badge always matches the tile.
  const [monitoringPageSize, setMonitoringPageSize] = useState(100);
  const { data: monitoringList, isLoading: monitoringLoading } = useQuery({
    queryKey: ["campaign-stats-monitoring", activeCampaignIds.join(",")],
    enabled: statsPanel === "monitoring" && activeCampaignIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select(
          "id, subject, body, communication_type, communication_date, campaign_id, contact_id, account_id, email_status, call_outcome, linkedin_status, delivery_status, thread_id, parent_id, conversation_id, sent_via, contacts(id, contact_name, email), accounts(id, account_name)"
        )
        .in("campaign_id", activeCampaignIds)
        .order("communication_date", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
  });

  const campaignNameById = useMemo(() => {
    const m: Record<string, string> = {};
    campaigns.forEach((c) => { m[c.id] = c.campaign_name; });
    return m;
  }, [campaigns]);

  const campaignSlugById = useMemo(() => {
    const m: Record<string, string> = {};
    campaigns.forEach((c) => { m[c.id] = c.slug || slugify(c.campaign_name); });
    return m;
  }, [campaigns]);

  // Accounts in campaigns
  const { data: campaignAccountsList, isLoading: accountsLoading } = useQuery({
    queryKey: ["campaign-stats-accounts", activeCampaignIds.join(",")],
    enabled: statsPanel === "accounts" && activeCampaignIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("id, campaign_id, created_at, accounts(id, account_name, industry, country)")
        .in("campaign_id", activeCampaignIds)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  // Contacts in campaigns
  const { data: campaignContactsList, isLoading: contactsLoading } = useQuery({
    queryKey: ["campaign-stats-contacts", activeCampaignIds.join(",")],
    enabled: (statsPanel === "contacts" || statsPanel === "accounts") && activeCampaignIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("id, campaign_id, account_id, created_at, contacts(id, contact_name, email, company_name, position)")
        .in("campaign_id", activeCampaignIds)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  // Per-campaign unique touches list (used by the "Avg / campaign" panel).
  // Derived from the same RPC as the headline tile so the numbers always match.
  const avgPerCampaign = useMemo(() => {
    const tBy = (agg as any).touchesBycamp || {};
    return activeCampaignIds
      .map((id) => ({ campaign_id: id, count: Number(tBy[id]) || 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [agg, activeCampaignIds]);
  const avgLoading = aggLoading;

  // Empty state
  if (campaigns.length === 0 && !aggLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md text-center flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            {archiveView === "archived" ? <Archive className="h-8 w-8 text-primary" /> : <Megaphone className="h-8 w-8 text-primary" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold">
              {archiveView === "archived" ? "No archived campaigns" : "No campaigns yet"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {archiveView === "archived"
                ? "Campaigns you archive will appear here. You can restore them anytime."
                : "Create your first campaign to start tracking accounts, contacts and outreach performance."}
            </p>
          </div>
          {onCreate && archiveView !== "archived" && (
            <Button onClick={onCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first campaign
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {stats.map((s) => {
            const isActive = s.label === "Total" ? !statusFilter && !typeFilter : statusFilter === s.filter;
            return (
              <Card
                key={s.label}
                role="button"
                tabIndex={0}
                className={`border border-l-4 ${STAT_BORDER_COLORS[s.label] || "border-l-primary"} shadow-none cursor-pointer transition-all hover:shadow-md ${
                  isActive ? STAT_ACTIVE_BG[s.label] : ""
                }`}
                onClick={() => handleStatClick(s.label, s.filter)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleStatClick(s.label, s.filter); } }}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`h-8 w-8 rounded-lg ${STAT_ICON_BG[s.label] || "bg-muted"} flex items-center justify-center shrink-0 relative`}>
                    <s.icon className={`h-4 w-4 ${s.color} shrink-0`} />
                    {isActive && s.label !== "Total" && (
                      <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-2 w-2 text-primary-foreground" />
                      </span>
                    )}
                  </div>
                  <div>
                    {aggLoading && campaigns.length === 0 ? (
                      <Skeleton className="h-6 w-10" />
                    ) : (
                      <p className={`text-2xl font-bold leading-none tabular-nums ${STAT_VALUE_COLORS[s.label] || ""}`}>{s.value}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Section 1 — Insights row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Top Active Campaigns */}
          <Card className="border shadow-none min-h-[260px] flex flex-col">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                Top Active Campaigns
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-2 flex-1">
              {aggLoading ? (
                <div className="space-y-2.5">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : topCampaigns.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-1 py-6">
                  <Inbox className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium">No active outreach yet</p>
                  <p className="text-xs text-muted-foreground">Send your first email to see top performers here.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {topCampaigns.map(({ c, com, sent, rate, strategy }, i) => {
                    const stratPct = strategy.total > 0 ? (strategy.count / strategy.total) * 100 : 0;
                    const ownerName = c.owner ? (displayNames[c.owner] || "") : "";
                    const ownerInitial = (ownerName?.trim()?.[0] || "?").toUpperCase();
                    return (
                      <div
                        key={c.id}
                        className="p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => navigate(`/campaigns/${campaignSlugById[c.id] || slugify(c.campaign_name)}`)}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-muted-foreground tabular-nums w-4">{i + 1}.</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center shrink-0">
                                  {ownerInitial}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{ownerName || "Unassigned"}</TooltipContent>
                            </Tooltip>
                            <span className="text-xs font-medium truncate">{c.campaign_name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant="secondary" className="text-[10px] h-5">
                              <MessageSquare className="h-2.5 w-2.5 mr-1" />{com}
                            </Badge>
                            {sent > 0 && (
                              <Badge
                                variant="secondary"
                                className={`text-[10px] h-5 ${
                                  rate >= 30 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : rate >= 10 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                  : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {rate}% reply
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pl-11">
                          <Progress value={stratPct} className="h-1 flex-1" />
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                            Setup {strategy.count}/{strategy.total}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email Engagement */}
          <Card className="border shadow-none min-h-[260px] flex flex-col">
            <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                Email Engagement
              </CardTitle>
              {engagementFilter && (
                <Badge variant="secondary" className="text-[10px] cursor-pointer" onClick={() => setEngagementFilter(null)}>
                  {engagementFilter} <X className="h-2.5 w-2.5 ml-1" />
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-3 pt-2 flex-1 flex flex-col items-center justify-center">
              {aggLoading ? (
                <Skeleton className="w-[120px] h-[120px] rounded-full" />
              ) : engagementData.length === 0 ? (
                <div className="text-center flex flex-col items-center gap-1">
                  <Inbox className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium">No emails sent yet</p>
                  <p className="text-xs text-muted-foreground">Engagement breakdown appears once you send.</p>
                </div>
              ) : (
                <>
                  <div className="relative w-[120px] h-[120px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={engagementData} cx="50%" cy="50%" innerRadius={36} outerRadius={56}
                          paddingAngle={2} dataKey="value" stroke="none"
                          onClick={(seg: any) => {
                            const name = seg?.name as "Sent" | "Replied" | "Failed";
                            if (!name) return;
                            setEngagementFilter((prev) => prev === name ? null : name);
                            // Smooth-scroll to the All Campaigns table so the filter effect is visible.
                            setTimeout(() => {
                              document.getElementById("all-campaigns-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 50);
                          }}
                          className="cursor-pointer"
                        >
                          {engagementData.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.fill}
                              opacity={engagementFilter && engagementFilter !== entry.name ? 0.35 : 1}
                            />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          wrapperStyle={{ zIndex: 50 }}
                          position={{ y: -8 }}
                          allowEscapeViewBox={{ x: true, y: true }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-bold leading-none tabular-nums">{replyRate}%</span>
                      <span className="text-[9px] text-muted-foreground mt-0.5">Reply rate</span>
                      <span className="text-[9px] text-muted-foreground tabular-nums">{totalEmails} total</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
                    {engagementData.map((e) => (
                      <button
                        key={e.name}
                        onClick={() => setEngagementFilter((prev) => prev === e.name ? null : (e.name as any))}
                        className={`flex items-center gap-1.5 text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                          engagementFilter === e.name ? "bg-muted ring-1 ring-border" : "hover:bg-muted/60"
                        }`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.fill }} />
                        <span className="text-muted-foreground">{e.name}</span>
                        <span className="tabular-nums font-medium">{e.value}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="border shadow-none min-h-[260px] flex flex-col">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-sm font-medium">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-2 flex-1">
              <div className="grid grid-cols-2 gap-2 h-full">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex flex-col justify-between p-3 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors text-left"
                      onClick={() => setStatsPanel("accounts")}
                    >
                      <div className="h-7 w-7 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <Building2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        {aggLoading ? <Skeleton className="h-5 w-10" /> : (
                          <p className="text-xl font-bold leading-none tabular-nums">{totalAccountsDistinct}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">Accounts</p>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Distinct accounts across active campaigns (shared accounts counted once)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex flex-col justify-between p-3 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors text-left"
                      onClick={() => setStatsPanel("contacts")}
                    >
                      <div className="h-7 w-7 rounded-md bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                        <Users className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        {aggLoading ? <Skeleton className="h-5 w-10" /> : (
                          <p className="text-xl font-bold leading-none tabular-nums">{totalContactsDistinct}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">Contacts</p>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Distinct contacts across active campaigns (shared contacts counted once)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex flex-col justify-between p-3 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors text-left"
                      onClick={() => setStatsPanel("monitoring")}
                    >
                      <div className="h-7 w-7 rounded-md bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                        <Activity className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        {aggLoading ? <Skeleton className="h-5 w-10" /> : (
                          <p className="text-xl font-bold leading-none tabular-nums">{totalCommsDistinct}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">Monitoring</p>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Unique outreach touches across active campaigns (shared touches counted once)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex flex-col justify-between p-3 rounded-md bg-muted/30 hover:bg-muted/60 transition-colors text-left"
                      onClick={() => setStatsPanel("avg")}
                    >
                      <div className="h-7 w-7 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <TrendingUp className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        {aggLoading ? <Skeleton className="h-5 w-10" /> : (
                          <p className="text-xl font-bold leading-none tabular-nums">{avgComms}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">Avg / campaign</p>
                      </div>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Unique outreach touches per active campaign (shared touches counted once)</TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Section 2 — All Campaigns Table */}
        <div id="all-campaigns-table" className="mt-6 scroll-mt-4">
          <Card className="border shadow-none">
            <CardHeader className="pb-2 pt-3 px-4 flex flex-col gap-2">
              <div className="flex flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-medium">All Campaigns</CardTitle>
                  <Badge variant="outline" className="text-xs">{filtered.length}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-56">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleRefresh}>
                        <RefreshCw className={`h-3.5 w-3.5 ${aggLoading ? "animate-spin" : ""}`} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh data</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={exportCsv}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export CSV</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              {/* Filter bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Owners</SelectItem>
                    {ownerIds.map((id) => (
                      <SelectItem key={id} value={id}>{displayNames[id] || "Unknown"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={channelFilter} onValueChange={setChannelFilter}>
                  <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Channel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Channels</SelectItem>
                    {CHANNEL_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAllFilters}>
                    <X className="h-3 w-3 mr-1" /> Clear all
                  </Button>
                )}
                {statusFilter && (
                  <Badge variant="secondary" className="text-[10px] cursor-pointer" onClick={() => setStatusFilter(null)}>
                    Status: {statusFilter} <X className="h-2.5 w-2.5 ml-1" />
                  </Badge>
                )}
                {engagementFilter && (
                  <Badge variant="secondary" className="text-[10px] cursor-pointer" onClick={() => setEngagementFilter(null)}>
                    Engagement: {engagementFilter} <X className="h-2.5 w-2.5 ml-1" />
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs whitespace-nowrap">Name</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Type</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Priority</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Owner</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Status</TableHead>
                      <TableHead className="text-xs whitespace-nowrap w-[120px]">Strategy</TableHead>
                      <TableHead className="text-xs whitespace-nowrap text-right">Accounts</TableHead>
                      <TableHead className="text-xs whitespace-nowrap text-right">Contacts</TableHead>
                      <TableHead className="text-xs whitespace-nowrap text-right">Comms</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Engagement</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Start</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">End</TableHead>
                      <TableHead className="text-xs whitespace-nowrap text-right w-[120px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-8">
                          No campaigns match the current filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((c) => {
                        const strategy = getStrategyProgress(c.id);
                        const stratPct = strategy.total > 0 ? (strategy.count / strategy.total) * 100 : 0;
                        const acc = agg.accountsBycamp[c.id] || 0;
                        const con = agg.contactsBycamp[c.id] || 0;
                        const com = agg.commsBycamp[c.id] || 0;
                        const sent = agg.sentBycamp[c.id] || 0;
                        const replies = agg.repliesBycamp[c.id] || 0;
                        const ownerName = c.owner ? (displayNames[c.owner] || "—") : "—";
                        return (
                          <TableRow
                            key={c.id}
                            className="group cursor-pointer hover:bg-muted/50 even:bg-muted/10"
                            onClick={() => navigate(`/campaigns/${campaignSlugById[c.id] || slugify(c.campaign_name)}`)}
                          >
                            <TableCell className="text-xs font-medium max-w-[200px] truncate">{c.campaign_name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{campaignTypeLabel(c.campaign_type) || "—"}</TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] ${PRIORITY_BADGE_CLASS[c.priority || "Medium"]}`} variant="secondary">
                                {c.priority || "Medium"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{ownerName}</TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] ${STATUS_BADGE[c.status || "Draft"]}`} variant="secondary">{c.status || "Draft"}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-2 cursor-help">
                                      <Progress value={stratPct} className="h-1.5 w-16" />
                                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{strategy.count}/{strategy.total}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="text-xs">
                                    {(() => {
                                      const detail = getStrategyDetail?.(c.id);
                                      const items = [
                                        { label: "Message", done: detail?.message },
                                        { label: "Audience", done: detail?.audience },
                                        { label: "Region", done: detail?.region },
                                        { label: "Timing", done: detail?.timing },
                                      ];
                                      return (
                                        <div className="space-y-1">
                                          {items.map((it) => (
                                            <div key={it.label} className="flex items-center gap-2">
                                              {it.done ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-muted-foreground" />}
                                              <span className={it.done ? "" : "text-muted-foreground"}>{it.label}</span>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{acc}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{con}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">{com}</TableCell>
                            <TableCell className="text-xs">
                              {sent > 0 ? (
                                <span className="text-muted-foreground tabular-nums">
                                  <span className="text-foreground font-medium">{replies}</span>/{sent} replies
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {c.start_date ? format(new Date(c.start_date + "T00:00:00"), "dd MMM yy") : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {c.end_date ? format(new Date(c.end_date + "T00:00:00"), "dd MMM yy") : "—"}
                            </TableCell>
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/campaigns/${campaignSlugById[c.id] || slugify(c.campaign_name)}`)}>
                                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View</TooltipContent>
                                </Tooltip>
                                {!c.archived_at && onEdit && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(c)}>
                                        <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit</TooltipContent>
                                  </Tooltip>
                                )}
                                {!c.archived_at && onClone && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClone(c.id)}>
                                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Clone</TooltipContent>
                                  </Tooltip>
                                )}
                                {!c.archived_at && onArchive && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onArchive(c.id)}>
                                        <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Archive</TooltipContent>
                                  </Tooltip>
                                )}
                                {c.archived_at && onRestore && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRestore(c.id)}>
                                        <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Restore</TooltipContent>
                                  </Tooltip>
                                )}
                                {c.archived_at && onDelete && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onDelete(c.id)}>
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete permanently</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {renderStatsPanel({
          statsPanel,
          setStatsPanel,
          panelSearch,
          setPanelSearch,
          panelCampaignFilter,
          setPanelCampaignFilter,
          monitoringTypeFilter,
          setMonitoringTypeFilter,
          expandedAccount,
          setExpandedAccount,
          accountsLoading,
          contactsLoading,
          monitoringLoading,
          avgLoading,
          campaignAccountsList: campaignAccountsList || [],
          campaignContactsList: campaignContactsList || [],
          monitoringList: monitoringList || [],
          avgPerCampaign: avgPerCampaign || [],
          campaignNameById,
          campaignSlugById,
          activeCampaignIds,
          avgComms,
          activeCount: activeCampaignsCount,
          monitoringPageSize,
          setMonitoringPageSize,
          onOpenAccount,
          onOpenContact,
          navigate,
        })}
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Stats Panel renderer — Accounts (grouped) | Contacts (deduped) | Monitoring | Avg
// ============================================================================
function renderStatsPanel(props: {
  statsPanel: null | "accounts" | "contacts" | "monitoring" | "avg";
  setStatsPanel: (v: null | "accounts" | "contacts" | "monitoring" | "avg") => void;
  panelSearch: string;
  setPanelSearch: (v: string) => void;
  panelCampaignFilter: string;
  setPanelCampaignFilter: (v: string) => void;
  monitoringTypeFilter: "all" | "Email" | "Call" | "LinkedIn" | "Replied";
  setMonitoringTypeFilter: (v: "all" | "Email" | "Call" | "LinkedIn" | "Replied") => void;
  expandedAccount: string | null;
  setExpandedAccount: (v: string | null) => void;
  accountsLoading: boolean;
  contactsLoading: boolean;
  monitoringLoading: boolean;
  avgLoading: boolean;
  campaignAccountsList: any[];
  campaignContactsList: any[];
  monitoringList: any[];
  avgPerCampaign: { campaign_id: string; count: number }[];
  campaignNameById: Record<string, string>;
  campaignSlugById: Record<string, string>;
  activeCampaignIds: string[];
  avgComms: string;
  activeCount: number;
  monitoringPageSize: number;
  setMonitoringPageSize: (n: number) => void;
  onOpenAccount?: (id: string) => void;
  onOpenContact?: (id: string) => void;
  navigate: (path: string) => void;
}) {
  const {
    statsPanel, setStatsPanel,
    panelSearch, setPanelSearch,
    panelCampaignFilter, setPanelCampaignFilter,
    monitoringTypeFilter, setMonitoringTypeFilter,
    expandedAccount, setExpandedAccount,
    accountsLoading, contactsLoading, monitoringLoading, avgLoading,
    campaignAccountsList, campaignContactsList, monitoringList, avgPerCampaign,
    campaignNameById, campaignSlugById, activeCampaignIds,
    avgComms, activeCount,
    monitoringPageSize, setMonitoringPageSize,
    onOpenAccount, onOpenContact,
    navigate,
  } = props;

  // Group accounts by account.id, collect campaigns + linked contacts
  const accountsGrouped = (() => {
    const map = new Map<string, { account: any; campaigns: Set<string>; contactRows: any[] }>();
    for (const row of campaignAccountsList) {
      const acc = row.accounts;
      if (!acc?.id) continue;
      const entry = map.get(acc.id) || { account: acc, campaigns: new Set<string>(), contactRows: [] };
      entry.campaigns.add(row.campaign_id);
      map.set(acc.id, entry);
    }
    // Attach contacts that share account_id AND share at least one campaign
    for (const cRow of campaignContactsList) {
      const acctId = cRow.account_id;
      if (!acctId) continue;
      const entry = map.get(acctId);
      if (!entry) continue;
      if (!entry.campaigns.has(cRow.campaign_id)) continue;
      // dedupe by contact id
      if (!entry.contactRows.some((x: any) => x.contacts?.id === cRow.contacts?.id)) {
        entry.contactRows.push(cRow);
      }
    }
    return Array.from(map.values());
  })();

  // Dedupe contacts by contact.id
  const contactsDeduped = (() => {
    const map = new Map<string, { contact: any; campaigns: Set<string>; account_id: string | null }>();
    for (const row of campaignContactsList) {
      const c = row.contacts;
      if (!c?.id) continue;
      const entry = map.get(c.id) || { contact: c, campaigns: new Set<string>(), account_id: row.account_id || null };
      entry.campaigns.add(row.campaign_id);
      map.set(c.id, entry);
    }
    return Array.from(map.values());
  })();

  // Filter accounts by search + campaign
  const accountsFiltered = accountsGrouped.filter((g) => {
    if (panelCampaignFilter !== "all" && !g.campaigns.has(panelCampaignFilter)) return false;
    if (!panelSearch) return true;
    const q = panelSearch.toLowerCase();
    return (
      g.account.account_name?.toLowerCase().includes(q) ||
      g.account.industry?.toLowerCase().includes(q) ||
      g.account.country?.toLowerCase().includes(q)
    );
  });

  const contactsFiltered = contactsDeduped.filter((g) => {
    if (panelCampaignFilter !== "all" && !g.campaigns.has(panelCampaignFilter)) return false;
    if (!panelSearch) return true;
    const q = panelSearch.toLowerCase();
    return (
      g.contact.contact_name?.toLowerCase().includes(q) ||
      g.contact.email?.toLowerCase().includes(q) ||
      g.contact.company_name?.toLowerCase().includes(q) ||
      g.contact.position?.toLowerCase().includes(q)
    );
  });

  // Group email rows by conversation_id (matches detail Monitoring + the tile RPC).
  // For each email thread we keep the latest outbound row as the "card" and capture
  // the latest inbound (graph-sync) row as the reply preview. Calls / LinkedIn stay
  // one row per touch (grouped per contact below).
  const monitoringEntries = (() => {
    const emailGroups = new Map<string, any[]>();
    const otherRows: any[] = [];
    for (const m of monitoringList) {
      if (m.communication_type === "Email") {
        const key = m.conversation_id || `solo-${m.id}`;
        const arr = emailGroups.get(key) || [];
        arr.push(m);
        emailGroups.set(key, arr);
      } else {
        otherRows.push(m);
      }
    }

    const entries: Array<{ row: any; reply: any | null; threadId: string; channel: string }> = [];

    emailGroups.forEach((msgs, key) => {
      const sorted = [...msgs].sort(
        (a, b) =>
          new Date(b.communication_date || 0).getTime() -
          new Date(a.communication_date || 0).getTime()
      );
      const outbound = sorted.filter((m) => (m.sent_via || "manual") !== "graph-sync");
      const inbound = sorted.filter((m) => (m.sent_via || "manual") === "graph-sync");
      // Skip pure-inbound threads (no outbound from us) — they are not "monitoring touches"
      if (outbound.length === 0) return;
      entries.push({
        row: outbound[0],
        reply: inbound[0] || null,
        threadId: key,
        channel: "email",
      });
    });

    // Calls / LinkedIn: dedupe by (campaign_id, contact_id, channel) — repeat
    // touches to the same contact on the same channel are treated as follow-ups
    // and must NOT inflate the count (matches the tile's distinct-contact rule).
    const otherSeen = new Set<string>();
    const otherSorted = [...otherRows].sort(
      (a, b) =>
        new Date(b.communication_date || 0).getTime() -
        new Date(a.communication_date || 0).getTime()
    );
    otherSorted.forEach((m) => {
      const channel = (m.communication_type || "").toLowerCase();
      const channelKey = channel === "phone" ? "call" : channel;
      const contactKey = m.contact_id || `row-${m.id}`;
      const dedupeKey = `${m.campaign_id}|${contactKey}|${channelKey}`;
      if (otherSeen.has(dedupeKey)) return;
      otherSeen.add(dedupeKey);
      entries.push({
        row: m,
        reply: null,
        threadId: dedupeKey,
        channel,
      });
    });

    // Sort by latest activity desc (use reply date when present)
    entries.sort((a, b) => {
      const ta = new Date(a.reply?.communication_date || a.row.communication_date || 0).getTime();
      const tb = new Date(b.reply?.communication_date || b.row.communication_date || 0).getTime();
      return tb - ta;
    });
    return entries;
  })();

  const monitoringFilteredAll = monitoringEntries.filter((entry) => {
    const m = entry.row;
    const type = entry.channel;
    if (panelCampaignFilter !== "all" && m.campaign_id !== panelCampaignFilter) return false;
    if (monitoringTypeFilter === "Email" && type !== "email") return false;
    if (monitoringTypeFilter === "Call" && type !== "call" && type !== "phone") return false;
    if (monitoringTypeFilter === "LinkedIn" && type !== "linkedin") return false;
    if (monitoringTypeFilter === "Replied" && !entry.reply) return false;
    if (panelSearch) {
      const q = panelSearch.toLowerCase();
      const hay = `${m.subject || ""} ${m.contacts?.contact_name || ""} ${m.accounts?.account_name || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const monitoringFiltered = monitoringFilteredAll.slice(0, monitoringPageSize);
  const monitoringHasMore = monitoringFilteredAll.length > monitoringFiltered.length;

  const titleMap: Record<string, string> = {
    accounts: "Campaign Accounts",
    contacts: "Campaign Contacts",
    monitoring: "Monitoring",
    avg: "Communications per Campaign",
  };
  const countMap: Record<string, number> = {
    accounts: accountsFiltered.length,
    contacts: contactsFiltered.length,
    monitoring: monitoringFiltered.length,
    avg: avgPerCampaign.length,
  };

  const isLoading =
    (statsPanel === "accounts" && (accountsLoading || contactsLoading)) ||
    (statsPanel === "contacts" && contactsLoading) ||
    (statsPanel === "monitoring" && monitoringLoading) ||
    (statsPanel === "avg" && avgLoading);

  return (
    <Sheet open={!!statsPanel} onOpenChange={(o) => !o && setStatsPanel(null)}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <div className="sticky top-0 z-10 bg-background border-b p-4 space-y-3">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {statsPanel ? titleMap[statsPanel] : ""}
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {countMap[statsPanel || "accounts"]}
              </Badge>
            </SheetTitle>
          </SheetHeader>
          {statsPanel !== "avg" && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={`Search ${statsPanel}...`}
                value={panelSearch}
                onChange={(e) => setPanelSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          )}
          {activeCampaignIds.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setPanelCampaignFilter("all")}
                className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                  panelCampaignFilter === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 hover:bg-muted text-muted-foreground border-transparent"
                }`}
              >
                All campaigns
              </button>
              {activeCampaignIds.map((id) => (
                <button
                  key={id}
                  onClick={() => setPanelCampaignFilter(id)}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors max-w-[160px] truncate ${
                    panelCampaignFilter === id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground border-transparent"
                  }`}
                  title={campaignNameById[id]}
                >
                  {campaignNameById[id] || "—"}
                </button>
              ))}
            </div>
          )}
          {statsPanel === "monitoring" && (
            <div className="flex items-center gap-1 flex-wrap">
              {(["all", "Email", "Call", "LinkedIn", "Replied"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setMonitoringTypeFilter(f)}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                    monitoringTypeFilter === f
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground border-transparent"
                  }`}
                >
                  {f === "all" ? "All types" : f}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : statsPanel === "accounts" ? (
            accountsFiltered.length === 0 ? (
              <EmptyState icon={Building2} message="No accounts in active campaigns" />
            ) : (
              accountsFiltered.map((g) => {
                const expanded = expandedAccount === g.account.id;
                return (
                  <div key={g.account.id} className="rounded-md border bg-card">
                    <div className="flex items-center gap-2 p-3">
                      <button
                        onClick={() => setExpandedAccount(expanded ? null : g.account.id)}
                        className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center shrink-0"
                        aria-label="Toggle contacts"
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => onOpenAccount?.(g.account.id)}
                        className="flex-1 min-w-0 text-left group"
                      >
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-xs font-medium truncate">{g.account.account_name}</p>
                          <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {g.account.industry && <Badge variant="outline" className="text-[9px] h-4 px-1">{g.account.industry}</Badge>}
                          {g.account.country && <span className="text-[10px] text-muted-foreground">{g.account.country}</span>}
                          <Badge variant="secondary" className="text-[9px] h-4 px-1">
                            <Users className="h-2.5 w-2.5 mr-0.5" />{g.contactRows.length}
                          </Badge>
                          {Array.from(g.campaigns).map((cid) => (
                            <Badge
                              key={cid}
                              variant="secondary"
                              className="text-[9px] h-4 px-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 cursor-pointer hover:bg-indigo-200"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const slug = campaignSlugById[cid];
                                if (slug) navigate(`/campaigns/${slug}`);
                              }}
                              title={`Open ${campaignNameById[cid]}`}
                            >
                              {campaignNameById[cid] || "—"}
                            </Badge>
                          ))}
                        </div>
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t bg-muted/20 px-3 py-2 space-y-1">
                        {g.contactRows.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground italic py-1">No contacts in same campaign</p>
                        ) : (
                          g.contactRows.map((cr: any) => (
                            <button
                              key={cr.id}
                              onClick={() => onOpenContact?.(cr.contacts.id)}
                              className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-background text-left group"
                            >
                              <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-medium truncate">{cr.contacts?.contact_name || "—"}</p>
                                {cr.contacts?.email && (
                                  <p className="text-[9px] text-muted-foreground truncate">{cr.contacts.email}</p>
                                )}
                              </div>
                              <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : statsPanel === "contacts" ? (
            contactsFiltered.length === 0 ? (
              <EmptyState icon={Users} message="No contacts in active campaigns" />
            ) : (
              contactsFiltered.map((g) => (
                <button
                  key={g.contact.id}
                  onClick={() => onOpenContact?.(g.contact.id)}
                  className="w-full text-left p-3 rounded-md border bg-card hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-medium truncate">{g.contact.contact_name}</p>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                  </div>
                  {g.contact.email && (
                    <p className="text-[10px] text-muted-foreground truncate">{g.contact.email}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {g.contact.position && <Badge variant="outline" className="text-[9px] h-4 px-1">{g.contact.position}</Badge>}
                    {g.contact.company_name && <span className="text-[10px] text-muted-foreground">{g.contact.company_name}</span>}
                    {Array.from(g.campaigns).map((cid) => (
                      <Badge
                        key={cid}
                        variant="secondary"
                        className="text-[9px] h-4 px-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 cursor-pointer hover:bg-indigo-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const slug = campaignSlugById[cid];
                          if (slug) navigate(`/campaigns/${slug}`);
                        }}
                        title={`Open ${campaignNameById[cid]}`}
                      >
                        {campaignNameById[cid] || "—"}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))
            )
          ) : statsPanel === "monitoring" ? (
            monitoringFiltered.length === 0 ? (
              <EmptyState icon={Activity} message="No monitoring records for active campaigns yet" />
            ) : (
              monitoringFiltered.map((entry: any) => {
                const m = entry.row;
                const type = entry.channel;
                const reply = entry.reply;
                const Icon = type === "email" ? Mail : type === "linkedin" ? Linkedin : (type === "call" || type === "phone") ? Phone : MessageSquare;
                const typeColor =
                  type === "email" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                  type === "linkedin" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" :
                  (type === "call" || type === "phone") ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                  "bg-muted text-muted-foreground";
                const status = type === "email" ? m.email_status : type === "linkedin" ? m.linkedin_status : (type === "call" || type === "phone") ? m.call_outcome : m.delivery_status;
                const statusColor = (s?: string) => {
                  const k = (s || "").toLowerCase();
                  if (k.includes("repl") || k.includes("success") || k === "sent" || k === "delivered" || k === "opened") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
                  if (k.includes("fail") || k.includes("bounce") || k.includes("declin") || k.includes("no answer")) return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
                  if (k.includes("pending") || k.includes("scheduled") || k.includes("queued")) return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
                  return "bg-muted text-muted-foreground";
                };
                const contactName = m.contacts?.contact_name;
                const accountName = m.accounts?.account_name;
                const title =
                  type === "email" ? (m.subject || "(no subject)") :
                  contactName ? `${type.charAt(0).toUpperCase() + type.slice(1)} with ${contactName}` :
                  m.subject || `${type} touchpoint`;
                const campaignName = campaignNameById[m.campaign_id] || "—";
                const handleOpenThread = () => {
                  if (!m.campaign_id) return;
                  const slug = campaignSlugById[m.campaign_id] || slugify(campaignName);
                  if (!slug) return;
                  const params = new URLSearchParams({
                    tab: "monitoring",
                    view: "outreach",
                    channel: type === "phone" ? "call" : type,
                    thread: entry.threadId,
                  });
                  navigate(`/campaigns/${slug}?${params.toString()}`);
                };
                return (
                  <div
                    key={entry.threadId}
                    role="button"
                    tabIndex={0}
                    onClick={handleOpenThread}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenThread(); } }}
                    className="p-3 rounded-md border bg-card cursor-pointer hover:bg-muted/50 hover:border-primary/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {/* keep original layout */}
                    <div className="flex items-start gap-2">
                      <div className={`h-7 w-7 rounded-md ${typeColor} flex items-center justify-center shrink-0`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className="text-xs font-medium truncate">{title}</p>
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                            {m.communication_date ? format(new Date(m.communication_date), "dd MMM, HH:mm") : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {status && <Badge variant="secondary" className={`text-[9px] h-4 px-1 ${statusColor(status)}`}>{status}</Badge>}
                          {contactName && <span className="text-[10px] text-muted-foreground truncate">{contactName}</span>}
                          {accountName && <span className="text-[10px] text-muted-foreground">· {accountName}</span>}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 truncate">{campaignName}</p>
                        {reply && (
                          <div className="mt-2 pl-2 border-l-2 border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-r p-1.5">
                            <div className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                              <CornerDownRight className="h-3 w-3" />
                              Replied · {format(new Date(reply.communication_date), "dd MMM, HH:mm")}
                            </div>
                            {reply.body && (
                              <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{reply.body}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : null}
          {statsPanel === "monitoring" && monitoringHasMore && (
            <div className="pt-2 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setMonitoringPageSize(monitoringPageSize + 100)}>
                Load more
              </Button>
            </div>
          )}
          {statsPanel === "avg" && (
            <>
              <div className="text-xs text-muted-foreground mb-2">
                Average: <span className="font-semibold tabular-nums text-foreground">{avgComms}</span> across {activeCount} active campaign{activeCount === 1 ? "" : "s"}
              </div>
              {avgPerCampaign.length === 0 ? (
                <EmptyState icon={TrendingUp} message="No communications yet" />
              ) : (
                avgPerCampaign.map((row) => {
                  const campaignName = campaignNameById[row.campaign_id] || "—";
                  return (
                    <div
                      key={row.campaign_id}
                      className="p-3 rounded-md border bg-card flex items-center justify-between gap-3"
                    >
                      <p className="text-xs font-medium truncate">{campaignName}</p>
                      <Badge variant="outline" className="text-[10px] tabular-nums">{row.count}</Badge>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
