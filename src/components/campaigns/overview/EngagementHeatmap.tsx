import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Activity } from "lucide-react";

interface Props {
  communications: any[];
  onCellClick?: (weekday: number, hourFrom: number, hourTo: number) => void;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// 6 buckets of 4 hours each to keep it compact
const BUCKETS = [
  { label: "0-4", from: 0, to: 4 },
  { label: "4-8", from: 4, to: 8 },
  { label: "8-12", from: 8, to: 12 },
  { label: "12-16", from: 12, to: 16 },
  { label: "16-20", from: 16, to: 20 },
  { label: "20-24", from: 20, to: 24 },
];

export function EngagementHeatmap({ communications, onCellClick }: Props) {
  const grid = useMemo(() => {
    // 7 days x 6 buckets
    const cells: number[][] = Array.from({ length: 7 }, () =>
      Array(6).fill(0)
    );
    communications.forEach((c: any) => {
      // Engagement = reply or open
      const isEngagement =
        c.sent_via === "graph-sync" ||
        c.email_status === "Replied" ||
        !!c.opened_at;
      if (!isEngagement) return;
      const dStr = c.opened_at || c.communication_date;
      if (!dStr) return;
      const d = new Date(dStr);
      const day = d.getDay();
      const hour = d.getHours();
      const bucket = BUCKETS.findIndex((b) => hour >= b.from && hour < b.to);
      if (bucket >= 0) cells[day][bucket]++;
    });
    return cells;
  }, [communications]);

  const max = Math.max(...grid.flat(), 1);
  const intensity = (v: number) => {
    if (v === 0) return "bg-muted/40";
    const ratio = v / max;
    if (ratio > 0.75) return "bg-primary";
    if (ratio > 0.5) return "bg-primary/70";
    if (ratio > 0.25) return "bg-primary/45";
    return "bg-primary/25";
  };

  const totalEngagements = grid.flat().reduce((a, b) => a + b, 0);

  return (
    <Card className="h-full">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Engagement Heatmap
          </h3>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {totalEngagements} engagements
          </span>
        </div>
        {totalEngagements === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No engagement data yet
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            <div className="grid grid-cols-[28px_repeat(6,1fr)] gap-0.5 text-[9px] text-muted-foreground">
              <span />
              {BUCKETS.map((b) => (
                <span key={b.label} className="text-center">
                  {b.label}
                </span>
              ))}
            </div>
            {DAYS.map((day, d) => (
              <div
                key={day}
                className="grid grid-cols-[28px_repeat(6,1fr)] gap-0.5"
              >
                <span className="text-[10px] text-muted-foreground flex items-center">
                  {day}
                </span>
                {grid[d].map((v, b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() =>
                      onCellClick?.(d, BUCKETS[b].from, BUCKETS[b].to)
                    }
                    title={`${day} ${BUCKETS[b].label}h — ${v} engagement${
                      v === 1 ? "" : "s"
                    }`}
                    className={`h-5 rounded-sm transition-opacity hover:opacity-80 ${intensity(v)} ${onCellClick ? "cursor-pointer" : ""}`}
                  />
                ))}
              </div>
            ))}
            <p className="text-[9px] text-muted-foreground mt-1">
              Best send time = densest cell
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
