import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Megaphone, Zap, FileEdit, CheckCircle2, PauseCircle,
  Search, Users, Building2, MessageSquare, Mail, Phone, Linkedin,
  TrendingUp, AlertTriangle, Calendar
} from "lucide-react";
import { format, differenceInDays, startOfMonth, subMonths, isAfter } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";

interface Campaign {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  owner: string | null;
  archived_at: string | null;
  created_at: string | null;
}

interface CampaignDashboardProps {
  campaigns: Campaign[];
  getStrategyProgress: (id: string) => { count: number; total: number };
}

const STATUS_COLORS: Record<string, string> = {
  Active: "hsl(142, 71%, 45%)",
  Draft: "hsl(215, 20%, 65%)",
  Completed: "hsl(217, 91%, 60%)",
  Paused: "hsl(45, 93%, 47%)",
};

const STATUS_BADGE: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  Active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const STAT_BORDER_COLORS: Record<string, string> = {
  Total: "border-l-indigo-500",
  Active: "border-l-emerald-500",
  Draft: "border-l-slate-400",
  Completed: "border-l-blue-500",
  Paused: "border-l-amber-500",
};

const STAT_ICON_BG: Record<string, string> = {
  Total: "bg-indigo-100 dark:bg-indigo-900/30",
  Active: "bg-emerald-100 dark:bg-emerald-900/30",
  Draft: "bg-slate-100 dark:bg-slate-800",
  Completed: "bg-blue-100 dark:bg-blue-900/30",
  Paused: "bg-amber-100 dark:bg-amber-900/30",
};

const STAT_VALUE_COLORS: Record<string, string> = {
  Total: "text-indigo-600 dark:text-indigo-400",
  Active: "text-emerald-600 dark:text-emerald-400",
  Draft: "text-slate-600 dark:text-slate-400",
  Completed: "text-blue-600 dark:text-blue-400",
  Paused: "text-amber-600 dark:text-amber-400",
};

const CHANNEL_ICONS: Record<string, any> = {
  Email: Mail,
  Call: Phone,
  Phone: Phone,
  LinkedIn: Linkedin,
};

const CHANNEL_COLORS: Record<string, string> = {
  Email: "hsl(217, 91%, 60%)",
  Call: "hsl(142, 71%, 45%)",
  Phone: "hsl(142, 71%, 45%)",
  LinkedIn: "hsl(201, 90%, 40%)",
};

const ENGAGEMENT_COLORS = {
  Sent: "hsl(217, 91%, 60%)",
  Replied: "hsl(142, 71%, 45%)",
  Failed: "hsl(0, 72%, 51%)",
};

