// Shared campaign status constants & helpers — used by list, dashboard, detail, inline dropdowns.

/**
 * Single source of truth for "account status from contact stages".
 * Both `Qualified` and `Converted` count as `Deal Created` so the Audience tab
 * agrees with the Analytics funnel and the recomputed `campaign_accounts.status`.
 */
export type ContactStageLike = { stage?: string | null };

export function deriveAccountStatusFromContacts(contacts: ContactStageLike[]): string {
  if (!contacts || contacts.length === 0) return "Not Contacted";
  if (contacts.some((c) => c.stage === "Qualified" || c.stage === "Converted")) return "Deal Created";
  if (contacts.some((c) => c.stage === "Responded")) return "Responded";
  if (contacts.some((c) => c.stage && c.stage !== "Not Contacted")) return "Contacted";
  return "Not Contacted";
}

export const STATUS_LIST = ["Draft", "Active", "Paused", "Completed"] as const;
export type CampaignStatus = (typeof STATUS_LIST)[number];

export const STATUS_BADGE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  Active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export const STATUS_DOT: Record<string, string> = {
  Draft: "bg-slate-400",
  Active: "bg-emerald-500",
  Paused: "bg-amber-500",
  Completed: "bg-blue-500",
};

export const STATUS_OPTIONS: { value: CampaignStatus; label: string }[] = STATUS_LIST.map((s) => ({
  value: s,
  label: s,
}));

/**
 * Return the statuses a campaign can transition to from `current`.
 * When `isStrategyComplete` is false, transitions to "Active" are blocked
 * (matches the rule enforced on the detail page).
 */
export function allowedTransitions(
  current: CampaignStatus | string | null | undefined,
  isStrategyComplete: boolean
): CampaignStatus[] {
  const from = (current || "Draft") as CampaignStatus;
  const toActive = isStrategyComplete;
  switch (from) {
    case "Draft":
      return toActive ? ["Active"] : [];
    case "Active":
      return ["Paused", "Completed"];
    case "Paused":
      return [...(toActive ? (["Active"] as CampaignStatus[]) : []), "Completed"];
    case "Completed":
      return []; // terminal
    default:
      return [];
  }
}
