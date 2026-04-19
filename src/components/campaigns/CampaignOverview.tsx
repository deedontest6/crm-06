import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Building2, Users, MessageSquare, TrendingUp,
  Target, FileText, BarChart3, ArrowRight, Mail, Phone, Linkedin,
  Activity, Trophy, HeartPulse, Calendar, Layers
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { campaignTypeLabel, PRIORITY_BADGE_CLASS } from "@/utils/campaignTypeLabel";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, BarChart, Bar
} from "recharts";

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
}

const statusColors: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Active: "bg-primary/10 text-primary",
  Paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const commTypeStyles: Record<string, { badge: string; icon: any; color: string }> = {
  Email: { badge: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800", icon: Mail, color: "hsl(217 91% 60%)" },
  Call: { badge: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800", icon: Phone, color: "hsl(142 71% 45%)" },
  Phone: { badge: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800", icon: Phone, color: "hsl(142 71% 45%)" },
  LinkedIn: { badge: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800", icon: Linkedin, color: "hsl(231 48% 48%)" },
};

// Funnel stage colors (cumulative funnel)
const funnelStages = [
  { key: "total", label: "Total Contacts", color: "bg-slate-400", hex: "hsl(215 20% 65%)" },
  { key: "contacted", label: "Contacted", color: "bg-blue-500", hex: "hsl(217 91% 60%)" },
  { key: "responded", label: "Responded", color: "bg-amber-500", hex: "hsl(38 92% 50%)" },
  { key: "qualified", label: "Qualified", color: "bg-purple-500", hex: "hsl(271 81% 56%)" },
  { key: "converted", label: "Converted", color: "bg-emerald-500", hex: "hsl(160 84% 39%)" },
];

function parseRegionToCountries(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const r = JSON.parse(raw);
    if (Array.isArray(r)) {
      return Array.from(new Set(r.map((item: any) =>
        typeof item === "object" && item !== null ? item.country || item.region : String(item)
      ).filter(Boolean)));
    }
    if (typeof r === "object" && r !== null) {
      const out: string[] = [];
      Object.values(r).forEach((v) => {
        if (Array.isArray(v)) out.push(...(v as string[]));
        else if (v) out.push(String(v));
      });
      return Array.from(new Set(out));
    }
  } catch {}
  return [raw];
}

interface KPIConfig {
  label: string;
  value: number | string;
  icon: any;
  sub?: string;
  onClick?: () => void;
  borderColor: string;
  iconBg: string;
  iconColor: string;
  valueColor: string;
}

export function CampaignOverview({
  campaign, accounts, contacts, communications,
  isStrategyComplete, strategyProgress, onTabChange
}: Props) {
  const { data: deals = [] } = useQuery({
    queryKey: ["campaign-deals-overview", campaign.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, stage, total_contract_value")
        .eq("campaign_id", campaign.id);
      if (error) throw error;
      return data;
    },
  });

  // ---- Channel counts ----
  const emailCount = communications.filter((c: any) => c.communication_type === "Email").length;
  const callCount = communications.filter((c: any) => c.communication_type === "Call" || c.communication_type === "Phone").length;
  const linkedinCount = communications.filter((c: any) => c.communication_type === "LinkedIn").length;
  const outreachTotal = emailCount + callCount + linkedinCount;

  // ---- Engagement Funnel (cumulative) ----
  const funnelData = useMemo(() => {
    const total = contacts.length;
    let converted = 0, qualified = 0, responded = 0, contacted = 0;
    contacts.forEach((c: any) => {
      const s = c.stage || "Not Contacted";
      if (s === "Converted") { converted++; qualified++; responded++; contacted++; }
      else if (s === "Qualified") { qualified++; responded++; contacted++; }
      else if (s === "Responded") { responded++; contacted++; }
      else if (s === "Contacted") { contacted++; }
    });
    const counts = { total, contacted, responded, qualified, converted };
    return funnelStages.map((stage, i) => {
      const count = (counts as any)[stage.key] as number;
      const pctOfTotal = total > 0 ? Math.round((count / total) * 100) : 0;
      const prevCount = i > 0 ? (counts as any)[funnelStages[i - 1].key] : count;
      const conversionFromPrev = prevCount > 0 && i > 0 ? Math.round((count / prevCount) * 100) : null;
      return { ...stage, count, pctOfTotal, conversionFromPrev };
    });
  }, [contacts]);
  const responseCount = funnelData.find(f => f.key === "responded")?.count || 0;

  // ---- Channel Mix ----
  const channelMix = useMemo(() => {
    const data = [
      { name: "Email", value: emailCount, color: commTypeStyles.Email.color },
      { name: "Call", value: callCount, color: commTypeStyles.Call.color },
      { name: "LinkedIn", value: linkedinCount, color: commTypeStyles.LinkedIn.color },
    ].filter(d => d.value > 0);
    return data;
  }, [emailCount, callCount, linkedinCount]);

  // ---- Response Rate by Channel ----
  // Approximate: count contacts who responded that received this channel type
  const responseRateData = useMemo(() => {
    const channels = ["Email", "Call", "LinkedIn"] as const;
    const respondedContactIds = new Set(
      contacts.filter((c: any) => ["Responded", "Qualified", "Converted"].includes(c.stage)).map((c: any) => c.id)
    );
    return channels.map(ch => {
      const sentForChannel = communications.filter((c: any) =>
        ch === "Call" ? (c.communication_type === "Call" || c.communication_type === "Phone") : c.communication_type === ch
      );
      const sent = sentForChannel.length;
      const contactedIds = new Set(sentForChannel.map((c: any) => c.contact_id).filter(Boolean));
      const responses = Array.from(contactedIds).filter((id) => respondedContactIds.has(id)).length;
      const rate = sent > 0 ? Math.round((responses / Math.max(1, contactedIds.size)) * 100) : 0;
      return { channel: ch, sent, responses, rate, color: commTypeStyles[ch].color };
    });
  }, [communications, contacts]);

  // ---- Top Engaged Accounts ----
  const topAccounts = useMemo(() => {
    const accMap: Record<string, { id: string; name: string; touches: number; contactsCount: number; respondedCount: number }> = {};
    accounts.forEach((a: any) => {
      const id = a.account_id || a.id;
      const name = a.accounts?.account_name || a.account_name || "Unknown";
      accMap[id] = { id, name, touches: 0, contactsCount: 0, respondedCount: 0 };
    });
    contacts.forEach((c: any) => {
      const aid = c.account_id;
      if (aid && accMap[aid]) {
        accMap[aid].contactsCount++;
        if (["Responded", "Qualified", "Converted"].includes(c.stage)) accMap[aid].respondedCount++;
      }
    });
    communications.forEach((c: any) => {
      const aid = c.account_id;
      if (aid && accMap[aid]) accMap[aid].touches++;
    });
    return Object.values(accMap)
      .filter(a => a.touches > 0 || a.respondedCount > 0)
      .sort((a, b) => (b.touches + b.respondedCount * 5) - (a.touches + a.respondedCount * 5))
      .slice(0, 5);
  }, [accounts, contacts, communications]);

  // ---- Outreach Activity (stacked bar by channel) ----
  const timelineData = useMemo(() => {
    if (communications.length === 0) return [];
    const weekMap: Record<string, { week: string; Email: number; Call: number; LinkedIn: number; ts: number }> = {};
    communications.forEach((c: any) => {
      if (!c.communication_date) return;
      const d = new Date(c.communication_date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = format(weekStart, "dd MMM");
      if (!weekMap[key]) weekMap[key] = { week: key, Email: 0, Call: 0, LinkedIn: 0, ts: weekStart.getTime() };
      const t = c.communication_type === "Phone" ? "Call" : c.communication_type;
      if (t === "Email" || t === "Call" || t === "LinkedIn") weekMap[key][t]++;
    });
    return Object.values(weekMap).sort((a, b) => a.ts - b.ts);
  }, [communications]);

  // ---- Campaign Health ----
  const totalDealValue = deals.reduce((sum: number, d: any) => sum + (d.total_contract_value || 0), 0);
  const contactedContactIds = new Set(
    communications.map((c: any) => c.contact_id).filter(Boolean)
  );
  const coveragePct = contacts.length > 0 ? Math.round((contactedContactIds.size / contacts.length) * 100) : 0;
  const avgTouches = contacts.length > 0 ? (outreachTotal / contacts.length).toFixed(1) : "0.0";

  const today = new Date();
  const startDate = campaign.start_date ? new Date(campaign.start_date) : null;
  const endDate = campaign.end_date ? new Date(campaign.end_date) : null;
  const totalDays = startDate && endDate ? Math.max(1, differenceInDays(endDate, startDate)) : 0;
  const elapsedDays = startDate ? Math.max(0, differenceInDays(today, startDate)) : 0;
  const daysRemaining = endDate ? Math.max(0, differenceInDays(endDate, today)) : 0;
  const timeProgressPct = totalDays > 0 ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : 0;

  const countries = useMemo(() => parseRegionToCountries(campaign.region), [campaign.region]);
  const description = (campaign.description || "").trim();
  const goal = (campaign.goal || "").trim();
  const notes = (campaign.notes || "").replace(/\[timezone:.+?\]\s*/g, "").trim();

  const kpis: KPIConfig[] = [
    {
      label: "Accounts", value: accounts.length, icon: Building2,
      onClick: () => onTabChange("setup"),
      borderColor: "border-l-muted-foreground/30",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      valueColor: "text-foreground",
    },
    {
      label: "Contacts", value: contacts.length, icon: Users,
      onClick: () => onTabChange("setup"),
      borderColor: "border-l-muted-foreground/30",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      valueColor: "text-foreground",
    },
    {
      label: "Outreach", value: outreachTotal, icon: MessageSquare,
      sub: `${emailCount} ✉ · ${callCount} ☎ · ${linkedinCount} in`,
      onClick: () => onTabChange("monitoring"),
      borderColor: "border-l-muted-foreground/30",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      valueColor: "text-foreground",
    },
    {
      label: "Responses", value: responseCount, icon: TrendingUp,
      sub: contacts.length > 0 ? `${Math.round((responseCount / contacts.length) * 100)}% rate` : undefined,
      borderColor: "border-l-muted-foreground/30",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      valueColor: "text-foreground",
    },
    {
      label: "Deals", value: deals.length, icon: BarChart3,
      sub: totalDealValue > 0 ? `€${totalDealValue.toLocaleString()}` : undefined,
      onClick: () => onTabChange("monitoring"),
      borderColor: "border-l-muted-foreground/30",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      valueColor: "text-foreground",
    },
    {
      label: "Setup", value: `${strategyProgress}/4`, icon: Target,
      sub: `${Math.round((strategyProgress / 4) * 100)}% done`,
      onClick: () => onTabChange("setup"),
      borderColor: "border-l-muted-foreground/30",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      valueColor: "text-foreground",
    },
  ];

  const totalContacts = contacts.length;

  return (
    <div className="space-y-4 w-full">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card
              key={k.label}
              className={`border-l-4 ${k.borderColor} ${k.onClick ? "cursor-pointer hover:shadow-md transition-all" : ""}`}
              onClick={k.onClick}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.valueColor}`}>{k.value}</p>
                    {k.sub && <p className="text-xs text-muted-foreground mt-1 truncate">{k.sub}</p>}
                  </div>
                  <div className={`h-10 w-10 rounded-lg ${k.iconBg} flex items-center justify-center shrink-0`}>
                    <Icon className={`h-5 w-5 ${k.iconColor}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Engagement Funnel + Channel Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Engagement Funnel */}
        <Card className="lg:col-span-7">
          <CardHeader className="pb-3">
            <CardTitle
              className="text-base font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
              onClick={() => onTabChange("setup")}
            >
              <Layers className="h-4 w-4 text-muted-foreground" />
              Engagement Funnel
              <ArrowRight className="h-4 w-4 ml-auto opacity-60" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {totalContacts === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No contacts added yet</p>
            ) : (
              <div className="space-y-2.5">
                {funnelData.map((s) => (
                  <div key={s.key} className="space-y-1">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 text-foreground/80 truncate font-medium">{s.label}</span>
                      <div className="flex-1 h-7 rounded-md bg-muted overflow-hidden relative">
                        <div
                          className={`h-full ${s.color} rounded-md transition-all flex items-center px-2`}
                          style={{ width: `${Math.max(s.pctOfTotal, 2)}%` }}
                        >
                          {s.pctOfTotal >= 12 && (
                            <span className="text-xs font-semibold text-white tabular-nums">{s.pctOfTotal}%</span>
                          )}
                        </div>
                      </div>
                      <span className="w-10 text-right text-sm font-semibold tabular-nums">{s.count}</span>
                      <span className="w-20 text-right text-xs text-muted-foreground tabular-nums shrink-0">
                        {s.conversionFromPrev !== null ? `→ ${s.conversionFromPrev}%` : ""}
                      </span>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-2 border-t mt-3">
                  Each stage is cumulative. Right column shows conversion rate from previous stage.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channel Mix Donut */}
        <Card className="lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Outreach Channel Mix
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {channelMix.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                No outreach yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={channelMix}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {channelMix.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [`${v} messages`, n]} />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value, entry: any) => `${value} (${entry.payload.value})`}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Response Rate + Campaign Health */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Response Rate by Channel */}
        <Card className="lg:col-span-7 border-l-4 border-l-amber-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              Response Rate by Channel
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {outreachTotal === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No outreach data yet</p>
            ) : (
              <div className="space-y-4">
                {responseRateData.map((r) => {
                  const Icon = commTypeStyles[r.channel].icon;
                  return (
                    <div key={r.channel} className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Icon className="h-4 w-4" style={{ color: r.color }} />
                        <span className="font-medium">{r.channel}</span>
                        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                          {r.responses} / {r.sent} sent · <span className="font-semibold text-foreground">{r.rate}%</span>
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${r.rate}%`, backgroundColor: r.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Campaign Health */}
        <Card className="lg:col-span-5 border-l-4 border-l-rose-500">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                <HeartPulse className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              </div>
              Campaign Health
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            {/* Time progress */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium uppercase tracking-wide">
                  <Calendar className="h-3.5 w-3.5" />
                  Timeline
                </span>
                <span className="tabular-nums">
                  {endDate ? `${daysRemaining}d remaining` : "No end date"}
                </span>
              </div>
              <Progress value={timeProgressPct} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                {totalDays > 0 ? `${elapsedDays} of ${totalDays} days (${timeProgressPct}%)` : "—"}
              </p>
            </div>

            {/* Coverage */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium uppercase tracking-wide">
                  <Users className="h-3.5 w-3.5" />
                  Contact Coverage
                </span>
                <span className="font-semibold tabular-nums">{coveragePct}%</span>
              </div>
              <Progress value={coveragePct} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                {contactedContactIds.size} of {contacts.length} contacts reached
              </p>
            </div>

            {/* Avg touches & pipeline */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Avg Touches</p>
                <p className="text-xl font-bold mt-0.5 tabular-nums">{avgTouches}</p>
                <p className="text-xs text-muted-foreground">per contact</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Pipeline</p>
                <p className="text-xl font-bold mt-0.5 tabular-nums">
                  {totalDealValue > 0 ? `€${(totalDealValue / 1000).toFixed(0)}k` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">{deals.length} deals</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Outreach Activity — stacked bar */}
      <Card className="border-l-4 border-l-indigo-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            Outreach Activity Over Time
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {timelineData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              No outreach activity yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={timelineData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={28} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar dataKey="Email" stackId="a" fill={commTypeStyles.Email.color} radius={[0, 0, 0, 0]} />
                <Bar dataKey="Call" stackId="a" fill={commTypeStyles.Call.color} radius={[0, 0, 0, 0]} />
                <Bar dataKey="LinkedIn" stackId="a" fill={commTypeStyles.LinkedIn.color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Top Engaged Accounts + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Top Engaged Accounts */}
        <Card className="lg:col-span-7 border-l-4 border-l-purple-500">
          <CardHeader className="pb-3">
            <CardTitle
              className="text-base font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
              onClick={() => onTabChange("setup")}
            >
              <div className="h-8 w-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Trophy className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
              Top Engaged Accounts
              <ArrowRight className="h-4 w-4 ml-auto opacity-60" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {topAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No engagement yet</p>
            ) : (
              <div className="divide-y divide-border">
                {topAccounts.map((a, idx) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-muted/50 rounded-md px-2 -mx-2 transition-colors"
                    onClick={() => onTabChange("setup")}
                  >
                    <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.contactsCount} contact{a.contactsCount !== 1 ? "s" : ""} · {a.touches} touch{a.touches !== 1 ? "es" : ""}
                      </p>
                    </div>
                    {a.respondedCount > 0 && (
                      <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800 text-xs h-6 px-2">
                        {a.respondedCount} responded
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="lg:col-span-5 border-l-4 border-l-cyan-500">
          <CardHeader className="pb-3">
            <CardTitle
              className="text-base font-semibold flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
              onClick={() => onTabChange("monitoring")}
            >
              <div className="h-8 w-8 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center">
                <MessageSquare className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              </div>
              Recent Activity
              <ArrowRight className="h-4 w-4 ml-auto opacity-60" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {communications.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No activity yet</p>
            ) : (
              <div className="divide-y divide-border">
                {communications.slice(0, 5).map((c: any) => {
                  const snippet = (c.subject || c.notes || "").toString().trim();
                  const style = commTypeStyles[c.communication_type] || commTypeStyles.Email;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 text-sm py-2 cursor-pointer hover:bg-muted/50 rounded-md px-2 -mx-2 transition-colors"
                      onClick={() => onTabChange("monitoring")}
                    >
                      <Badge variant="outline" className={`text-xs h-6 px-2 shrink-0 ${style.badge}`}>
                        {c.communication_type}
                      </Badge>
                      <span className="shrink-0 truncate max-w-[120px] text-sm font-medium">
                        {c.contacts?.contact_name || "Unknown"}
                      </span>
                      {snippet && <span className="text-sm text-muted-foreground truncate flex-1">· {snippet}</span>}
                      <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                        {c.communication_date ? format(new Date(c.communication_date), "dd MMM") : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Campaign Details */}
      <Card className="border-l-4 border-l-slate-400">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
            </div>
            Campaign Details
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Type</p>
                <p className="text-sm font-medium">{campaignTypeLabel(campaign.campaign_type)}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Priority</p>
                  <Badge className={`${PRIORITY_BADGE_CLASS[campaign.priority || "Medium"]} h-6 px-2.5 text-xs`} variant="secondary">
                    {campaign.priority || "Medium"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Channel</p>
                  <p className="text-sm font-medium">{campaign.primary_channel || "—"}</p>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Status</p>
                <Badge className={`${statusColors[campaign.status || "Draft"]} h-6 px-2.5 text-xs`} variant="secondary">
                  {campaign.status || "Draft"}
                </Badge>
              </div>
              {Array.isArray(campaign.tags) && campaign.tags.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {campaign.tags.map((t: string) => (
                      <Badge key={t} variant="outline" className="h-6 px-2.5 text-xs bg-muted/40">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {countries.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Region</p>
                  <div className="flex flex-wrap gap-1.5">
                    {countries.slice(0, 12).map((c) => (
                      <Badge key={c} variant="outline" className="h-6 px-2.5 text-xs bg-muted/40">{c}</Badge>
                    ))}
                    {countries.length > 12 && (
                      <Badge variant="outline" className="h-6 px-2.5 text-xs bg-muted/40">+{countries.length - 12}</Badge>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {description && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Description</p>
                  <div className="bg-muted/30 rounded-md p-3 text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {description}
                  </div>
                </div>
              )}
              {goal && goal !== description && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Goal</p>
                  <div className="bg-muted/30 rounded-md p-3 text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {goal}
                  </div>
                </div>
              )}
              {notes && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-1">Notes</p>
                  <div className="bg-muted/30 rounded-md p-3 text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {notes}
                  </div>
                </div>
              )}
              {!description && !goal && !notes && (
                <p className="text-sm text-muted-foreground italic">No description, goal, or notes added yet.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
