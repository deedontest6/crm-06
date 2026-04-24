import { CSVParser } from "@/utils/csvParser";
import { format } from "date-fns";
import { isReachableEmail, isReachableLinkedIn, isReachablePhone, whyUnreachable } from "@/lib/email";

export interface ReachabilityRow {
  account: string;
  contact: string;
  email: string;
  phone: string;
  linkedin: string;
  emailReachable: boolean;
  linkedInReachable: boolean;
  phoneReachable: boolean;
  primaryMatch: boolean;
  stage: string;
  linkedinStatus: string;
  whyUnreachable: string;
}

function reasonsFor(c: any, a: any): string {
  const phoneSrc = c.phone_no || a.phone || "";
  const parts: string[] = [];
  const e = whyUnreachable("Email", { email: c.email });
  const l = whyUnreachable("LinkedIn", { linkedin: c.linkedin });
  const p = whyUnreachable("Phone", { phone: phoneSrc });
  if (!isReachableEmail(c.email)) parts.push(`Email: ${e}`);
  if (!isReachableLinkedIn(c.linkedin)) parts.push(`LinkedIn: ${l}`);
  if (!isReachablePhone(phoneSrc)) parts.push(`Phone: ${p}`);
  return parts.join(" · ") || "All channels reachable";
}

export interface AccountAggregate {
  account: string;
  contacts: number;
  emailable: number;
  linkedin: number;
  callable: number;
}

interface BuildArgs {
  campaignAccounts: any[];
  campaignContacts: any[];
  primaryChannel: string;
  searchQuery?: string;
  /** When set, only include contacts reachable on this channel. */
  channelFilter?: "all" | "Email" | "LinkedIn" | "Phone";
}

const yn = (v: boolean) => (v ? "Y" : "N");

function matchesSearch(q: string, ...vals: (string | null | undefined)[]) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return vals.some((v) => v && v.toLowerCase().includes(needle));
}

export function buildReachabilityData({
  campaignAccounts,
  campaignContacts,
  primaryChannel,
  searchQuery = "",
  channelFilter = "all",
}: BuildArgs): { rows: ReachabilityRow[]; aggregates: AccountAggregate[] } {
  const q = searchQuery.trim();
  const accountMap = new Map<string, any>();
  for (const ca of campaignAccounts) accountMap.set(ca.account_id, ca.accounts || {});

  const rows: ReachabilityRow[] = [];

  for (const cc of campaignContacts) {
    const c = cc.contacts || {};
    const a = cc.account_id ? accountMap.get(cc.account_id) || {} : {};
    const accountName = a.account_name || (cc.account_id ? "—" : "Unlinked");
    if (!matchesSearch(q, accountName, c.contact_name, c.email, c.phone_no, c.position, c.industry)) {
      continue;
    }
    const emailReachable = isReachableEmail(c.email);
    const linkedInReachable = isReachableLinkedIn(c.linkedin);
    const phoneReachable = isReachablePhone(c.phone_no) || isReachablePhone(a.phone);

    if (channelFilter === "Email" && !emailReachable) continue;
    if (channelFilter === "LinkedIn" && !linkedInReachable) continue;
    if (channelFilter === "Phone" && !phoneReachable) continue;

    const primaryMatch =
      !primaryChannel ||
      (primaryChannel === "Email" && emailReachable) ||
      (primaryChannel === "LinkedIn" && linkedInReachable) ||
      ((primaryChannel === "Phone" || primaryChannel === "Call") && phoneReachable) ||
      !["Email", "LinkedIn", "Phone", "Call"].includes(primaryChannel);

    rows.push({
      account: accountName,
      contact: c.contact_name || "—",
      email: c.email || "",
      phone: c.phone_no || a.phone || "",
      linkedin: c.linkedin || "",
      emailReachable,
      linkedInReachable,
      phoneReachable,
      primaryMatch,
      stage: cc.stage || "Not Contacted",
      linkedinStatus: cc.linkedin_status || "",
      whyUnreachable: reasonsFor(c, a),
    });
  }

  const aggMap = new Map<string, AccountAggregate>();
  for (const r of rows) {
    const cur = aggMap.get(r.account) || {
      account: r.account,
      contacts: 0,
      emailable: 0,
      linkedin: 0,
      callable: 0,
    };
    cur.contacts++;
    if (r.emailReachable) cur.emailable++;
    if (r.linkedInReachable) cur.linkedin++;
    if (r.phoneReachable) cur.callable++;
    aggMap.set(r.account, cur);
  }
  const aggregates = Array.from(aggMap.values()).sort((a, b) => a.account.localeCompare(b.account));

  return { rows: rows.sort((a, b) => a.account.localeCompare(b.account) || a.contact.localeCompare(b.contact)), aggregates };
}

function safeFilename(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "campaign";
}

