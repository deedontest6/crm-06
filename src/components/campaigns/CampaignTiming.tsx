import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Campaign } from "@/hooks/useCampaigns";
import { Plus, MoreHorizontal, Check } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface TimingWindow {
  id: string;
  campaign_id: string;
  window_name: string;
  start_date: string;
  end_date: string;
  priority: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

interface Props {
  campaign: Campaign;
  isCampaignEnded: boolean;
  daysRemaining: number | null;
  timingNotes?: string | null;
  onSaveTimingNotes?: (notes: string) => void;
}

/**
 * Returns true if `today` falls within the campaign's start/end date range
 * (and within any defined timing windows, if loaded). Use to gate outreach actions.
 */
export function isWithinActiveWindow(campaign: Campaign): boolean {
  if (!campaign.start_date || !campaign.end_date) return false;
  const today = new Date().toISOString().split("T")[0];
  return campaign.start_date <= today && campaign.end_date >= today;
}

export function CampaignTiming({ campaign, isCampaignEnded, daysRemaining, timingNotes, onSaveTimingNotes }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(timingNotes || "");
  const [showAddWindow, setShowAddWindow] = useState(false);
  const [newWindow, setNewWindow] = useState({ window_name: "", start_date: "", end_date: "", priority: "Normal", notes: "" });

  useEffect(() => {
    setNotes(timingNotes || "");
  }, [timingNotes]);

  // Fetch timing windows
  const { data: timingWindows = [] } = useQuery({
    queryKey: ["campaign-timing-windows", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_timing_windows")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data as TimingWindow[];
    },
  });

  const handleAddWindow = async () => {
    if (!newWindow.window_name || !newWindow.start_date || !newWindow.end_date) {
      toast.warning("Window name, start and end dates are required");
      return;
    }
    const { error } = await supabase.from("campaign_timing_windows").insert({
      campaign_id: campaign.id,
      window_name: newWindow.window_name,
      start_date: newWindow.start_date,
      end_date: newWindow.end_date,
      priority: newWindow.priority,
      notes: newWindow.notes || null,
      created_by: user?.id,
    });
    if (error) { toast.error("Failed to add window"); return; }
    queryClient.invalidateQueries({ queryKey: ["campaign-timing-windows", campaign.id] });
    setNewWindow({ window_name: "", start_date: "", end_date: "", priority: "Normal", notes: "" });
    setShowAddWindow(false);
    toast.success("Timing window added");
  };

  const handleDeleteWindow = async (id: string) => {
    await supabase.from("campaign_timing_windows").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-timing-windows", campaign.id] });
    toast.success("Window removed");
  };

  const getProgressColor = () => {
    if (isCampaignEnded) return "bg-destructive";
    if (daysRemaining !== null && daysRemaining <= 7) return "bg-yellow-500";
    return "bg-primary";
  };

  const getProgress = () => {
    if (!campaign.start_date || !campaign.end_date) return 0;
    const start = new Date(campaign.start_date + "T00:00:00").getTime();
    const end = new Date(campaign.end_date + "T00:00:00").getTime();
    const now = Date.now();
    if (now >= end) return 100;
    if (now <= start) return 0;
    return Math.round(((now - start) / (end - start)) * 100);
  };

  const isWindowActive = (w: TimingWindow) => {
    const today = new Date().toISOString().split("T")[0];
    return w.start_date <= today && w.end_date >= today;
  };

  const handleNotesBlur = () => {
    if (onSaveTimingNotes && notes !== (timingNotes || "")) {
      onSaveTimingNotes(notes);
    }
  };
  const notesDirty = notes !== (timingNotes || "");

  const datesMissing = !campaign.start_date || !campaign.end_date;
  const [justSaved, setJustSaved] = useState(false);

  const handleNotesBlurWrapped = () => {
    if (onSaveTimingNotes && notes !== (timingNotes || "")) {
      onSaveTimingNotes(notes);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
    }
  };

  const renderStatusHeader = () => {
    if (datesMissing) {
      return (
        <p className="text-xs text-muted-foreground">
          Set start &amp; end dates from the Edit menu to enable timing tracking.
        </p>
      );
    }
    return (
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="font-medium text-sm tabular-nums">
          {format(new Date(campaign.start_date! + "T00:00:00"), "dd MMM")} → {format(new Date(campaign.end_date! + "T00:00:00"), "dd MMM yyyy")}
        </span>
        <span className="text-muted-foreground">
          · {isCampaignEnded ? `Ended ${Math.abs(daysRemaining || 0)}d ago` : `${daysRemaining}d remaining`}
        </span>
        <div className="flex-1 min-w-[140px] flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${getProgressColor()}`} style={{ width: `${getProgress()}%` }} />
          </div>
          <span className="text-muted-foreground tabular-nums text-[11px]">{getProgress()}%</span>
        </div>
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        {renderStatusHeader()}

        {/* Windows toolbar */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Timing windows <span className="text-foreground/70">· {timingWindows.length}</span>
          </span>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowAddWindow(v => !v)}>
            <Plus className="h-3 w-3" /> Add Window
          </Button>
        </div>

        {/* Add window form (compact, no card) */}
        {showAddWindow && (
          <div className="border border-dashed rounded-md p-2.5 space-y-2 bg-muted/20">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div>
                <Label className="text-[10px]">Window name</Label>
                <Input className="h-7 text-xs" placeholder="e.g. Pre-Diwali Push" value={newWindow.window_name} onChange={e => setNewWindow({ ...newWindow, window_name: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Start</Label>
                <Input type="date" className="h-7 text-xs" value={newWindow.start_date} onChange={e => setNewWindow({ ...newWindow, start_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">End</Label>
                <Input type="date" className="h-7 text-xs" value={newWindow.end_date} onChange={e => setNewWindow({ ...newWindow, end_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Priority</Label>
                <Select value={newWindow.priority} onValueChange={v => setNewWindow({ ...newWindow, priority: v })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Normal">Normal</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Input className="h-7 text-xs" placeholder="Notes (optional)" value={newWindow.notes} onChange={e => setNewWindow({ ...newWindow, notes: e.target.value })} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAddWindow(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleAddWindow}>Add</Button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {timingWindows.length === 0 && !showAddWindow && (
          <p className="text-xs text-muted-foreground italic py-1">No timing windows defined.</p>
        )}

        {/* Flat divided window rows */}
        {timingWindows.length > 0 && (
          <div className="border border-border rounded-md divide-y divide-border">
            {timingWindows.map(w => {
              const active = isWindowActive(w);
              const isCritical = w.priority === "Critical";
              const dotClass = active
                ? "bg-green-500"
                : isCritical
                  ? "bg-destructive"
                  : "bg-muted-foreground/30";
              return (
                <div key={w.id} className="flex items-center justify-between gap-2 py-2 px-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {active ? "Active now" : isCritical ? "Critical priority" : "Upcoming / past"}
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-sm font-medium truncate">{w.window_name}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(w.start_date + "T00:00:00"), "dd MMM")}–{format(new Date(w.end_date + "T00:00:00"), "dd MMM")}
                    </span>
                    <span className="text-xs text-muted-foreground">· {w.priority}</span>
                    {active && <span className="text-xs text-green-600 dark:text-green-500">· Active</span>}
                    {w.notes && <span className="text-xs text-muted-foreground truncate">· {w.notes}</span>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleDeleteWindow(w.id)} className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}

        {/* Visual timeline bar */}
        {timingWindows.length > 0 && !datesMissing && (
          <div className="relative h-3 bg-muted rounded-full overflow-hidden">
            {timingWindows.map(w => {
              const campStart = new Date(campaign.start_date! + "T00:00:00").getTime();
              const campEnd = new Date(campaign.end_date! + "T00:00:00").getTime();
              const wStart = new Date(w.start_date + "T00:00:00").getTime();
              const wEnd = new Date(w.end_date + "T00:00:00").getTime();
              const range = campEnd - campStart;
              if (range <= 0) return null;
              const left = Math.max(0, ((wStart - campStart) / range) * 100);
              const width = Math.min(100 - left, ((wEnd - wStart) / range) * 100);
              const active = isWindowActive(w);
              return (
                <div
                  key={w.id}
                  className={`absolute top-0 h-full rounded-full ${active ? "bg-green-500" : "bg-primary/40"}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                  title={`${w.window_name}: ${w.start_date} → ${w.end_date}`}
                />
              );
            })}
            {(() => {
              const campStart = new Date(campaign.start_date! + "T00:00:00").getTime();
              const campEnd = new Date(campaign.end_date! + "T00:00:00").getTime();
              const range = campEnd - campStart;
              if (range <= 0) return null;
              const todayPos = ((Date.now() - campStart) / range) * 100;
              if (todayPos < 0 || todayPos > 100) return null;
              return <div className="absolute top-0 h-full w-0.5 bg-destructive" style={{ left: `${todayPos}%` }} title="Today" />;
            })()}
          </div>
        )}

        {/* Timing note */}
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1">
            Timing note
            {justSaved && <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 dark:text-green-500"><Check className="h-2.5 w-2.5" /> Saved</span>}
          </Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={handleNotesBlurWrapped} placeholder="e.g. Must complete outreach before Diwali..." rows={2} className="text-sm" />
        </div>
      </div>
    </TooltipProvider>
  );
}
