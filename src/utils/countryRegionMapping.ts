/**
 * Shared country-region mapping utility.
 * Covers 7 geographic regions, ~200 countries, and formatted timezones.
 */

/**
 * Map UI region names to all DB region codes that should match.
 * The DB historically stores short codes like "EU", "ASIA", "US" alongside long names.
 */
export const REGION_DB_ALIASES: Record<string, string[]> = {
  "Europe": ["EU", "Europe"],
  "Asia": ["ASIA", "Asia"],
  "Middle East": ["ASIA", "Middle East"],
  "North America": ["US", "North America"],
  "Africa": ["Africa", "Other"],
  "Oceania": ["Oceania", "Other"],
  "South America": ["South America", "Other"],
};

/** Expand a list of UI region names to all DB codes that should match. */
export function expandRegionsForDb(regions: string[]): string[] {
  const out = new Set<string>();
  for (const r of regions) {
    const aliases = REGION_DB_ALIASES[r] ?? [r];
    for (const a of aliases) out.add(a);
  }
  return Array.from(out);
}

// Geographic regions
export const regions = [
  "Africa",
  "Asia",
  "Europe",
  "Middle East",
  "North America",
  "Oceania",
  "South America",
];

// All countries grouped by region, alphabetically sorted within each region
export const countries = [
  // Africa
  "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi",
  "Cabo Verde", "Cameroon", "Central African Republic", "Chad", "Comoros",
  "Congo", "Côte d'Ivoire", "DR Congo", "Djibouti", "Egypt",
  "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia", "Gabon", "Gambia",
  "Ghana", "Guinea", "Guinea-Bissau", "Kenya", "Lesotho", "Liberia", "Libya",
  "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco",
  "Mozambique", "Namibia", "Niger", "Nigeria", "Rwanda", "São Tomé and Príncipe",
  "Senegal", "Seychelles", "Sierra Leone", "Somalia", "South Africa",
  "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia",
  "Zimbabwe",
  // Asia
  "Afghanistan", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "China",
  "India", "Indonesia", "Japan", "Kazakhstan", "Kyrgyzstan", "Laos",
  "Malaysia", "Maldives", "Mongolia", "Myanmar", "Nepal", "North Korea",
  "Pakistan", "Philippines", "Singapore", "South Korea", "Sri Lanka",
  "Taiwan", "Tajikistan", "Thailand", "Timor-Leste", "Turkmenistan",
  "Uzbekistan", "Vietnam",
  // Europe
  "Albania", "Andorra", "Armenia", "Austria", "Azerbaijan", "Belarus",
  "Belgium", "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Cyprus",
  "Czech Republic", "Denmark", "Estonia", "Finland", "France", "Georgia",
  "Germany", "Greece", "Hungary", "Iceland", "Ireland", "Italy", "Kosovo",
  "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Moldova",
  "Monaco", "Montenegro", "Netherlands", "North Macedonia", "Norway",
  "Poland", "Portugal", "Romania", "Russia", "San Marino", "Serbia",
  "Slovakia", "Slovenia", "Spain", "Sweden", "Switzerland", "Turkey",
  "UK", "Ukraine", "Vatican City",
  // Middle East
  "Bahrain", "Iran", "Iraq", "Israel", "Jordan", "Kuwait", "Lebanon",
  "Oman", "Palestine", "Qatar", "Saudi Arabia", "Syria", "UAE", "Yemen",
  // North America
  "Antigua and Barbuda", "Bahamas", "Barbados", "Belize", "Canada",
  "Costa Rica", "Cuba", "Dominica", "Dominican Republic", "El Salvador",
  "Grenada", "Guatemala", "Haiti", "Honduras", "Jamaica", "Mexico",
  "Nicaragua", "Panama", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Trinidad and Tobago", "USA",
  // Oceania
  "Australia", "Fiji", "Kiribati", "Marshall Islands", "Micronesia",
  "Nauru", "New Zealand", "Palau", "Papua New Guinea", "Samoa",
  "Solomon Islands", "Tonga", "Tuvalu", "Vanuatu",
  // South America
  "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador",
  "Guyana", "Paraguay", "Peru", "Suriname", "Uruguay", "Venezuela",
];

