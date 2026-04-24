/**
 * Split a raw email body into the new reply text and any quoted/older content.
 * Uses common reply separators; first match wins. If none found, the whole body
 * is treated as new text.
 */
export function parseEmailBody(
  raw: string | null | undefined
): { newText: string; quotedText: string } {
  if (!raw) return { newText: "", quotedText: "" };
  // If HTML, do a quick tag strip first so separators inside markup are detectable.
  let text = raw;
  if (/^\s*<.+>/.test(text)) {
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<\/?(br|p|div)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  text = text.replace(/\r\n/g, "\n");

  const separators: RegExp[] = [
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*On .+wrote:\s*$/im,
    /^\s*From:\s.+$/im,
    /^_{5,}$/m,
    /^-{5,}$/m,
  ];

  let cutIdx = -1;
  for (const re of separators) {
    const m = text.match(re);
    if (m && m.index !== undefined && (cutIdx === -1 || m.index < cutIdx)) {
      cutIdx = m.index;
    }
  }

  // Also cut at first run of lines starting with ">"
  const quoteLineMatch = text.match(/^>.*$/m);
  if (
    quoteLineMatch &&
    quoteLineMatch.index !== undefined &&
    (cutIdx === -1 || quoteLineMatch.index < cutIdx)
  ) {
    cutIdx = quoteLineMatch.index;
  }

  if (cutIdx === -1) {
    return { newText: text.trim(), quotedText: "" };
  }
  const newText = text.slice(0, cutIdx).trim();
  const quotedText = text.slice(cutIdx).trim();
  // If the new text is empty, fall back to a short preview of the raw body.
  if (!newText) {
    return { newText: text.trim().slice(0, 200), quotedText };
  }
  return { newText, quotedText };
}
