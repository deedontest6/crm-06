export type SegmentFilters = {
  industries?: string[];
  regions?: string[];
  countries?: string[];
  positions?: string[];
  excludes?: {
    industries?: string[];
    regions?: string[];
    countries?: string[];
  };
};

/**
 * Returns true if a campaign_contact row (with joined contacts/accounts) matches the segment filters.
 * Used by both Audience preview and Monitoring filtering.
 */
export function matchesSegmentFilters(cc: any, f: SegmentFilters | null | undefined): boolean {
  if (!f) return true;
  const contact = cc?.contacts || cc;
  const account = cc?.accounts || {};

  const industry = contact?.industry || account?.industry;
  const region = contact?.region || account?.region;
  const country = contact?.country || account?.country;
  const position = contact?.position;

  const inList = (val: any, list?: string[]) =>
    !list || list.length === 0 || (val && list.some((x) => String(x).toLowerCase() === String(val).toLowerCase()));

  if (!inList(industry, f.industries)) return false;
  if (!inList(region, f.regions)) return false;
  if (!inList(country, f.countries)) return false;
  if (f.positions && f.positions.length > 0) {
    if (!position) return false;
    const hit = f.positions.some((p) => String(position).toLowerCase().includes(String(p).toLowerCase()));
    if (!hit) return false;
  }

  const ex = f.excludes;
  if (ex) {
    if (ex.industries?.length && industry && ex.industries.some((x) => x.toLowerCase() === String(industry).toLowerCase())) return false;
    if (ex.regions?.length && region && ex.regions.some((x) => x.toLowerCase() === String(region).toLowerCase())) return false;
    if (ex.countries?.length && country && ex.countries.some((x) => x.toLowerCase() === String(country).toLowerCase())) return false;
  }
  return true;
}
