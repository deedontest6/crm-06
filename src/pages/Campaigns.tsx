import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Eye, Edit2, Copy, Archive, ArchiveRestore, LayoutGrid, List } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useMemo } from "react";
import { CampaignModal } from "@/components/campaigns/CampaignModal";
import { CampaignDashboard } from "@/components/campaigns/CampaignDashboard";
import { format } from "date-fns";
import { CAMPAIGN_TYPE_OPTIONS, campaignTypeLabel, PRIORITY_BADGE_CLASS } from "@/utils/campaignTypeLabel";
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

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Active: "bg-primary/10 text-primary",
  Paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export default function Campaigns() {
  const navigate = useNavigate();
  const { campaigns, archivedCampaigns, isLoading, archiveCampaign, restoreCampaign, cloneCampaign, getStrategyProgress } = useCampaigns();
  const [view, setView] = useState<string>("dashboard");
  const [archiveView, setArchiveView] = useState<"active" | "archived">("active");
  const displayedCampaigns = archiveView === "active" ? campaigns : archivedCampaigns;
  const ownerIds = useMemo(() => displayedCampaigns.map((c) => c.owner).filter(Boolean) as string[], [displayedCampaigns]);
  const { displayNames } = useUserDisplayNames(ownerIds);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<any>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const filtered = displayedCampaigns.filter((c: any) => {
    const matchesSearch = c.campaign_name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const matchesType = typeFilter === "all" || campaignTypeLabel(c.campaign_type) === typeFilter;
    const matchesPriority = priorityFilter === "all" || (c.priority || "Medium") === priorityFilter;
    return matchesSearch && matchesStatus && matchesType && matchesPriority;
  });

  const handleArchive = () => {
    if (archiveId) {
      archiveCampaign.mutate(archiveId);
      setArchiveId(null);
    }
  };

  const getStrategyBadge = (campaignId: string) => {
    const { count, total } = getStrategyProgress(campaignId);
    let colorClass = "bg-muted text-muted-foreground";
    if (count === total) colorClass = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    else if (count > 0) colorClass = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
    return <Badge className={colorClass} variant="secondary">{count}/{total}</Badge>;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header - aligned with other modules */}
      <div className="flex-shrink-0 h-16 px-6 border-b bg-background flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">Campaigns</h1>
          <Badge variant="secondary">{campaigns.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v)} size="sm">
            <ToggleGroupItem value="dashboard" aria-label="Dashboard view">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" onClick={() => { setEditCampaign(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> New Campaign
          </Button>
        </div>
      </div>

      {/* Filters - only in list view */}
      {view === "list" && (
        <div className="flex items-center gap-3 px-6 py-3 bg-muted/30 border-b flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search campaigns..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Paused">Paused</SelectItem>
              <SelectItem value="Completed">Completed</SelectItem>
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
          <div className="flex items-center gap-1 ml-auto">
            <Button
              variant={archiveView === "active" ? "default" : "outline"}
              size="sm"
              onClick={() => setArchiveView("active")}
            >
              Active
            </Button>
            <Button
              variant={archiveView === "archived" ? "default" : "outline"}
              size="sm"
              onClick={() => setArchiveView("archived")}
            >
              <Archive className="h-3.5 w-3.5 mr-1" />
              Archived
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {view === "dashboard" ? (
        <CampaignDashboard campaigns={campaigns} getStrategyProgress={getStrategyProgress} />
      ) : (
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-3">
              <p>{archiveView === "archived" ? "No archived campaigns" : "No campaigns yet"}</p>
              {archiveView === "active" && (
                <Button onClick={() => { setEditCampaign(null); setModalOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" /> Create your first campaign
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((campaign: any) => (
                  <TableRow
                    key={campaign.id}
                    className={`cursor-pointer hover:bg-muted/50 ${campaign.archived_at ? "opacity-60" : ""}`}
                    onClick={() => {
                      const slug = campaign.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                      navigate(`/campaigns/${slug}`);
                    }}
                  >
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
                            <span className="text-[10px] text-muted-foreground">+{campaign.tags.length - 3}</span>
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
                    <TableCell>
                      <Badge className={statusColors[campaign.status || "Draft"]} variant="secondary">{campaign.status}</Badge>
                    </TableCell>
                    <TableCell>{getStrategyBadge(campaign.id)}</TableCell>
                    <TableCell>
                      <TooltipProvider delayDuration={300}>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Tooltip><TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                              const slug = campaign.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
                                  onClick={() => cloneCampaign.mutateAsync(campaign.id).then((newId) => { if (newId) { const slug = (campaign.campaign_name + " (Copy)").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); navigate(`/campaigns/${slug}`); } })}
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
                            <Tooltip><TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => restoreCampaign.mutate(campaign.id)}
                              >
                                <ArchiveRestore className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </TooltipTrigger><TooltipContent>Restore</TooltipContent></Tooltip>
                          )}
                        </div>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <CampaignModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditCampaign(null); }}
        campaign={editCampaign}
        onCreated={(id) => navigate(`/campaigns/${id}`)}
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
    </div>
  );
}
