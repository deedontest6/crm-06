import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plus, Search, Eye, Edit2, Copy, Archive, ArchiveRestore, LayoutGrid, List, Trash2, X, Download,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { CampaignModal } from "@/components/campaigns/CampaignModal";
import { FirstRunWizard } from "@/components/campaigns/FirstRunWizard";
import { CampaignDashboard } from "@/components/campaigns/CampaignDashboard";
import { AccountModal } from "@/components/AccountModal";
import { ContactModal } from "@/components/ContactModal";
import { StandardPagination } from "@/components/shared/StandardPagination";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { CAMPAIGN_TYPE_OPTIONS, campaignTypeLabel, PRIORITY_BADGE_CLASS, CHANNEL_OPTIONS } from "@/utils/campaignTypeLabel";
import { STATUS_BADGE, STATUS_OPTIONS, allowedTransitions, type CampaignStatus } from "@/utils/campaignStatus";
import { getExportFilename } from "@/utils/exportUtils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function Campaigns() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-synced state (Phase 2.7)
  const view = searchParams.get("view") || "dashboard";
  const archiveView = (searchParams.get("archive") === "archived" ? "archived" : "active") as "active" | "archived";
  const search = searchParams.get("q") || "";
  const statusFilter = searchParams.get("status") || "all";
  const typeFilter = searchParams.get("type") || "all";
  const priorityFilter = searchParams.get("priority") || "all";
  const channelFilter = searchParams.get("channel") || "all";
  const currentPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10));

  const updateParam = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === "" || value === "all") next.delete(key);
          else next.set(key, value);
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const setView = (v: string) => updateParam({ view: v === "dashboard" ? null : v });
  const setArchiveView = (v: "active" | "archived") => updateParam({ archive: v === "active" ? null : v, page: null });
  const setSearch = (v: string) => updateParam({ q: v, page: null });
  const setStatusFilter = (v: string) => updateParam({ status: v, page: null });
  const setTypeFilter = (v: string) => updateParam({ type: v, page: null });
  const setPriorityFilter = (v: string) => updateParam({ priority: v, page: null });
  const setChannelFilter = (v: string) => updateParam({ channel: v, page: null });
  const setCurrentPage = (p: number) => updateParam({ page: p === 1 ? null : String(p) });
  const setPageSize = (s: number) => updateParam({ pageSize: s === 50 ? null : String(s), page: null });

  const {
    campaigns, archivedCampaigns, isLoading,
    archiveCampaign, restoreCampaign, cloneCampaign, deleteCampaign, deleteCampaignsBulk, updateCampaign,
    getStrategyProgress, getStrategyDetail,
  } = useCampaigns({ includeArchived: archiveView === "archived" });

  const displayedCampaigns = archiveView === "active" ? campaigns : archivedCampaigns;
  const ownerIds = useMemo(
    () => displayedCampaigns.map((c) => c.owner).filter(Boolean) as string[],
    [displayedCampaigns]
  );
  const { displayNames } = useUserDisplayNames(ownerIds);

  const [modalOpen, setModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<any>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);

  // Bulk selection (Phase 2.8)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | "archive" | "restore" | "delete">(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset selection whenever filters/view change
  useEffect(() => {
    setSelected(new Set());
  }, [archiveView, view, search, statusFilter, typeFilter, priorityFilter, channelFilter]);

  const { data: editAccount } = useQuery({
    queryKey: ["account-for-edit", editAccountId],
    enabled: !!editAccountId,
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").eq("id", editAccountId!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: editContact } = useQuery({
    queryKey: ["contact-for-edit", editContactId],
    enabled: !!editContactId,
    queryFn: async () => {
      const { data, error } = await supabase.from("contacts").select("*").eq("id", editContactId!).single();
      if (error) throw error;
      return data;
    },
  });

  const prefetchCampaign = (campaignId: string) => {
    const cached = queryClient.getQueryData(["campaign", campaignId]);
    if (cached) return;
    queryClient.prefetchQuery({
      queryKey: ["campaign", campaignId],
      queryFn: async () => {
        const { data, error } = await supabase.from("campaigns").select("*").eq("id", campaignId).single();
        if (error) throw error;
        return data;
      },
      staleTime: 60_000,
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return displayedCampaigns.filter((c: any) => {
      const ownerName = c.owner ? (displayNames[c.owner] || "").toLowerCase() : "";
      const tagsStr = Array.isArray(c.tags) ? c.tags.join(" ").toLowerCase() : "";
      const matchesSearch = !q ||
        c.campaign_name.toLowerCase().includes(q) ||
        (c.goal || "").toLowerCase().includes(q) ||
        (c.campaign_type || "").toLowerCase().includes(q) ||
        (c.primary_channel || "").toLowerCase().includes(q) ||
        ownerName.includes(q) ||
        tagsStr.includes(q);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      // Compare on the raw enum value — the URL holds the canonical key, not
      // the human label. Round-tripping through campaignTypeLabel silently
      // dropped legacy values whose label maps differently.
      const matchesType = typeFilter === "all" || (c.campaign_type || "") === typeFilter;
      const matchesPriority = priorityFilter === "all" || (c.priority || "Medium") === priorityFilter;
      const matchesChannel = channelFilter === "all" || (c.primary_channel || "") === channelFilter;
      return matchesSearch && matchesStatus && matchesType && matchesPriority && matchesChannel;
    });
  }, [displayedCampaigns, displayNames, search, statusFilter, typeFilter, priorityFilter, channelFilter]);

  // Pagination (Phase 2.9)
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const pageStart = (effectivePage - 1) * pageSize;
  const paginated = filtered.slice(pageStart, pageStart + pageSize);

  const hasActiveFilters =
    !!search || statusFilter !== "all" || typeFilter !== "all" || priorityFilter !== "all" || channelFilter !== "all";
  const clearAllFilters = () => {
    updateParam({ q: null, status: null, type: null, priority: null, channel: null, page: null });
  };

  const handleArchive = () => {
    if (archiveId) {
      archiveCampaign.mutate(archiveId);
      setArchiveId(null);
    }
  };

  const handlePermanentDelete = () => {
    if (deleteId) {
      deleteCampaign.mutate(deleteId);
      setDeleteId(null);
    }
  };

  // Inline status change (Phase 2.10) — respects transition rules
  const handleInlineStatusChange = async (c: any, newStatus: string) => {
    // A1: List page must use the SAME activation gate as the detail page.
    // `mart_complete` only covers the 4 strategy flags; the detail page also
    // requires a primary_channel and a start/end date before allowing
    // Draft → Active. Otherwise the campaign activates here but immediately
    // fails at first send.
    const hasChannel = !!(c.primary_channel && String(c.primary_channel).trim());
    const hasDates = !!c.start_date && !!c.end_date;
    const isStrategyComplete = !!c.mart_complete && hasChannel && hasDates;
    const allowed = allowedTransitions(c.status as CampaignStatus, isStrategyComplete);
    if (!allowed.includes(newStatus as CampaignStatus)) {
      const missing: string[] = [];
      if (!c.mart_complete) missing.push("4 strategy steps");
      if (!hasChannel) missing.push("primary channel");
      if (!hasDates) missing.push("start & end date");
      toast({
        title: "Status change blocked",
        description: newStatus === "Active" && !isStrategyComplete
          ? `Before activating, finish: ${missing.join(", ")}.`
          : `Cannot transition from ${c.status} to ${newStatus}.`,
        variant: "destructive",
      });
      return;
    }
    updateCampaign.mutate({ id: c.id, status: newStatus } as any);
  };

  // Bulk action handlers
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const pageAllSelected = paginated.length > 0 && paginated.every((c) => selected.has(c.id));
  const toggleSelectAllPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) paginated.forEach((c) => next.delete(c.id));
      else paginated.forEach((c) => next.add(c.id));
      return next;
    });
  };
  const toggleSelectOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = async () => {
    if (!bulkAction || selectedIds.length === 0) return;
    try {
      if (bulkAction === "archive") {
        await Promise.all(selectedIds.map((id) => archiveCampaign.mutateAsync(id)));
        toast({ title: `Archived ${selectedIds.length} campaign${selectedIds.length > 1 ? "s" : ""}` });
      } else if (bulkAction === "restore") {
        await Promise.all(selectedIds.map((id) => restoreCampaign.mutateAsync(id)));
        toast({ title: `Restored ${selectedIds.length} campaign${selectedIds.length > 1 ? "s" : ""}` });
      } else if (bulkAction === "delete") {
        await deleteCampaignsBulk.mutateAsync(selectedIds);
      }
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: "Bulk action failed", description: e?.message || "", variant: "destructive" });
    } finally {
      setBulkAction(null);
    }
  };

  const exportSelectedCsv = () => {
    const rows = filtered.filter((c) => selected.has(c.id));
    if (rows.length === 0) return;
    const header = ["Name", "Type", "Priority", "Status", "Channel", "Tags", "Owner", "Start", "End"];
    const body = rows.map((c: any) => [
      c.campaign_name,
      campaignTypeLabel(c.campaign_type) || "",
      c.priority || "Medium",
      c.status || "Draft",
      c.primary_channel || "",
      Array.isArray(c.tags) ? c.tags.join("; ") : "",
      c.owner ? displayNames[c.owner] || "" : "",
      c.start_date || "",
      c.end_date || "",
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getExportFilename("campaigns", "selected");
    a.click();
    URL.revokeObjectURL(url);
  };

  // Keyboard shortcuts (Phase 2.12)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
      if (isEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setEditCampaign(null);
        setModalOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        setView(view === "dashboard" ? "list" : "dashboard");
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setArchiveView(archiveView === "active" ? "archived" : "active");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, archiveView]);

  const getStrategyBadge = (campaignId: string) => {
    const { count, total } = getStrategyProgress(campaignId);
    let colorClass = "bg-muted text-muted-foreground";
    if (count === total) colorClass = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    else if (count > 0) colorClass = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
    return <Badge className={colorClass} variant="secondary">{count}/{total}</Badge>;
  };

  const bulkCount = selectedIds.length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 h-16 px-6 border-b bg-background flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">Campaigns</h1>
          <Badge variant="secondary">{displayedCampaigns.length}</Badge>
          {archiveView === "archived" && <Badge variant="outline" className="text-xs">Archived</Badge>}
        </div>
        <div className="flex items-center gap-3">
          <ToggleGroup
            type="single"
            value={archiveView}
            onValueChange={(v) => v && setArchiveView(v as "active" | "archived")}
            size="sm"
            className="border border-border rounded-md p-0.5 bg-muted/40 gap-0.5"
          >
            <ToggleGroupItem value="active" className="h-7 px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border">
              Active
            </ToggleGroupItem>
            <ToggleGroupItem value="archived" className="h-7 px-3 text-xs data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border">
              <Archive className="h-3.5 w-3.5 mr-1" /> Archived
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v)}
            size="sm"
            className="border border-border rounded-md p-0.5 bg-muted/40 gap-0.5"
          >
            <ToggleGroupItem value="dashboard" aria-label="Dashboard view" className="h-7 px-2 data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view" className="h-7 px-2 data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Campaign
          </Button>
        </div>
      </div>

      {/* Filters — list view */}
      {view === "list" && (
        <div className="flex items-center gap-3 px-6 py-3 bg-muted/30 border-b flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search name, owner, tag, type... (press /)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {CAMPAIGN_TYPE_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              {CHANNEL_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-9" onClick={clearAllFilters}>
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>
      )}

      {/* Bulk actions bar */}
      {view === "list" && bulkCount > 0 && (
        <div className="flex-shrink-0 px-6 py-2 bg-primary/5 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-primary text-primary-foreground">
              {bulkCount} selected
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportSelectedCsv}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
            {archiveView === "active" && (
              <Button variant="outline" size="sm" onClick={() => setBulkAction("archive")}>
                <Archive className="h-3.5 w-3.5 mr-1" /> Archive
              </Button>
            )}
            {archiveView === "archived" && (
              <Button variant="outline" size="sm" onClick={() => setBulkAction("restore")}>
                <ArchiveRestore className="h-3.5 w-3.5 mr-1" /> Restore
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => setBulkAction("delete")}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {view === "dashboard" ? (
        <CampaignDashboard
          campaigns={displayedCampaigns}
          archiveView={archiveView}
          getStrategyProgress={getStrategyProgress}
          getStrategyDetail={getStrategyDetail}
          onEdit={(c) => { setEditCampaign(c); setModalOpen(true); }}
          onClone={(id) => {
            cloneCampaign.mutateAsync(id).then((res) => {
              if (res?.slug) navigate(`/campaigns/${res.slug}`);
              else if (res?.id) navigate(`/campaigns/${res.id}`);
            });
          }}
          onArchive={(id) => setArchiveId(id)}
          onRestore={(id) => restoreCampaign.mutate(id)}
          onDelete={(id) => setDeleteId(id)}
          onCreate={() => setWizardOpen(true)}
          onOpenAccount={(id) => setEditAccountId(id)}
          onOpenContact={(id) => setEditContactId(id)}
        />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-3">
                {hasActiveFilters ? (
                  <>
                    <p>No campaigns match your filters</p>
                    <Button variant="outline" size="sm" onClick={clearAllFilters}>
                      <X className="h-4 w-4 mr-2" /> Clear filters
                    </Button>
                  </>
                ) : (
                  <>
                    <p>{archiveView === "archived" ? "No archived campaigns" : "No campaigns yet"}</p>
                    {archiveView === "active" && (
                      <Button onClick={() => { setEditCampaign(null); setModalOpen(true); }}>
                        <Plus className="h-4 w-4 mr-2" /> Create your first campaign
                      </Button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <TooltipProvider delayDuration={200}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={pageAllSelected}
                          onCheckedChange={toggleSelectAllPage}
                          aria-label="Select all on this page"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead className="w-[140px]">Status</TableHead>
                      <TableHead>Strategy</TableHead>
                      <TableHead className="w-[150px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((campaign: any) => {
                      const isSelected = selected.has(campaign.id);
                      const allowed = allowedTransitions(campaign.status as CampaignStatus, !!campaign.mart_complete);
                      const currentStatus = (campaign.status || "Draft") as CampaignStatus;
                      const inlineOptions = STATUS_OPTIONS.filter(
                        (o) => o.value === currentStatus || allowed.includes(o.value)
                      );
                      const disableInline = archiveView === "archived" || inlineOptions.length <= 1;
                      return (
                        <TableRow
                          key={campaign.id}
                          className={`cursor-pointer hover:bg-muted/50 ${campaign.archived_at ? "opacity-60" : ""} ${isSelected ? "bg-primary/5" : ""}`}
                          onMouseEnter={() => prefetchCampaign(campaign.id)}
                          onClick={() => {
                            // Always prefer the canonical slug from the DB trigger to
                            // avoid the URL flicker caused by the detail page rewriting it.
                            const slug = campaign.slug || campaign.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                            navigate(`/campaigns/${slug}`);
                          }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelectOne(campaign.id)}
                              aria-label={`Select ${campaign.campaign_name}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {campaign.campaign_name}
                            {campaign.archived_at && (
                              <Badge variant="outline" className="ml-2 text-xs">Archived</Badge>
                            )}
                            {Array.isArray(campaign.tags) && campaign.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {campaign.tags.slice(0, 3).map((t: string) => (
                                  <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                                ))}
                                {campaign.tags.length > 3 && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-[10px] text-muted-foreground cursor-help">+{campaign.tags.length - 3}</span>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">
                                      {campaign.tags.slice(3).join(", ")}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>{campaignTypeLabel(campaign.campaign_type)}</TableCell>
                          <TableCell>
                            <Badge className={PRIORITY_BADGE_CLASS[campaign.priority || "Medium"]} variant="secondary">
                              {campaign.priority || "Medium"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{campaign.primary_channel || "—"}</TableCell>
                          <TableCell>{campaign.owner ? displayNames[campaign.owner] || "—" : "—"}</TableCell>
                          <TableCell>{campaign.start_date ? format(new Date(campaign.start_date + "T00:00:00"), "dd MMM yyyy") : "—"}</TableCell>
                          <TableCell>{campaign.end_date ? format(new Date(campaign.end_date + "T00:00:00"), "dd MMM yyyy") : "—"}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {disableInline ? (
                              <Badge className={STATUS_BADGE[campaign.status || "Draft"]} variant="secondary">
                                {campaign.status || "Draft"}
                              </Badge>
                            ) : (
                              <Select
                                value={currentStatus}
                                onValueChange={(v) => handleInlineStatusChange(campaign, v)}
                              >
                                <SelectTrigger className="h-7 text-xs w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {inlineOptions.map((o) => (
                                    <SelectItem
                                      key={o.value}
                                      value={o.value}
                                      disabled={o.value !== currentStatus && !allowed.includes(o.value)}
                                    >
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>{getStrategyBadge(campaign.id)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <Tooltip><TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                  const slug = campaign.slug || campaign.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                                  navigate(`/campaigns/${slug}`);
                                }}>
                                  <Eye className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger><TooltipContent>View</TooltipContent></Tooltip>
                              {!campaign.archived_at && (
                                <>
                                  <Tooltip><TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditCampaign(campaign); setModalOpen(true); }}>
                                      <Edit2 className="h-4 w-4 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger><TooltipContent>Edit</TooltipContent></Tooltip>
                                  <Tooltip><TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => cloneCampaign.mutateAsync(campaign.id).then((res) => {
                                        if (res?.slug) navigate(`/campaigns/${res.slug}`);
                                        else if (res?.id) navigate(`/campaigns/${res.id}`);
                                      })}
                                    >
                                      <Copy className="h-4 w-4 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger><TooltipContent>Clone</TooltipContent></Tooltip>
                                  <Tooltip><TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setArchiveId(campaign.id)}>
                                      <Archive className="h-4 w-4 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger><TooltipContent>Archive</TooltipContent></Tooltip>
                                </>
                              )}
                              {campaign.archived_at && (
                                <>
                                  <Tooltip><TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => restoreCampaign.mutate(campaign.id)}>
                                      <ArchiveRestore className="h-4 w-4 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger><TooltipContent>Restore</TooltipContent></Tooltip>
                                  <Tooltip><TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteId(campaign.id)}>
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </TooltipTrigger><TooltipContent>Delete permanently</TooltipContent></Tooltip>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            )}
          </div>
          {filtered.length > 0 && (
            <StandardPagination
              currentPage={effectivePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              itemsPerPage={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              entityName="campaigns"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          )}
        </div>
      )}

      <CampaignModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditCampaign(null); }}
        campaign={editCampaign}
        onCreated={(id) => navigate(`/campaigns/${id}`)}
      />

      <FirstRunWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      <AccountModal
        open={!!editAccountId && !!editAccount}
        onOpenChange={(o) => !o && setEditAccountId(null)}
        account={editAccount as any}
        onSuccess={() => {
          setEditAccountId(null);
          queryClient.invalidateQueries({ queryKey: ["campaign-stats-accounts"] });
        }}
      />

      <ContactModal
        open={!!editContactId && !!editContact}
        onOpenChange={(o) => !o && setEditContactId(null)}
        contact={editContact as any}
        onSuccess={() => {
          setEditContactId(null);
          queryClient.invalidateQueries({ queryKey: ["campaign-stats-contacts"] });
        }}
      />

      <AlertDialog open={!!archiveId} onOpenChange={(v) => !v && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Campaign</AlertDialogTitle>
            <AlertDialogDescription>This campaign will be moved to the archive. You can restore it later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the campaign and everything attached to it:
              accounts, contacts, communications, templates, sequences, segments,
              send caps, timing windows, follow-up rules, queued send jobs, and any
              linked action items / reminders. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePermanentDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk action confirm */}
      <AlertDialog open={!!bulkAction} onOpenChange={(v) => !v && setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === "archive" && `Archive ${bulkCount} campaign${bulkCount > 1 ? "s" : ""}?`}
              {bulkAction === "restore" && `Restore ${bulkCount} campaign${bulkCount > 1 ? "s" : ""}?`}
              {bulkAction === "delete" && `Delete ${bulkCount} campaign${bulkCount > 1 ? "s" : ""} permanently?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === "archive" && "Selected campaigns will be moved to the archive. You can restore them later."}
              {bulkAction === "restore" && "Selected campaigns will be moved back to the active list."}
              {bulkAction === "delete" && "This permanently removes the selected campaigns and everything attached to them: accounts, contacts, communications, templates, sequences, segments, send caps, timing windows, follow-up rules, queued send jobs, and any linked action items / reminders. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runBulk}
              className={bulkAction === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
