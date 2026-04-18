import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface WidgetStats {
  activeCount: number;
  totalCount: number;
  avgStrategy: number;
  topCampaigns: { id: string; name: string; rate: number }[];
}

export function CampaignDashboardWidget() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-dashboard-widget"],
    staleTime: 2 * 60 * 1000,
    enabled: !!user,
    queryFn: async (): Promise<WidgetStats> => {
      const { data, error } = await supabase.rpc("get_campaign_widget_stats");
      if (error) throw error;
      const stats = (data as unknown as WidgetStats) || {
        activeCount: 0, totalCount: 0, avgStrategy: 0, topCampaigns: [],
      };
      return {
        activeCount: stats.activeCount || 0,
        totalCount: stats.totalCount || 0,
        avgStrategy: stats.avgStrategy || 0,
        topCampaigns: stats.topCampaigns || [],
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Megaphone className="h-5 w-5 text-primary" />
          Campaign Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 rounded-lg bg-primary/5">
            <div className="text-2xl font-bold text-primary">{data.activeCount}</div>
            <div className="text-xs text-muted-foreground">Active Campaigns</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-primary/5">
            <div className="text-2xl font-bold text-primary">{data.avgStrategy}%</div>
            <div className="text-xs text-muted-foreground">Avg Strategy Done</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-primary/5">
            <div className="text-2xl font-bold text-primary">{data.totalCount}</div>
            <div className="text-xs text-muted-foreground">Total Campaigns</div>
          </div>
        </div>

        {data.topCampaigns.length > 0 && (
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" />
              Top by Response Rate
            </div>
            <div className="space-y-2">
              {data.topCampaigns.map((c, i) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1 mr-2">
                    <span className="text-muted-foreground mr-1">{i + 1}.</span>
                    {c.name}
                  </span>
                  <Badge
                    variant="secondary"
                    className={
                      c.rate >= 50
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        : c.rate >= 20
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {c.rate}%
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.topCampaigns.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-2">
            No campaign contacts yet
          </div>
        )}
      </CardContent>
    </Card>
  );
}
