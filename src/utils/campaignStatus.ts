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
  if (contacts.some((c) => c.stage === "Opened")) return "Opened";
  if (contacts.some((c) => c.stage && c.stage !== "Not Contacted")) return "Contacted";
  return "Not Contacted";
}

// Contact stages used inside a campaign (separate from campaign status above).
// Ordered from coldest to warmest. `Opened` was added when the state-machine
// trigger started auto-promoting on first non-bot open.
export const CONTACT_STAGE_LIST = [
  "Not Contacted",
  "Email Sent",
  "Phone Contacted",
  "LinkedIn Contacted",
  "Opened",
  "Responded",
  "Qualified",
  "Converted",
] as const;
export type ContactStage = (typeof CONTACT_STAGE_LIST)[number];

export const CONTACT_STAGE_BADGE: Record<string, string> = {
  "Not Contacted": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  "Email Sent": "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "Phone Contacted": "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  "LinkedIn Contacted": "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  Opened: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  Responded: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  Qualified: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  Converted: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
};

export const DISPOSITION_BADGE: Record<string, string> = {
  Interested: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Not Interested": "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
};

export const STATUS_LIST = ["Draft", "Scheduled", "Active", "Paused", "Completed", "Failed"] as const;
export type CampaignStatus = (typeof STATUS_LIST)[number];

export const STATUS_BADGE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  Scheduled: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  Active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export const STATUS_DOT: Record<string, string> = {
  Draft: "bg-slate-400",
  Scheduled: "bg-cyan-500",
  Active: "bg-emerald-500",
  Paused: "bg-amber-500",
  Completed: "bg-blue-500",
  Failed: "bg-red-500",
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
      return toActive ? ["Scheduled", "Active"] : [];
    case "Scheduled":
      return [...(toActive ? (["Active"] as CampaignStatus[]) : []), "Paused", "Failed"];
    case "Active":
      return ["Paused", "Completed", "Failed"];
    case "Paused":
      return [...(toActive ? (["Active"] as CampaignStatus[]) : []), "Completed"];
    case "Completed":
    case "Failed":
      return []; // terminal
    default:
      return [];
  }
}
