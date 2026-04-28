import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Duplicate-send guard:
 * Looks up `campaign_settings.duplicate_send_window_days` (default 3) and returns:
 *   - windowDays: number
 *   - getRecentlyEmailedIds(contactIds): Promise<Set<string>>
 *
 * Used by Email Compose to warn before sending to contacts who were emailed
 * recently in the SAME campaign.
 */
export function useDuplicateSendGuard(campaignId: string) {
  const { data: windowDays = 3 } = useQuery({
    queryKey: ["duplicate-send-window-days"],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_settings")
        .select("setting_value")
        .eq("setting_key", "duplicate_send_window_days")
        .maybeSingle();
      const n = Number(data?.setting_value);
      return Number.isFinite(n) && n > 0 ? n : 3;
    },
    staleTime: 10 * 60_000,
  });

  const getRecentlyEmailedIds = async (contactIds: string[]): Promise<Set<string>> => {
    if (contactIds.length === 0 || !campaignId) return new Set();
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("campaign_communications")
      .select("contact_id, communication_date")
      .eq("campaign_id", campaignId)
      .eq("communication_type", "Email")
      .in("contact_id", contactIds)
      .gte("communication_date", cutoff)
      .or("sent_via.eq.azure,sent_via.eq.manual");
    if (error || !data) return new Set();
    return new Set(data.map((r) => r.contact_id).filter(Boolean) as string[]);
  };

  return { windowDays, getRecentlyEmailedIds };
}
