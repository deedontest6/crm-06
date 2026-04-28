import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Ban, Download, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";

type Reason = "unsubscribed" | "bounced" | "complained" | "manual";

interface SuppressionRow {
  id: string;
  email: string;
  reason: string;
  source: string | null;
  campaign_id: string | null;
  created_at: string;
}

const PAGE_SIZE = 25;

const reasonVariants: Record<string, { label: string; className: string }> = {
  unsubscribed: { label: "Unsubscribed", className: "bg-amber-500/10 text-amber-700 border-amber-200" },
  bounced: { label: "Bounced", className: "bg-red-500/10 text-red-700 border-red-200" },
  complained: { label: "Complained", className: "bg-red-600/10 text-red-800 border-red-300" },
  manual: { label: "Manual", className: "bg-slate-500/10 text-slate-700 border-slate-200" },
};

const SuppressionListSettings = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<SuppressionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addEmails, setAddEmails] = useState("");
  const [addReason, setAddReason] = useState<Reason>("manual");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("campaign_suppression_list")
      .select("id, email, reason, source, campaign_id, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      toast.error("Failed to load suppression list");
    } else {
      setRows((data || []) as SuppressionRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (reasonFilter !== "all" && r.reason !== reasonFilter) return false;
      if (!q) return true;
      return r.email.toLowerCase().includes(q) || (r.source || "").toLowerCase().includes(q);
    });
  }, [rows, search, reasonFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const handleAdd = async () => {
    if (!user) return;
    const emails = addEmails
      .split(/[\s,;\n]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (emails.length === 0) {
      toast.error("No valid emails found");
      return;
    }

    setAdding(true);
    try {
      const payload = emails.map((email) => ({
        email,
        reason: addReason,
        source: "admin_ui",
        created_by: user.id,
      }));
      const { error } = await supabase
        .from("campaign_suppression_list")
        .upsert(payload, { onConflict: "email" });
      if (error) throw error;
      toast.success(`Added ${emails.length} address${emails.length === 1 ? "" : "es"} to suppression list`);
      setAddEmails("");
      setAddOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to add suppression entries");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (row: SuppressionRow) => {
    const { error } = await supabase
      .from("campaign_suppression_list")
      .delete()
      .eq("id", row.id);
    if (error) {
      toast.error(error.message || "Failed to remove");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    toast.success(`${row.email} removed from suppression list`);
  };

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const header = "Email,Reason,Source,Added\n";
    const body = filtered
      .map((r) =>
        [r.email, r.reason, r.source || "", r.created_at]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `suppression-list-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ban className="h-4 w-4" />
          Do Not Email List
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Email addresses on this list will never receive campaign emails. Entries are added automatically via
          unsubscribe links and bounce/complaint feedback, and can be added manually here.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or source"
              className="pl-8 h-9"
            />
          </div>
          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
              <SelectItem value="bounced">Bounced</SelectItem>
              <SelectItem value="complained">Complained</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>

          <Button size="sm" variant="outline" onClick={exportCsv} className="h-9 gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9 gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add emails
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add to suppression list</DialogTitle>
                <DialogDescription>
                  Paste one email per line, or separate with commas. These addresses will be blocked from all future
                  campaign sends.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Textarea
                  rows={6}
                  value={addEmails}
                  onChange={(e) => setAddEmails(e.target.value)}
                  placeholder="user1@example.com&#10;user2@example.com"
                  className="font-mono text-sm"
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Reason</label>
                  <Select value={addReason} onValueChange={(v) => setAddReason(v as Reason)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                      <SelectItem value="bounced">Bounced</SelectItem>
                      <SelectItem value="complained">Complained</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={adding}>
                  Cancel
                </Button>
                <Button onClick={handleAdd} disabled={adding}>
                  {adding && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Add to suppression list
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${filtered.length} of ${rows.length} entries`}
        </div>

        {/* Table */}
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-[140px]">Reason</TableHead>
                <TableHead className="w-[140px]">Source</TableHead>
                <TableHead className="w-[160px]">Added</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin inline-block text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                    No suppression entries found.
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row) => {
                  const v = reasonVariants[row.reason] || reasonVariants.manual;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={v.className}>
                          {v.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.source || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(row.created_at), "dd MMM yyyy, HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove from suppression?</AlertDialogTitle>
                              <AlertDialogDescription>
                                <strong>{row.email}</strong> will be eligible to receive campaign emails again. Only
                                remove if you have explicit consent from the recipient.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleRemove(row)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SuppressionListSettings;