// Map every country to its region
export const countryToRegion: Record<string, string> = {
  // Africa
  "Algeria": "Africa", "Angola": "Africa", "Benin": "Africa", "Botswana": "Africa",
  "Burkina Faso": "Africa", "Burundi": "Africa", "Cabo Verde": "Africa",
  "Cameroon": "Africa", "Central African Republic": "Africa", "Chad": "Africa",
  "Comoros": "Africa", "Congo": "Africa", "Côte d'Ivoire": "Africa",
  "DR Congo": "Africa", "Djibouti": "Africa", "Egypt": "Africa",
  "Equatorial Guinea": "Africa", "Eritrea": "Africa", "Eswatini": "Africa",
  "Ethiopia": "Africa", "Gabon": "Africa", "Gambia": "Africa", "Ghana": "Africa",
  "Guinea": "Africa", "Guinea-Bissau": "Africa", "Kenya": "Africa",
  "Lesotho": "Africa", "Liberia": "Africa", "Libya": "Africa",
  "Madagascar": "Africa", "Malawi": "Africa", "Mali": "Africa",
  "Mauritania": "Africa", "Mauritius": "Africa", "Morocco": "Africa",
  "Mozambique": "Africa", "Namibia": "Africa", "Niger": "Africa",
  "Nigeria": "Africa", "Rwanda": "Africa", "São Tomé and Príncipe": "Africa",
  "Senegal": "Africa", "Seychelles": "Africa", "Sierra Leone": "Africa",
  "Somalia": "Africa", "South Africa": "Africa", "South Sudan": "Africa",
  "Sudan": "Africa", "Tanzania": "Africa", "Togo": "Africa", "Tunisia": "Africa",
  "Uganda": "Africa", "Zambia": "Africa", "Zimbabwe": "Africa",
  // Asia
  "Afghanistan": "Asia", "Bangladesh": "Asia", "Bhutan": "Asia", "Brunei": "Asia",
  "Cambodia": "Asia", "China": "Asia", "India": "Asia", "Indonesia": "Asia",
  "Japan": "Asia", "Kazakhstan": "Asia", "Kyrgyzstan": "Asia", "Laos": "Asia",
  "Malaysia": "Asia", "Maldives": "Asia", "Mongolia": "Asia", "Myanmar": "Asia",
  "Nepal": "Asia", "North Korea": "Asia", "Pakistan": "Asia",
  "Philippines": "Asia", "Singapore": "Asia", "South Korea": "Asia",
  "Sri Lanka": "Asia", "Taiwan": "Asia", "Tajikistan": "Asia", "Thailand": "Asia",
  "Timor-Leste": "Asia", "Turkmenistan": "Asia", "Uzbekistan": "Asia",
  "Vietnam": "Asia",
  // Europe
  "Albania": "Europe", "Andorra": "Europe", "Armenia": "Europe", "Austria": "Europe",
  "Azerbaijan": "Europe", "Belarus": "Europe", "Belgium": "Europe",
  "Bosnia and Herzegovina": "Europe", "Bulgaria": "Europe", "Croatia": "Europe",
  "Cyprus": "Europe", "Czech Republic": "Europe", "Denmark": "Europe",
  "Estonia": "Europe", "Finland": "Europe", "France": "Europe", "Georgia": "Europe",
  "Germany": "Europe", "Greece": "Europe", "Hungary": "Europe", "Iceland": "Europe",
  "Ireland": "Europe", "Italy": "Europe", "Kosovo": "Europe", "Latvia": "Europe",
  "Liechtenstein": "Europe", "Lithuania": "Europe", "Luxembourg": "Europe",
  "Malta": "Europe", "Moldova": "Europe", "Monaco": "Europe",
  "Montenegro": "Europe", "Netherlands": "Europe", "North Macedonia": "Europe",
  "Norway": "Europe", "Poland": "Europe", "Portugal": "Europe", "Romania": "Europe",
  "Russia": "Europe", "San Marino": "Europe", "Serbia": "Europe",
  "Slovakia": "Europe", "Slovenia": "Europe", "Spain": "Europe", "Sweden": "Europe",
  "Switzerland": "Europe", "Turkey": "Europe", "UK": "Europe", "Ukraine": "Europe",
  "Vatican City": "Europe",
  // Middle East
  "Bahrain": "Middle East", "Iran": "Middle East", "Iraq": "Middle East",
  "Israel": "Middle East", "Jordan": "Middle East", "Kuwait": "Middle East",
  "Lebanon": "Middle East", "Oman": "Middle East", "Palestine": "Middle East",
  "Qatar": "Middle East", "Saudi Arabia": "Middle East", "Syria": "Middle East",
  "UAE": "Middle East", "Yemen": "Middle East",
  // North America
  "Antigua and Barbuda": "North America", "Bahamas": "North America",
  "Barbados": "North America", "Belize": "North America", "Canada": "North America",
  "Costa Rica": "North America", "Cuba": "North America", "Dominica": "North America",
  "Dominican Republic": "North America", "El Salvador": "North America",
  "Grenada": "North America", "Guatemala": "North America", "Haiti": "North America",
  "Honduras": "North America", "Jamaica": "North America", "Mexico": "North America",
  "Nicaragua": "North America", "Panama": "North America",
  "Saint Kitts and Nevis": "North America", "Saint Lucia": "North America",
  "Saint Vincent and the Grenadines": "North America",
  "Trinidad and Tobago": "North America", "USA": "North America",
  // Oceania
  "Australia": "Oceania", "Fiji": "Oceania", "Kiribati": "Oceania",
  "Marshall Islands": "Oceania", "Micronesia": "Oceania", "Nauru": "Oceania",
  "New Zealand": "Oceania", "Palau": "Oceania", "Papua New Guinea": "Oceania",
  "Samoa": "Oceania", "Solomon Islands": "Oceania", "Tonga": "Oceania",
  "Tuvalu": "Oceania", "Vanuatu": "Oceania",
  // South America
  "Argentina": "South America", "Bolivia": "South America", "Brazil": "South America",
  "Chile": "South America", "Colombia": "South America", "Ecuador": "South America",
  "Guyana": "South America", "Paraguay": "South America", "Peru": "South America",
  "Suriname": "South America", "Uruguay": "South America", "Venezuela": "South America",
};

