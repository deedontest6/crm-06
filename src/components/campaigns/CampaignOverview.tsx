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
} from "./overviewMetrics";
import { RecentActivityPanel } from "./overview/RecentActivityPanel";
import { EngagementHeatmap } from "./overview/EngagementHeatmap";
import { UpcomingTasks } from "./overview/UpcomingTasks";

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
  const totalDealValue = deals.reduce(
    (sum: number, d: any) => sum + (Number(d.total_contract_value) || 0),
    0
  );
  const coveragePct =
    contacts.length > 0
      ? Math.round((contactedContactIds.size / contacts.length) * 100)
      : 0;
  const avgTouches =
    contacts.length > 0 ? (outreach.total / contacts.length).toFixed(1) : "0.0";

  const today = new Date();
  const startDate = campaign.start_date ? new Date(campaign.start_date) : null;
  const endDate = campaign.end_date ? new Date(campaign.end_date) : null;
  const totalDays =
    startDate && endDate ? Math.max(1, differenceInDays(endDate, startDate)) : 0;
  const elapsedDays = startDate ? Math.max(0, differenceInDays(today, startDate)) : 0;
  const daysRemaining = endDate ? Math.max(0, differenceInDays(endDate, today)) : 0;
  const timeProgressPct =
    totalDays > 0 ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : 0;

  const responseRate =
    contactedContactIds.size > 0
      ? Math.round((repliedContactIds.size / contactedContactIds.size) * 100)
      : 0;

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

  // Activity timeline (30-day daily)
  const timelineData = useMemo(() => {
    const today = startOfDay(new Date());
    const days = Array.from({ length: 30 }, (_, i) =>
      startOfDay(subDays(today, 29 - i))
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
      sub: `${outreach.emailThreads}✉ ${outreach.calls}☎ ${outreach.linkedin}in`,
      onClick: () =>
        drill({ tab: "monitoring", view: "outreach", channel: "email", status: "all" }),
      borderClass: "border-l-indigo-500",
      iconBg: "bg-indigo-100 dark:bg-indigo-900/40",
      iconColor: "text-indigo-600 dark:text-indigo-300",
      spark: outreachSpark,
      sparkColor: "hsl(231 48% 55%)",
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
          channel: "email",
          status: "replied",
        }),
      borderClass: "border-l-amber-500",
      iconBg: "bg-amber-100 dark:bg-amber-900/40",
      iconColor: "text-amber-600 dark:text-amber-300",
      spark: responseSpark,
      sparkColor: "hsl(38 92% 50%)",
    },
    {
      label: "Deals",
      value: deals.length,
      icon: BarChart3,
      sub: totalDealValue > 0 ? `€${(totalDealValue / 1000).toFixed(0)}k` : "—",
      onClick: () => navigate(`/deals?campaign=${campaign.id}`),
      borderClass: "border-l-emerald-500",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/40",
      iconColor: "text-emerald-600 dark:text-emerald-300",
    },
  ];

  // Channel performance rows
  const channelRows = [
    {
      key: "Email" as const,
      icon: Mail,
      sent: outreach.emailThreads,
      replied: repliedThreads.length,
      spark: buildChannelSpark((c) => c.communication_type === "Email" && c.sent_via !== "graph-sync"),
      onClick: () =>
        drill({ tab: "monitoring", view: "outreach", channel: "email", status: "all" }),
    },
    {
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
    {
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
  ];

  

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
                    {k.sub && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {k.sub}
                      </p>
                    )}
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

      {/* Rows 2-4: Recent Activity (left, spans all rows) + nested right column */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Left: Recent Activity (sticky tall sidebar) */}
        <div className="lg:col-span-4">
          <RecentActivityPanel
            communications={communications}
            onOpenThread={(threadId) =>
              drill({
                tab: "monitoring",
                view: "outreach",
                channel: "email",
                status: "all",
                threadId,
              })
            }
            onOpenAll={() =>
              drill({
                tab: "monitoring",
                view: "outreach",
                channel: "email",
                status: "all",
              })
            }
            onOpenCall={() =>
              drill({ tab: "monitoring", view: "outreach", channel: "call", status: "all" })
            }
            onOpenLinkedIn={() =>
              drill({ tab: "monitoring", view: "outreach", channel: "linkedin", status: "all" })
            }
          />
        </div>

        {/* Right column: 4 rows of paired cards */}
        <div className="lg:col-span-8 flex flex-col gap-3">
          {/* Right Row A: Next Action + Channel Performance */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Next Best Action */}
            <Card>
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

            {/* Channel Performance */}
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider">
                    Channel Performance
                  </h3>
                </div>
                <div className="flex flex-col gap-1.5">
                  {channelRows.map((ch) => {
                    const Icon = ch.icon;
                    const rate = ch.sent > 0 ? Math.round((ch.replied / ch.sent) * 100) : 0;
                    return (
                      <button
                        key={ch.key}
                        onClick={ch.onClick}
                        className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[11px] hover:bg-muted/40 rounded px-1 py-1"
                      >
                        <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-left font-medium truncate">{ch.key}</span>
                        <span className="text-right tabular-nums text-muted-foreground">
                          {ch.replied}/{ch.sent}
                        </span>
                        <span className="w-10 text-right tabular-nums font-semibold">
                          {ch.sent > 0 ? `${rate}%` : "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Row B: Top Engaged + Health */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Top Engaged */}
            <Card>
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
                    {topAccounts.map((a) => (
                      <li key={a.id}>
                        <button
                          onClick={() =>
                            navigate(`/accounts?accountId=${a.id}`)
                          }
                          className="w-full flex items-center justify-between gap-1 text-[11px] hover:bg-muted/40 rounded px-1 py-0.5"
                          title={`Open ${a.name}`}
                        >
                          <span className="truncate text-left" title={a.name}>
                            {a.name}
                          </span>
                          <span className="tabular-nums shrink-0">
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">
                              {a.replies}
                            </span>
                            <span className="text-muted-foreground/60">
                              /{a.touches}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Health */}
            <Card>
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
                  >
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="text-muted-foreground">Time</span>
                      <span className="tabular-nums font-medium">
                        {endDate ? `${daysRemaining}d` : "—"}
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
                  >
                    <span className="text-muted-foreground">Touches</span>
                    <span className="tabular-nums font-medium">{avgTouches}</span>
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Row C: Conversion + Engagement Heatmap */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Conversion */}
            <div className="md:col-span-5">
              <Card className="h-full">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">
                      Conversion
                    </h3>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() =>
                        drill({
                          tab: "monitoring",
                          view: "outreach",
                          channel: "email",
                          status: "replied",
                        })
                      }
                      className="text-left hover:bg-muted/40 rounded p-1"
                    >
                      <p className="text-[9px] uppercase text-muted-foreground">Reply</p>
                      <p className="text-base font-bold tabular-nums leading-none">
                        {responseRate}
                        <span className="text-[10px] text-muted-foreground">%</span>
                      </p>
                    </button>
                    <button
                      onClick={() => navigate(`/deals?campaign=${campaign.id}`)}
                      className="text-left hover:bg-muted/40 rounded p-1"
                    >
                      <p className="text-[9px] uppercase text-muted-foreground">
                        Lead→Deal
                      </p>
                      <p className="text-base font-bold tabular-nums leading-none">
                        {repliedContactIds.size > 0
                          ? Math.round((deals.length / repliedContactIds.size) * 100)
                          : 0}
                        <span className="text-[10px] text-muted-foreground">%</span>
                      </p>
                    </button>
                    <button
                      onClick={() => navigate(`/deals?campaign=${campaign.id}`)}
                      className="text-left hover:bg-muted/40 rounded p-1"
                    >
                      <p className="text-[9px] uppercase text-muted-foreground">Avg €</p>
                      <p className="text-base font-bold tabular-nums leading-none">
                        {deals.length > 0
                          ? `€${(totalDealValue / deals.length / 1000).toFixed(0)}k`
                          : "—"}
                      </p>
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>
            {/* Engagement Heatmap */}
            <div className="md:col-span-7">
              <EngagementHeatmap
                communications={communications}
                onCellClick={() =>
                  drill({ tab: "monitoring", view: "outreach", channel: "email", status: "all" })
                }
              />
            </div>
          </div>

          {/* Right Row D: Activity Timeline + Upcoming Tasks */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Activity Timeline (30-day daily) */}
            <div className="md:col-span-7">
              <Card className="h-full">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">
                      Activity Timeline
                    </h3>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Last 30 days
                    </span>
                  </div>
                  <div className="h-36">
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
                          interval={4}
                        />
                        <RTooltip
                          contentStyle={{
                            fontSize: 11,
                            borderRadius: 6,
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--background))",
                          }}
                        />
                        <Bar dataKey="Email" stackId="a" fill="hsl(231 48% 55%)" />
                        <Bar dataKey="Call" stackId="a" fill="hsl(142 71% 45%)" />
                        <Bar dataKey="LinkedIn" stackId="a" fill="hsl(266 85% 58%)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            {/* Upcoming Tasks */}
            <div className="md:col-span-5">
              <UpcomingTasks
                campaignId={campaign.id}
                onOpenTasks={() => onTabChange("actionItems")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
