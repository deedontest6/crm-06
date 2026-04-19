import { useParams, useNavigate } from "react-router-dom";
import { useCampaignDetail, useCampaigns, type CampaignDetailEnabledTabs } from "@/hooks/useCampaigns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  const [activateOpen, setActivateOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const autoCompleteRef = useRef(false);

  // Auto-complete campaign when end date is reached (Active or Paused)
  useEffect(() => {
    if (
      detail.campaign &&
      detail.isCampaignEnded &&
      (detail.campaign.status === "Active" || detail.campaign.status === "Paused") &&
      !autoCompleteRef.current
    ) {
      autoCompleteRef.current = true;
      updateCampaign.mutate({ id: detail.campaign.id, status: "Completed" });
      const endStr = detail.campaign.end_date
        ? format(new Date(detail.campaign.end_date + "T00:00:00"), "dd-MM-yy")
        : "";
      toast.info(`This campaign ended on ${endStr} and has been marked Completed.`);
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

  const currentStatus = campaign.status || "Draft";
  const isCompleted = currentStatus === "Completed";
  const isDraftEndedPast = currentStatus === "Draft" && isCampaignEnded;
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isBeforeStart = !!campaign.start_date && todayStr < campaign.start_date;

  type MenuOpt = { value: string; label: string; disabled: boolean; reason?: string };
  const buildMenuOptions = (): MenuOpt[] => {
    if (isCompleted) return [];
    const opts: MenuOpt[] = [];

    if (currentStatus !== "Draft") {
      const canRevert = currentStatus === "Paused";
      opts.push({
        value: "Draft",
        label: "Revert to Draft",
        disabled: !canRevert,
        reason: canRevert ? undefined : "Only Paused campaigns can revert to Draft",
      });
    }

    if (currentStatus !== "Active") {
      const label = currentStatus === "Paused" ? "Resume" : "Activate";
      opts.push({
        value: "Active",
        label,
        disabled: !isFullyStrategyComplete,
        reason: isFullyStrategyComplete ? undefined : "Complete all 4 Strategy sections first",
      });
    }

    if (currentStatus === "Active") {
      opts.push({ value: "Paused", label: "Pause", disabled: false });
    }

    opts.push({
      value: "Completed",
      label: "Mark Completed",
      disabled: currentStatus === "Draft",
      reason: currentStatus === "Draft" ? "Activate the campaign before completing it" : undefined,
    });

    return opts;
  };

  const performStatusChange = (newStatus: string) => {
    updateCampaign.mutate({ id: campaign.id, status: newStatus });
  };

  const handleStatusChange = (newStatus: string) => {
    if (isCompleted) {
      toast.error("Completed campaigns cannot be reactivated.");
      return;
    }
    if (newStatus === "Active") {
      if (!isFullyStrategyComplete) {
        toast.error("Complete all 4 Strategy sections before activating.");
        return;
      }
      setActivateOpen(true);
      return;
    }
    if (newStatus === "Completed") {
      setCompleteOpen(true);
      return;
    }
    performStatusChange(newStatus);
  };

  const statusDot: Record<string, string> = {
    Draft: "bg-muted-foreground",
    Active: "bg-primary",
    Paused: "bg-yellow-500",
    Completed: "bg-green-500",
  };

  return (
    <TooltipProvider delayDuration={150}>
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 border-b bg-background">
        <div className="h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground truncate">{campaign.campaign_name}</h1>
              <p className="text-sm text-muted-foreground truncate">
                {campaign.campaign_type} · Owner: {campaign.owner ? displayNames[campaign.owner] || "—" : "—"}
                {campaign.start_date && campaign.end_date && (
                  <> · {format(new Date(campaign.start_date + "T00:00:00"), "dd-MM-yy")} → {format(new Date(campaign.end_date + "T00:00:00"), "dd-MM-yy")}</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={isCompleted}>
                <Button size="sm" className={`gap-1.5 border ${statusColors[currentStatus]} hover:opacity-90`}>
                  <span className={`inline-block h-2 w-2 rounded-full ${statusDot[currentStatus]}`} />
                  {currentStatus}
                  {!isCompleted && <ChevronDown className="h-3 w-3" />}
                </Button>
              </DropdownMenuTrigger>
              {!isCompleted && (
                <DropdownMenuContent align="end" className="w-56">
                  {buildMenuOptions().map((opt) => {
                    const item = (
                      <DropdownMenuItem
                        key={opt.value}
                        disabled={opt.disabled}
                        onSelect={(e) => {
                          if (opt.disabled) { e.preventDefault(); return; }
                          handleStatusChange(opt.value);
                        }}
                        className="flex items-center gap-2"
                      >
                        <span className={`inline-block h-2 w-2 rounded-full ${statusDot[opt.value]}`} />
                        <span className="flex-1">{opt.label}</span>
                      </DropdownMenuItem>
                    );
                    if (opt.disabled && opt.reason) {
                      return (
                        <Tooltip key={opt.value}>
                          <TooltipTrigger asChild><div>{item}</div></TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[220px] text-xs">{opt.reason}</TooltipContent>
                        </Tooltip>
                      );
                    }
                    return item;
                  })}
                  {buildMenuOptions().length === 0 && (
                    <DropdownMenuItem disabled>No status changes available</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              )}
            </DropdownMenu>

            {isCampaignEnded && !isCompleted && (
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
        {isDraftEndedPast && (
          <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            End date has passed while still in Draft. Activate, reschedule, or mark complete.
          </div>
        )}
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
              {(currentStatus === "Active" || currentStatus === "Paused") && (
                <span className="block mt-2 text-destructive font-medium">
                  Warning: this campaign is currently {currentStatus}. Archiving will remove it from active monitoring.
                </span>
              )}
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

      <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{currentStatus === "Paused" ? "Resume Campaign?" : "Activate Campaign?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {currentStatus === "Paused"
                ? "Resuming will continue outreach and monitoring for this campaign."
                : "Activating will start outreach and begin monitoring. Make sure your Strategy and audience are ready."}
              {isBeforeStart && campaign.start_date && (
                <span className="block mt-2 text-yellow-700 dark:text-yellow-400 font-medium">
                  Note: scheduled start date is {format(new Date(campaign.start_date + "T00:00:00"), "dd-MM-yy")}. Activate now anyway?
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { performStatusChange("Active"); setActivateOpen(false); }}>
              {currentStatus === "Paused" ? "Resume" : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as Completed?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is permanent. Once completed, the campaign cannot be reactivated, edited as Active, or paused. Outreach and monitoring will stop.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { performStatusChange("Completed"); setCompleteOpen(false); }}
            >
              Mark Completed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
}
