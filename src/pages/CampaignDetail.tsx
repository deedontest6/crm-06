import { useParams, useNavigate } from "react-router-dom";
import { useCampaignDetail, useCampaigns, type CampaignDetailEnabledTabs } from "@/hooks/useCampaigns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertTriangle, ChevronDown, Trash2, Copy, Archive, Pencil, MoreHorizontal } from "lucide-react";
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
import { format } from "date-fns";
import { toast } from "sonner";
import { CampaignModal } from "@/components/campaigns/CampaignModal";
import { CampaignOverview } from "@/components/campaigns/CampaignOverview";

// Lazy-load heavy tab content so its code & queries don't run until the tab is opened
const CampaignStrategy = lazy(() =>
  import("@/components/campaigns/CampaignStrategy").then((m) => ({ default: m.CampaignStrategy }))
);
const CampaignCommunications = lazy(() =>
  import("@/components/campaigns/CampaignCommunications").then((m) => ({ default: m.CampaignCommunications }))
);
const CampaignAnalytics = lazy(() =>
  import("@/components/campaigns/CampaignAnalytics").then((m) => ({ default: m.CampaignAnalytics }))
);
const CampaignActionItems = lazy(() =>
  import("@/components/campaigns/CampaignActionItems").then((m) => ({ default: m.CampaignActionItems }))
);

const TabFallback = () => (
  <div className="space-y-3 py-2">
    <div className="h-24 rounded-lg bg-muted animate-pulse" />
    <div className="h-48 rounded-lg bg-muted animate-pulse" />
  </div>
);

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Active: "bg-primary/10 text-primary",
  Paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

