import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2,
  Users,
  MessageSquare,
  TrendingUp,
  BarChart3,
  ArrowRight,
  HeartPulse,
  Trophy,
  Sparkles,
  Mail,
  Phone,
  Linkedin,
  Activity,
  Target,
} from "lucide-react";
import { differenceInDays, subDays, startOfDay, format } from "date-fns";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, Tooltip as RTooltip } from "recharts";
import {
  getOutreachCounts,
  getRepliedThreads,
  getFunnel,
} from "./overviewMetrics";
import { RecentActivityPanel } from "./overview/RecentActivityPanel";
import { EngagementHeatmap } from "./overview/EngagementHeatmap";
import { UpcomingActionItems } from "./overview/UpcomingActionItems";
import { getEnabledChannels, pickDrilldownChannel } from "./channelVisibility";

interface StrategyComplete {
  message: boolean;
  audience: boolean;
  region: boolean;
  timing: boolean;
}

interface Props {
  campaign: any;
  accounts: any[];
  contacts: any[];
  communications: any[];
  isStrategyComplete: StrategyComplete;
  strategyProgress: number;
  onTabChange: (tab: string) => void;
  onDrilldown?: (
    drilldown:
      | {
          tab: "setup";
          section: "region" | "audience" | "message" | "timing";
          audienceView?: "accounts" | "contacts";
        }
      | {
          tab: "monitoring";
          view: "outreach" | "analytics";
          channel?: "email" | "linkedin" | "call";
          status?: "all" | "sent" | "replied" | "failed" | "bounced";
          threadId?: string;
        }
      | { tab: "actionItems" }
  ) => void;
}

const funnelStages = [
  { key: "total", label: "Total", bar: "bg-slate-400" },
  { key: "contacted", label: "Contacted", bar: "bg-blue-500" },
  { key: "responded", label: "Responded", bar: "bg-amber-500" },
  { key: "qualified", label: "Qualified", bar: "bg-violet-500" },
  { key: "converted", label: "Converted", bar: "bg-emerald-500" },
] as const;

