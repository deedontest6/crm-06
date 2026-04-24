// UI mirror of `supabase/functions/_shared/subject-normalize.ts`.
// Keep these two files in sync — the edge function is the source of truth,
// this file exists so the React UI can apply the same guard before rendering
// inbound replies in the conversation reader.

const PREFIX_TOKENS = [
  // English
  "re", "fw", "fwd",
  // German
  "aw", "wg", "antwort", "weitergeleitet",
  // French
  "rép", "rep", "tr",
  // Spanish
  "rv", "res",
  // Italian
  "r", "i",
  // Dutch
  "antw", "doorst",
];

const PREFIX_REGEX = new RegExp(
  `^\\s*(?:${PREFIX_TOKENS.map((t) => t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")})\\s*:\\s*`,
  "i",
);

const BRACKET_TAG_REGEX = /^\s*\[[^\]]{1,40}\]\s*/;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;

export function normalizeSubjectRoot(subject: string | null | undefined): string {
  if (!subject) return "";
  let s = String(subject);
  try { s = s.normalize("NFKC"); } catch { /* ignore */ }
  s = s.replace(ZERO_WIDTH_REGEX, "");
  let prev: string;
  do {
    prev = s;
    s = s.replace(BRACKET_TAG_REGEX, "");
    s = s.replace(PREFIX_REGEX, "");
  } while (s !== prev);
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[\s.,;:!?\-–—_]+$/u, "").trim();
  return s.toLowerCase();
}

function tokens(s: string): Set<string> {
  return new Set(
    s.split(/[^\p{L}\p{N}]+/u).map((t) => t.trim()).filter((t) => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function areSubjectsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeSubjectRoot(a);
  const nb = normalizeSubjectRoot(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.length >= 8 && nb.includes(na)) return true;
  if (nb.length >= 8 && na.includes(nb)) return true;
  const j = jaccard(tokens(na), tokens(nb));
  return j >= 0.6;
}