function downloadBlob(content: string | Blob, filename: string, mime = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ROW_HEADERS = [
  "Account",
  "Contact",
  "Email",
  "Phone",
  "LinkedIn",
  "Reachable on Email",
  "Reachable on LinkedIn",
  "Reachable on Phone",
  "Primary Channel Match",
  "Stage",
  "LinkedIn Status",
  "Why Unreachable",
];

function rowsToCSVBlock(rows: ReachabilityRow[], emptyLabel = "(no rows in scope)") {
  if (rows.length === 0) {
    return `${ROW_HEADERS.join(",")}\n${CSVParser.escapeCSVField(emptyLabel)}\n`;
  }
  return CSVParser.toCSV(
    rows.map((r) => ({
      Account: r.account,
      Contact: r.contact,
      Email: r.email,
      Phone: r.phone,
      LinkedIn: r.linkedin,
      "Reachable on Email": yn(r.emailReachable),
      "Reachable on LinkedIn": yn(r.linkedInReachable),
      "Reachable on Phone": yn(r.phoneReachable),
      "Primary Channel Match": yn(r.primaryMatch),
      Stage: r.stage,
      "LinkedIn Status": r.linkedinStatus,
      "Why Unreachable": r.whyUnreachable,
    })),
    ROW_HEADERS,
  );
}

export function exportReachabilityCSV(opts: {
  campaignName: string;
  primaryChannel: string;
  data: ReturnType<typeof buildReachabilityData>;
  /** When true, label as "Filtered view"; otherwise "All". Cosmetic only. */
  filteredView?: boolean;
}) {
  const { campaignName, primaryChannel, data, filteredView } = opts;
  const { rows, aggregates } = data;

  const aggHeaders = ["Account", "# Contacts", "# Emailable", "# LinkedIn", "# Callable"];
  const aggBlock = CSVParser.toCSV(
    aggregates.map((a) => ({
      Account: a.account,
      "# Contacts": String(a.contacts),
      "# Emailable": String(a.emailable),
      "# LinkedIn": String(a.linkedin),
      "# Callable": String(a.callable),
    })),
    aggHeaders,
  );

  const allBlock = rowsToCSVBlock(rows);
  const emailBlock = rowsToCSVBlock(rows.filter((r) => r.emailReachable));
  const linkedinBlock = rowsToCSVBlock(rows.filter((r) => r.linkedInReachable));
  const phoneBlock = rowsToCSVBlock(rows.filter((r) => r.phoneReachable));

  const meta =
    `Campaign,${CSVParser.escapeCSVField(campaignName)}\n` +
    `Primary Channel,${CSVParser.escapeCSVField(primaryChannel || "—")}\n` +
    `Scope,${CSVParser.escapeCSVField(filteredView ? "Filtered view" : "All")}\n` +
    `Generated,${CSVParser.escapeCSVField(format(new Date(), "yyyy-MM-dd HH:mm"))}\n`;

  const csv =
    `${meta}\n# Account aggregates\n${aggBlock}\n\n` +
    `# All contacts (${rows.length})\n${allBlock}\n\n` +
    `# Email-reachable only (${rows.filter((r) => r.emailReachable).length})\n${emailBlock}\n\n` +
    `# LinkedIn-reachable only (${rows.filter((r) => r.linkedInReachable).length})\n${linkedinBlock}\n\n` +
    `# Phone-reachable only (${rows.filter((r) => r.phoneReachable).length})\n${phoneBlock}\n`;

  downloadBlob(
    csv,
    `${safeFilename(campaignName)}-reachability-${format(new Date(), "yyyy-MM-dd")}.csv`,
    "text/csv;charset=utf-8;",
  );
}

export async function exportReachabilityPDF(opts: {
  campaignName: string;
  primaryChannel: string;
  data: ReturnType<typeof buildReachabilityData>;
  filteredView?: boolean;
}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { campaignName, primaryChannel, data, filteredView } = opts;
  const { rows, aggregates } = data;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const generatedAt = format(new Date(), "yyyy-MM-dd HH:mm");

  // Header
  doc.setFontSize(16);
  doc.text("Reachability Report", 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Campaign: ${campaignName}`, 40, 58);
  doc.text(`Primary channel: ${primaryChannel || "—"}`, 40, 72);
  doc.text(`Scope: ${filteredView ? "Filtered view" : "All"}`, 40, 86);
  doc.text(`Generated: ${generatedAt}`, 40, 100);
  doc.setTextColor(0);

  // Aggregates table
  autoTable(doc, {
    startY: 119,
    head: [["Account", "# Contacts", "# Emailable", "# LinkedIn", "# Callable"]],
    body: aggregates.map((a) => [
      a.account,
      String(a.contacts),
      String(a.emailable),
      String(a.linkedin),
      String(a.callable),
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Generated ${generatedAt} • ${campaignName}`,
        40,
        doc.internal.pageSize.getHeight() - 20,
      );
      doc.setTextColor(0);
    },
  });

  const afterAggY = (doc as any).lastAutoTable?.finalY || 200;

  // Per-contact reachability
  autoTable(doc, {
    startY: afterAggY + 24,
    head: [["Account", "Contact", "Email", "Phone", "LinkedIn?", "✉", "in", "📞", "Primary", "Stage", "Why Unreachable"]],
    body: rows.map((r) => [
      r.account,
      r.contact,
      r.email || "—",
      r.phone || "—",
      r.linkedin ? "Yes" : "—",
      r.emailReachable ? "●" : "○",
      r.linkedInReachable ? "●" : "○",
      r.phoneReachable ? "●" : "○",
      r.primaryMatch ? "✓" : "—",
      r.stage,
      r.whyUnreachable,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [60, 60, 60] },
    columnStyles: {
      5: { halign: "center", cellWidth: 24 },
      6: { halign: "center", cellWidth: 24 },
      7: { halign: "center", cellWidth: 24 },
      8: { halign: "center", cellWidth: 50 },
    },
    margin: { left: 40, right: 40 },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      // color the reachability dots
      if ([5, 6, 7].includes(data.column.index)) {
        const reachable = data.cell.raw === "●";
        data.cell.styles.textColor = reachable ? [16, 185, 129] : [200, 200, 200];
        data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === 8 && data.cell.raw === "✓") {
        data.cell.styles.textColor = [16, 185, 129];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save(`${safeFilename(campaignName)}-reachability-${format(new Date(), "yyyy-MM-dd")}.pdf`);
}
