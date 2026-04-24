// PDF report of skipped/invalid email replies for a given date range
// (and optional campaign). Pulls from `email_reply_skip_log` and emits a
// downloadable PDF using pdf-lib (Deno-compatible via npm: specifier).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REASON_LABEL: Record<string, string> = {
  chronology: "Chronology",
  subject_mismatch: "Subject mismatch",
  contact_mismatch: "Contact mismatch",
  ambiguous_candidates: "Ambiguous candidates",
  no_eligible_parent: "No eligible parent",
};

function safeText(s: unknown, max = 80): string {
  const str = String(s ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try { return new Date(s).toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
  catch { return String(s); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const campaignId: string | undefined = body.campaign_id || undefined;
    const fromIso: string = body.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toIso: string = body.to || new Date().toISOString();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the caller is authenticated (RLS will further restrict rows below).
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use user-scoped client so RLS filters rows to those they can read.
    let query = userClient
      .from("email_reply_skip_log")
      .select("*, campaigns(campaign_name), contacts(contact_name)")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (campaignId) query = query.eq("campaign_id", campaignId);

    const { data: rows, error } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const entries = rows || [];

    // Aggregate breakdown by reason
    const byReason = new Map<string, number>();
    for (const r of entries) {
      byReason.set(r.skip_reason, (byReason.get(r.skip_reason) || 0) + 1);
    }

    // ---- Build PDF ----
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 612, PAGE_H = 792;
    const MARGIN = 40;
    const colors = {
      ink: rgb(0.12, 0.13, 0.16),
      muted: rgb(0.45, 0.47, 0.52),
      rule: rgb(0.85, 0.86, 0.89),
      accent: rgb(0.18, 0.32, 0.78),
      red: rgb(0.78, 0.18, 0.22),
    };

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let cursorY = PAGE_H - MARGIN;

    const newPage = () => {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      cursorY = PAGE_H - MARGIN;
    };
    const ensureSpace = (h: number) => {
      if (cursorY - h < MARGIN) newPage();
    };
    const drawText = (text: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: any } = {}) => {
      page.drawText(text, {
        x, y, size: opts.size ?? 10, font: opts.bold ? fontBold : font, color: opts.color ?? colors.ink,
      });
    };

    // ---- Cover page ----
    drawText("Email Reply Skip Report", MARGIN, cursorY - 18, { size: 22, bold: true });
    cursorY -= 36;
    drawText(
      `Range: ${fmtDate(fromIso)} → ${fmtDate(toIso)}`,
      MARGIN, cursorY - 12, { size: 10, color: colors.muted },
    );
    cursorY -= 18;
    if (campaignId) {
      const campaignName = entries.find((e: any) => e.campaigns)?.campaigns?.campaign_name || campaignId;
      drawText(`Campaign: ${safeText(campaignName)}`, MARGIN, cursorY - 12, { size: 10, color: colors.muted });
      cursorY -= 18;
    }
    drawText(`Generated: ${fmtDate(new Date().toISOString())}`, MARGIN, cursorY - 12, { size: 10, color: colors.muted });
    cursorY -= 28;

    // KPI row
    drawText("Total skipped replies", MARGIN, cursorY - 12, { size: 11, color: colors.muted });
    drawText(String(entries.length), MARGIN, cursorY - 36, { size: 28, bold: true, color: colors.red });
    cursorY -= 60;

    // Breakdown by reason
    drawText("Breakdown by reason", MARGIN, cursorY - 12, { size: 12, bold: true });
    cursorY -= 24;
    page.drawLine({
      start: { x: MARGIN, y: cursorY }, end: { x: PAGE_W - MARGIN, y: cursorY },
      thickness: 0.5, color: colors.rule,
    });
    cursorY -= 12;
    for (const [reason, count] of Array.from(byReason.entries()).sort((a, b) => b[1] - a[1])) {
      ensureSpace(16);
      drawText(REASON_LABEL[reason] || reason, MARGIN, cursorY - 10, { size: 10 });
      drawText(String(count), PAGE_W - MARGIN - 30, cursorY - 10, { size: 10, bold: true });
      cursorY -= 16;
    }

    // ---- Per-day breakdown ----
    cursorY -= 16;
    ensureSpace(40);
    drawText("Daily volume", MARGIN, cursorY - 12, { size: 12, bold: true });
    cursorY -= 24;
    const byDay = new Map<string, number>();
    for (const r of entries) {
      const d = String(r.created_at).slice(0, 10);
      byDay.set(d, (byDay.get(d) || 0) + 1);
    }
    page.drawLine({
      start: { x: MARGIN, y: cursorY }, end: { x: PAGE_W - MARGIN, y: cursorY },
      thickness: 0.5, color: colors.rule,
    });
    cursorY -= 12;
    drawText("Date", MARGIN, cursorY - 10, { size: 9, bold: true, color: colors.muted });
    drawText("Skipped", PAGE_W - MARGIN - 60, cursorY - 10, { size: 9, bold: true, color: colors.muted });
    cursorY -= 14;
    for (const [day, count] of Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0]))) {
      ensureSpace(14);
      drawText(day, MARGIN, cursorY - 10, { size: 10 });
      drawText(String(count), PAGE_W - MARGIN - 60, cursorY - 10, { size: 10 });
      cursorY -= 14;
    }

    // ---- Per-row detail ----
    newPage();
    drawText("Skipped replies — detail", MARGIN, cursorY - 18, { size: 16, bold: true });
    cursorY -= 28;

    for (const r of entries) {
      ensureSpace(86);
      // Card header
      drawText(safeText(r.subject || "(no subject)", 70), MARGIN, cursorY - 12, { size: 11, bold: true });
      const reasonLabel = REASON_LABEL[r.skip_reason] || r.skip_reason;
      drawText(reasonLabel, PAGE_W - MARGIN - 130, cursorY - 12, { size: 10, color: colors.red, bold: true });
      cursorY -= 18;

      drawText(`When: ${fmtDate(r.created_at)}`, MARGIN, cursorY - 10, { size: 9, color: colors.muted });
      cursorY -= 12;
      const campaignName = (r as any).campaigns?.campaign_name || (r.campaign_id ? r.campaign_id.slice(0, 8) : "—");
      const contactName = (r as any).contacts?.contact_name || (r.contact_id ? r.contact_id.slice(0, 8) : "—");
      drawText(`Campaign: ${safeText(campaignName, 40)}    Contact: ${safeText(contactName, 30)}`, MARGIN, cursorY - 10, { size: 9, color: colors.muted });
      cursorY -= 12;
      drawText(`From: ${safeText(r.sender_email || "—", 50)}    Contact email: ${safeText(r.contact_email || "—", 40)}`, MARGIN, cursorY - 10, { size: 9, color: colors.muted });
      cursorY -= 12;
      if (r.parent_subject) {
        drawText(`Parent subject: ${safeText(r.parent_subject, 80)}`, MARGIN, cursorY - 10, { size: 9, color: colors.muted });
        cursorY -= 12;
      }
      if (r.parent_sent_at) {
        drawText(`Parent sent at: ${fmtDate(r.parent_sent_at)}    Reply received at: ${fmtDate(r.received_at)}`, MARGIN, cursorY - 10, { size: 9, color: colors.muted });
        cursorY -= 12;
      }

      page.drawLine({
        start: { x: MARGIN, y: cursorY - 4 }, end: { x: PAGE_W - MARGIN, y: cursorY - 4 },
        thickness: 0.3, color: colors.rule,
      });
      cursorY -= 12;
    }

    // Footer page numbers
    const pages = pdfDoc.getPages();
    pages.forEach((p, idx) => {
      p.drawText(`Page ${idx + 1} of ${pages.length}`, {
        x: PAGE_W - MARGIN - 80, y: 20, size: 8, font, color: colors.muted,
      });
    });

    const pdfBytes = await pdfDoc.save();
    // Wrap in Blob to satisfy Deno BodyInit typing across runtime versions.
    const pdfBlob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
    return new Response(pdfBlob, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Length": String(pdfBytes.byteLength),
        "Content-Disposition": `attachment; filename="email-skip-report-${fromIso.slice(0, 10)}-to-${toIso.slice(0, 10)}.pdf"`,
      },
    });
  } catch (err) {
    console.error("email-skip-report error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
