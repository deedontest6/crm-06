import { useState, useMemo, useEffect } from "react";
// Card imports removed — using divide-y container instead
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, Circle, ChevronDown, ChevronsUpDown, Mail, Users, Globe, Clock } from "lucide-react";
// Tabs no longer used after Audience sub-tabs were removed.
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { CampaignMessage } from "./CampaignMessage";
import { CampaignAudience } from "./CampaignAudience";
import { CampaignRegion } from "./CampaignRegion";
import { CampaignTiming } from "./CampaignTiming";
// FollowUpRulesPanel removed — sequences own follow-up cadence as of Phase B.
// SequencesPanel was merged into CampaignTiming so the Timing accordion renders one cohesive panel.
// SegmentManager removed from Setup; legacy file kept for backwards compatibility with Communications/Message panels.
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
  initialOpenSection?: "region" | "audience" | "message" | "timing";
  audienceView?: "accounts" | "contacts";
  /** When true (campaign Completed), Message section hides create/edit actions. */
  isReadOnly?: boolean;
  contentCounts?: {
    emailTemplateCount: number;
    phoneScriptCount: number;
    linkedinTemplateCount: number;
    materialCount: number;
    regionCount: number;
    countryCount?: number;
    accountCount: number;
    contactCount: number;
    /** F2: number of audience contacts reachable on the campaign's primary channel. */
    reachableOnPrimary?: number;
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

export function CampaignStrategy({ campaignId, campaign, isStrategyComplete, updateStrategyFlag, isCampaignEnded, daysRemaining, timingNotes, initialOpenSection, audienceView, isReadOnly = false, contentCounts }: Props) {
  const queryClient = useQueryClient();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    region: true, audience: false, message: false, timing: false,
  });
  // Audience sub-tabs and the legacy SegmentManager were removed in favor of
  // an inline Account / Contact / Industry / Position filter inside CampaignAudience.

  useEffect(() => {
    if (!initialOpenSection) return;
    setOpenSections({
      region: initialOpenSection === "region",
      audience: initialOpenSection === "audience",
      message: initialOpenSection === "message",
      timing: initialOpenSection === "timing",
    });
  }, [initialOpenSection, audienceView]);

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
      case "region": {
        // Accept either a region OR a country selection. The compose payload
        // can be `[{country: 'DE'}]` with no region field — that's still a
        // valid geographic scope. Previously the validator only counted regions.
        let countryCount = 0;
        try {
          const parsed = campaign.region ? JSON.parse(campaign.region) : null;
          if (Array.isArray(parsed)) {
            countryCount = parsed.filter((r: any) => r?.country).length;
          }
        } catch { /* legacy plain-string region — ignore */ }
        if ((counts?.regionCount ?? 0) === 0 && countryCount === 0)
          return "Add at least 1 region or country before marking Region as done.";
        return null;
      }
      case "audience":
        if ((counts?.accountCount ?? 0) === 0 && (counts?.contactCount ?? 0) === 0)
          return "Add at least 1 account or contact before marking Audience as done.";
        // F2: at least one contact must be reachable on the chosen primary channel.
        // Skip when primary_channel isn't set yet — Message step will flag it.
        if (counts?.contactCount && counts?.reachableOnPrimary === 0 && campaign.primary_channel) {
          return `No audience contact is reachable on ${campaign.primary_channel}. Add contacts with valid ${campaign.primary_channel.toLowerCase()} details first.`;
        }
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
      toast({ title: validationError });
      return;
    }
    await updateStrategyFlag(flag, true);
    toast({ title: `${label} marked as done` });
  };

  const handleUnmark = async (flag: string, label: string) => {
    await updateStrategyFlag(flag, false);
    toast({ title: `${label} unmarked` });
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
    toast({ title: "Timing note saved" });
  };

  const completedCount = [isStrategyComplete.region, isStrategyComplete.audience, isStrategyComplete.message, isStrategyComplete.timing].filter(Boolean).length;
  const progressPercent = (completedCount / 4) * 100;

  const getContentSummary = (key: string): string => {
    if (!contentCounts) return "";
    switch (key) {
      case "region": {
        const r = contentCounts.regionCount;
        const c = contentCounts.countryCount ?? 0;
        if (r === 0 && c === 0) return "No regions";
        const parts: string[] = [];
        parts.push(`${r} region${r === 1 ? "" : "s"}`);
        if (c > 0) parts.push(`${c} countr${c === 1 ? "y" : "ies"}`);
        return parts.join(" · ");
      }
      case "audience": {
        const a = contentCounts.accountCount;
        const c = contentCounts.contactCount;
        return `${a} account${a === 1 ? "" : "s"} · ${c} contact${c === 1 ? "" : "s"}`;
      }
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
    region: <Globe className="h-[18px] w-[18px]" />,
    audience: <Users className="h-[18px] w-[18px]" />,
    message: <Mail className="h-[18px] w-[18px]" />,
    timing: <Clock className="h-[18px] w-[18px]" />,
  };

  // Per-section color theming (Region=blue, Audience=emerald, Message=purple, Timing=amber)
  // matches the rest of the app's color language and aids visual scanning.
  const sectionStyles: Record<string, { header: string; icon: string; border: string }> = {
    region:   { header: "bg-blue-500/10 hover:bg-blue-500/15",    icon: "text-blue-600 dark:text-blue-400",       border: "border-l-4 border-l-blue-500" },
    audience: { header: "bg-emerald-500/10 hover:bg-emerald-500/15", icon: "text-emerald-600 dark:text-emerald-400", border: "border-l-4 border-l-emerald-500" },
    message:  { header: "bg-purple-500/10 hover:bg-purple-500/15", icon: "text-purple-600 dark:text-purple-400",   border: "border-l-4 border-l-purple-500" },
    timing:   { header: "bg-amber-500/10 hover:bg-amber-500/15",   icon: "text-amber-600 dark:text-amber-400",     border: "border-l-4 border-l-amber-500" },
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
    <div className="space-y-1.5">
      <div className="border rounded-lg divide-y bg-card">
        {sections.map((section, sectionIndex) => {
          const isOpen = openSections[section.key];
          return (
            <Collapsible key={section.key} open={isOpen} onOpenChange={() => toggleSection(section.key)}>
              <CollapsibleTrigger asChild>
                <div className={`py-3 px-4 cursor-pointer transition-colors ${sectionStyles[section.key].header} ${sectionStyles[section.key].border} ${section.done ? "opacity-60" : ""}`}>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
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
                          ? <CheckCircle2 className="h-6 w-6 text-primary fill-primary/20" />
                          : <Circle className="h-6 w-6 text-muted-foreground hover:text-primary" />}
                      </button>
                      <span className={sectionStyles[section.key].icon}>{sectionIcons[section.key]}</span>
                      <span className={`text-[15px] font-semibold ${section.done ? "text-muted-foreground" : ""}`}>{section.label}</span>
                    </div>
                    <div className="flex justify-start min-w-0">
                      {(() => {
                        const summary = getContentSummary(section.key);
                        return summary ? (
                          <span className="text-[13px] text-muted-foreground truncate">{summary}</span>
                        ) : null;
                      })()}
                    </div>
                    <div className="flex items-center justify-end gap-1 shrink-0">
                      {sectionIndex === 0 && (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => { e.stopPropagation(); toggleAll(); }}
                                aria-label={allOpen ? "Collapse all" : "Expand all"}
                              >
                                <ChevronsUpDown className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">{allOpen ? "Collapse all" : "Expand all"}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
                <div className="pt-1.5 pb-2 px-3 space-y-2">
                  {(() => {
                    const hint = validateSection(section.key);
                    if (!section.done && hint) {
                      // Suppress the redundant "add at least 1 account/contact" hint —
                      // the audience empty state already communicates this directly.
                      if (
                        section.key === "audience" &&
                        (contentCounts?.accountCount ?? 0) === 0 &&
                        (contentCounts?.contactCount ?? 0) === 0
                      ) {
                        return null;
                      }
                      return (
                        <div className="text-[12px] rounded-md px-3 py-1.5 bg-muted/50 text-muted-foreground">
                          {hint}
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {section.key === "region" && <CampaignRegion campaign={campaign} />}
                  {section.key === "audience" && (
                    <CampaignAudience
                      campaign={campaign}
                      selectedRegions={selectedRegions}
                      isCampaignEnded={isCampaignEnded}
                      focusMode={audienceView}
                    />
                  )}
                  {section.key === "message" && (
                    <CampaignMessage
                      campaignId={campaignId}
                      campaign={campaign}
                      selectedRegions={selectedRegions}
                      audienceCounts={{ accounts: contentCounts?.accountCount ?? 0, contacts: contentCounts?.contactCount ?? 0 }}
                      isReadOnly={isReadOnly}
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
