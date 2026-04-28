import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { ListChecks, Plus } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";

interface Props {
  campaignId: string;
  onOpenActionItems: () => void;
}

export function UpcomingActionItems({ campaignId, onOpenActionItems }: Props) {
  const { data: items = [] } = useQuery({
    queryKey: ["campaign-upcoming-action-items", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("action_items")
        .select("id, title, status, priority, due_date, assigned_to")
        .eq("module_type", "campaign")
        .eq("module_id", campaignId)
        .neq("status", "Completed")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(8);
      if (error) throw error;
      return data || [];
    },
  });

  const pill = (due?: string | null) => {
    if (!due) return { cls: "bg-muted text-muted-foreground", label: "No date" };
    const d = parseISO(due);
    const diff = differenceInDays(d, new Date());
    if (diff < 0)
      return {
        cls: "bg-destructive/15 text-destructive",
        label: `${Math.abs(diff)}d overdue`,
      };
    if (diff === 0)
      return { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", label: "Today" };
    if (diff <= 3)
      return {
        cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        label: `${diff}d`,
      };
    return {
      cls: "bg-muted text-muted-foreground",
      label: format(d, "d MMM"),
    };
  };

  return (
    <Card className="h-full">
      <CardContent className="p-3 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Upcoming Action Items
          </h3>
          <button
            onClick={onOpenActionItems}
            className="ml-auto text-[11px] text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Open
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center flex-1">
            No upcoming action items
          </p>
        ) : (
          <ul className="flex flex-col gap-1 flex-1 overflow-auto">
            {items.map((t: any) => {
              const p = pill(t.due_date);
              return (
                <li
                  key={t.id}
                  onClick={onOpenActionItems}
                  className="flex items-center gap-2 text-[11px] hover:bg-muted/40 rounded px-1.5 py-1 cursor-pointer"
                >
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${p.cls}`}
                  >
                    {p.label}
                  </span>
                  <span className="truncate flex-1">{t.title}</span>
                  <span className="text-[9px] text-muted-foreground shrink-0">
                    {t.priority}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
