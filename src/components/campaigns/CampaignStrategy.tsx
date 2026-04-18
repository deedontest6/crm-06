import { useState, useMemo } from "react";
// Card imports removed — using divide-y container instead
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Circle, ChevronDown, ChevronsUpDown, Mail, Users, Globe, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { CampaignMessage } from "./CampaignMessage";
import { CampaignAudience } from "./CampaignAudience";
import { CampaignRegion } from "./CampaignRegion";
import { CampaignTiming } from "./CampaignTiming";
import type { Campaign } from "@/hooks/useCampaigns";

interface Props {
  campaignId: string;
  campaign: Campaign;
  isStrategyComplete: { message: boolean; audience: boolean; region: boolean; timing: boolean };
  updateStrategyFlag: (flag: string, value: boolean) => Promise<void>;
  isCampaignEnded: boolean;
  daysRemaining: number | null;
  timingNotes?: string | null;
  campaignName?: string;
  campaignOwner?: string | null;
  endDate?: string | null;
  contentCounts?: {
    emailTemplateCount: number;
    phoneScriptCount: number;
    linkedinTemplateCount: number;
    materialCount: number;
    regionCount: number;
    accountCount: number;
    contactCount: number;
  };
}

export function parseSelectedRegions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return Array.from(new Set(arr.map((r: any) => r.region).filter(Boolean)));
    }
  } catch {}
  return raw && !raw.startsWith("[") ? [raw] : [];
}

