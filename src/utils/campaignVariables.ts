// Shared campaign email/message variable substitution.
// Single source of truth so EmailComposeModal, template previews, and any
// future LinkedIn/Call composers behave identically.

export interface VariableContact {
  contact_name?: string | null;
  email?: string | null;
  company_name?: string | null;
  position?: string | null;
  region?: string | null;
}

export interface VariableContext {
  contact?: VariableContact | null;
  ownerName?: string;
  accountCountry?: string | null;
}

export const AVAILABLE_VARIABLES = [
  "{first_name}",
  "{last_name}",
  "{contact_name}",
  "{company_name}",
  "{position}",
  "{email}",
  "{region}",
  "{country}",
  "{owner_name}",
] as const;

function splitName(full?: string | null): { first: string; last: string } {
  if (!full) return { first: "", last: "" };
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.length > 1 ? parts.slice(1).join(" ") : "" };
}

/** Whitespace-tolerant: matches `{ var }`, `{var}`, `{VAR}`. */
function pattern(name: string): RegExp {
  return new RegExp(`\\{\\s*${name}\\s*\\}`, "gi");
}

export function substituteVariables(text: string, ctx: VariableContext): string {
  if (!text) return text;
  const c = ctx.contact || {};
  const { first, last } = splitName(c.contact_name);
  return text
    .replace(pattern("contact_name"), c.contact_name || "")
    .replace(pattern("first_name"), first)
    .replace(pattern("last_name"), last)
    .replace(pattern("company_name"), c.company_name || "")
    .replace(pattern("position"), c.position || "")
    .replace(pattern("email"), c.email || "")
    .replace(pattern("region"), c.region || "")
    .replace(pattern("country"), ctx.accountCountry || "")
    .replace(pattern("owner_name"), ctx.ownerName || "");
}

/** Returns the unresolved `{...}` tokens still present in the rendered text. */
export function findUnresolvedVariables(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}/g) || [];
  // Dedupe + normalize
  return Array.from(new Set(matches.map(m => m.replace(/\s+/g, ""))));
}

/** Heuristic: does the body contain HTML tags worth rendering as HTML? */
export function looksLikeHtml(text: string): boolean {
  if (!text) return false;
  return /<\/?[a-z][\s\S]*?>/i.test(text);
}
