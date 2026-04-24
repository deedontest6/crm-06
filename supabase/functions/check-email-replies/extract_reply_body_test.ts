import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractReplyBody } from "./index.ts";

Deno.test("extractReplyBody strips HTML, styles and decodes entities", () => {
  const msg = {
    uniqueBody: {
      contentType: "html",
      content:
        "<style>.x{color:red}</style><div>Thanks &amp; regards</div><br><p>Bob &lt;b@y.com&gt;</p>",
    },
  };
  const out = extractReplyBody(msg);
  assert(!/<\/?(div|br|p|style|script)/i.test(out), "should strip HTML tags");
  assert(!out.includes(".x{color:red}"), "should drop style block contents");
  assert(out.includes("Thanks & regards"), "decodes &amp;");
  assert(out.includes("Bob <b@y.com>"), "decodes &lt; &gt;");
});

Deno.test("extractReplyBody removes inline From/Sent/To/Subject header lines", () => {
  const msg = {
    uniqueBody: {
      contentType: "text",
      content: [
        "Sounds good — let's proceed.",
        "",
        "From: Alice <a@x.com>",
        "Sent: Monday, January 1, 2025 9:00 AM",
        "To: Bob <b@y.com>",
        "Cc: team@x.com",
        "Subject: Project kickoff",
        "",
        "Body remains here.",
      ].join("\n"),
    },
  };
  const out = extractReplyBody(msg);
  assert(!/^From:/m.test(out), "From: line removed");
  assert(!/^Sent:/m.test(out), "Sent: line removed");
  assert(!/^To:/m.test(out), "To: line removed");
  assert(!/^Cc:/m.test(out), "Cc: line removed");
  assert(!/^Subject:/m.test(out), "Subject: line removed");
  assert(out.includes("Sounds good"), "preserves new content");
  assert(out.includes("Body remains here"), "preserves remaining body");
});

Deno.test("extractReplyBody falls back uniqueBody -> body -> bodyPreview", () => {
  // Empty uniqueBody → use body
  const fromBody = extractReplyBody({
    uniqueBody: { content: "", contentType: "text" },
    body: { content: "Body text here.", contentType: "text" },
    bodyPreview: "preview",
  });
  assertEquals(fromBody, "Body text here.");

  // Empty uniqueBody and body → use bodyPreview
  const fromPreview = extractReplyBody({
    uniqueBody: { content: "", contentType: "text" },
    body: { content: "", contentType: "text" },
    bodyPreview: "Preview only.",
  });
  assertEquals(fromPreview, "Preview only.");

  // Nothing at all → ""
  assertEquals(extractReplyBody({}), "");
});

Deno.test("extractReplyBody collapses 3+ blank lines to 2", () => {
  const msg = {
    uniqueBody: {
      contentType: "text",
      content: "Line one.\n\n\n\n\nLine two.",
    },
  };
  const out = extractReplyBody(msg);
  assertEquals(out, "Line one.\n\nLine two.");
});
