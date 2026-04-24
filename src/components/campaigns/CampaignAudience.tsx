import { useMemo } from "react";
import type { Campaign } from "@/hooks/useCampaigns";
import { CampaignAudienceTable } from "./CampaignAudienceTable";

interface Props {
  campaign: Campaign;
  selectedRegions: string[];
  campaignName?: string;
  campaignOwner?: string | null;
  endDate?: string | null;
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

export function CampaignAudience({ campaign, selectedRegions, isCampaignEnded, focusMode }: Props) {
  const selectedCountries = useMemo(() => parseSelectedCountries(campaign.region), [campaign.region]);
  // If the parent didn't supply regions (e.g. wizard step skipped), derive them from the JSON blob
  // so country/region filtering still applies. Dedupe to avoid duplicates from prop+JSON overlap.
  const effectiveRegions = useMemo(() => {
    const fromJSON = parseRegionsFromJSON(campaign.region);
    return Array.from(new Set([...(selectedRegions || []), ...fromJSON]));
  }, [selectedRegions, campaign.region]);

  return (
    <div className="space-y-3">
      <CampaignAudienceTable
        campaignId={campaign.id}
        isCampaignEnded={isCampaignEnded}
        selectedRegions={effectiveRegions}
        selectedCountries={selectedCountries}
        focusMode={focusMode}
        regionsMissing={selectedRegions.length === 0}
      />
    </div>
  );
}