export default function CampaignDetail() {
  const { id: rawId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Support multiple URL formats: UUID, slug--UUID, or slug-only
  const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const extractedId = rawId?.includes("--") ? rawId.split("--").pop() : rawId;
  const isDirectUUID = extractedId ? isUUID(extractedId) : false;
  
  // If it's a slug-only URL, look up campaign by name
  const { campaigns } = useCampaigns();
  const id = useMemo(() => {
    if (isDirectUUID) return extractedId;
    // Slug-only: find campaign whose slugified name matches
    if (rawId && campaigns.length > 0) {
      const match = campaigns.find(c => {
        const slug = c.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return slug === rawId;
      });
      if (match) return match.id;
    }
    return extractedId;
  }, [extractedId, isDirectUUID, rawId, campaigns]);

  const [activeTab, setActiveTab] = useState("overview");
  const enabledTabs = useMemo<CampaignDetailEnabledTabs>(() => ({
    overview: true, // always needed for the default landing tab
    setup: activeTab === "setup",
    monitoring: activeTab === "monitoring",
    actionItems: activeTab === "actionItems",
  }), [activeTab]);
  const detail = useCampaignDetail(id, enabledTabs);
  const { updateCampaign, deleteCampaign, archiveCampaign, cloneCampaign } = useCampaigns();
  const ownerIds = useMemo(() => [detail.campaign?.owner].filter(Boolean) as string[], [detail.campaign?.owner]);
  const { displayNames } = useUserDisplayNames(ownerIds);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const autoCompleteRef = useRef(false);

  // Auto-complete campaign when end date is reached (only if Active)
  useEffect(() => {
    if (
      detail.campaign &&
      detail.isCampaignEnded &&
      detail.campaign.status === "Active" &&
      !autoCompleteRef.current
    ) {
      autoCompleteRef.current = true;
      updateCampaign.mutate({ id: detail.campaign.id, status: "Completed" });
      toast.info(`This campaign ended on ${detail.campaign.end_date} and has been marked Completed.`);
    }
  }, [detail.campaign, detail.isCampaignEnded]);

  // Set document title and update URL to show campaign name only (no UUID)
  useEffect(() => {
    if (detail.campaign?.campaign_name) {
      document.title = `${detail.campaign.campaign_name} — Campaign`;
      const slug = detail.campaign.campaign_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const newUrl = `/campaigns/${slug}`;
      window.history.replaceState(null, "", newUrl);
    }
    return () => { document.title = "CRM"; };
  }, [detail.campaign?.campaign_name]);

  if (detail.isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-muted animate-pulse" />
          <div className="h-6 w-64 rounded bg-muted animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (!detail.campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Campaign not found</p>
        <Button variant="outline" onClick={() => navigate("/campaigns")}>Back to Campaigns</Button>
      </div>
    );
  }

  const { campaign, isStrategyComplete, strategyProgress, isFullyStrategyComplete, isCampaignEnded, daysRemaining } = detail;

  // Status transition rules
  const handleStatusChange = (newStatus: string) => {
    const current = campaign.status || "Draft";

    // Completed lock
    if (current === "Completed") {
      toast.error("Completed campaigns cannot be reactivated.");
      return;
    }

    // Strategy gate for Active
    if (newStatus === "Active" && !isFullyStrategyComplete) {
      toast.error("Complete all 4 Strategy sections before activating this campaign.");
      return;
    }

    updateCampaign.mutate({ id: campaign.id, status: newStatus });
  };

  const getAvailableStatuses = () => {
    const current = campaign.status || "Draft";
    if (current === "Completed") return [];
    const statuses = ["Draft", "Paused", "Completed"];
    if (isFullyStrategyComplete) statuses.splice(1, 0, "Active");
    return statuses.filter((s) => s !== current);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 h-16 px-6 border-b bg-background flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground truncate">{campaign.campaign_name}</h1>
            <p className="text-sm text-muted-foreground truncate">
              {campaign.campaign_type} · Owner: {campaign.owner ? displayNames[campaign.owner] || "—" : "—"}
              {campaign.start_date && campaign.end_date && (
                <> · {format(new Date(campaign.start_date + "T00:00:00"), "dd MMM yyyy")} → {format(new Date(campaign.end_date + "T00:00:00"), "dd MMM yyyy")}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className={`gap-1 border ${statusColors[campaign.status || "Draft"]} hover:opacity-90`}>
                {campaign.status || "Draft"}
                {campaign.status !== "Completed" && <ChevronDown className="h-3 w-3" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {getAvailableStatuses().map((s) => (
                <DropdownMenuItem key={s} onClick={() => handleStatusChange(s)}>
                  <Badge className={`${statusColors[s]} mr-2`} variant="secondary">{s}</Badge>
                  Set to {s}
                </DropdownMenuItem>
              ))}
              {getAvailableStatuses().length === 0 && (
                <DropdownMenuItem disabled>No status changes available</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {isCampaignEnded && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Ended
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <MoreHorizontal className="h-3.5 w-3.5" /> Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => cloneCampaign.mutateAsync(campaign.id).then((newId) => { if (newId) { const slug = (campaign.campaign_name + " (Copy)").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); navigate(`/campaigns/${slug}`); } })}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Clone
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
                <Archive className="h-3.5 w-3.5 mr-2" /> Archive
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 4 Tabs */}
      <div className="flex-1 overflow-hidden px-6 pt-3 pb-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="w-full grid grid-cols-4 h-10">
            <TabsTrigger value="overview" className="text-sm h-9">Overview</TabsTrigger>
            <TabsTrigger value="setup" className="text-sm h-9">Setup</TabsTrigger>
            <TabsTrigger value="monitoring" className="text-sm h-9">Monitoring</TabsTrigger>
            <TabsTrigger value="actionItems" className="text-sm h-9">Action Items</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto mt-3">
            <TabsContent value="overview" className="mt-0">
              <CampaignOverview
                campaign={campaign}
                accounts={detail.accounts}
                contacts={detail.contacts}
                communications={detail.communications}
                isStrategyComplete={isStrategyComplete}
                strategyProgress={strategyProgress}
                onTabChange={setActiveTab}
              />
            </TabsContent>

            <TabsContent value="setup" className="mt-0">
              <Suspense fallback={<TabFallback />}>
                <CampaignStrategy
                  campaignId={campaign.id}
                  campaign={campaign}
                  isStrategyComplete={isStrategyComplete}
                  updateStrategyFlag={detail.updateStrategyFlag}
                  isCampaignEnded={isCampaignEnded}
                  daysRemaining={daysRemaining}
                  timingNotes={detail.strategy?.timing_notes}
                  campaignName={campaign.campaign_name}
                  campaignOwner={campaign.owner}
                  endDate={campaign.end_date}
                  contentCounts={{
                    emailTemplateCount: detail.emailTemplates.filter(t => t.email_type !== "LinkedIn-Connection" && t.email_type !== "LinkedIn-Followup").length,
                    phoneScriptCount: detail.phoneScripts.length,
                    linkedinTemplateCount: detail.emailTemplates.filter(t => t.email_type === "LinkedIn-Connection" || t.email_type === "LinkedIn-Followup").length,
                    materialCount: detail.materials.length,
                    regionCount: (() => { try { const arr = JSON.parse(campaign.region || ""); return Array.isArray(arr) ? arr.length : 0; } catch { return campaign.region ? 1 : 0; } })(),
                    accountCount: detail.accounts.length,
                    contactCount: detail.contacts.length,
                  }}
                />
              </Suspense>
            </TabsContent>

            <TabsContent value="monitoring" className="mt-0">
              <Tabs defaultValue="outreach" className="w-full">
                <TabsList className="h-8 mb-3">
                  <TabsTrigger value="outreach" className="text-xs h-7">Outreach</TabsTrigger>
                  <TabsTrigger value="analytics" className="text-xs h-7">Analytics</TabsTrigger>
                </TabsList>
                <TabsContent value="outreach" className="mt-0">
                  <Suspense fallback={<TabFallback />}>
                    <CampaignCommunications campaignId={campaign.id} isCampaignEnded={isCampaignEnded} />
                  </Suspense>
                </TabsContent>
                <TabsContent value="analytics" className="mt-0">
                  <Suspense fallback={<TabFallback />}>
                    <CampaignAnalytics campaignId={campaign.id} />
                  </Suspense>
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="actionItems" className="mt-0">
              <Suspense fallback={<TabFallback />}>
                <CampaignActionItems campaignId={campaign.id} />
              </Suspense>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <CampaignModal open={editOpen} onClose={() => setEditOpen(false)} campaign={campaign} isStrategyComplete={isFullyStrategyComplete} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{campaign.campaign_name}" and all associated accounts, contacts, communications, templates, and materials. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteCampaign.mutate(campaign.id, { onSuccess: () => navigate("/campaigns") });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              This campaign will be moved to the archive. You can restore it later from the campaigns list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              archiveCampaign.mutate(campaign.id, { onSuccess: () => navigate("/campaigns") });
            }}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
