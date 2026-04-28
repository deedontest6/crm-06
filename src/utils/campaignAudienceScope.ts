import { expandRegionsForDb, normalizeCountryName } from "@/utils/countryRegionMapping";
import { supabase } from "@/integrations/supabase/client";

/**
 * Single source of truth for "what accounts/contacts are in scope of the
 * selected regions/countries on a campaign". Used by both the Region header
 * counts and the Add Audience picker so the totals always match.
 *
 * Rule:
 *  - If selectedCountries has any entries, scope is exactly those countries.
 *  - Otherwise, scope is every account whose region matches the selected
 *    regions (after region alias expansion).
 *  - If neither is provided, scope is every account.
 */

export interface ScopedAccount {
  id: string;
  account_name: string;
  industry: string | null;
  region: string | null;
  country: string | null;
}

export interface ScopedContact {
  id: string;
  contact_name: string | null;
  email: string | null;
  position: string | null;
  company_name: string | null;
  phone_no: string | null;
  linkedin: string | null;
}

const BATCH = 1000;

async function batched<T>(build: (q: any) => any): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from);
    if (error) throw error;
    all.push(...((data || []) as T[]));
    if (!data || data.length < BATCH) break;
    from += BATCH;
  }
  return all;
}

export function buildCountryVariants(selectedCountries: string[]): string[] {
  const set = new Set<string>();
  for (const c of selectedCountries || []) {
    if (!c) continue;
    set.add(c);
    const canon = normalizeCountryName(c);
    if (canon) set.add(canon);
  }
  return Array.from(set);
}

export async function fetchScopedAccounts(
  selectedRegions: string[],
  selectedCountries: string[],
): Promise<ScopedAccount[]> {
  const countryVariants = buildCountryVariants(selectedCountries);
  const regionVariants = expandRegionsForDb(selectedRegions || []);

  if (countryVariants.length > 0) {
    const orExpr = countryVariants.map((c) => `country.ilike.${c.replace(/,/g, "")}`).join(",");
    const rows = await batched<ScopedAccount>(async (from) =>
      supabase
        .from("accounts")
        .select("id, account_name, industry, region, country")
        .or(orExpr)
        .range(from, from + BATCH - 1),
    );
    if (rows.length > 0) return rows;
  }
  if (regionVariants.length > 0) {
    return batched<ScopedAccount>(async (from) =>
      supabase
        .from("accounts")
        .select("id, account_name, industry, region, country")
        .in("region", regionVariants)
        .range(from, from + BATCH - 1),
    );
  }
  return batched<ScopedAccount>(async (from) =>
    supabase
      .from("accounts")
      .select("id, account_name, industry, region, country")
      .range(from, from + BATCH - 1),
  );
}

/**
 * Fetch all contacts whose company_name matches any scoped account name.
 * Done case-insensitively in chunks to avoid huge IN() lists.
 */
export async function fetchScopedContactsForAccounts(
  accounts: { account_name: string }[],
): Promise<ScopedContact[]> {
  const names = Array.from(
    new Set(
      accounts
        .map((a) => (a.account_name || "").trim())
        .filter(Boolean),
    ),
  );
  if (names.length === 0) return [];
  const all: ScopedContact[] = [];
  const chunkSize = 200;
  for (let i = 0; i < names.length; i += chunkSize) {
    const chunk = names.slice(i, i + chunkSize);
    const rows = await batched<ScopedContact>(async (from) =>
      supabase
        .from("contacts")
        .select("id, contact_name, email, position, company_name, phone_no, linkedin")
        .in("company_name", chunk)
        .range(from, from + BATCH - 1),
    );
    all.push(...rows);
  }
  // Dedupe by id (contact may match multiple chunks if company name appears twice).
  const seen = new Set<string>();
  return all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export async function getScopedAudience(
  selectedRegions: string[],
  selectedCountries: string[],
) {
  const accounts = await fetchScopedAccounts(selectedRegions, selectedCountries);
  const contacts = await fetchScopedContactsForAccounts(accounts);
  return { accounts, contacts };
}
