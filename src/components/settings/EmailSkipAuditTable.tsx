import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StandardPagination } from "@/components/shared/StandardPagination";
import { ArrowLeft, Download, FileDown, Filter } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";

const REASON_LABELS: Record<string, string> = {
  chronology: "Chronology",
  subject_mismatch: "Subject mismatch",
  contact_mismatch: "Contact mismatch",
  ambiguous_candidates: "Ambiguous",
  no_eligible_parent: "No eligible parent",
};

const REASON_COLORS: Record<string, string> = {
  chronology: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  subject_mismatch: "bg-destructive/15 text-destructive",
  contact_mismatch: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  ambiguous_candidates: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  no_eligible_parent: "bg-muted text-muted-foreground",
};

interface Props {
  campaignId?: string;
  embedded?: boolean;
}

export function EmailSkipAuditTable({ campaignId, embedded }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const thirtyDaysAgo = useMemo(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    [],
  );

  const [from, setFrom] = useState(searchParams.get("from") || thirtyDaysAgo);
  const [to, setTo] = useState(searchParams.get("to") || today);
  const [reasonFilter, setReasonFilter] = useState<string>(searchParams.get("reason") || "all");
  const [search, setSearch] = useState("");
  const [correlationFilter, setCorrelationFilter] = useState<string | null>(searchParams.get("correlation_id"));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    const c = searchParams.get("correlation_id");
    if (c !== correlationFilter) setCorrelationFilter(c);
  }, [searchParams]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["email-skip-log", campaignId, from, to, reasonFilter, correlationFilter],
    queryFn: async () => {
      let q = supabase
        .from("email_reply_skip_log")
        .select("*, campaigns(campaign_name), contacts(contact_name)")
        .gte("created_at", new Date(from + "T00:00:00").toISOString())
        .lte("created_at", new Date(to + "T23:59:59").toISOString())
        .order("created_at", { ascending: false })
        .limit(2000);
      if (campaignId) q = q.eq("campaign_id", campaignId);
      if (reasonFilter !== "all") q = q.eq("skip_reason", reasonFilter);
      if (correlationFilter) q = q.eq("correlation_id", correlationFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((r: any) =>
      [r.subject, r.parent_subject, r.sender_email, r.contact_email, (r as any).contacts?.contact_name, (r as any).campaigns?.campaign_name]
        .filter(Boolean).some((v: string) => v.toLowerCase().includes(s)),
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const exportCsv = () => {
    const headers = ["When", "Campaign", "Contact", "Sender", "Subject", "Reason", "Parent subject", "Parent sent at", "Correlation"];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const cells = [
        r.created_at,
        (r as any).campaigns?.campaign_name || r.campaign_id || "",
        (r as any).contacts?.contact_name || r.contact_id || "",
        r.sender_email || "",
        r.subject || "",
        REASON_LABELS[r.skip_reason] || r.skip_reason,
        r.parent_subject || "",
        r.parent_sent_at || "",
        r.correlation_id || "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `email-skip-log-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    try {
      toast({ title: "Generating PDF…" });
      const { data, error } = await supabase.functions.invoke("email-skip-report", {
        body: {
          campaign_id: campaignId,
          from: new Date(from + "T00:00:00").toISOString(),
          to: new Date(to + "T23:59:59").toISOString(),
        },
      });
      if (error) throw error;
      const blob = data instanceof Blob ? data : new Blob([data as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `email-skip-report-${from}-to-${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "PDF failed", description: e?.message || "Could not generate PDF.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[140px]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[140px]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Reason</label>
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  {Object.entries(REASON_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground">Search subject / contact / sender</label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-8" />
            </div>
            {correlationFilter && (
              <Badge variant="outline" className="gap-1">
                <Filter className="h-3 w-3" />
                Correlation: {correlationFilter.slice(0, 8)}
                <button
                  onClick={() => { setCorrelationFilter(null); setSearchParams((p) => { p.delete("correlation_id"); return p; }); }}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                >×</button>
              </Badge>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={exportCsv} className="h-8 gap-1">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={downloadPdf} className="h-8 gap-1">
                <FileDown className="h-3.5 w-3.5" /> PDF report
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Parent subject</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : pageRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No skipped replies in this range.</TableCell></TableRow>
                ) : pageRows.map((r: any) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(r)}>
                    <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), "dd MMM HH:mm")}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{r.campaigns?.campaign_name || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[140px] truncate">{r.contacts?.contact_name || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[180px] truncate">{r.sender_email || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate">{r.subject || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${REASON_COLORS[r.skip_reason] || ""}`}>
                        {REASON_LABELS[r.skip_reason] || r.skip_reason}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate">{r.parent_subject || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <StandardPagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            itemsPerPage={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            entityName="skipped replies"
          />
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">Skipped reply detail</SheetTitle>
                <SheetDescription className="text-xs">
                  <Badge variant="outline" className={`mr-2 ${REASON_COLORS[selected.skip_reason] || ""}`}>
                    {REASON_LABELS[selected.skip_reason] || selected.skip_reason}
                  </Badge>
                  {format(new Date(selected.created_at), "PPp")}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <Field label="Subject" value={selected.subject} />
                <Field label="Sender" value={selected.sender_email} />
                <Field label="Contact email" value={selected.contact_email} />
                <Field label="Conversation ID" value={selected.conversation_id} mono />
                <Field label="Received at" value={selected.received_at && format(new Date(selected.received_at), "PPp")} />
                <Field label="Parent subject" value={selected.parent_subject} />
                <Field label="Parent sent at" value={selected.parent_sent_at && format(new Date(selected.parent_sent_at), "PPp")} />
                {selected.correlation_id && <Field label="Correlation" value={selected.correlation_id} mono />}
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Diagnostic details</div>
                  <pre className="text-[11px] bg-muted/40 rounded p-3 overflow-auto max-h-[300px]">
                    {JSON.stringify(selected.details, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`col-span-2 text-xs ${mono ? "font-mono break-all" : ""}`}>{value || "—"}</div>
    </div>
  );
}

export default EmailSkipAuditTable;
