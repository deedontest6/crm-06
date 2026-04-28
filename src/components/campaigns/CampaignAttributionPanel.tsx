import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DollarSign, TrendingUp, ExternalLink, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

interface Props { campaignId: string }

type WindowDays = 30 | 60 | 90 | 180;

interface Deal {
  id: string;
  deal_name: string;
  total_contract_value: number | null;
  currency_type: string | null;
  stage: string;
  expected_closing_date: string | null;
  created_at: string | null;
  campaign_id: string | null;
  account_id: string | null;
}

const WON_STAGES = new Set(["Closed Won", "Won", "Closed-Won", "closed_won"]);
const LOST_STAGES = new Set(["Lost", "Closed Lost", "closed_lost"]);

const SELECT_COLS = "id, deal_name, total_contract_value, currency_type, stage, expected_closing_date, created_at, campaign_id, account_id";

export function CampaignAttributionPanel({ campaignId }: Props) {
  const navigate = useNavigate();
  const [windowDays, setWindowDays] = useState<WindowDays>(90);

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-attribution", campaignId, windowDays],
    queryFn: async () => {
      const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
      const { data: directRaw, error: e1 } = await supabase
        .from("deals")
        .select(SELECT_COLS)
        .eq("campaign_id", campaignId)
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (e1) throw e1;
      const direct = (directRaw || []) as unknown as Deal[];

      const { data: campAccounts } = await supabase
        .from("campaign_accounts")
        .select("account_id")
        .eq("campaign_id", campaignId);
      const accIds = (campAccounts || []).map(a => a.account_id).filter(Boolean) as string[];

      let influenced: Deal[] = [];
      if (accIds.length > 0) {
        const directIds = new Set(direct.map(d => d.id));
        const { data: infRaw } = await supabase
          .from("deals")
          .select(SELECT_COLS)
          .in("account_id", accIds.slice(0, 1000))
          .gte("created_at", since)
          .order("created_at", { ascending: false });
        influenced = ((infRaw || []) as unknown as Deal[])
          .filter(d => !directIds.has(d.id) && d.campaign_id !== campaignId);
      }

      return { direct, influenced };
    },
    staleTime: 60_000,
  });

  const summary = useMemo(() => {
    const direct = data?.direct || [];
    const influenced = data?.influenced || [];
    const sumWon = (arr: Deal[]) =>
      arr.filter(d => WON_STAGES.has(d.stage)).reduce((s, d) => s + (d.total_contract_value || 0), 0);
    const sumPipeline = (arr: Deal[]) =>
      arr.filter(d => !WON_STAGES.has(d.stage) && !LOST_STAGES.has(d.stage))
        .reduce((s, d) => s + (d.total_contract_value || 0), 0);
    return {
      directCount: direct.length,
      influencedCount: influenced.length,
      wonRevenue: sumWon(direct),
      pipelineRevenue: sumPipeline(direct),
      influencedWonRevenue: sumWon(influenced),
      currency: direct[0]?.currency_type || influenced[0]?.currency_type || "EUR",
    };
  }, [data]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: summary.currency || "EUR",
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-3">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-emerald-600" />
              Conversion Attribution
              <Tooltip>
                <TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-xs">
                  <strong>Direct</strong>: deals tagged with this campaign.<br />
                  <strong>Influenced</strong>: deals on accounts the campaign touched.<br />
                  Window applies to deal creation date.
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <ToggleGroup
              type="single"
              value={String(windowDays)}
              onValueChange={(v) => v && setWindowDays(Number(v) as WindowDays)}
              size="sm"
              className="h-7"
            >
              {([30, 60, 90, 180] as WindowDays[]).map(d => (
                <ToggleGroupItem key={d} value={String(d)} className="h-6 px-2 text-[11px]">
                  {d}d
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="Direct deals" value={summary.directCount} sub={`${summary.influencedCount} influenced`} />
              <Tile label="Won revenue" value={fmt(summary.wonRevenue)} accent="emerald" />
              <Tile label="Open pipeline" value={fmt(summary.pipelineRevenue)} accent="primary" />
              <Tile label="Influenced won" value={fmt(summary.influencedWonRevenue)} sub="not direct-tagged" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium">Deals attributed</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-xs text-muted-foreground text-center">Loading…</div>
            ) : (data?.direct.length || 0) === 0 ? (
              <div className="p-6 text-xs text-muted-foreground text-center">
                No deals tagged with this campaign yet. Set a deal's <em>Campaign</em> field to attribute revenue here.
              </div>
            ) : (
              <div className="divide-y">
                {data!.direct.map(d => (
                  <button
                    key={d.id}
                    onClick={() => navigate(`/deals/${d.id}`)}
                    className="w-full text-left grid grid-cols-12 gap-2 items-center px-4 py-2.5 hover:bg-muted/40 transition-colors text-xs"
                  >
                    <div className="col-span-12 sm:col-span-5 flex items-center gap-2 min-w-0">
                      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{d.deal_name}</span>
                    </div>
                    <div className="col-span-4 sm:col-span-2 tabular-nums">{d.total_contract_value ? fmt(d.total_contract_value) : "—"}</div>
                    <div className="col-span-4 sm:col-span-2">
                      <Badge variant={WON_STAGES.has(d.stage) ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">
                        {d.stage || "—"}
                      </Badge>
                    </div>
                    <div className="col-span-3 sm:col-span-2 text-muted-foreground tabular-nums">
                      {d.expected_closing_date ? format(new Date(d.expected_closing_date), "d MMM yy") : "—"}
                    </div>
                    <div className="col-span-1 flex justify-end text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: "emerald" | "primary" }) {
  const accentClass = accent === "emerald"
    ? "text-emerald-600 dark:text-emerald-400"
    : accent === "primary"
    ? "text-primary"
    : "";
  return (
    <div className="rounded-lg border border-border/50 p-3 bg-card">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${accentClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
