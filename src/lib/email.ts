/**
 * Shared email + channel reachability helpers.
 *
 * `isReachableEmail` enforces a minimal email shape so junk values like
 * "n/a", "-", "none", whitespace, or anything missing an "@x.y" tail are
 * NOT treated as a deliverable address. Use this everywhere we used to
 * rely on `!!email?.trim()`.
 */

const JUNK_VALUES = ["-", "--", "n/a", "na", "none", "null", "tbd", "unknown", "x", "xx", "xxx"];

export function isReachableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return false;
  if (JUNK_VALUES.includes(trimmed)) return false;
  return /.+@.+\..+/.test(trimmed);
}

/**
 * Validate a LinkedIn URL/handle. Filters junk placeholders and short noise.
 * Accepts anything that looks like a linkedin.com URL OR is at least 5
 * non-junk characters (covers profile slugs pasted without the domain).
 */
export function isReachableLinkedIn(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  if (JUNK_VALUES.includes(trimmed)) return false;
  if (trimmed.includes("linkedin.com")) return true;
  return trimmed.length >= 5;
}

/**
 * Validate a phone number. Filters junk placeholders and requires at least
 * 6 digits to be considered dialable.
 */
export function isReachablePhone(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  if (JUNK_VALUES.includes(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 6;
}

/**
 * Cosmetic phone formatter for dropdown labels. NOT a true E.164 normalizer —
 * just groups digits in a readable way. Preserves any leading "+".
 */
export function formatPhoneForDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const raw = value.trim();
  if (!raw) return "";
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return raw;
  // Group from the right in chunks of 3, keep country code as a separate leading group.
  let cc = "";
  let rest = digits;
  if (hasPlus) {
    // Most country codes are 1-3 digits. Take up to 3.
    const ccLen = digits.length > 10 ? digits.length - 10 : Math.min(2, digits.length - 7);
    if (ccLen > 0) {
      cc = digits.slice(0, ccLen);
      rest = digits.slice(ccLen);
    }
  }
  // Group the rest in 3-4 digit chunks for readability.
  const groups: string[] = [];
  let i = rest.length;
  while (i > 0) {
    const start = Math.max(0, i - 3);
    groups.unshift(rest.slice(start, i));
    i = start;
  }
  const restFormatted = groups.join(" ");
  if (cc) return `+${cc} ${restFormatted}`;
  if (hasPlus) return `+${restFormatted}`;
  return restFormatted;
}

/**
 * Explain WHY a contact is unreachable on a given channel. Used in exports
 * and tooltips so users can fix the right field on the contact.
 */
export function whyUnreachable(
  channel: "Email" | "LinkedIn" | "Phone",
  values: { email?: string | null; linkedin?: string | null; phone?: string | null },
): string {
  const v = channel === "Email" ? values.email : channel === "LinkedIn" ? values.linkedin : values.phone;
  const label = channel === "Email" ? "email" : channel === "LinkedIn" ? "LinkedIn" : "phone";
  if (!v || !v.trim()) return `missing ${label}`;
  const trimmed = v.trim().toLowerCase();
  if (JUNK_VALUES.includes(trimmed)) return `junk ${label} '${v.trim()}'`;
  if (channel === "Email") return `invalid email '${v.trim()}'`;
  if (channel === "Phone") return `phone too short '${v.trim()}'`;
  return `invalid ${label} '${v.trim()}'`;
}

/**
 * Normalize the campaign's `primary_channel` and the `communication_type`
 * being logged so "Phone" and "Call" aren't compared as different values.
 * Returns one of: "Email" | "LinkedIn" | "Phone" | "" (unknown).
 */
export function normalizeChannel(value: string | null | undefined): "Email" | "LinkedIn" | "Phone" | "" {
  const v = (value || "").trim().toLowerCase();
  if (v === "email") return "Email";
  if (v === "linkedin") return "LinkedIn";
  if (v === "phone" || v === "call") return "Phone";
  return "";
}

/** Friendly user-facing label (Phone/Call collapsed to "Phone"). */
export function channelLabel(value: string | null | undefined): string {
  const n = normalizeChannel(value);
  return n || (value || "").trim();
}