export function CampaignStrategy({ campaignId, campaign, isStrategyComplete, updateStrategyFlag, isCampaignEnded, daysRemaining, timingNotes, campaignName, campaignOwner, endDate, contentCounts }: Props) {
  const queryClient = useQueryClient();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    region: true, audience: false, message: false, timing: false,
  });

  const selectedRegions = useMemo(() => parseSelectedRegions(campaign.region), [campaign.region]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAll = () => {
    const allOpen = Object.values(openSections).every(Boolean);
    const newState = { region: !allOpen, audience: !allOpen, message: !allOpen, timing: !allOpen };
    setOpenSections(newState);
  };

  const validateSection = (key: string): string | null => {
    const counts = contentCounts;
    switch (key) {
      case "region":
        if ((counts?.regionCount ?? 0) === 0)
          return "Add at least 1 region before marking Region as done.";
        return null;
      case "audience":
        if ((counts?.accountCount ?? 0) === 0 && (counts?.contactCount ?? 0) === 0)
          return "Add at least 1 account or contact before marking Audience as done.";
        return null;
      case "message":
        if (counts && counts.emailTemplateCount === 0 && counts.phoneScriptCount === 0 && counts.linkedinTemplateCount === 0)
          return "Add at least 1 email template, call script, or LinkedIn message before marking Message as done.";
        return null;
      case "timing":
        if (!campaign.start_date || !campaign.end_date)
          return "Set campaign start and end dates before marking Timing as done.";
        return null;
      default:
        return null;
    }
  };

  const handleMarkDone = async (flag: string, label: string, key: string) => {
    const validationError = validateSection(key);
    if (validationError) {
      toast.warning(validationError);
      return;
    }
    await updateStrategyFlag(flag, true);
    toast.success(`${label} marked as done`);
  };

  const handleUnmark = async (flag: string, label: string) => {
    await updateStrategyFlag(flag, false);
    toast.info(`${label} unmarked`);
  };

  const handleSaveTimingNotes = async (notes: string) => {
    if (!campaignId) return;
    const { data: existing } = await supabase.from("campaign_mart").select("campaign_id").eq("campaign_id", campaignId).maybeSingle();
    if (existing) {
      await supabase.from("campaign_mart").update({ timing_notes: notes }).eq("campaign_id", campaignId);
    } else {
      await supabase.from("campaign_mart").insert({ campaign_id: campaignId, timing_notes: notes });
    }
    queryClient.invalidateQueries({ queryKey: ["campaign-mart", campaignId] });
    toast.success("Timing note saved");
  };

  const completedCount = [isStrategyComplete.region, isStrategyComplete.audience, isStrategyComplete.message, isStrategyComplete.timing].filter(Boolean).length;
  const progressPercent = (completedCount / 4) * 100;

  const getContentSummary = (key: string): string => {
    if (!contentCounts) return "";
    switch (key) {
      case "region":
        return contentCounts.regionCount > 0 ? `${contentCounts.regionCount} region${contentCounts.regionCount > 1 ? "s" : ""}` : "No regions";
      case "audience":
        return `${contentCounts.accountCount} accounts · ${contentCounts.contactCount} contacts`;
      case "message": {
        const parts: string[] = [];
        if (contentCounts.emailTemplateCount > 0) parts.push(`${contentCounts.emailTemplateCount} email${contentCounts.emailTemplateCount > 1 ? "s" : ""}`);
        if (contentCounts.phoneScriptCount > 0) parts.push(`${contentCounts.phoneScriptCount} script${contentCounts.phoneScriptCount > 1 ? "s" : ""}`);
        if (contentCounts.linkedinTemplateCount > 0) parts.push(`${contentCounts.linkedinTemplateCount} LinkedIn`);
        return parts.join(", ");
      }
      case "timing":
        return campaign.start_date && campaign.end_date ? `${campaign.start_date} → ${campaign.end_date}` : "Dates not set";
      default:
        return "";
    }
  };

  const sectionIcons: Record<string, React.ReactNode> = {
    region: <Globe className="h-4 w-4" />,
    audience: <Users className="h-4 w-4" />,
    message: <Mail className="h-4 w-4" />,
    timing: <Clock className="h-4 w-4" />,
  };

  // Unified header styling — all sections use the Region (blue) theme
  const unifiedStyle = { header: "bg-blue-500/10 hover:bg-blue-500/15", icon: "text-blue-600 dark:text-blue-400", border: "border-l-4 border-l-blue-500" };
  const sectionStyles: Record<string, { header: string; icon: string; border: string }> = {
    region:   unifiedStyle,
    audience: unifiedStyle,
    message:  unifiedStyle,
    timing:   unifiedStyle,
  };

  // Order: Region → Audience → Message → Timing
  const sections = [
    { key: "region", label: "Region", flag: "region_done", done: isStrategyComplete.region },
    { key: "audience", label: "Audience", flag: "audience_done", done: isStrategyComplete.audience },
    { key: "message", label: "Message", flag: "message_done", done: isStrategyComplete.message },
    { key: "timing", label: "Timing", flag: "timing_done", done: isStrategyComplete.timing },
  ];

  const allOpen = Object.values(openSections).every(Boolean);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" className="text-[11px] gap-1 h-6" onClick={toggleAll}>
          <ChevronsUpDown className="h-3 w-3" />
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
      </div>

      <div className="border rounded-lg divide-y bg-card">
        {sections.map((section) => {
          const isOpen = openSections[section.key];
          return (
            <Collapsible key={section.key} open={isOpen} onOpenChange={() => toggleSection(section.key)}>
              <CollapsibleTrigger asChild>
                <div className={`py-2 px-3 cursor-pointer transition-colors ${sectionStyles[section.key].header} ${sectionStyles[section.key].border} ${section.done ? "opacity-60" : ""}`}>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (section.done) {
                            handleUnmark(section.flag, section.label);
                          } else {
                            handleMarkDone(section.flag, section.label, section.key);
                          }
                        }}
                        title={section.done ? `Unmark ${section.label}` : `Mark ${section.label} as done`}
                        className="shrink-0 rounded-full hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {section.done
                          ? <CheckCircle2 className="h-5 w-5 text-primary fill-primary/20" />
                          : <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />}
                      </button>
                      <span className={sectionStyles[section.key].icon}>{sectionIcons[section.key]}</span>
                      <span className={`text-sm font-semibold ${section.done ? "line-through text-muted-foreground" : ""}`}>{section.label}</span>
                    </div>
                    <div className="flex justify-center min-w-0">
                      {!isOpen && (() => {
                        const summary = getContentSummary(section.key);
                        return summary ? (
                          <span className="text-xs text-muted-foreground truncate">{summary}</span>
                        ) : null;
                      })()}
                    </div>
                    <div className="flex items-center justify-end gap-1 shrink-0">
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
                <div className="pt-1 pb-3 px-3">
                  {section.key === "region" && <CampaignRegion campaign={campaign} />}
                  {section.key === "audience" && (
                    <CampaignAudience
                      campaign={campaign}
                      selectedRegions={selectedRegions}
                      campaignName={campaignName}
                      campaignOwner={campaignOwner}
                      endDate={endDate}
                      isCampaignEnded={isCampaignEnded}
                    />
                  )}
                  {section.key === "message" && (
                    <CampaignMessage
                      campaignId={campaignId}
                      campaign={campaign}
                      selectedRegions={selectedRegions}
                      audienceCounts={{ accounts: contentCounts?.accountCount ?? 0, contacts: contentCounts?.contactCount ?? 0 }}
                    />
                  )}
                  {section.key === "timing" && (
                    <CampaignTiming
                      campaign={campaign}
                      isCampaignEnded={isCampaignEnded}
                      daysRemaining={daysRemaining}
                      timingNotes={timingNotes}
                      onSaveTimingNotes={handleSaveTimingNotes}
                    />
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