/**
 * Mapping of common country name variants to the canonical name used in the system.
 */
const countryAliases: Record<string, string> = {
  // USA variants
  "united states": "USA", "united states of america": "USA", "us": "USA",
  "u.s.": "USA", "u.s.a.": "USA", "america": "USA",
  // UK variants
  "united kingdom": "UK", "great britain": "UK", "gb": "UK",
  "england": "UK", "britain": "UK",
  // Korea variants
  "korea": "South Korea", "republic of korea": "South Korea",
  "s. korea": "South Korea", "south korea": "South Korea",
  // UAE variants
  "united arab emirates": "UAE", "u.a.e.": "UAE",
  // Czech variants
  "czech": "Czech Republic", "czechia": "Czech Republic",
  // Netherlands variants
  "holland": "Netherlands", "the netherlands": "Netherlands",
  // Switzerland variants
  "swiss": "Switzerland",
  // DR Congo variants
  "democratic republic of the congo": "DR Congo", "drc": "DR Congo",
  // Congo variants
  "republic of the congo": "Congo",
  // Côte d'Ivoire variants
  "ivory coast": "Côte d'Ivoire", "cote d'ivoire": "Côte d'Ivoire",
  // Eswatini variants
  "swaziland": "Eswatini",
  // Myanmar variants
  "burma": "Myanmar",
  // North Macedonia variants
  "macedonia": "North Macedonia",
  // Timor-Leste variants
  "east timor": "Timor-Leste",
  // Russia variants
  "russian federation": "Russia",
  // Iran variants
  "islamic republic of iran": "Iran",
  // Syria variants
  "syrian arab republic": "Syria",
  // Palestine variants
  "state of palestine": "Palestine",
  // Taiwan variants
  "chinese taipei": "Taiwan",
  // New Zealand variants
  "nz": "New Zealand",
  // Brazil variants
  "brasil": "Brazil",
};

/**
 * All IANA timezone identifiers used in this system.
 */
export const TIMEZONE_IANA_LIST: string[] = [
  "Pacific/Midway", "Pacific/Honolulu", "America/Anchorage",
  "America/Los_Angeles", "America/Denver", "America/Chicago",
  "America/New_York", "America/Caracas", "America/Halifax",
  "America/St_Johns", "America/Argentina/Buenos_Aires", "America/Sao_Paulo",
  "Atlantic/South_Georgia", "Atlantic/Azores", "UTC", "Europe/London",
  "Europe/Paris", "Europe/Berlin", "Africa/Lagos", "Europe/Helsinki",
  "Africa/Cairo", "Africa/Johannesburg", "Europe/Istanbul", "Europe/Moscow",
  "Asia/Riyadh", "Africa/Nairobi", "Asia/Tehran", "Asia/Dubai",
  "Asia/Kabul", "Asia/Karachi", "Asia/Tashkent", "Asia/Kolkata",
  "Asia/Kathmandu", "Asia/Dhaka", "Asia/Almaty", "Asia/Yangon",
  "Asia/Bangkok", "Asia/Jakarta", "Asia/Shanghai", "Asia/Singapore",
  "Asia/Hong_Kong", "Australia/Perth", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Adelaide", "Australia/Sydney", "Pacific/Guam",
  "Pacific/Noumea", "Pacific/Auckland", "Pacific/Fiji",
  "Pacific/Tongatapu", "Pacific/Kiritimati",
];

