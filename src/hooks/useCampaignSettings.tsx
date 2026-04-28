/**
 * Per-tenant campaign settings stored in `campaign_settings` (key/value text rows).
 *
 * Currently exposed:
 *   - enqueue_threshold (default 25): bulk-recipient count above which the
 *     EmailComposeModal hands the batch off to the durable backend send queue
 *     instead of looping `send-campaign-email` from the browser.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SETTINGS_KEYS = ["enqueue_threshold", "duplicate_send_window_days"] as const;
type SettingKey = (typeof SETTINGS_KEYS)[number];

const DEFAULTS: Record<SettingKey, string> = {
  enqueue_threshold: "25",
  duplicate_send_window_days: "3",
};

export interface CampaignSettings {
  enqueueThreshold: number;
  duplicateSendWindowDays: number;
}

function parseInteger(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function useCampaignSettings() {
  const query = useQuery({
    queryKey: ["campaign-settings"],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Record<SettingKey, string>> => {
      const { data, error } = await supabase
        .from("campaign_settings")
        .select("setting_key, setting_value")
        .in("setting_key", SETTINGS_KEYS as unknown as string[]);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data || []) {
        if (row?.setting_key) map[row.setting_key] = row.setting_value ?? "";
      }
      return { ...DEFAULTS, ...map } as Record<SettingKey, string>;
    },
  });

  const raw = query.data ?? DEFAULTS;
  const settings: CampaignSettings = {
    enqueueThreshold: parseInteger(raw.enqueue_threshold, 25),
    duplicateSendWindowDays: parseInteger(raw.duplicate_send_window_days, 3),
  };

  return {
    settings,
    isLoading: query.isLoading,
  };
}
