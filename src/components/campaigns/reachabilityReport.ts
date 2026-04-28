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
  /** When provided, exporters omit columns/rows for channels not in this list. */
  enabledChannels?: string[];
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
  enabledChannels,
}: BuildArgs): { rows: ReachabilityRow[]; aggregates: AccountAggregate[]; enabledChannels: string[] } {
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

  const norm = (v: string) => (v === "Call" ? "Phone" : v);
  const channels = (enabledChannels && enabledChannels.length > 0)
    ? Array.from(new Set(enabledChannels.map(norm))).filter((c) => ["Email", "Phone", "LinkedIn"].includes(c))
    : ["Email", "Phone", "LinkedIn"];
  return {
    rows: rows.sort((a, b) => a.account.localeCompare(b.account) || a.contact.localeCompare(b.contact)),
    aggregates,
    enabledChannels: channels,
  };
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

function buildHeaders(enabled: string[]) {
  const h: string[] = ["Account", "Contact"];
  if (enabled.includes("Email")) h.push("Email", "Reachable on Email");
  if (enabled.includes("Phone")) h.push("Phone", "Reachable on Phone");
  if (enabled.includes("LinkedIn")) h.push("LinkedIn", "Reachable on LinkedIn", "LinkedIn Status");
  h.push("Primary Channel Match", "Stage", "Why Unreachable");
  return h;
}

function rowsToCSVBlock(rows: ReachabilityRow[], enabled: string[], emptyLabel = "(no rows in scope)") {
  const headers = buildHeaders(enabled);
  if (rows.length === 0) {
    return `${headers.join(",")}\n${CSVParser.escapeCSVField(emptyLabel)}\n`;
  }
  return CSVParser.toCSV(
    rows.map((r) => {
      const o: Record<string, string> = {
        Account: r.account,
        Contact: r.contact,
      };
      if (enabled.includes("Email")) {
        o.Email = r.email;
        o["Reachable on Email"] = yn(r.emailReachable);
      }
      if (enabled.includes("Phone")) {
        o.Phone = r.phone;
        o["Reachable on Phone"] = yn(r.phoneReachable);
      }
      if (enabled.includes("LinkedIn")) {
        o.LinkedIn = r.linkedin;
        o["Reachable on LinkedIn"] = yn(r.linkedInReachable);
        o["LinkedIn Status"] = r.linkedinStatus;
      }
      o["Primary Channel Match"] = yn(r.primaryMatch);
      o.Stage = r.stage;
      o["Why Unreachable"] = r.whyUnreachable;
      return o;
    }),
    headers,
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
  const { rows, aggregates, enabledChannels } = data;

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

  const allBlock = rowsToCSVBlock(rows, enabledChannels);
  const emailBlock = enabledChannels.includes("Email") ? rowsToCSVBlock(rows.filter((r) => r.emailReachable), enabledChannels) : "";
  const linkedinBlock = enabledChannels.includes("LinkedIn") ? rowsToCSVBlock(rows.filter((r) => r.linkedInReachable), enabledChannels) : "";
  const phoneBlock = enabledChannels.includes("Phone") ? rowsToCSVBlock(rows.filter((r) => r.phoneReachable), enabledChannels) : "";

  const meta =
    `Campaign,${CSVParser.escapeCSVField(campaignName)}\n` +
    `Primary Channel,${CSVParser.escapeCSVField(primaryChannel || "—")}\n` +
    `Scope,${CSVParser.escapeCSVField(filteredView ? "Filtered view" : "All")}\n` +
    `Generated,${CSVParser.escapeCSVField(format(new Date(), "yyyy-MM-dd HH:mm"))}\n`;

  let csv = `${meta}\n# Account aggregates\n${aggBlock}\n\n# All contacts (${rows.length})\n${allBlock}\n`;
  if (emailBlock) csv += `\n# Email-reachable only (${rows.filter((r) => r.emailReachable).length})\n${emailBlock}\n`;
  if (linkedinBlock) csv += `\n# LinkedIn-reachable only (${rows.filter((r) => r.linkedInReachable).length})\n${linkedinBlock}\n`;
  if (phoneBlock) csv += `\n# Phone-reachable only (${rows.filter((r) => r.phoneReachable).length})\n${phoneBlock}\n`;

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
  const { rows, aggregates, enabledChannels } = data;

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

  // Aggregates table — drop columns for disabled channels.
  const aggHead: string[] = ["Account", "# Contacts"];
  if (enabledChannels.includes("Email")) aggHead.push("# Emailable");
  if (enabledChannels.includes("LinkedIn")) aggHead.push("# LinkedIn");
  if (enabledChannels.includes("Phone")) aggHead.push("# Callable");
  autoTable(doc, {
    startY: 119,
    head: [aggHead],
    body: aggregates.map((a) => {
      const row: string[] = [a.account, String(a.contacts)];
      if (enabledChannels.includes("Email")) row.push(String(a.emailable));
      if (enabledChannels.includes("LinkedIn")) row.push(String(a.linkedin));
      if (enabledChannels.includes("Phone")) row.push(String(a.callable));
      return row;
    }),
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

  // Per-contact reachability — drop columns for disabled channels.
  const head: string[] = ["Account", "Contact"];
  const dotIdx: number[] = [];
  if (enabledChannels.includes("Email")) { head.push("Email"); head.push("✉"); dotIdx.push(head.length - 1); }
  if (enabledChannels.includes("Phone")) { head.push("Phone"); head.push("📞"); dotIdx.push(head.length - 1); }
  if (enabledChannels.includes("LinkedIn")) { head.push("LinkedIn?"); head.push("in"); dotIdx.push(head.length - 1); }
  const primaryIdx = head.length;
  head.push("Primary", "Stage", "Why Unreachable");
  autoTable(doc, {
    startY: afterAggY + 24,
    head: [head],
    body: rows.map((r) => {
      const row: (string)[] = [r.account, r.contact];
      if (enabledChannels.includes("Email")) { row.push(r.email || "—"); row.push(r.emailReachable ? "●" : "○"); }
      if (enabledChannels.includes("Phone")) { row.push(r.phone || "—"); row.push(r.phoneReachable ? "●" : "○"); }
      if (enabledChannels.includes("LinkedIn")) { row.push(r.linkedin ? "Yes" : "—"); row.push(r.linkedInReachable ? "●" : "○"); }
      row.push(r.primaryMatch ? "✓" : "—", r.stage, r.whyUnreachable);
      return row;
    }),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: 40, right: 40 },
    didParseCell: (cellData) => {
      if (cellData.section !== "body") return;
      if (dotIdx.includes(cellData.column.index)) {
        const reachable = cellData.cell.raw === "●";
        cellData.cell.styles.textColor = reachable ? [16, 185, 129] : [200, 200, 200];
        cellData.cell.styles.fontStyle = "bold";
        cellData.cell.styles.halign = "center";
      }
      if (cellData.column.index === primaryIdx && cellData.cell.raw === "✓") {
        cellData.cell.styles.textColor = [16, 185, 129];
        cellData.cell.styles.fontStyle = "bold";
      }
    },
  });

  doc.save(`${safeFilename(campaignName)}-reachability-${format(new Date(), "yyyy-MM-dd")}.pdf`);
}
