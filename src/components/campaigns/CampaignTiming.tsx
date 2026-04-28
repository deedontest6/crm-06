import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Campaign } from "@/hooks/useCampaigns";
import { Plus, Trash2, GripVertical, X, Check, Pencil, Mail, Linkedin, Phone, ListChecks, FlaskConical } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { getEnabledChannels } from "./channelVisibility";
import { CampaignSequenceRunsDrawer } from "./CampaignSequenceRunsDrawer";
import { CampaignSequenceDryRunModal } from "./CampaignSequenceDryRunModal";

interface Props {
  campaign: Campaign;
  isCampaignEnded: boolean;
  daysRemaining: number | null;
  timingNotes?: string | null;
  onSaveTimingNotes?: (notes: string) => void;
}

const CONDITIONS = [
  { value: "no_reply", label: "If no reply" },
  { value: "no_open", label: "If not opened" },
  { value: "always", label: "Always (after wait)" },
] as const;

/**
 * Returns true if `today` falls within the campaign's start/end date range.
 */
export function isWithinActiveWindow(campaign: Campaign): boolean {
  if (!campaign.start_date || !campaign.end_date) return false;
  const today = new Date().toISOString().split("T")[0];
  return campaign.start_date <= today && campaign.end_date >= today;
}

const ChannelIcon = ({ type, className = "h-3 w-3" }: { type: string; className?: string }) => {
  if (type === "linkedin") return <Linkedin className={className} />;
  if (type === "call") return <Phone className={className} />;
  return <Mail className={className} />;
};