export function CampaignDashboard({ campaigns, getStrategyProgress }: CampaignDashboardProps) {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: aggregates } = useQuery({
    queryKey: ["campaign-aggregates"],
    staleTime: 5 * 60_000, // 5 min — bumps from 1 min so quick navigations don't refetch
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_campaign_aggregates");
      if (error) throw error;
      const rows = (data || []) as Array<{
        campaign_id: string;
        accounts_count: number;
        contacts_count: number;
        communications_count: number;
        email_count: number;
        call_count: number;
        phone_count: number;
        linkedin_count: number;
        email_sent: number;
        email_replied: number;
        email_failed: number;
        replies_count: number;
      }>;

      const accountsBycamp: Record<string, number> = {};
      const contactsBycamp: Record<string, number> = {};
      const commsBycamp: Record<string, number> = {};
      const repliesBycamp: Record<string, number> = {};
      const sentBycamp: Record<string, number> = {};
      const channelCounts: Record<string, number> = { Email: 0, Call: 0, LinkedIn: 0, Other: 0 };
      const emailStatus = { Sent: 0, Replied: 0, Failed: 0 };
      let totalAccounts = 0, totalContacts = 0, totalComms = 0;

      rows.forEach((r) => {
        const id = r.campaign_id;
        accountsBycamp[id] = Number(r.accounts_count) || 0;
        contactsBycamp[id] = Number(r.contacts_count) || 0;
        commsBycamp[id] = Number(r.communications_count) || 0;
        sentBycamp[id] = Number(r.email_count) || 0;
        repliesBycamp[id] = Number(r.email_replied) || 0;

        totalAccounts += accountsBycamp[id];
        totalContacts += contactsBycamp[id];
        totalComms += commsBycamp[id];

        channelCounts.Email += Number(r.email_count) || 0;
        channelCounts.Call += (Number(r.call_count) || 0) + (Number(r.phone_count) || 0);
        channelCounts.LinkedIn += Number(r.linkedin_count) || 0;

        emailStatus.Sent += Number(r.email_sent) || 0;
        emailStatus.Replied += Number(r.email_replied) || 0;
        emailStatus.Failed += Number(r.email_failed) || 0;
      });

      return {
        accountsBycamp, contactsBycamp, commsBycamp,
        totalAccounts, totalContacts, totalComms,
        channelCounts, emailStatus, repliesBycamp, sentBycamp,
      };
    },
  });

  const agg = aggregates || {
    accountsBycamp: {}, contactsBycamp: {}, commsBycamp: {},
    totalAccounts: 0, totalContacts: 0, totalComms: 0,
    channelCounts: { Email: 0, Call: 0, LinkedIn: 0, Other: 0 },
    emailStatus: { Sent: 0, Replied: 0, Failed: 0 },
    repliesBycamp: {} as Record<string, number>,
    sentBycamp: {} as Record<string, number>,
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { Active: 0, Draft: 0, Completed: 0, Paused: 0 };
    campaigns.forEach((c) => { const s = c.status || "Draft"; if (counts[s] !== undefined) counts[s]++; });
    return counts;
  }, [campaigns]);

  const pieData = useMemo(() =>
    Object.entries(statusCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, fill: STATUS_COLORS[name] || "hsl(0,0%,70%)" })),
    [statusCounts]
  );

  const channelData = useMemo(() => {
    return Object.entries(agg.channelCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, fill: CHANNEL_COLORS[name] || "hsl(0,0%,60%)" }));
  }, [agg.channelCounts]);

  const engagementData = useMemo(() => {
    return Object.entries(agg.emailStatus)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value, fill: ENGAGEMENT_COLORS[name as keyof typeof ENGAGEMENT_COLORS] }));
  }, [agg.emailStatus]);

  const totalEmails = agg.emailStatus.Sent + agg.emailStatus.Replied + agg.emailStatus.Failed;
  const replyRate = totalEmails > 0 ? Math.round((agg.emailStatus.Replied / totalEmails) * 100) : 0;

  const timelineData = useMemo(() => {
    const months: { key: string; label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = startOfMonth(subMonths(new Date(), i));
      months.push({ key: format(d, "yyyy-MM"), label: format(d, "MMM"), count: 0 });
    }
    const map = new Map(months.map((m) => [m.key, m]));
    campaigns.forEach((c) => {
      if (!c.created_at) return;
      const k = format(new Date(c.created_at), "yyyy-MM");
      const m = map.get(k);
      if (m) m.count++;
    });
    return months;
  }, [campaigns]);

  const topCampaigns = useMemo(() => {
    return [...campaigns]
      .map((c) => {
        const com = agg.commsBycamp[c.id] || 0;
        const sent = agg.sentBycamp[c.id] || 0;
        const replies = agg.repliesBycamp[c.id] || 0;
        const rate = sent > 0 ? Math.round((replies / sent) * 100) : 0;
        return { c, com, replies, sent, rate, strategy: getStrategyProgress(c.id) };
      })
      .filter((x) => x.com > 0)
      .sort((a, b) => b.com - a.com)
      .slice(0, 5);
  }, [campaigns, agg, getStrategyProgress]);

  const alerts = useMemo(() => {
    const today = new Date();
    return campaigns
      .filter((c) => c.status === "Active" && c.end_date)
      .map((c) => {
        const end = new Date(c.end_date! + "T00:00:00");
        const days = differenceInDays(end, today);
        return { c, days, overdue: days < 0 };
      })
      .filter((x) => x.days <= 7)
      .sort((a, b) => a.days - b.days)
      .slice(0, 3);
  }, [campaigns]);

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter && (c.status || "Draft") !== statusFilter) return false;
      if (typeFilter && (c.campaign_type || "Unspecified") !== typeFilter) return false;
      if (search && !c.campaign_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [campaigns, statusFilter, typeFilter, search]);

  const stats = [
    { label: "Total", value: campaigns.length, icon: Megaphone, color: "text-primary", filter: null as string | null },
    { label: "Active", value: statusCounts.Active, icon: Zap, color: "text-green-600 dark:text-green-400", filter: "Active" },
    { label: "Draft", value: statusCounts.Draft, icon: FileEdit, color: "text-muted-foreground", filter: "Draft" },
    { label: "Completed", value: statusCounts.Completed, icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400", filter: "Completed" },
    { label: "Paused", value: statusCounts.Paused, icon: PauseCircle, color: "text-yellow-600 dark:text-yellow-400", filter: "Paused" },
  ];

  const handleStatClick = (filter: string | null) => {
    setStatusFilter((prev) => (prev === filter ? null : filter));
    setTypeFilter(null);
  };

  const handlePieClick = (data: any) => {
    if (data?.name) {
      setStatusFilter((prev) => (prev === data.name ? null : data.name));
      setTypeFilter(null);
    }
  };

  const activeFilterLabel = statusFilter || typeFilter || null;
  const avgComms = campaigns.length > 0 ? (agg.totalComms / campaigns.length).toFixed(1) : "0";

  return (
    <div className="flex-1 overflow-auto p-3 space-y-3">
      {/* Alerts */}
      {alerts.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-xs">
            <span className="font-medium text-amber-700 dark:text-amber-400">Attention:</span>{" "}
            {alerts.map((a, i) => (
              <span key={a.c.id}>
                <button
                  className="underline hover:text-amber-700 dark:hover:text-amber-300"
                  onClick={() => {
                    const slug = a.c.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                    navigate(`/campaigns/${slug}`);
                  }}
                >
                  {a.c.campaign_name}
                </button>{" "}
                <span className="text-amber-700 dark:text-amber-400">
                  {a.overdue ? `overdue by ${Math.abs(a.days)}d` : `ends in ${a.days}d`}
                </span>
                {i < alerts.length - 1 ? " · " : ""}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {stats.map((s) => (
          <Card
            key={s.label}
            className={`border border-l-4 ${STAT_BORDER_COLORS[s.label] || "border-l-primary"} shadow-none cursor-pointer transition-all hover:shadow-md ${
              statusFilter === s.filter && s.filter !== null ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => handleStatClick(s.filter)}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`h-8 w-8 rounded-lg ${STAT_ICON_BG[s.label] || "bg-muted"} flex items-center justify-center shrink-0`}>
                <s.icon className={`h-4 w-4 ${s.color} shrink-0`} />
              </div>
              <div>
                <p className={`text-2xl font-bold leading-none ${STAT_VALUE_COLORS[s.label] || ""}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 4-Tile Chart Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Status Pie */}
        <Card className="border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="50%"
                    innerRadius={35} outerRadius={62}
                    paddingAngle={3} dataKey="value"
                    onClick={handlePieClick} cursor="pointer" stroke="none"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} opacity={statusFilter && statusFilter !== entry.name ? 0.3 : 1} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value: number, name: string) => [`${value} campaigns`, name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend verticalAlign="bottom" height={24} iconSize={8} formatter={(value: string) => (<span className="text-xs text-muted-foreground">{value}</span>)} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Channel Mix */}
        <Card className="border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium">Channel Mix</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            {channelData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No communications</p>
            ) : (
              <div className="space-y-2.5">
                {channelData.map((ch) => {
                  const Icon = CHANNEL_ICONS[ch.name] || MessageSquare;
                  const total = channelData.reduce((s, x) => s + x.value, 0);
                  const pct = total > 0 ? (ch.value / total) * 100 : 0;
                  return (
                    <div key={ch.name}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground">{ch.name}</span>
                        </div>
                        <span className="tabular-nums font-medium">{ch.value}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: ch.fill }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Email Engagement */}
        <Card className="border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium">Email Engagement</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {engagementData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No emails sent</p>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative w-[100px] h-[100px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={engagementData} cx="50%" cy="50%" innerRadius={28} outerRadius={45} paddingAngle={2} dataKey="value" stroke="none">
                        {engagementData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Pie>
                      <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-base font-bold leading-none">{replyRate}%</span>
                    <span className="text-[9px] text-muted-foreground">Reply</span>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5 text-xs min-w-0">
                  {engagementData.map((e) => (
                    <div key={e.name} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: e.fill }} />
                        <span className="text-muted-foreground truncate">{e.name}</span>
                      </div>
                      <span className="tabular-nums font-medium">{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card className="border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium">Quick Stats</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                <div className="h-7 w-7 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                  <Building2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-none">{agg.totalAccounts}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Accounts</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                <div className="h-7 w-7 rounded-md bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                  <Users className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-none">{agg.totalContacts}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Contacts</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                <div className="h-7 w-7 rounded-md bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
                  <MessageSquare className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-none">{agg.totalComms}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Comms</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30">
                <div className="h-7 w-7 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                  <TrendingUp className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold leading-none">{avgComms}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Avg / camp</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Timeline + Top Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Timeline */}
        <Card className="border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              Campaigns Created (Last 6 Months)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={timelineData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RechartsTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value: number) => [`${value} campaigns`, "Created"]}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Active */}
        <Card className="border shadow-none">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              Top Active Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            {topCampaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No campaign activity yet</p>
            ) : (
              <div className="space-y-2.5">
                {topCampaigns.map(({ c, com, replies, sent, rate, strategy }, i) => {
                  const stratPct = strategy.total > 0 ? (strategy.count / strategy.total) * 100 : 0;
                  return (
                    <div
                      key={c.id}
                      className="p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => {
                        const slug = c.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                        navigate(`/campaigns/${slug}`);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-medium text-muted-foreground tabular-nums w-4">{i + 1}.</span>
                          <span className="text-xs font-medium truncate">{c.campaign_name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary" className="text-[10px] h-5">
                            <MessageSquare className="h-2.5 w-2.5 mr-1" />{com}
                          </Badge>
                          {sent > 0 && (
                            <Badge
                              variant="secondary"
                              className={`text-[10px] h-5 ${
                                rate >= 30 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : rate >= 10 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {rate}% reply
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pl-6">
                        <Progress value={stratPct} className="h-1 flex-1" />
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          MART {strategy.count}/{strategy.total}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Campaigns Table */}
      <Card className="border shadow-none">
        <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-medium">
              All Campaigns
              {activeFilterLabel && (
                <Badge variant="secondary" className="ml-2 cursor-pointer" onClick={() => { setStatusFilter(null); setTypeFilter(null); }}>
                  {activeFilterLabel} ✕
                </Badge>
              )}
            </CardTitle>
            <Badge variant="outline" className="text-xs">{filtered.length}</Badge>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs whitespace-nowrap">Name</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Type</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Status</TableHead>
                  <TableHead className="text-xs whitespace-nowrap w-[120px]">Strategy</TableHead>
                  <TableHead className="text-xs whitespace-nowrap text-right">Accounts</TableHead>
                  <TableHead className="text-xs whitespace-nowrap text-right">Contacts</TableHead>
                  <TableHead className="text-xs whitespace-nowrap text-right">Comms</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Engagement</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Start</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">
                      No campaigns match the current filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c) => {
                    const strategy = getStrategyProgress(c.id);
                    const stratPct = strategy.total > 0 ? (strategy.count / strategy.total) * 100 : 0;
                    const acc = agg.accountsBycamp[c.id] || 0;
                    const con = agg.contactsBycamp[c.id] || 0;
                    const com = agg.commsBycamp[c.id] || 0;
                    const sent = agg.sentBycamp[c.id] || 0;
                    const replies = agg.repliesBycamp[c.id] || 0;
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer hover:bg-muted/50 even:bg-muted/10"
                        onClick={() => { const slug = c.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); navigate(`/campaigns/${slug}`); }}
                      >
                        <TableCell className="text-xs font-medium max-w-[200px] truncate">{c.campaign_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.campaign_type || "—"}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${STATUS_BADGE[c.status || "Draft"]}`} variant="secondary">{c.status || "Draft"}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={stratPct} className="h-1.5 w-16" />
                            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{strategy.count}/{strategy.total}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{acc}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{con}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{com}</TableCell>
                        <TableCell className="text-xs">
                          {sent > 0 ? (
                            <span className="text-muted-foreground tabular-nums">
                              <span className="text-foreground font-medium">{replies}</span>/{sent} replies
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {c.start_date ? format(new Date(c.start_date + "T00:00:00"), "dd MMM yy") : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {c.end_date ? format(new Date(c.end_date + "T00:00:00"), "dd MMM yy") : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