/**
 * Compute a dynamic label for an IANA timezone reflecting current DST state.
 * Returns e.g. "GMT+2 Central European Summer Time"
 */
export function getTimezoneLabel(iana: string): string {
  try {
    const now = new Date();
    // Get short offset like "GMT+2"
    const offsetFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      timeZoneName: "shortOffset",
    });
    const offsetParts = offsetFormatter.formatToParts(now);
    const offsetPart = offsetParts.find(p => p.type === "timeZoneName")?.value || "GMT";

    // Get long name like "Central European Summer Time"
    const longFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      timeZoneName: "long",
    });
    const longParts = longFormatter.formatToParts(now);
    const longName = longParts.find(p => p.type === "timeZoneName")?.value || iana;

    return `${offsetPart} – ${longName}`;
  } catch {
    return iana.replace(/_/g, " ");
  }
}

/** Cached formatted timezone list – regenerated once per page load. */
let _cachedFormattedList: { value: string; label: string }[] | null = null;

/**
 * Get the full timezone list with dynamically computed labels (DST-aware).
 */
export function getFormattedTimezoneList(): { value: string; label: string }[] {
  if (!_cachedFormattedList) {
    _cachedFormattedList = TIMEZONE_IANA_LIST.map(iana => ({
      value: iana,
      label: getTimezoneLabel(iana),
    }));
  }
  return _cachedFormattedList;
}

/**
 * Keep TIMEZONE_LIST as a backward-compatible alias.
 * @deprecated Use getFormattedTimezoneList() for DST-aware labels.
 */
export const TIMEZONE_LIST = getFormattedTimezoneList();

/**
 * Map each country to its applicable timezone IANA values.
 */
