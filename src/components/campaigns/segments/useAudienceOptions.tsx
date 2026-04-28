import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { regions as REGIONS, countries as COUNTRIES, countryToRegion } from "@/utils/countryRegionMapping";

const FALLBACK_INDUSTRIES = ["Automotive", "Technology", "Manufacturing", "Other"];

export function useAudienceOptions(selectedRegions?: string[]) {
  const { data: industries = FALLBACK_INDUSTRIES } = useQuery({
    queryKey: ["audience-options", "industries"],
    queryFn: async () => {
      const [a, c] = await Promise.all([
        supabase.from("accounts").select("industry").not("industry", "is", null).limit(1000),
        supabase.from("contacts").select("industry").not("industry", "is", null).limit(1000),
      ]);
      const set = new Set<string>(FALLBACK_INDUSTRIES);
      (a.data || []).forEach((r: any) => r.industry && set.add(r.industry));
      (c.data || []).forEach((r: any) => r.industry && set.add(r.industry));
      return Array.from(set).sort();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: positions = [] } = useQuery({
    queryKey: ["audience-options", "positions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("contacts")
        .select("position")
        .not("position", "is", null)
        .limit(2000);
      const set = new Set<string>();
      (data || []).forEach((r: any) => r.position && set.add(String(r.position).trim()));
      return Array.from(set).filter(Boolean).sort();
    },
    staleTime: 5 * 60 * 1000,
  });

  const countriesFiltered =
    selectedRegions && selectedRegions.length > 0
      ? COUNTRIES.filter((c) => selectedRegions.includes(countryToRegion[c]))
      : COUNTRIES;

  return {
    industries,
    regions: REGIONS,
    countries: countriesFiltered,
    positions,
  };
}
