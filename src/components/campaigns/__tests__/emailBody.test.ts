import { describe, it, expect } from "vitest";
import { parseEmailBody } from "../emailBody";

describe("parseEmailBody", () => {
  it("returns empty for null/undefined/empty input", () => {
    expect(parseEmailBody(null)).toEqual({ newText: "", quotedText: "" });
    expect(parseEmailBody(undefined)).toEqual({ newText: "", quotedText: "" });
    expect(parseEmailBody("")).toEqual({ newText: "", quotedText: "" });
  });

  it("returns whole body as newText when no separator present", () => {
    const r = parseEmailBody("Hi Bob,\n\nThanks for the update.\n\n— Alice");
    expect(r.quotedText).toBe("");
    expect(r.newText).toContain("Thanks for the update");
  });

  it("splits on Outlook 'From:' header block", () => {
    const body = [
      "Sounds good — let's proceed.",
      "",
      "From: Alice <a@x.com>",
      "Sent: Monday, January 1, 2025 9:00 AM",
      "To: Bob <b@y.com>",
      "Subject: Project kickoff",
      "",
      "Original message body here.",
    ].join("\n");
    const r = parseEmailBody(body);
    expect(r.newText).toBe("Sounds good — let's proceed.");
    expect(r.quotedText).toMatch(/^From: Alice/);
    expect(r.quotedText).toContain("Original message body here");
  });

  it("splits on Gmail 'On ... wrote:' line", () => {
    const body = [
      "Yes, that works for me.",
      "",
      "On Mon, 1 Jan 2025 at 09:00, Alice <a@x.com> wrote:",
      "> Hi Bob, can we meet?",
    ].join("\n");
    const r = parseEmailBody(body);
    expect(r.newText).toBe("Yes, that works for me.");
    expect(r.quotedText).toMatch(/^On Mon, 1 Jan 2025/);
  });

  it("splits on -----Original Message----- separator", () => {
    const body = [
      "Confirmed.",
      "",
      "-----Original Message-----",
      "Hi team, please confirm.",
    ].join("\n");
    const r = parseEmailBody(body);
    expect(r.newText).toBe("Confirmed.");
    expect(r.quotedText).toContain("Original Message");
  });

  it("splits on first '>' quoted line", () => {
    const body = ["Here is my reply.", "", "> previous line one", "> previous line two"].join("\n");
    const r = parseEmailBody(body);
    expect(r.newText).toBe("Here is my reply.");
    expect(r.quotedText).toMatch(/^> previous line one/);
  });

  it("splits on long underscore separator", () => {
    const body = ["Quick note.", "", "______________________________", "Old thread content."].join(
      "\n"
    );
    const r = parseEmailBody(body);
    expect(r.newText).toBe("Quick note.");
    expect(r.quotedText).toContain("Old thread content");
  });

  it("strips HTML tags and decodes entities, still detects separators", () => {
    const body =
      "<div>Thanks &amp; regards</div><br><br>From: Alice<br>Sent: today<br>Subject: Hi";
    const r = parseEmailBody(body);
    expect(r.newText).toContain("Thanks & regards");
    expect(r.newText).not.toMatch(/<div>/);
    expect(r.quotedText).toMatch(/^From: Alice/);
  });

  it("falls back to 200-char preview when newText is empty", () => {
    const body = "From: Alice\nSent: today\nTo: Bob\nSubject: x\n\nOnly quoted content here.";
    const r = parseEmailBody(body);
    // newText should be a non-empty preview rather than empty
    expect(r.newText.length).toBeGreaterThan(0);
    expect(r.newText.length).toBeLessThanOrEqual(200);
  });
});
