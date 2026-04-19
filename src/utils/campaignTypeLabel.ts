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
  { value: "Mixed", label: "Mixed" },
];

export const PRIORITY_BADGE_CLASS: Record<string, string> = {
  Low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  High: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};
