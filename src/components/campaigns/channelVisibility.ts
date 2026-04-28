// Single source of truth for resolving which channels a campaign should
// surface in its UI. Every campaign UI component MUST use this helper so
// that disabling Phone/LinkedIn at creation time consistently hides those
// channels everywhere (icons, stats, columns, charts, filters, tabs).

export type Channel = "Email" | "Phone" | "LinkedIn";

const ALL: Channel[] = ["Email", "Phone", "LinkedIn"];

const norm = (v: string): string => (v === "Call" ? "Phone" : v);

export function getEnabledChannels(campaign: any): Channel[] {
  const raw = campaign?.enabled_channels as string[] | null | undefined;
  if (Array.isArray(raw) && raw.length > 0) {
    const cleaned = raw
      .map(norm)
      .filter((v): v is Channel => (ALL as string[]).includes(v));
    if (cleaned.length > 0) return cleaned;
  }
  const pc = norm((campaign?.primary_channel || "").toString().trim());
  if ((ALL as string[]).includes(pc)) return [pc as Channel];
  // Legacy / unset: assume all (back-compat).
  return [...ALL];
}

export function isChannelEnabled(campaign: any, channel: Channel): boolean {
  return getEnabledChannels(campaign).includes(channel);
}

/** Pick a sensible default drilldown channel — first enabled, prefer Email. */
export function pickDrilldownChannel(
  campaign: any
): "email" | "call" | "linkedin" {
  const enabled = getEnabledChannels(campaign);
  if (enabled.includes("Email")) return "email";
  if (enabled.includes("Phone")) return "call";
  return "linkedin";
}
