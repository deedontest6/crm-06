/**
 * Shared email body rendering helpers used by both `send-campaign-email`
 * and `campaign-follow-up-runner` so plain-text → HTML conversion stays
 * identical between manual sends and automated follow-ups.
 *
 * Single source of truth — do NOT inline copies in other functions.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert a plain-text body to paragraph-aware HTML so blank lines render
 * as spacing and single newlines render as <br>. If the body already
 * contains block-level HTML, it's returned unchanged.
 */
export function ensureHtmlBody(body: string): string {
  if (!body) return "";
  if (/<(p|div|br|table|ul|ol|h[1-6]|blockquote|section|article)\b/i.test(body)) {
    return body;
  }
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map((block) => {
      const inner = escapeHtml(block).replace(/\n/g, "<br>");
      return `<p style="margin:0 0 1em 0; line-height:1.5;">${inner}</p>`;
    })
    .join("");
}
