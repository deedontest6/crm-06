import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

const STAGES = [
  { key: "Lead", color: "bg-slate-400" },
  { key: "Discussions", color: "bg-blue-500" },
  { key: "Qualified", color: "bg-violet-500" },
  { key: "RFQ", color: "bg-amber-500" },
  { key: "Offered", color: "bg-orange-500" },
  { key: "Won", color: "bg-emerald-500" },
  { key: "Lost", color: "bg-rose-500" },
];

interface Props {
  campaignId: string;
  deals: any[];
}

export function PipelineByStage({ campaignId, deals }: Props) {
  const navigate = useNavigate();
  const byStage = STAGES.map((s) => {
    const d = deals.filter((x: any) => x.stage === s.key);
    const value = d.reduce(
      (sum, x) => sum + (Number(x.total_contract_value) || 0),
      0
    );
    return { ...s, count: d.length, value };
  });
  const maxValue = Math.max(...byStage.map((s) => s.value), 1);
  const totalValue = byStage.reduce((s, x) => s + x.value, 0);

  return (
    <Card className="h-full">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Pipeline by Stage
          </h3>
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            €{(totalValue / 1000).toFixed(0)}k · {deals.length}
          </span>
        </div>
        {deals.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No deals yet
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {byStage.map((s) => (
              <button
                key={s.key}
                onClick={() =>
                  navigate(`/deals?campaign=${campaignId}&stage=${s.key}`)
                }
                className="flex items-center gap-2 text-[11px] hover:bg-muted/40 rounded px-1 py-0.5 text-left"
              >
                <span className="w-20 shrink-0 truncate">{s.key}</span>
                <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                  <div
                    className={`h-full ${s.color} rounded transition-all`}
                    style={{
                      width: `${Math.max(
                        (s.value / maxValue) * 100,
                        s.count > 0 ? 4 : 0
                      )}%`,
                    }}
                  />
                </div>
                <span className="w-14 text-right tabular-nums text-muted-foreground">
                  €{(s.value / 1000).toFixed(0)}k
                </span>
                <span className="w-6 text-right tabular-nums font-semibold">
                  {s.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
