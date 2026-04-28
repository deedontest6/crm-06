import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  steps: Array<{ id: string; step_number: number; step_type?: string | null }>;
  defaultDryRunOnly?: boolean;
}

const OUTCOMES = [
  { value: "all", label: "All outcomes" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "action_item_created", label: "Action item" },
  { value: "dry_run_match", label: "Dry-run match" },
] as const;

const REASON_LABELS: Record<string, string> = {
  no_template: "No template",
  template_missing: "Template missing",
  no_eligible_parent: "No eligible parent yet",
  segment_empty: "Segment is empty",
  not_in_segment: "Outside target segment",
  stop_sequence: "Contact opted out of sequence",
  already_fired: "Already fired for this contact",
  channel_conflict_24h: "Recently contacted on another channel",
  replied: "Contact already replied",
  opened: "Contact opened the parent",
  no_email: "No email on contact",
  suppressed: "Email is suppressed",
  duplicate_request: "Duplicate send request",
  send_failed: "Send failed",
  action_item_insert_failed: "Action item insert failed",
};

function outcomeBadge(outcome: string) {
  const m: Record<string, string> = {
    sent: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
    skipped: "bg-muted text-muted-foreground border-border",
    action_item_created: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
    dry_run_match: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
  };
  return m[outcome] || "bg-muted text-muted-foreground border-border";
}

const PAGE_SIZE = 50;

export function CampaignSequenceRunsDrawer({ open, onOpenChange, campaignId, steps, defaultDryRunOnly = false }: Props) {
  const [stepFilter, setStepFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [dryRunOnly, setDryRunOnly] = useState<boolean>(defaultDryRunOnly);
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["campaign-sequence-runs", campaignId, stepFilter, outcomeFilter, dryRunOnly, page],
    enabled: open,
    queryFn: async () => {
      let q = (supabase.from("campaign_sequence_runs") as any)
        .select("id, sequence_id, step_number, contact_id, outcome, reason, detail, communication_id, is_dry_run, ran_at", { count: "exact" })
        .eq("campaign_id", campaignId)
        .order("ran_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (stepFilter !== "all") q = q.eq("sequence_id", stepFilter);
      if (outcomeFilter !== "all") q = q.eq("outcome", outcomeFilter);
      if (dryRunOnly) q = q.eq("is_dry_run", true);
      const { data, error, count } = await q;
      if (error) throw error;

      // Resolve contact names in one pass
      const ids = Array.from(new Set((data ?? []).map((r: any) => r.contact_id).filter(Boolean)));
      let nameMap: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, contact_name, email")
          .in("id", ids as string[]);
        for (const c of contacts ?? []) {
          nameMap[c.id] = c.contact_name || c.email || "";
        }
      }
      return { rows: (data ?? []) as any[], count: count ?? 0, nameMap };
    },
  });

  const stepOptions = useMemo(
    () => [{ value: "all", label: "All steps" }, ...steps.map((s) => ({ value: s.id, label: `Step ${s.step_number}` }))],
    [steps],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-3">
          <SheetTitle>Sequence run logs</SheetTitle>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Select value={stepFilter} onValueChange={(v) => { setStepFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {stepOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={outcomeFilter} onValueChange={(v) => { setOutcomeFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={dryRunOnly}
              onChange={(e) => { setDryRunOnly(e.target.checked); setPage(0); }}
              className="h-3.5 w-3.5"
            />
            Dry-run only
          </label>
          <Button size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>

        {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>}
        {!isLoading && data && data.rows.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No runs yet. The hourly runner will log every evaluation here.
          </div>
        )}

        {!isLoading && data && data.rows.length > 0 && (
          <>
            <div className="border rounded-md divide-y">
              {data.rows.map((r) => (
                <div key={r.id} className="px-2.5 py-1.5 text-xs flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums w-[72px] shrink-0">
                    {formatDistanceToNow(new Date(r.ran_at), { addSuffix: true })}
                  </span>
                  <span className="text-muted-foreground w-[42px] shrink-0">#{r.step_number}</span>
                  <span className="truncate flex-1 min-w-0">
                    {r.contact_id ? (data.nameMap[r.contact_id] || r.contact_id.slice(0, 8)) : <em className="text-muted-foreground">—</em>}
                  </span>
                  <Badge variant="outline" className={`shrink-0 text-[10px] px-1.5 py-0 ${outcomeBadge(r.outcome)}`}>
                    {r.outcome.replace(/_/g, " ")}
                  </Badge>
                  {r.is_dry_run && (
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 shrink-0">dry</span>
                  )}
                  {r.reason && (
                    <span className="text-muted-foreground text-[10px] truncate max-w-[180px]" title={r.detail || REASON_LABELS[r.reason] || r.reason}>
                      {REASON_LABELS[r.reason] || r.reason}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <span>{data.count} total · page {page + 1} of {totalPages}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}