export function CampaignTiming({ campaign, isCampaignEnded, daysRemaining, timingNotes, onSaveTimingNotes }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(timingNotes || "");
  const [showAddStep, setShowAddStep] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [runsDryOnly, setRunsDryOnly] = useState(false);
  const [dryRunOpen, setDryRunOpen] = useState(false);

  const enabledChannels = useMemo(() => getEnabledChannels(campaign), [campaign]);
  const channelOptions = useMemo(() => {
    const opts: Array<{ value: "email" | "linkedin" | "call"; label: string }> = [];
    if (enabledChannels.includes("Email")) opts.push({ value: "email", label: "Email" });
    if (enabledChannels.includes("LinkedIn")) opts.push({ value: "linkedin", label: "LinkedIn task" });
    if (enabledChannels.includes("Phone")) opts.push({ value: "call", label: "Call task" });
    return opts;
  }, [enabledChannels]);
  const [stepType, setStepType] = useState<string>(channelOptions[0]?.value ?? "email");
  const [waitDays, setWaitDays] = useState(3);
  const [condition, setCondition] = useState<string>("no_reply");
  const [templateId, setTemplateId] = useState<string>("");
  const [targetSegmentId, setTargetSegmentId] = useState<string>("all");

  useEffect(() => { setNotes(timingNotes || ""); }, [timingNotes]);

  useEffect(() => {
    if (channelOptions.length > 0 && !channelOptions.find(o => o.value === stepType)) {
      setStepType(channelOptions[0].value);
      setTemplateId("");
    }
  }, [channelOptions, stepType]);

  const datesMissing = !campaign.start_date || !campaign.end_date;

  const handleNotesBlurWrapped = () => {
    if (onSaveTimingNotes && notes !== (timingNotes || "")) {
      onSaveTimingNotes(notes);
    }
  };

  const { data: steps = [] } = useQuery({
    queryKey: ["campaign-sequences", campaign.id],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("campaign_sequences") as any)
        .select("id, step_number, template_id, wait_business_days, condition, is_enabled, target_segment_id, step_type")
        .eq("campaign_id", campaign.id)
        .order("step_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["campaign-templates-for-seq", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_email_templates")
        .select("id, template_name")
        .or(`campaign_id.eq.${campaign.id},campaign_id.is.null`)
        .order("template_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: segments = [] } = useQuery({
    queryKey: ["campaign-segments-for-seq", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_audience_segments")
        .select("id, segment_name")
        .eq("campaign_id", campaign.id)
        .order("segment_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Indicator metrics: per-step last-fired + sent-count + next-fires-at.
  const { data: stepMetrics = {} } = useQuery({
    queryKey: ["campaign-sequence-metrics", campaign.id, steps.length],
    enabled: steps.length > 0,
    queryFn: async () => {
      // 1) All sequence-runner sends, grouped by step
      const { data: comms } = await supabase
        .from("campaign_communications")
        .select("sequence_step, communication_date, contact_id, conversation_id, opened_at, delivery_status")
        .eq("campaign_id", campaign.id)
        .eq("sent_via", "sequence_runner")
        .in("delivery_status", ["sent", "manual"]);
      // 2) Parent rows for each step's "next fires" calc — initial outreach + each prior step
      const { data: parents } = await supabase
        .from("campaign_communications")
        .select("sequence_step, communication_date, contact_id, conversation_id, opened_at")
        .eq("campaign_id", campaign.id)
        .eq("communication_type", "Email")
        .eq("delivery_status", "sent");
      const nowMs = Date.now();
      const out: Record<string, { lastFired: string | null; sentCount: number; nextFiresAt: string | null; eligibleParents: number }> = {};
      for (const step of steps as any[]) {
        const stepRuns = (comms ?? []).filter((c: any) => c.sequence_step === step.step_number);
        const lastFired = stepRuns.length > 0
          ? stepRuns.reduce((m: string, c: any) => c.communication_date > m ? c.communication_date : m, stepRuns[0].communication_date)
          : null;
        const parentStep = step.step_number - 1;
        const eligibleParents = (parents ?? []).filter((p: any) =>
          parentStep === 0 ? (p.sequence_step == null || p.sequence_step === 0) : p.sequence_step === parentStep
        );
        // child set per parent contact for idempotency
        const childContactIds = new Set(stepRuns.map((c: any) => c.contact_id));
        // earliest parent without a child whose wait + parent_date is in the future = next fire
        const candidateTimes = eligibleParents
          .filter((p: any) => p.contact_id && !childContactIds.has(p.contact_id))
          .filter((p: any) => {
            // condition gating (best-effort, mirrors runner logic)
            if (step.condition === "no_open" && p.opened_at) return false;
            return true;
          })
          .map((p: any) => new Date(p.communication_date).getTime() + step.wait_business_days * 86400_000);
        const earliest = candidateTimes.length > 0 ? Math.min(...candidateTimes) : null;
        let nextFiresAt: string | null = null;
        if (earliest !== null) {
          const target = Math.max(earliest, nowMs);
          // round up to next top-of-hour (cron runs hourly)
          const d = new Date(target);
          d.setMinutes(0, 0, 0);
          if (d.getTime() < target) d.setHours(d.getHours() + 1);
          nextFiresAt = d.toISOString();
        }
        out[step.id] = {
          lastFired,
          sentCount: stepRuns.length,
          nextFiresAt,
          eligibleParents: eligibleParents.length,
        };
      }
      return out;
    },
  });

  const enabledStepCount = useMemo(() => (steps as any[]).filter((s) => s.is_enabled).length, [steps]);

  const addStep = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (stepType === "email" && !templateId) throw new Error("Pick a template");
      const nextStep = (steps[steps.length - 1]?.step_number ?? 0) + 1;
      const { error } = await (supabase.from("campaign_sequences") as any).insert({
        campaign_id: campaign.id,
        step_number: nextStep,
        template_id: stepType === "email" ? templateId : null,
        wait_business_days: waitDays,
        condition,
        is_enabled: true,
        created_by: user.id,
        target_segment_id: targetSegmentId === "all" ? null : targetSegmentId,
        step_type: stepType,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-sequences", campaign.id] });
      setTemplateId("");
      setTargetSegmentId("all");
      setShowAddStep(false);
    },
    onError: (e: any) => toast({ title: "Failed to add step", description: e.message, variant: "destructive" }),
  });

  const toggleStep = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("campaign_sequences").update({ is_enabled: enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaign-sequences", campaign.id] }),
  });

  const deleteStep = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaign_sequences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaign-sequences", campaign.id] }),
  });

  const reorder = useMutation({
    mutationFn: async (newOrder: Array<any>) => {
      for (let i = 0; i < newOrder.length; i++) {
        const { error } = await supabase.from("campaign_sequences").update({ step_number: 1000 + i }).eq("id", newOrder[i].id);
        if (error) throw error;
      }
      for (let i = 0; i < newOrder.length; i++) {
        const { error } = await supabase.from("campaign_sequences").update({ step_number: i + 1 }).eq("id", newOrder[i].id);
        if (error) throw error;
      }
    },
    onMutate: async (newOrder: Array<any>) => {
      await queryClient.cancelQueries({ queryKey: ["campaign-sequences", campaign.id] });
      const prev = queryClient.getQueryData(["campaign-sequences", campaign.id]);
      queryClient.setQueryData(["campaign-sequences", campaign.id], newOrder.map((s, i) => ({ ...s, step_number: i + 1 })));
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["campaign-sequences", campaign.id], ctx.prev);
      toast({ title: "Reorder failed", description: e.message, variant: "destructive" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaign-sequences", campaign.id] }),
  });

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    const next = Array.from(steps);
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    reorder.mutate(next);
  };

  const scrollToMessage = () => {
    const el = document.querySelector('[data-strategy-section="message"]');
    if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ---- Compact timeline (single row) ----
  const renderTimelineRow = () => {
    if (datesMissing) {
      return (
        <p className="text-xs text-muted-foreground italic">
          Set start &amp; end dates to enable timing tracking.
        </p>
      );
    }
    const campStart = new Date(campaign.start_date! + "T00:00:00").getTime();
    const campEnd = new Date(campaign.end_date! + "T00:00:00").getTime();
    const range = campEnd - campStart;
    const todayPos = range > 0
      ? Math.min(100, Math.max(0, ((Date.now() - campStart) / range) * 100))
      : 0;

    return (
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
          {format(new Date(campaign.start_date! + "T00:00:00"), "dd MMM")}
        </span>
        <div className="relative h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
          {isCampaignEnded && <div className="absolute inset-0 bg-destructive/40" />}
          {!isCampaignEnded && range > 0 && (
            <div className="absolute top-0 left-0 h-full bg-primary/70" style={{ width: `${todayPos}%` }} />
          )}
          {range > 0 && !isCampaignEnded && (
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-foreground border border-background"
              style={{ left: `calc(${todayPos}% - 4px)` }}
              title="Today"
            />
          )}
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
          {format(new Date(campaign.end_date! + "T00:00:00"), "dd MMM")}
        </span>
        <span
          className={`text-[11px] tabular-nums shrink-0 min-w-[64px] text-right ${
            isCampaignEnded ? "text-destructive font-medium" : "text-muted-foreground"
          }`}
        >
          {isCampaignEnded ? `Ended ${Math.abs(daysRemaining || 0)}d ago` : `${daysRemaining}d left`}
        </span>
      </div>
    );
  };

  // ---- Note (inline, minimal) ----
  const noteRef = useRef<HTMLInputElement>(null);
  const renderNote = () => (
    <div className="flex items-center gap-1.5 group">
      <Pencil className="h-3 w-3 text-muted-foreground/60 shrink-0" />
      <input
        ref={noteRef}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleNotesBlurWrapped}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setNotes(timingNotes || ""); (e.target as HTMLInputElement).blur(); }
        }}
        placeholder="Add a timing note…"
        aria-label="Timing note"
        className="flex-1 bg-transparent border-0 outline-none text-xs text-foreground placeholder:text-muted-foreground/60 focus:placeholder:text-muted-foreground/40 px-0 py-0.5 border-b border-transparent focus:border-border transition-colors"
      />
    </div>
  );

  // ---- Inline add-step row ----
  const renderAddStepRow = () => (
    <div
      className="flex flex-wrap items-center gap-1.5 py-1.5 border-t border-border/60"
      onKeyDown={(e) => { if (e.key === "Escape") setShowAddStep(false); }}
    >
      <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-1" />
      {channelOptions.length > 1 && (
        <Select value={stepType} onValueChange={(v) => { setStepType(v); if (v !== "email") setTemplateId(""); }}>
          <SelectTrigger className="h-7 text-xs w-[110px]" aria-label="Channel"><SelectValue /></SelectTrigger>
          <SelectContent>
            {channelOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {stepType === "email" && (
        templates.length === 0 ? (
          <button
            type="button"
            onClick={scrollToMessage}
            className="h-7 text-xs px-2 rounded border border-dashed border-border text-muted-foreground hover:text-foreground w-[240px] text-left"
          >
            Add a template first →
          </button>
        ) : (
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="h-7 text-xs w-[240px]" aria-label="Template">
              <SelectValue placeholder="Template…" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>)}
            </SelectContent>
          </Select>
        )
      )}
      <Select value={condition} onValueChange={setCondition}>
        <SelectTrigger className="h-7 text-xs w-[120px]" aria-label="Trigger"><SelectValue /></SelectTrigger>
        <SelectContent>
          {CONDITIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-0.5">
        <Input
          type="number"
          min={0}
          max={60}
          value={waitDays}
          onChange={(e) => setWaitDays(parseInt(e.target.value) || 0)}
          onKeyDown={(e) => { if (e.key === "Enter" && !addStep.isPending) addStep.mutate(); }}
          className="h-7 text-xs w-[52px]"
          aria-label="Wait days"
        />
        <span className="text-[11px] text-muted-foreground">d</span>
      </div>
      {segments.length > 0 && (
        <Select value={targetSegmentId} onValueChange={setTargetSegmentId}>
          <SelectTrigger className="h-7 text-xs w-[140px]" aria-label="Segment"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contacts</SelectItem>
            {segments.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.segment_name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <div className="flex items-center gap-0.5 ml-auto">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => addStep.mutate()}
          disabled={addStep.isPending || (stepType === "email" && (templates.length === 0 || !templateId))}
          aria-label="Save step"
        >
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowAddStep(false)} aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2.5">
      {/* Compact timeline + inline note */}
      {renderTimelineRow()}
      {!datesMissing && renderNote()}

      {/* Follow-up steps toolbar */}
      <div className="flex items-center gap-3 pt-1.5 border-t border-border/60">
        <span className="text-xs text-foreground">
          Follow-up steps <span className="text-muted-foreground">({steps.length})</span>
        </span>
        <div className="flex items-center gap-0.5 ml-auto">
          {steps.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => { setRunsDryOnly(false); setRunsOpen(true); }}
                title="View sequence run logs"
              >
                <ListChecks className="h-3 w-3" /> Runs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => setDryRunOpen(true)}
                disabled={enabledStepCount === 0}
                title="Preview who would receive a follow-up right now"
              >
                <FlaskConical className="h-3 w-3" /> Dry-run
              </Button>
            </>
          )}
        <Button
          variant="ghost"
          size="sm"
            className="h-7 text-xs gap-1 px-2"
          onClick={() => setShowAddStep(v => !v)}
          disabled={channelOptions.length === 0}
          title={channelOptions.length === 0 ? "Enable a channel first" : "Add follow-up step"}
        >
          <Plus className="h-3 w-3" /> Step
        </Button>
        </div>
      </div>

      {/* Steps list */}
      {steps.length > 0 && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="sequence-steps">
            {(dropProvided) => (
              <div ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
                {steps.map((s: any, idx: number) => {
                  const tpl = templates.find((t: any) => t.id === s.template_id);
                  const cond = CONDITIONS.find((c) => c.value === s.condition)?.label ?? s.condition;
                  const seg = s.target_segment_id
                    ? segments.find((sg: any) => sg.id === s.target_segment_id)?.segment_name
                    : null;
                  const stepLabel = (s.step_type && s.step_type !== "email")
                    ? `${s.step_type === "linkedin" ? "LinkedIn" : "Call"} task`
                    : (tpl?.template_name || "(deleted template)");
                  const showChannelIcon = channelOptions.length > 1;
                  const m = (stepMetrics as any)[s.id];
                  let nextLabel = "";
                  if (!s.is_enabled) {
                    nextLabel = "Paused";
                  } else if (m) {
                    if (m.eligibleParents === 0) {
                      nextLabel = s.step_number === 1 ? "Awaiting initial sends" : `Awaiting step ${s.step_number - 1}`;
                    } else if (m.nextFiresAt) {
                      const ms = new Date(m.nextFiresAt).getTime() - Date.now();
                      if (ms <= 60 * 60 * 1000) nextLabel = "Fires next hour";
                      else if (ms < 24 * 60 * 60 * 1000) nextLabel = `Fires in ${Math.round(ms / 3600_000)}h`;
                      else nextLabel = `Fires ${format(new Date(m.nextFiresAt), "EEE HH:00")}`;
                    } else {
                      nextLabel = "Idle";
                    }
                  }
                  return (
                    <Draggable key={s.id} draggableId={s.id} index={idx}>
                      {(dragProvided, snapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={`flex items-center gap-2 py-1 border-t border-border/60 ${
                            snapshot.isDragging ? "shadow-lg ring-1 ring-primary/40 bg-card" : ""
                          } ${!s.is_enabled ? "opacity-60" : ""}`}
                        >
                          <button
                            type="button"
                            {...dragProvided.dragHandleProps}
                            className="text-muted-foreground/50 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
                            aria-label="Drag to reorder"
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </button>
                          <span className="text-[11px] tabular-nums text-muted-foreground w-4 shrink-0">{idx + 1}.</span>
                          {showChannelIcon && (
                            <ChannelIcon type={s.step_type || "email"} className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-xs truncate flex-1 min-w-0">{stepLabel}</span>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0 hidden md:inline">
                            {s.wait_business_days}d · {cond}{seg ? ` · ${seg}` : ""}
                          </span>
                          {m && (
                            <span
                              className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 hidden lg:inline"
                              title={m.lastFired ? `Last fired ${format(new Date(m.lastFired), "PP HH:mm")} · ${m.sentCount} sent` : "No runs yet"}
                            >
                              {m.sentCount > 0 ? `${m.sentCount} sent` : "0 sent"} · {nextLabel || "—"}
                            </span>
                          )}
                          <Switch
                            checked={s.is_enabled}
                            onCheckedChange={(v) => toggleStep.mutate({ id: s.id, enabled: v })}
                            className="scale-75"
                            title="Pause without deleting"
                            aria-label="Toggle step active"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteStep.mutate(s.id)}
                            aria-label="Delete step"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {showAddStep && channelOptions.length > 0 && renderAddStepRow()}

      <CampaignSequenceRunsDrawer
        open={runsOpen}
        onOpenChange={setRunsOpen}
        campaignId={campaign.id}
        steps={steps as any[]}
        defaultDryRunOnly={runsDryOnly}
      />
      <CampaignSequenceDryRunModal
        open={dryRunOpen}
        onOpenChange={setDryRunOpen}
        campaignId={campaign.id}
        enabledStepCount={enabledStepCount}
        onViewResults={() => { setRunsDryOnly(true); setRunsOpen(true); }}
      />
    </div>
  );
}
