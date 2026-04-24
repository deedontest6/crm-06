// Single source of truth for normalizing email subject lines so reply-to-parent
// matching is robust against localized prefixes, bracket tags, casing, and
// minor typos. Mirror lives at `src/utils/subjectNormalize.ts` for UI guard parity.

// All reply/forward prefix tokens we strip (case-insensitive).
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

// Tags Outlook/Exchange/MTAs commonly add: [EXT], [External], [SPAM], [#1234], etc.
const BRACKET_TAG_REGEX = /^\s*\[[^\]]{1,40}\]\s*/;

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;

/**
 * Normalize a subject root: strip stacked prefixes (Re: Re: Fw:), Outlook tags
 * ([EXT], [#123]), unicode-normalize, lowercase, collapse whitespace, trim
 * trailing punctuation. Safe for null/undefined.
 */
export function normalizeSubjectRoot(subject: string | null | undefined): string {
  if (!subject) return "";

  let s = String(subject);

  // NFKC unicode normalize
  try {
    s = s.normalize("NFKC");
  } catch {
    // ignore
  }

  // Remove zero-width characters
  s = s.replace(ZERO_WIDTH_REGEX, "");

  // Strip stacked prefixes and bracket tags repeatedly until stable
  let prev: string;
  do {
    prev = s;
    s = s.replace(BRACKET_TAG_REGEX, "");
    s = s.replace(PREFIX_REGEX, "");
  } while (s !== prev);

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  // Trim trailing punctuation
  s = s.replace(/[\s.,;:!?\-–—_]+$/u, "").trim();

  return s.toLowerCase();
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2),
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

/**
 * Decide whether two subject lines belong to the same conversation thread.
 * Tolerant to localized "Re:", forwarding prefixes, [EXT] tags, unicode, and
 * minor typos — but rejects unrelated topics that merely share a contact.
 *
 * Rule: compatible iff token Jaccard ≥ 0.6 OR substring containment ≥ 8 chars.
 *
 * Empty/null subjects are treated as compatible (we don't have enough signal
 * to reject; the chronology gate and contact-email match are the other guards).
 */
export function areSubjectsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeSubjectRoot(a);
  const nb = normalizeSubjectRoot(b);
  if (!na || !nb) return true;
  if (na === nb) return true;

  // Substring containment of at least 8 chars (lets "boosting automotive" match
  // "boosting automotive virtualization at realthingks").
  if (na.length >= 8 && nb.includes(na)) return true;
  if (nb.length >= 8 && na.includes(nb)) return true;

  // Token Jaccard ≥ 0.6
  const j = jaccard(tokens(na), tokens(nb));
  return j >= 0.6;
}
