// Single source of truth for parsing the campaign.region JSON blob.
// The blob can be either a JSON array of {region, country?} objects, OR
// a legacy single-string value (e.g. "EU"). Both must yield consistent
// region counts everywhere in the app.

export interface RegionEntry {
  region: string;
  country?: string | null;
}

export function parseRegionEntries(raw: string | null | undefined): RegionEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .map((r: any) => ({ region: r?.region, country: r?.country ?? null }))
        .filter((r) => !!r.region);
    }
  } catch { /* not JSON */ }
  return raw && !raw.startsWith("[") ? [{ region: raw, country: null }] : [];
}

/** Distinct region names (deduplicated). Used for both progress badge and Audience filter. */
export function parseSelectedRegions(raw: string | null | undefined): string[] {
  return Array.from(new Set(parseRegionEntries(raw).map((r) => r.region).filter(Boolean)));
}

/** Distinct country codes/names from the JSON blob. */
export function parseSelectedCountries(raw: string | null | undefined): string[] {
  return Array.from(new Set(parseRegionEntries(raw).map((r) => r.country).filter(Boolean) as string[]));
}
