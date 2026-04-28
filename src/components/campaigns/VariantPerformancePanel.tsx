import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Beaker, Info, ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props { campaignId: string }

interface Variant {
  id: string;
  template_id: string;
  variant_label: string;
  subject: string;
  is_winner: boolean;
}

interface VariantStats {
  variant_id: string;
  template_id: string;
  variant_label: string;
  is_winner: boolean;
  template_name: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  open_rate: number;
  reply_rate: number;
}

// Wilson score interval (95%) for a binomial proportion — gives a robust
// confidence band that doesn't blow up at small n.
function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function VariantPerformancePanel({ campaignId }: Props) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-variants-stats", campaignId],
    queryFn: async (): Promise<VariantStats[]> => {
      // 1. All templates for this campaign
      const { data: templates, error: tplErr } = await supabase
        .from("campaign_email_templates")
        .select("id, template_name")
        .eq("campaign_id", campaignId);
      if (tplErr) throw tplErr;
      const templateIds = (templates || []).map(t => t.id);
      if (templateIds.length === 0) return [];

      // 2. All variants for those templates
      const { data: variants, error: vErr } = await supabase
        .from("campaign_email_variants")
        .select("id, template_id, variant_label, is_winner")
        .in("template_id", templateIds);
      if (vErr) throw vErr;
      if (!variants || variants.length === 0) return [];

      const variantIds = variants.map(v => v.id);

      // 3. Aggregate per variant from communications
      const { data: comms, error: cErr } = await supabase
        .from("campaign_communications")
        .select("variant_id, delivery_status, email_status, opened_at, parent_id")
        .eq("campaign_id", campaignId)
        .in("variant_id", variantIds);
      if (cErr) throw cErr;

      // 4. Reply lookup: any comm whose parent_id is in our sent set
      const sentByVariant = new Map<string, Set<string>>();
      // We can't join replies to variant directly without a 2nd query; treat
      // any inbound (delivery_status = received) communication whose thread
      // touches a variant as a reply via existing reply_count if present.
      // For correctness here we count `email_status = Replied` on the outbound row.
      const stats = new Map<string, { sent: number; opened: number; replied: number; bounced: number }>();
      for (const v of variants) stats.set(v.id, { sent: 0, opened: 0, replied: 0, bounced: 0 });

      for (const c of comms || []) {
        if (!c.variant_id) continue;
        const s = stats.get(c.variant_id);
        if (!s) continue;
        const status = c.delivery_status;
        const eStatus = c.email_status;
        if (status === "received") continue;
        if (status === "failed" || eStatus === "Bounced" || eStatus === "Failed") s.bounced++;
        else s.sent++;
        if (c.opened_at) s.opened++;
        if (eStatus === "Replied") s.replied++;
      }

      const tplName = new Map((templates || []).map(t => [t.id, t.template_name]));
      return variants.map(v => {
        const s = stats.get(v.id) || { sent: 0, opened: 0, replied: 0, bounced: 0 };
        return {
          variant_id: v.id,
          template_id: v.template_id,
          variant_label: v.variant_label,
          is_winner: v.is_winner,
          template_name: tplName.get(v.template_id) || "Template",
          sent: s.sent,
          opened: s.opened,
          replied: s.replied,
          bounced: s.bounced,
          open_rate: s.sent > 0 ? s.opened / s.sent : 0,
          reply_rate: s.sent > 0 ? s.replied / s.sent : 0,
        };
      });
    },
    staleTime: 30_000,
  });

  const promote = useMutation({
    mutationFn: async (variant: VariantStats) => {
      // Set this variant as winner; clear winner flag from siblings on the same template.
      const { error: clearErr } = await supabase
        .from("campaign_email_variants")
        .update({ is_winner: false })
        .eq("template_id", variant.template_id);
      if (clearErr) throw clearErr;
      const { error } = await supabase
        .from("campaign_email_variants")
        .update({ is_winner: true })
        .eq("id", variant.variant_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-variants-stats", campaignId] });
      toast({ title: "Winner promoted", description: "Future sends will use this variant." });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Group by template so users see A/B pairs side by side
  const groups = useMemo(() => {
    const map = new Map<string, VariantStats[]>();
    for (const v of data || []) {
      if (!map.has(v.template_id)) map.set(v.template_id, []);
      map.get(v.template_id)!.push(v);
    }
    // Only show templates that actually have 2+ variants (real A/B tests)
    return Array.from(map.values()).filter(arr => arr.length >= 2);
  }, [data]);

  if (isLoading) {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-6 flex items-center justify-center text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading variant data…
        </CardContent>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Beaker className="h-4 w-4 text-violet-500" /> A/B Variant Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 text-xs text-muted-foreground">
          No A/B variants yet. Add a B variant to any email template to compare open and reply rates.
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider delayDuration={120}>
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Beaker className="h-4 w-4 text-violet-500" />
            A/B Variant Performance
            <Tooltip>
              <TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground cursor-help" /></TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-xs">
                Open and reply rates per variant with a 95% Wilson confidence interval.
                Promote the winner to make it the default for future sends.
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-4">
          {groups.map(variants => {
            const totalSent = variants.reduce((a, b) => a + b.sent, 0);
            // Winner candidate = highest reply rate with at least 30 sends
            const eligible = variants.filter(v => v.sent >= 30);
            const leader = eligible.length
              ? eligible.reduce((a, b) => (b.reply_rate > a.reply_rate ? b : a))
              : null;
            return (
              <div key={variants[0].template_id} className="rounded-lg border border-border/50 overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-xs font-medium flex items-center justify-between">
                  <span className="truncate">{variants[0].template_name}</span>
                  <span className="text-muted-foreground">{totalSent} total sends</span>
                </div>
                <div className="divide-y">
                  {variants.map(v => {
                    const ciOpen = wilson(v.opened, v.sent);
                    const ciReply = wilson(v.replied, v.sent);
                    const isLeader = leader?.variant_id === v.variant_id;
                    return (
                      <div key={v.variant_id} className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 text-xs">
                        <div className="col-span-12 sm:col-span-2 flex items-center gap-1.5">
                          <Badge
                            variant={v.is_winner ? "default" : "secondary"}
                            className={`h-5 px-1.5 text-[10px] ${v.is_winner ? "bg-amber-500 hover:bg-amber-500" : ""}`}
                          >
                            {v.is_winner && <Trophy className="h-2.5 w-2.5 mr-0.5" />}
                            {v.variant_label}
                          </Badge>
                          {isLeader && !v.is_winner && (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                              Leader
                            </Badge>
                          )}
                        </div>
                        <div className="col-span-4 sm:col-span-2 tabular-nums">
                          <div className="text-muted-foreground text-[10px]">Sent</div>
                          <div className="font-medium">{v.sent}</div>
                        </div>
                        <div className="col-span-4 sm:col-span-3 tabular-nums">
                          <div className="text-muted-foreground text-[10px]">Open rate</div>
                          <div className="font-medium">
                            {fmtPct(v.open_rate)}
                            <span className="text-[10px] text-muted-foreground ml-1">
                              [{fmtPct(ciOpen.low)}–{fmtPct(ciOpen.high)}]
                            </span>
                          </div>
                        </div>
                        <div className="col-span-4 sm:col-span-3 tabular-nums">
                          <div className="text-muted-foreground text-[10px]">Reply rate</div>
                          <div className="font-medium">
                            {fmtPct(v.reply_rate)}
                            <span className="text-[10px] text-muted-foreground ml-1">
                              [{fmtPct(ciReply.low)}–{fmtPct(ciReply.high)}]
                            </span>
                          </div>
                        </div>
                        <div className="col-span-12 sm:col-span-2 flex justify-end">
                          {!v.is_winner && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1"
                              disabled={v.sent < 30 || promote.isPending}
                              onClick={() => promote.mutate(v)}
                            >
                              <ArrowUpRight className="h-3 w-3" /> Promote
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {variants.every(v => v.sent < 30) && (
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/20 border-t">
                    Need at least 30 sends per variant before declaring a winner.
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
