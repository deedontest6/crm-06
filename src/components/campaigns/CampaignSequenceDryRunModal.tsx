import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  enabledStepCount: number;
  onViewResults: () => void;
}

const REASON_LABEL: Record<string, string> = {
  no_template: "No template",
  no_eligible_parent: "No eligible parent yet",
  segment_empty: "Segment empty",
  not_in_segment: "Outside segment",
  stop_sequence: "Opted out of sequence",
  already_fired: "Already fired",
  replied: "Already replied",
  opened: "Already opened",
  no_email: "No email",
  suppressed: "Suppressed",
};

export function CampaignSequenceDryRunModal({ open, onOpenChange, campaignId, enabledStepCount, onViewResults }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ wouldSend: number; wouldSkip: number; byReason: Record<string, number> } | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("campaign-follow-up-dryrun", {
        body: { campaign_id: campaignId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Dry-run failed");
      setResult({ wouldSend: data.wouldSend ?? 0, wouldSkip: data.wouldSkip ?? 0, byReason: data.byReason ?? {} });
    } catch (e: any) {
      toast({ title: "Dry-run failed", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const reset = () => { setResult(null); setRunning(false); };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Simulate follow-ups</DialogTitle>
          <DialogDescription>
            Preview which contacts would receive a follow-up right now, without sending anything.
            Results are also saved to the run logs (marked as dry-run).
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="text-sm space-y-2 py-2">
            <div className="flex justify-between"><span className="text-muted-foreground">Enabled steps</span><span className="tabular-nums">{enabledStepCount}</span></div>
            <div className="text-xs text-muted-foreground">
              The same gates as the real runner are applied (replies, opens, segments, suppression, idempotency).
            </div>
          </div>
        )}

        {result && (
          <div className="text-sm space-y-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border bg-emerald-500/5 border-emerald-500/30 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Would send / create</div>
                <div className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{result.wouldSend}</div>
              </div>
              <div className="rounded-md border px-3 py-2">
                <div className="text-[11px] text-muted-foreground">Would skip</div>
                <div className="text-2xl font-semibold tabular-nums">{result.wouldSkip}</div>
              </div>
            </div>
            {Object.keys(result.byReason).length > 0 && (
              <div className="border rounded-md divide-y text-xs">
                {Object.entries(result.byReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <div key={k} className="px-2.5 py-1 flex justify-between">
                    <span>{REASON_LABEL[k] || k}</span>
                    <span className="tabular-nums text-muted-foreground">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {!result && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>Cancel</Button>
              <Button onClick={handleRun} disabled={running || enabledStepCount === 0}>
                {running && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Run simulation
              </Button>
            </>
          )}
          {result && (
            <>
              <Button variant="ghost" onClick={() => { onOpenChange(false); }}>Close</Button>
              <Button onClick={() => { onOpenChange(false); onViewResults(); }}>View details</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}