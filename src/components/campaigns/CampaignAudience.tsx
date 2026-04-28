import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Campaign } from "@/hooks/useCampaigns";
import { isReachableEmail, isReachableLinkedIn, isReachablePhone } from "@/lib/email";
import { CampaignAudienceTable } from "./CampaignAudienceTable";

interface Props {
  campaign: Campaign;
  selectedRegions: string[];
  isCampaignEnded: boolean;
  focusMode?: "accounts" | "contacts";
}

function parseSelectedCountries(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return Array.from(new Set(arr.map((r: any) => r.country).filter(Boolean)));
    }
  } catch {}
  return [];
}

function parseRegionsFromJSON(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return Array.from(new Set(arr.map((r: any) => r.region).filter(Boolean)));
    }
  } catch {}
  return [];
}

/**
 * Setup-mode wrapper around the audience table.
 *
 * Linking (adding accounts/contacts to the campaign) is handled exclusively by
 * the AddAudienceModal opened from the table's "+ Add Audience" button.
 * Unlinking happens from per-row and bulk actions inside the table.
 *
 * The previous post-add narrowing UI (AudienceFilterBar with persisted
 * Account/Contact/Industry/Position chips) was removed — the table now lists
 * everything in the campaign, with search and channel filters as the only
 * client-side narrowing.
 */
export function CampaignAudience({ campaign, selectedRegions, isCampaignEnded, focusMode }: Props) {
  const selectedCountries = useMemo(() => parseSelectedCountries(campaign.region), [campaign.region]);
  const effectiveRegions = useMemo(() => {
    const fromJSON = parseRegionsFromJSON(campaign.region);
    return Array.from(new Set([...(selectedRegions || []), ...fromJSON]));
  }, [selectedRegions, campaign.region]);

  // Kept only so the header summary (counts shown above the table) stays in
  // sync with what the table itself fetches — react-query dedupes by key.
  useQuery({
    queryKey: ["campaign-audience-accounts", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("id, account_id, created_at, accounts(account_name, industry, region, country, website, phone)")
        .eq("campaign_id", campaign.id);
      if (error) throw error;
      return data;
    },
  });

  useQuery({
    queryKey: ["campaign-audience-contacts", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("id, contact_id, account_id, stage, disposition, engagement_score, attempt_count, last_activity_at, contacts(contact_name, email, position, linkedin, industry, phone_no)")
        .eq("campaign_id", campaign.id);
      if (error) throw error;
      return data;
    },
  });

  // Reachability helpers retained for downstream consumers that still import
  // from this module's bundle — no behaviour change.
  void isReachableEmail; void isReachableLinkedIn; void isReachablePhone;

  return (
    <div className="space-y-2">
      <CampaignAudienceTable
        campaignId={campaign.id}
        isCampaignEnded={isCampaignEnded}
        selectedRegions={effectiveRegions}
        selectedCountries={selectedCountries}
        focusMode={focusMode}
        regionsMissing={selectedRegions.length === 0}
        mode="setup"
      />
    </div>
  );
}
