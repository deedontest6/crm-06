import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Pause, Play, X, Loader2, RotateCw, ChevronRight, Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface SendJob {
  id: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  total_items: number;
  sent_items: number;
  failed_items: number;
  skipped_items: number;
  cancelled_items: number;
  created_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_summary: string | null;
}

interface SendJobItem {
  id: string;
  status: string;
  recipient_email: string;
  recipient_name: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  attempt_count: number;
}

const STATUS_VARIANTS: Record<SendJob["status"], { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-muted text-foreground" },
  running: { label: "Sending", className: "bg-primary/15 text-primary" },
  paused: { label: "Paused", className: "bg-amber-500/15 text-amber-700" },
  completed: { label: "Completed", className: "bg-emerald-500/15 text-emerald-700" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

interface Props {
  campaignId: string;
}

export function SendJobPanel({ campaignId }: Props) {
  const qc = useQueryClient();
  // Track which job rows are expanded so we lazy-fetch their items.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["send-jobs", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_send_jobs")
        .select(
          "id,status,total_items,sent_items,failed_items,skipped_items,cancelled_items,created_at,scheduled_at,started_at,finished_at,error_summary",
        )
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as SendJob[];
    },
    refetchInterval: (q) => {
      const list = (q.state.data as SendJob[] | undefined) || [];
      return list.some((j) => j.status === "queued" || j.status === "running") ? 5000 : false;
    },
  });

  // Realtime updates
  useEffect(() => {
    const ch = supabase
      .channel(`send-jobs-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaign_send_jobs", filter: `campaign_id=eq.${campaignId}` },
        () => qc.invalidateQueries({ queryKey: ["send-jobs", campaignId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [campaignId, qc]);

  const runRpc = async (rpc: "pause_send_job" | "resume_send_job" | "cancel_send_job", jobId: string) => {
    const { error } = await supabase.rpc(rpc, { _job_id: jobId });
    if (error) {
      toast({ title: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Job updated" });
    qc.invalidateQueries({ queryKey: ["send-jobs", campaignId] });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading send jobs...
        </CardContent>
      </Card>
    );
  }

  if (jobs.length === 0) return null;

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Background send jobs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map((j) => {
          const done = j.sent_items + j.failed_items + j.skipped_items + j.cancelled_items;
          const pct = j.total_items > 0 ? Math.round((done / j.total_items) * 100) : 0;
          const v = STATUS_VARIANTS[j.status];
          const canPause = j.status === "queued" || j.status === "running";
          const canResume = j.status === "paused";
          const canCancel = canPause || canResume;
          const hasFailures = j.failed_items > 0 || j.skipped_items > 0;
          const isExpanded = expanded.has(j.id);
          const scheduledFuture = j.scheduled_at && new Date(j.scheduled_at) > new Date();
          return (
            <div key={j.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className={`text-xs ${v.className}`} variant="outline">
                    {v.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground truncate">
                    {format(new Date(j.created_at), "MMM d, HH:mm")} · {j.total_items} recipient{j.total_items === 1 ? "" : "s"}
                    {scheduledFuture && (
                      <> · <span className="text-amber-600">scheduled {format(new Date(j.scheduled_at!), "MMM d, HH:mm")}</span></>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {hasFailures && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs" onClick={() => toggleExpanded(j.id)}>
                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      {isExpanded ? "Hide" : "Details"}
                    </Button>
                  )}
                  {canPause && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => runRpc("pause_send_job", j.id)}>
                      <Pause className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canResume && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => runRpc("resume_send_job", j.id)}>
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => runRpc("cancel_send_job", j.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <Progress value={pct} className="h-2" />
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Sent <strong className="text-foreground tabular-nums">{j.sent_items}</strong></span>
                {j.failed_items > 0 && (
                  <span>Failed <strong className="text-destructive tabular-nums">{j.failed_items}</strong></span>
                )}
                {j.skipped_items > 0 && (
                  <span>Skipped <strong className="text-foreground tabular-nums">{j.skipped_items}</strong></span>
                )}
                {j.cancelled_items > 0 && (
                  <span>Cancelled <strong className="text-foreground tabular-nums">{j.cancelled_items}</strong></span>
                )}
                <span className="ml-auto">{pct}%</span>
              </div>
              {j.error_summary && (
                <p className="text-xs text-destructive">{j.error_summary}</p>
              )}
              {isExpanded && hasFailures && (
                <FailedItemsList jobId={j.id} campaignId={campaignId} />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Lazily fetched per-item failure list with retry + CSV export.
function FailedItemsList({ jobId, campaignId }: { jobId: string; campaignId: string }) {
  const qc = useQueryClient();
  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ["send-job-items", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_send_job_items")
        .select("id, status, recipient_email, recipient_name, last_error_code, last_error_message, attempt_count")
        .eq("job_id", jobId)
        .in("status", ["failed", "skipped"])
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as SendJobItem[];
    },
  });

  const retryOne = async (id: string) => {
    const { error } = await supabase.rpc("requeue_send_job_item", { _item_id: id });
    if (error) {
      toast({ title: "Retry failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Recipient requeued — runner will pick it up shortly." });
    refetch();
    qc.invalidateQueries({ queryKey: ["send-jobs", campaignId] });
  };

  const retryAll = async () => {
    let ok = 0;
    let fail = 0;
    for (const it of items) {
      const { error } = await supabase.rpc("requeue_send_job_item", { _item_id: it.id });
      if (error) fail++;
      else ok++;
    }
    toast({
      title: `Requeued ${ok} item${ok === 1 ? "" : "s"}${fail ? ` (${fail} failed)` : ""}.`,
      variant: fail ? "destructive" : "default",
    });
    refetch();
    qc.invalidateQueries({ queryKey: ["send-jobs", campaignId] });
  };

  const exportCsv = () => {
    const header = ["recipient_name", "recipient_email", "status", "attempt_count", "error_code", "error_message"];
    const rows = items.map((it) => [
      it.recipient_name || "",
      it.recipient_email,
      it.status,
      String(it.attempt_count),
      it.last_error_code || "",
      it.last_error_message || "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `failed-recipients-${jobId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading failed recipients…</p>;
  }
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No failed items recorded for this job.</p>;
  }
  return (
    <div className="border-t pt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{items.length} failed / skipped</span>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" onClick={exportCsv}>
            <Download className="h-3 w-3" /> CSV
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" onClick={retryAll}>
            <RotateCw className="h-3 w-3" /> Retry all
          </Button>
        </div>
      </div>
      <div className="max-h-[180px] overflow-y-auto divide-y text-xs">
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between py-1 gap-2">
            <div className="flex-1 min-w-0">
              <div className="truncate">
                <span className="font-medium">{it.recipient_name || it.recipient_email}</span>{" "}
                <span className="text-muted-foreground">{it.recipient_name ? it.recipient_email : ""}</span>
              </div>
              <div className="text-[10px] text-destructive truncate" title={it.last_error_message || it.last_error_code || ""}>
                {it.last_error_code ? `[${it.last_error_code}] ` : ""}{it.last_error_message || "Unknown error"}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 shrink-0"
              onClick={() => retryOne(it.id)}
              title="Retry this recipient"
            >
              <RotateCw className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