export const countryTimezones: Record<string, string[]> = {
  // Africa
  "Algeria": ["Africa/Lagos"], "Angola": ["Africa/Lagos"], "Benin": ["Africa/Lagos"],
  "Botswana": ["Africa/Johannesburg"], "Burkina Faso": ["UTC"],
  "Burundi": ["Africa/Johannesburg"], "Cabo Verde": ["Atlantic/Azores"],
  "Cameroon": ["Africa/Lagos"], "Central African Republic": ["Africa/Lagos"],
  "Chad": ["Africa/Lagos"], "Comoros": ["Africa/Nairobi"],
  "Congo": ["Africa/Lagos"], "Côte d'Ivoire": ["UTC"],
  "DR Congo": ["Africa/Lagos", "Africa/Johannesburg"],
  "Djibouti": ["Africa/Nairobi"], "Egypt": ["Africa/Cairo"],
  "Equatorial Guinea": ["Africa/Lagos"], "Eritrea": ["Africa/Nairobi"],
  "Eswatini": ["Africa/Johannesburg"], "Ethiopia": ["Africa/Nairobi"],
  "Gabon": ["Africa/Lagos"], "Gambia": ["UTC"],
  "Ghana": ["UTC"], "Guinea": ["UTC"], "Guinea-Bissau": ["UTC"],
  "Kenya": ["Africa/Nairobi"], "Lesotho": ["Africa/Johannesburg"],
  "Liberia": ["UTC"], "Libya": ["Africa/Cairo"],
  "Madagascar": ["Africa/Nairobi"], "Malawi": ["Africa/Johannesburg"],
  "Mali": ["UTC"], "Mauritania": ["UTC"],
  "Mauritius": ["Asia/Dubai"], "Morocco": ["Europe/London", "Africa/Lagos"],
  "Mozambique": ["Africa/Johannesburg"], "Namibia": ["Africa/Johannesburg"],
  "Niger": ["Africa/Lagos"], "Nigeria": ["Africa/Lagos"],
  "Rwanda": ["Africa/Johannesburg"],
  "São Tomé and Príncipe": ["UTC"],
  "Senegal": ["UTC"], "Seychelles": ["Asia/Dubai"],
  "Sierra Leone": ["UTC"], "Somalia": ["Africa/Nairobi"],
  "South Africa": ["Africa/Johannesburg"], "South Sudan": ["Africa/Nairobi"],
  "Sudan": ["Africa/Johannesburg"], "Tanzania": ["Africa/Nairobi"],
  "Togo": ["UTC"], "Tunisia": ["Africa/Lagos"],
  "Uganda": ["Africa/Nairobi"], "Zambia": ["Africa/Johannesburg"],
  "Zimbabwe": ["Africa/Johannesburg"],
  // Asia
  "Afghanistan": ["Asia/Kabul"], "Bangladesh": ["Asia/Dhaka"],
  "Bhutan": ["Asia/Dhaka"], "Brunei": ["Asia/Singapore"],
  "Cambodia": ["Asia/Bangkok"], "China": ["Asia/Shanghai"],
  "India": ["Asia/Kolkata"], "Indonesia": ["Asia/Jakarta", "Asia/Singapore"],
  "Japan": ["Asia/Tokyo"], "Kazakhstan": ["Asia/Almaty"],
  "Kyrgyzstan": ["Asia/Almaty"], "Laos": ["Asia/Bangkok"],
  "Malaysia": ["Asia/Singapore"], "Maldives": ["Asia/Karachi"],
  "Mongolia": ["Asia/Shanghai"], "Myanmar": ["Asia/Yangon"],
  "Nepal": ["Asia/Kathmandu"], "North Korea": ["Asia/Seoul"],
  "Pakistan": ["Asia/Karachi"], "Philippines": ["Asia/Singapore"],
  "Singapore": ["Asia/Singapore"], "South Korea": ["Asia/Seoul"],
  "Sri Lanka": ["Asia/Kolkata"], "Taiwan": ["Asia/Shanghai"],
  "Tajikistan": ["Asia/Tashkent"], "Thailand": ["Asia/Bangkok"],
  "Timor-Leste": ["Asia/Tokyo"], "Turkmenistan": ["Asia/Tashkent"],
  "Uzbekistan": ["Asia/Tashkent"], "Vietnam": ["Asia/Bangkok"],
  // Europe
  "Albania": ["Europe/Paris"], "Andorra": ["Europe/Paris"],
  "Armenia": ["Asia/Dubai"], "Austria": ["Europe/Paris"],
  "Azerbaijan": ["Asia/Dubai"], "Belarus": ["Europe/Moscow"],
  "Belgium": ["Europe/Paris"], "Bosnia and Herzegovina": ["Europe/Paris"],
  "Bulgaria": ["Europe/Helsinki"], "Croatia": ["Europe/Paris"],
  "Cyprus": ["Europe/Helsinki"], "Czech Republic": ["Europe/Paris"],
  "Denmark": ["Europe/Paris"], "Estonia": ["Europe/Helsinki"],
  "Finland": ["Europe/Helsinki"], "France": ["Europe/Paris"],
  "Georgia": ["Asia/Dubai"], "Germany": ["Europe/Berlin"],
  "Greece": ["Europe/Helsinki"], "Hungary": ["Europe/Paris"],
  "Iceland": ["UTC"], "Ireland": ["Europe/London"],
  "Italy": ["Europe/Paris"], "Kosovo": ["Europe/Paris"],
  "Latvia": ["Europe/Helsinki"], "Liechtenstein": ["Europe/Paris"],
  "Lithuania": ["Europe/Helsinki"], "Luxembourg": ["Europe/Paris"],
  "Malta": ["Europe/Paris"], "Moldova": ["Europe/Helsinki"],
  "Monaco": ["Europe/Paris"], "Montenegro": ["Europe/Paris"],
  "Netherlands": ["Europe/Paris"], "North Macedonia": ["Europe/Paris"],
  "Norway": ["Europe/Paris"], "Poland": ["Europe/Paris"],
  "Portugal": ["Europe/London", "Atlantic/Azores"],
  "Romania": ["Europe/Helsinki"],
  "Russia": ["Europe/Moscow", "Asia/Dubai", "Asia/Tashkent", "Asia/Almaty", "Asia/Bangkok", "Asia/Shanghai", "Asia/Tokyo"],
  "San Marino": ["Europe/Paris"], "Serbia": ["Europe/Paris"],
  "Slovakia": ["Europe/Paris"], "Slovenia": ["Europe/Paris"],
  "Spain": ["Europe/Paris"], "Sweden": ["Europe/Paris"],
  "Switzerland": ["Europe/Paris"], "Turkey": ["Europe/Istanbul"],
  "UK": ["Europe/London"], "Ukraine": ["Europe/Helsinki"],
  "Vatican City": ["Europe/Paris"],
  // Middle East
  "Bahrain": ["Asia/Riyadh"], "Iran": ["Asia/Tehran"],
  "Iraq": ["Asia/Riyadh"], "Israel": ["Europe/Helsinki"],
  "Jordan": ["Asia/Riyadh"], "Kuwait": ["Asia/Riyadh"],
  "Lebanon": ["Europe/Helsinki"], "Oman": ["Asia/Dubai"],
  "Palestine": ["Europe/Helsinki"], "Qatar": ["Asia/Riyadh"],
  "Saudi Arabia": ["Asia/Riyadh"], "Syria": ["Asia/Riyadh"],
  "UAE": ["Asia/Dubai"], "Yemen": ["Asia/Riyadh"],
  // North America
  "Antigua and Barbuda": ["America/Halifax"], "Bahamas": ["America/New_York"],
  "Barbados": ["America/Halifax"], "Belize": ["America/Chicago"],
  "Canada": ["America/St_Johns", "America/Halifax", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
  "Costa Rica": ["America/Chicago"], "Cuba": ["America/New_York"],
  "Dominica": ["America/Halifax"], "Dominican Republic": ["America/Halifax"],
  "El Salvador": ["America/Chicago"], "Grenada": ["America/Halifax"],
  "Guatemala": ["America/Chicago"], "Haiti": ["America/New_York"],
  "Honduras": ["America/Chicago"], "Jamaica": ["America/New_York"],
  "Mexico": ["America/Chicago", "America/Denver", "America/Los_Angeles"],
  "Nicaragua": ["America/Chicago"], "Panama": ["America/New_York"],
  "Saint Kitts and Nevis": ["America/Halifax"],
  "Saint Lucia": ["America/Halifax"],
  "Saint Vincent and the Grenadines": ["America/Halifax"],
  "Trinidad and Tobago": ["America/Halifax"],
  "USA": ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
  // Oceania
  "Australia": ["Australia/Perth", "Australia/Adelaide", "Australia/Sydney"],
  "Fiji": ["Pacific/Fiji"], "Kiribati": ["Pacific/Kiritimati"],
  "Marshall Islands": ["Pacific/Auckland"], "Micronesia": ["Pacific/Guam"],
  "Nauru": ["Pacific/Auckland"], "New Zealand": ["Pacific/Auckland"],
  "Palau": ["Asia/Tokyo"], "Papua New Guinea": ["Pacific/Guam"],
  "Samoa": ["Pacific/Midway"], "Solomon Islands": ["Pacific/Noumea"],
  "Tonga": ["Pacific/Tongatapu"], "Tuvalu": ["Pacific/Auckland"],
  "Vanuatu": ["Pacific/Noumea"],
  // South America
  "Argentina": ["America/Argentina/Buenos_Aires"],
  "Bolivia": ["America/Halifax"], "Brazil": ["America/Sao_Paulo", "America/Halifax"],
  "Chile": ["America/Halifax"], "Colombia": ["America/New_York"],
  "Ecuador": ["America/New_York"], "Guyana": ["America/Halifax"],
  "Paraguay": ["America/Halifax"], "Peru": ["America/New_York"],
  "Suriname": ["America/Sao_Paulo"], "Uruguay": ["America/Sao_Paulo"],
  "Venezuela": ["America/Caracas"],
};

/**
 * Get filtered timezones for a given country with dynamic labels.
 * If no country selected, returns full list.
 */
export function getTimezonesForCountry(country: string): { value: string; label: string }[] {
  const tzValues = countryTimezones[country];
  const fullList = getFormattedTimezoneList();
  if (!tzValues || tzValues.length === 0) return fullList;
  return fullList.filter(tz => tzValues.includes(tz.value));
}

/**
 * Get countries for a given region.
 */
export function getCountriesForRegion(region: string): string[] {
  return countries.filter(c => countryToRegion[c] === region);
}

/**
 * Normalize a country name to its canonical form.
 */
export function normalizeCountryName(country: string | null | undefined): string | null {
  if (!country) return null;
  const trimmed = country.trim();
  if (!trimmed) return null;

  const exactMatch = countries.find(c => c.toLowerCase() === trimmed.toLowerCase());
  if (exactMatch) return exactMatch;

  const alias = countryAliases[trimmed.toLowerCase()];
  if (alias) return alias;

  return trimmed;
}

/**
 * Get the region for a given country name.
 */
export function getRegionForCountry(country: string | null | undefined): string | null {
  const normalized = normalizeCountryName(country);
  if (!normalized) return null;
  return countryToRegion[normalized] || null;
}
