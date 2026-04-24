// Campaign type display & legacy mapping
// Old DB values like "Outreach", "Nurture", "Event" are auto-mapped to new labels.

export const CAMPAIGN_TYPE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: "New Outreach", label: "New Outreach", description: "Cold contact / first touch" },
  { value: "Follow-up", label: "Follow-up", description: "Re-engage existing leads/contacts" },
  { value: "Product Launch", label: "Product Launch", description: "Announce a new product/service" },
  { value: "Event / Webinar", label: "Event / Webinar", description: "Promote an event or webinar" },
  { value: "Promotion / Offer", label: "Promotion / Offer", description: "Discounts, deals, time-bound offers" },
  { value: "Newsletter / Update", label: "Newsletter / Update", description: "Periodic informational broadcast" },
];

const LEGACY_MAP: Record<string, string> = {
  "Outreach": "New Outreach",
  "Cold Outreach": "New Outreach",
  "Nurture": "Follow-up",
  "Re-engagement": "Follow-up",
  "Event": "Event / Webinar",
  "Email": "Newsletter / Update",
};

export function campaignTypeLabel(value?: string | null): string {
  if (!value) return "—";
  return LEGACY_MAP[value] || value;
}

export const PRIORITY_OPTIONS = [
  { value: "Low", label: "Low", dot: "bg-emerald-500" },
  { value: "Medium", label: "Medium", dot: "bg-amber-500" },
  { value: "High", label: "High", dot: "bg-red-500" },
];

export const CHANNEL_OPTIONS = [
  { value: "Email", label: "Email" },
  { value: "Phone", label: "Phone" },
  { value: "LinkedIn", label: "LinkedIn" },
];

export const ALL_CHANNELS = ["Email", "Phone", "LinkedIn"] as const;
export type ChannelKey = typeof ALL_CHANNELS[number];

/** Normalize legacy "Call" -> "Phone" and trim whitespace. */
export function normalizeChannelValue(v?: string | null): string {
  if (!v) return "";
  const t = v.trim();
  return t === "Call" ? "Phone" : t;
}

/** Resolve enabled channels for a campaign with legacy fallback to primary_channel. */
export function getEnabledChannels(campaign: { enabled_channels?: string[] | null; primary_channel?: string | null } | null | undefined): ChannelKey[] {
  if (!campaign) return [...ALL_CHANNELS];
  const arr = (campaign.enabled_channels || []).map(normalizeChannelValue).filter(Boolean) as ChannelKey[];
  if (arr.length > 0) return arr.filter((c) => (ALL_CHANNELS as readonly string[]).includes(c));
  // Legacy: derive from primary_channel
  const pc = normalizeChannelValue(campaign.primary_channel);
  if (pc && (ALL_CHANNELS as readonly string[]).includes(pc)) return [pc as ChannelKey];
  return [...ALL_CHANNELS];
}

export const PRIORITY_BADGE_CLASS: Record<string, string> = {
  Low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  High: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};