export function CampaignOverview({
  campaign,
  accounts,
  contacts,
  communications,
  onTabChange,
  onDrilldown,
}: Props) {
  const navigate = useNavigate();

  const { data: deals = [] } = useQuery({
    queryKey: ["campaign-deals-overview", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select(
          "id, stage, total_contract_value, deal_name, account_id, source_campaign_contact_id"
        )
        .eq("campaign_id", campaign.id);
      if (error) throw error;
      return data || [];
    },
  });

  const drill = (d: Parameters<NonNullable<Props["onDrilldown"]>>[0]) =>
    onDrilldown ? onDrilldown(d) : onTabChange((d as any).tab);

  // Channel visibility — single source of truth for what to render.
  const enabledChannels = useMemo(() => getEnabledChannels(campaign), [campaign?.enabled_channels, campaign?.primary_channel]);
  const showEmailCh = enabledChannels.includes("Email");
  const showPhoneCh = enabledChannels.includes("Phone");
  const showLinkedInCh = enabledChannels.includes("LinkedIn");
  const defaultDrilldownChannel = useMemo(() => pickDrilldownChannel(campaign), [campaign?.enabled_channels, campaign?.primary_channel]);

  // ---------- Unified metrics ----------
  const outreach = useMemo(() => getOutreachCounts(communications), [communications]);
  const repliedThreads = useMemo(
    () => getRepliedThreads(communications),
    [communications]
  );


  // Outbound contacts (anyone we touched at least once)
  const contactedContactIds = useMemo(() => {
    const s = new Set<string>();
    outreach.threads.forEach((t) => {
      if (t.contactId && t.outboundCount > 0) s.add(t.contactId);
    });
    communications.forEach((c: any) => {
      if (
        c.communication_type !== "Email" &&
        c.contact_id &&
        c.sent_via !== "graph-sync"
      )
        s.add(c.contact_id);
    });
    return s;
  }, [outreach.threads, communications]);

  const repliedContactIds = useMemo(() => {
    const s = new Set<string>();
    repliedThreads.forEach((t) => t.contactId && s.add(t.contactId));
    return s;
  }, [repliedThreads]);

  // Sparkline buckets
  const buildSpark = (filterFn: (c: any) => boolean) => {
    const today = startOfDay(new Date());
    const days = Array.from({ length: 7 }, (_, i) =>
      startOfDay(subDays(today, 6 - i))
    );
    return days.map((day) => {
      const next = subDays(day, -1);
      const v = communications.filter((c: any) => {
        if (!filterFn(c)) return false;
        if (!c.communication_date) return false;
        const t = new Date(c.communication_date).getTime();
        return t >= day.getTime() && t < next.getTime();
      }).length;
      return { v };
    });
  };
  const outreachSpark = useMemo(
    () => buildSpark((c) => c.sent_via !== "graph-sync"),
    [communications]
  );
  const responseSpark = useMemo(
    () => buildSpark((c) => c.sent_via === "graph-sync" || c.email_status === "Replied"),
    [communications]
  );

  // Channel sparklines (14d)
  const buildChannelSpark = (channelMatch: (c: any) => boolean) => {
    const today = startOfDay(new Date());
    const days = Array.from({ length: 14 }, (_, i) =>
      startOfDay(subDays(today, 13 - i))
    );
    return days.map((day) => {
      const next = subDays(day, -1);
      const v = communications.filter((c: any) => {
        if (!channelMatch(c)) return false;
        if (!c.communication_date) return false;
        const t = new Date(c.communication_date).getTime();
        return t >= day.getTime() && t < next.getTime();
      }).length;
      return { v };
    });
  };

  // Health
  // Use the canonical "won deal value" so Avg € matches the Deals page (excludes Lost).
  const winningDeals = deals.filter((d: any) => d.stage !== "Lost");
  const totalDealValue = winningDeals.reduce(
    (sum: number, d: any) => sum + (Number(d.total_contract_value) || 0),
    0
  );
  // Coverage uses the canonical unique-touched-contact count (matches funnel).
  const coveragePct =
    contacts.length > 0
      ? Math.round((outreach.uniqueTouchedContacts / contacts.length) * 100)
      : 0;
  // Touches per CONTACTED contact (not per total contacts) — far more meaningful.
  const avgTouches =
    contactedContactIds.size > 0
      ? (outreach.total / contactedContactIds.size).toFixed(1)
      : "0.0";

  const today = new Date();
  const startDate = campaign.start_date ? new Date(campaign.start_date) : null;
  const endDate = campaign.end_date ? new Date(campaign.end_date) : null;
  const totalDays =
    startDate && endDate ? Math.max(1, differenceInDays(endDate, startDate)) : 0;
  const elapsedDays = startDate ? Math.max(0, differenceInDays(today, startDate)) : 0;
  const daysRemaining = endDate ? Math.max(0, differenceInDays(endDate, today)) : 0;
  const timeProgressPct =
    totalDays > 0 ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : 0;

  // Reply rate aligned with Analytics tab: replied threads / outbound threads.
  const responseRate =
    outreach.emailThreads > 0
      ? Math.round((repliedThreads.length / outreach.emailThreads) * 100)
      : 0;

  // Funnel-driven Lead→Deal % so Overview matches Analytics & Funnel widget.
  const funnel = useMemo(
    () => getFunnel(contacts, communications, deals),
    [contacts, communications, deals]
  );
  const leadToDealPct =
    funnel.responded > 0
      ? Math.round((funnel.converted / funnel.responded) * 100)
      : 0;
  const avgDealValue =
    winningDeals.length > 0 ? totalDealValue / winningDeals.length : 0;

  // Top engaged accounts
  const topAccounts = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; touches: number; replies: number }
    >();
    accounts.forEach((a: any) =>
      map.set(a.id, { id: a.id, name: a.account_name, touches: 0, replies: 0 })
    );
    communications.forEach((c: any) => {
      if (!c.account_id) return;
      const e = map.get(c.account_id);
      if (!e) return;
      if (c.sent_via === "graph-sync" || c.email_status === "Replied") e.replies++;
      else e.touches++;
    });
    return Array.from(map.values())
      .filter((a) => a.touches > 0 || a.replies > 0)
      .sort((a, b) => b.replies - a.replies || b.touches - a.touches)
      .slice(0, 5);
  }, [accounts, communications]);

  // Outreach timeline (last 14 days, daily)
  const timelineData = useMemo(() => {
    const today = startOfDay(new Date());
    const days = Array.from({ length: 14 }, (_, i) =>
      startOfDay(subDays(today, 13 - i))
    );
    return days.map((day) => {
      const next = subDays(day, -1);
      const inDay = communications.filter((c: any) => {
        if (!c.communication_date) return false;
        if (c.sent_via === "graph-sync") return false;
        const t = new Date(c.communication_date).getTime();
        return t >= day.getTime() && t < next.getTime();
      });
      const Email = inDay.filter((c) => c.communication_type === "Email").length;
      const Call = inDay.filter(
        (c) => c.communication_type === "Phone" || c.communication_type === "Call"
      ).length;
      const LinkedIn = inDay.filter((c) => c.communication_type === "LinkedIn").length;
      return {
        date: format(day, "d MMM"),
        iso: format(day, "yyyy-MM-dd"),
        Email,
        Call,
        LinkedIn,
        total: Email + Call + LinkedIn,
      };
    });
  }, [communications]);

  // Next Best Actions (up to 3)
  const nextActions = useMemo(() => {
    const list: Array<{
      id: string;
      icon: any;
      label: string;
      cta: string;
      onClick: () => void;
    }> = [];
    const unreached = contacts.length - contactedContactIds.size;
    if (unreached > 0)
      list.push({
        id: "reach",
        icon: MessageSquare,
        label: `${unreached} contact${unreached > 1 ? "s" : ""} not yet reached`,
        cta: "Reach out",
        onClick: () =>
          drill({
            tab: "setup",
            section: "audience",
            audienceView: "contacts",
          }),
      });
    const repliedNoDeal = repliedContactIds.size - deals.length;
    if (repliedNoDeal > 0)
      list.push({
        id: "convert",
        icon: TrendingUp,
        label: `${repliedNoDeal} replied — convert to deals`,
        cta: "Open replies",
        onClick: () =>
          drill({
            tab: "monitoring",
            view: "outreach",
            channel: "email",
            status: "replied",
          }),
      });
    // Stalled threads (>5d, outbound only, no reply)
    const fiveDaysAgo = subDays(new Date(), 5).getTime();
    const stalled = outreach.threads.filter(
      (t) =>
        !t.hasReply &&
        t.outboundCount > 0 &&
        t.lastDate &&
        new Date(t.lastDate).getTime() < fiveDaysAgo
    ).length;
    if (stalled > 0)
      list.push({
        id: "follow",
        icon: HeartPulse,
        label: `${stalled} stalled thread${stalled > 1 ? "s" : ""} — follow up`,
        cta: "Follow up",
        onClick: () =>
          drill({
            tab: "monitoring",
            view: "outreach",
            channel: "email",
            status: "sent",
          }),
      });
    if (endDate && daysRemaining <= 7 && daysRemaining > 0)
      list.push({
        id: "ending",
        icon: Sparkles,
        label: `Campaign ends in ${daysRemaining}d`,
        cta: "Review",
        onClick: () => drill({ tab: "monitoring", view: "analytics" } as any),
      });
    if (list.length === 0)
      list.push({
        id: "ok",
        icon: Sparkles,
        label: "All caught up — keep nurturing",
        cta: "Monitor",
        onClick: () => drill({ tab: "monitoring", view: "outreach" }),
      });
    return list.slice(0, 3);
  }, [contacts.length, contactedContactIds.size, repliedContactIds.size, deals.length, outreach.threads, endDate, daysRemaining]);

  // KPIs
  const kpis = [
    {
      label: "Accounts",
      value: accounts.length,
      icon: Building2,
      onClick: () =>
        drill({ tab: "setup", section: "audience", audienceView: "accounts" }),
      borderClass: "border-l-slate-400",
      iconBg: "bg-slate-100 dark:bg-slate-800",
      iconColor: "text-slate-600 dark:text-slate-300",
    },
    {
      label: "Contacts",
      value: contacts.length,
      icon: Users,
      onClick: () =>
        drill({ tab: "setup", section: "audience", audienceView: "contacts" }),
      borderClass: "border-l-blue-500",
      iconBg: "bg-blue-100 dark:bg-blue-900/40",
      iconColor: "text-blue-600 dark:text-blue-300",
    },
    {
      label: "Outreach",
      value: outreach.total,
      icon: MessageSquare,
      subNode: (
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums">
          {showEmailCh && (
            <span className="inline-flex items-center gap-0.5" title="Email threads">
              <Mail className="h-2.5 w-2.5" />
              {outreach.emailThreads}
            </span>
          )}
          {showPhoneCh && (
            <span className="inline-flex items-center gap-0.5" title="Calls">
              <Phone className="h-2.5 w-2.5" />
              {outreach.calls}
            </span>
          )}
          {showLinkedInCh && (
            <span className="inline-flex items-center gap-0.5" title="LinkedIn">
              <Linkedin className="h-2.5 w-2.5" />
              {outreach.linkedin}
            </span>
          )}
        </span>
      ),
      onClick: () =>
        drill({ tab: "monitoring", view: "outreach", channel: defaultDrilldownChannel, status: "all" }),
      borderClass: "border-l-indigo-500",
      iconBg: "bg-indigo-100 dark:bg-indigo-900/40",
      iconColor: "text-indigo-600 dark:text-indigo-300",
      spark: outreachSpark,
      sparkColor: "hsl(var(--channel-email))",
    },
    {
      label: "Responses",
      value: repliedThreads.length,
      icon: TrendingUp,
      sub: `${responseRate}% reply rate`,
      onClick: () =>
        drill({
          tab: "monitoring",
          view: "outreach",
          channel: defaultDrilldownChannel,
          status: "replied",
        }),
      borderClass: "border-l-amber-500",
      iconBg: "bg-amber-100 dark:bg-amber-900/40",
      iconColor: "text-amber-600 dark:text-amber-300",
      spark: responseSpark,
      sparkColor: "hsl(var(--channel-call))",
    },
    {
      label: "Deals",
      value: deals.length,
      icon: BarChart3,
      subNode: (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[10px] text-muted-foreground tabular-nums">
          {avgDealValue > 0 && <span>€{(avgDealValue / 1000).toFixed(0)}k avg</span>}
          {leadToDealPct > 0 && (
            <>
              {avgDealValue > 0 && <span className="opacity-50">·</span>}
              <span>{leadToDealPct}% L→D</span>
            </>
          )}
          {avgDealValue === 0 && leadToDealPct === 0 && <span>—</span>}
        </span>
      ),
      onClick: () => navigate(`/deals?campaign=${campaign.id}`),
      borderClass: "border-l-emerald-500",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
      iconColor: "text-emerald-600 dark:text-emerald-300",
    },
  ];

  // Channel performance rows — only enabled channels.
  const channelRows = [
    showEmailCh && {
      key: "Email" as const,
      icon: Mail,
      sent: outreach.emailThreads,
      replied: repliedThreads.length,
      spark: buildChannelSpark((c) => c.communication_type === "Email" && c.sent_via !== "graph-sync"),
      onClick: () =>
        drill({ tab: "monitoring", view: "outreach", channel: "email", status: "all" }),
    },
    showPhoneCh && {
      key: "Call" as const,
      icon: Phone,
      sent: outreach.calls,
      replied: communications.filter(
        (c: any) =>
          (c.communication_type === "Call" || c.communication_type === "Phone") &&
          c.call_outcome === "Interested"
      ).length,
      spark: buildChannelSpark(
        (c) => c.communication_type === "Call" || c.communication_type === "Phone"
      ),
      onClick: () =>
        drill({ tab: "monitoring", view: "outreach", channel: "call", status: "all" }),
    },
    showLinkedInCh && {
      key: "LinkedIn" as const,
      icon: Linkedin,
      sent: outreach.linkedin,
      replied: communications.filter(
        (c: any) =>
          c.communication_type === "LinkedIn" && c.linkedin_status === "Responded"
      ).length,
      spark: buildChannelSpark((c) => c.communication_type === "LinkedIn"),
      onClick: () =>
        drill({ tab: "monitoring", view: "outreach", channel: "linkedin", status: "all" }),
    },
  ].filter(Boolean) as Array<{
    key: "Email" | "Call" | "LinkedIn";
    icon: any;
    sent: number;
    replied: number;
    spark: { v: number }[];
    onClick: () => void;
  }>;

  

  return (
    <div className="flex flex-col gap-3 w-full pb-4">
      {/* Row 1: KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card
              key={k.label}
              className={`border-l-[3px] ${k.borderClass} cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all`}
              onClick={k.onClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  k.onClick();
                }
              }}
            >
              <CardContent className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {k.label}
                    </p>
                    <p className="text-xl font-bold leading-tight tabular-nums">
                      {k.value}
                    </p>
                    {(k as any).subNode ? (
                      <div className="mt-0.5">{(k as any).subNode}</div>
                    ) : (k as any).sub ? (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {(k as any).sub}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div
                      className={`h-7 w-7 rounded-md ${k.iconBg} flex items-center justify-center shrink-0`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${k.iconColor}`} />
                    </div>
                    {k.spark && k.spark.some((p) => p.v > 0) && (
                      <div className="h-4 w-12">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={k.spark}>
                            <Line
                              type="monotone"
                              dataKey="v"
                              stroke={k.sparkColor}
                              strokeWidth={1.5}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Row 2: 3-column main grid — Recent Activity | Next Action + Channels | Health + Top Engaged */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        {/* Recent Activity (left) */}
        <div className="lg:col-span-4 flex">
          <RecentActivityPanel
            communications={communications}
            enabledChannels={enabledChannels}
            onOpenThread={(threadId) =>
              drill({
                tab: "monitoring",
                view: "outreach",
                channel: defaultDrilldownChannel,
                status: "all",
                threadId,
              })
            }
            onOpenAll={() =>
              drill({
                tab: "monitoring",
                view: "outreach",
                channel: defaultDrilldownChannel,
                status: "all",
              })
            }
            onOpenCall={
              showPhoneCh
                ? () =>
                    drill({ tab: "monitoring", view: "outreach", channel: "call", status: "all" })
                : undefined
            }
            onOpenLinkedIn={
              showLinkedInCh
                ? () =>
                    drill({ tab: "monitoring", view: "outreach", channel: "linkedin", status: "all" })
                : undefined
            }
          />
        </div>

        {/* Middle column: Next Action (top) + Channel Performance (bottom) */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <Card className="flex-1">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Next Action
                </h3>
              </div>
              <ul className="flex flex-col gap-1.5">
                {nextActions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <li key={a.id}>
                      <button
                        onClick={a.onClick}
                        className="w-full flex items-start gap-2 p-1.5 rounded-md hover:bg-primary/5 text-left group"
                      >
                        <Icon className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium leading-tight truncate">
                            {a.label}
                          </p>
                          <p className="text-[10px] text-primary group-hover:underline flex items-center gap-0.5">
                            {a.cta} <ArrowRight className="h-2.5 w-2.5" />
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Channel Performance
                </h3>
              </div>
              <div className="flex flex-col gap-1">
                {(() => {
                  const active = channelRows.filter((c) => c.sent > 0);
                  const inactive = channelRows.filter((c) => c.sent === 0);
                  const rows = active.length > 0 ? active : channelRows;
                  return (
                    <>
                      {rows.map((ch) => {
                        const Icon = ch.icon;
                        const rate =
                          ch.sent > 0 ? Math.round((ch.replied / ch.sent) * 100) : 0;
                        const replyLabel = ch.key === "Email" ? "Reply" : "Positive";
                        return (
                          <button
                            key={ch.key}
                            onClick={ch.onClick}
                            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[11px] hover:bg-muted/40 rounded px-1 py-1"
                            title={`${replyLabel}: ${ch.replied} of ${ch.sent}`}
                          >
                            <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="text-left font-medium truncate">
                              {ch.key}
                            </span>
                            <span className="text-right tabular-nums text-muted-foreground">
                              {ch.replied}/{ch.sent}
                            </span>
                            <span className="w-10 text-right tabular-nums font-semibold">
                              {ch.sent > 0 ? `${rate}%` : "—"}
                            </span>
                          </button>
                        );
                      })}
                      {active.length > 0 && inactive.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/70 px-1 pt-0.5">
                          Inactive: {inactive.map((c) => c.key).join(", ")}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Health (top) + Top Engaged (bottom) */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <Card className="flex-1">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <HeartPulse className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Health
                </h3>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => drill({ tab: "setup", section: "timing" })}
                  className="text-left hover:opacity-80"
                  title={
                    startDate && endDate
                      ? `${format(startDate, "d MMM")} → ${format(endDate, "d MMM yyyy")}`
                      : "Set start & end dates"
                  }
                >
                  <div className="flex items-center justify-between text-[10px] mb-0.5">
                    <span className="text-muted-foreground">Time</span>
                    <span className="tabular-nums font-medium">
                      {endDate ? `${elapsedDays}/${totalDays}d` : "—"}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${timeProgressPct}%` }}
                    />
                  </div>
                </button>
                <button
                  onClick={() =>
                    drill({
                      tab: "setup",
                      section: "audience",
                      audienceView: "contacts",
                    })
                  }
                  className="text-left hover:opacity-80"
                  title={`${outreach.uniqueTouchedContacts} of ${contacts.length} contacts touched`}
                >
                  <div className="flex items-center justify-between text-[10px] mb-0.5">
                    <span className="text-muted-foreground">Coverage</span>
                    <span className="tabular-nums font-medium">{coveragePct}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${coveragePct}%` }}
                    />
                  </div>
                </button>
                <button
                  onClick={() =>
                    drill({ tab: "monitoring", view: "outreach", channel: "email", status: "all" })
                  }
                  className="flex items-center justify-between text-[10px] pt-0.5 hover:opacity-80"
                  title="Average outreach touches per contacted contact"
                >
                  <span className="text-muted-foreground">Touches / contact</span>
                  <span className="tabular-nums font-medium">{avgTouches}</span>
                </button>
              </div>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="h-3.5 w-3.5 text-amber-500" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Top Engaged
                </h3>
              </div>
              {topAccounts.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-2 text-center">
                  No engagement
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {topAccounts.map((a) => {
                    const total = a.touches + a.replies;
                    const rate =
                      total > 0 ? Math.round((a.replies / total) * 100) : 0;
                    return (
                      <li key={a.id}>
                        <button
                          onClick={() => navigate(`/accounts?accountId=${a.id}`)}
                          className="w-full flex items-center justify-between gap-2 text-[11px] hover:bg-muted/40 rounded px-1 py-0.5"
                          title={`${a.name} — ${a.replies} replies / ${a.touches} touches (${rate}%)`}
                        >
                          <span className="truncate text-left flex-1">{a.name}</span>
                          <span className="tabular-nums shrink-0 flex items-center gap-1">
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              {a.replies}
                            </span>
                            <span className="text-muted-foreground/60">
                              /{a.touches}
                            </span>
                            <span className="text-[10px] text-muted-foreground w-7 text-right">
                              {rate}%
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Row 3: Outreach Timeline + Upcoming Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        <div className="lg:col-span-8 flex">
          <Card className="flex-1">
            <CardContent className="p-3 h-full flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Outreach Timeline
                </h3>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Last 14 days
                </span>
              </div>
              <div className="h-32 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={timelineData}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    onClick={(e: any) => {
                      if (!e || !e.activeLabel) return;
                      drill({
                        tab: "monitoring",
                        view: "outreach",
                        channel: "email",
                        status: "all",
                      });
                    }}
                  >
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9 }}
                      axisLine={false}
                      tickLine={false}
                      interval={1}
                    />
                    <RTooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 6,
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--background))",
                      }}
                    />
                    {showEmailCh && <Bar dataKey="Email" stackId="a" fill="hsl(var(--channel-email))" />}
                    {showPhoneCh && <Bar dataKey="Call" stackId="a" fill="hsl(var(--channel-call))" />}
                    {showLinkedInCh && <Bar dataKey="LinkedIn" stackId="a" fill="hsl(var(--channel-linkedin))" />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-4 flex">
          <UpcomingActionItems
            campaignId={campaign.id}
            onOpenActionItems={() => onTabChange("actionItems")}
          />
        </div>
      </div>

      {/* Row 4: collapsible Reply Heatmap (hidden by default to save space) */}
      <details className="group rounded-lg border bg-card">
        <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground select-none">
          <Activity className="h-3.5 w-3.5" />
          Send-time analysis
          <span className="ml-auto text-[10px] font-normal normal-case">
            Click to expand
          </span>
        </summary>
        <div className="p-3 pt-0">
          <EngagementHeatmap
            communications={communications}
            enabledChannels={enabledChannels}
            onCellClick={() =>
              drill({ tab: "monitoring", view: "outreach", channel: defaultDrilldownChannel, status: "all" })
            }
          />
        </div>
      </details>
    </div>
  );
}
