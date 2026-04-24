import { useMemo, useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, Users, Building2, Mail, Phone, MessageSquare, TrendingUp,
  TrendingDown, RefreshCw, ArrowRight, Send, Reply, Download, Clock,
  Inbox, AlertTriangle, Info, Eye, Target, Trophy, DollarSign, Filter,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
  Tooltip as RechartsTooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import { format, subDays, isAfter, startOfDay } from "date-fns";

interface Props {
  campaignId: string;
}

// ────────────────────────── Design tokens ──────────────────────────
const CHART = {
  primary:  "hsl(var(--primary))",
  success:  "hsl(142 71% 45%)",   // emerald
  call:     "hsl(38 92% 50%)",    // amber
  linkedin: "hsl(258 90% 66%)",   // violet
  failed:   "hsl(0 84% 60%)",     // rose
  neutral:  "hsl(215 16% 47%)",   // slate
  opened:   "hsl(199 89% 48%)",   // sky
} as const;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_BUCKETS = [
  { label: "Morning", short: "AM",  range: [6, 12] as const },
  { label: "Midday",  short: "MD",  range: [12, 14] as const },
  { label: "Afternoon", short: "PM", range: [14, 18] as const },
  { label: "Evening", short: "EVE", range: [18, 24] as const },
];

type DateRange = "7" | "30" | "90" | "all";
type ChannelFilter = "all" | "email" | "call" | "linkedin";

// ────────────────────────── Helpers ──────────────────────────
const isBounce = (m: any) =>
  m.delivery_status === "failed" ||
  ["Bounced", "Failed"].includes(m.email_status || "");

const isProviderSent = (m: any) =>
  m.communication_type === "Email" &&
  m.sent_via && m.sent_via !== "manual" &&
  m.delivery_status !== "received";

const isInbound = (m: any) => m.delivery_status === "received";

const pct = (num: number, den: number) =>
  den > 0 ? Math.min(100, Math.max(0, Math.round((num / den) * 100))) : 0;

const trendDelta = (current: number, previous: number): { delta: number; up: boolean | null } => {
  if (previous === 0) return { delta: current === 0 ? 0 : 100, up: current > 0 };
  const d = Math.round(((current - previous) / previous) * 100);
  return { delta: Math.abs(d), up: d === 0 ? null : d > 0 };
};

// ────────────────────────── Sub components ──────────────────────────
function HeroKpiTile({
  label, value, icon: Icon, accent, delta, sublabel,
}: {
  label: string;
  value: string | number;
  icon: any;
  accent: "primary" | "success" | "call" | "linkedin" | "neutral";
  delta?: { delta: number; up: boolean | null };
  sublabel?: string;
}) {
  const accentMap: Record<string, string> = {
    primary:  "from-primary/10 to-primary/0 text-primary",
    success:  "from-emerald-500/10 to-emerald-500/0 text-emerald-600 dark:text-emerald-400",
    call:     "from-amber-500/10 to-amber-500/0 text-amber-600 dark:text-amber-400",
    linkedin: "from-violet-500/10 to-violet-500/0 text-violet-600 dark:text-violet-400",
    neutral:  "from-slate-500/10 to-slate-500/0 text-slate-600 dark:text-slate-400",
  };
  return (
    <Card className="border-border/60 shadow-sm overflow-hidden relative">
      <div className={`absolute inset-0 bg-gradient-to-br ${accentMap[accent]} pointer-events-none opacity-60`} />
      <CardContent className="p-4 relative">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <span className="text-3xl font-bold tabular-nums">{value}</span>
            {sublabel && <span className="text-[11px] text-muted-foreground">{sublabel}</span>}
          </div>
          <div className={`p-2 rounded-md bg-background/80 border border-border/50`}>
            <Icon className={`h-4 w-4 ${accentMap[accent].split(" ").pop()}`} />
          </div>
        </div>
        {delta && delta.up !== null && (
          <div className={`mt-2 inline-flex items-center gap-1 text-[11px] font-medium ${delta.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {delta.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta.delta}% vs prev period
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RateRow({ label, num, den, color, hint }: { label: string; num: number; den: number; color: string; hint: string }) {
  const p = pct(num, den);
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <div className="flex items-center gap-1 text-muted-foreground">
          {label}
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger><Info className="h-3 w-3" /></TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[220px]">{hint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <span className="font-medium tabular-nums text-foreground">{p}% <span className="text-muted-foreground">({num}/{den})</span></span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}

function EmptyHint({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <Icon className="h-8 w-8 mb-2 opacity-50" />
      <p className="text-xs">{message}</p>
    </div>
  );
}

// ────────────────────────── Main ──────────────────────────
export function CampaignAnalytics({ campaignId }: Props) {
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");

  const { data: accounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId, "analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("*, accounts(account_name, industry, region, country)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId, "analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("*, contacts(contact_name, email, position, company_name, region), accounts(account_name, region, industry)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const { data: communications = [] } = useQuery({
    queryKey: ["campaign-communications", campaignId, "analytics"],
    queryFn: async () => {
    const { data, error } = await supabase
        .from("campaign_communications")
        .select("*, opened_at, open_count, last_opened_at, tracking_id, contacts(contact_name), accounts(account_name, region, industry)")
        .eq("campaign_id", campaignId)
        .order("communication_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["campaign-deals", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("id, stage, total_contract_value, account_id")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  // Pull true delivery analytics from email_history for this campaign's contacts
  const contactEmails = useMemo(() => {
    return contacts.map(c => c.contacts?.email).filter(Boolean);
  }, [contacts]);

  const { data: emailHistory = [] } = useQuery({
    queryKey: ["campaign-email-history", campaignId, contactEmails.length],
    enabled: contactEmails.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_history")
        .select("id, recipient_email, sender_email, sent_at, status, opened_at, replied_at, bounced_at, open_count, unique_opens, reply_count")
        .in("recipient_email", contactEmails);
      if (error) throw error;
      return data as any[];
    },
    staleTime: 60_000, gcTime: 5 * 60_000,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["campaign-accounts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-deals", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-email-history", campaignId] });
  };

  // ───── Date / channel filtering ─────
  const cutoff = useMemo(() => {
    if (dateRange === "all") return null;
    return subDays(new Date(), parseInt(dateRange, 10));
  }, [dateRange]);

  const filteredComms = useMemo(() => {
    let rows = communications as any[];
    if (cutoff) rows = rows.filter(c => c.communication_date && isAfter(new Date(c.communication_date), cutoff));
    if (channelFilter !== "all") {
      rows = rows.filter(c => {
        const t = c.communication_type;
        if (channelFilter === "email") return t === "Email";
        if (channelFilter === "call") return t === "Call" || t === "Phone";
        if (channelFilter === "linkedin") return t === "LinkedIn";
        return true;
      });
    }
    return rows;
  }, [communications, cutoff, channelFilter]);

  // Previous-period comparison set (same window length immediately before)
  const prevPeriodComms = useMemo(() => {
    if (!cutoff) return [];
    const days = parseInt(dateRange, 10);
    const prevStart = subDays(cutoff, days);
    return (communications as any[]).filter(c => {
      if (!c.communication_date) return false;
      const d = new Date(c.communication_date);
      return isAfter(d, prevStart) && !isAfter(d, cutoff);
    });
  }, [communications, cutoff, dateRange]);

  // ───── Email metrics (corrected logic) ─────
  const emailStats = useMemo(() => {
    const allEmails = filteredComms.filter(c => c.communication_type === "Email");
    const provider = allEmails.filter(isProviderSent);
    const manual = allEmails.filter(c => c.sent_via === "manual" || !c.sent_via);
    const inbound = allEmails.filter(isInbound);

    const sent = provider.length;
    const bounced = provider.filter(isBounce).length;
    const delivered = Math.max(0, sent - bounced);

    // True opens & replies via email_history when available, fallback to comms
    const ehInWindow = (emailHistory as any[]).filter(e => {
      if (!cutoff) return true;
      return e.sent_at && isAfter(new Date(e.sent_at), cutoff);
    });
    const openedFromHistory = ehInWindow.filter(e => e.opened_at || (e.unique_opens ?? 0) > 0).length;
    const openedFromComms = provider.filter(p => p.opened_at || (p.open_count ?? 0) > 0).length;
    const opened = Math.max(openedFromHistory, openedFromComms);
    const repliedFromHistory = ehInWindow.reduce((s, e) => s + (e.reply_count || 0), 0);

    // Distinct conversations with inbound rows = replies (fallback)
    const repliedConvIds = new Set(inbound.map(c => c.conversation_id).filter(Boolean));
    const repliedFromComms = repliedConvIds.size || provider.filter(p => p.email_status === "Replied").length;

    const replied = Math.max(repliedFromHistory, repliedFromComms);

    return {
      sent, delivered, bounced, opened, replied,
      manualLogged: manual.length,
      inboundCount: inbound.length,
      totalLogged: sent + manual.length,
    };
  }, [filteredComms, emailHistory, cutoff]);

  const callStats = useMemo(() => {
    const calls = filteredComms.filter(c => c.communication_type === "Call" || c.communication_type === "Phone");
    const interested = calls.filter(c => c.call_outcome === "Interested").length;
    return { total: calls.length, interested, rate: pct(interested, calls.length) };
  }, [filteredComms]);

  const linkedInStats = useMemo(() => {
    const li = filteredComms.filter(c => c.communication_type === "LinkedIn");
    const responded = li.filter(c => c.linkedin_status === "Responded").length;
    return { total: li.length, responded, rate: pct(responded, li.length) };
  }, [filteredComms]);

  const responded = contacts.filter(c => c.stage === "Responded" || c.stage === "Qualified" || c.stage === "Converted");
  const dealsWon = deals.filter(d => d.stage === "Won");
  const totalDealValue = deals.reduce((s, d) => s + (Number(d.total_contract_value) || 0), 0);

  // ───── Hero KPIs with previous-period delta ─────
  const heroKpis = useMemo(() => {
    const prevSent = prevPeriodComms.filter(isProviderSent).length;
    const prevReplies = prevPeriodComms.filter(isInbound).length;

    return [
      { label: "Reach (Contacts)", value: contacts.length, icon: Users, accent: "primary" as const,
        sublabel: `${accounts.length} accounts` },
      { label: "Emails Sent", value: emailStats.sent, icon: Send, accent: "primary" as const,
        sublabel: emailStats.manualLogged > 0 ? `+${emailStats.manualLogged} manual logs` : undefined,
        delta: dateRange !== "all" ? trendDelta(emailStats.sent, prevSent) : undefined },
      { label: "Reply Rate", value: `${pct(emailStats.replied, emailStats.sent)}%`, icon: Reply, accent: "success" as const,
        sublabel: `${emailStats.replied}/${emailStats.sent} replied`,
        delta: dateRange !== "all" ? trendDelta(emailStats.replied, prevReplies) : undefined },
      { label: "Deals Won", value: dealsWon.length, icon: Trophy, accent: "call" as const,
        sublabel: `of ${deals.length} created` },
      { label: "Pipeline Value", value: `€${totalDealValue.toLocaleString()}`, icon: DollarSign, accent: "linkedin" as const,
        sublabel: `${deals.length} deal${deals.length === 1 ? "" : "s"}` },
    ];
  }, [contacts.length, accounts.length, emailStats, dealsWon.length, deals.length, totalDealValue, prevPeriodComms, dateRange]);

  // ───── Funnel (guarded monotonic non-increasing) ─────
  const funnel = useMemo(() => {
    const targeted = contacts.length;
    const contacted = contacts.filter(c => c.stage !== "Not Contacted").length;
    const respondedC = responded.length;
    const qualified = contacts.filter(c => c.stage === "Qualified" || c.stage === "Converted").length;
    const created = deals.length;
    const won = dealsWon.length;
    const raw = [
      { label: "Targeted", value: targeted, icon: Target },
      { label: "Contacted", value: contacted, icon: Send },
      { label: "Responded", value: respondedC, icon: Reply },
      { label: "Qualified", value: qualified, icon: TrendingUp },
      { label: "Deal Created", value: Math.min(created, qualified || created), icon: BarChart3 },
      { label: "Won", value: won, icon: Trophy },
    ];
    // Guard non-increasing
    for (let i = 1; i < raw.length; i++) {
      raw[i].value = Math.min(raw[i].value, raw[i - 1].value);
    }
    return raw;
  }, [contacts, responded.length, deals.length, dealsWon.length]);

  // ───── Channel mix donut ─────
  const channelData = useMemo(() => {
    const data = [
      { name: "Email",    value: filteredComms.filter(c => c.communication_type === "Email").length,    fill: CHART.primary },
      { name: "Call",     value: callStats.total,    fill: CHART.call },
      { name: "LinkedIn", value: linkedInStats.total, fill: CHART.linkedin },
    ].filter(d => d.value > 0);
    return data;
  }, [filteredComms, callStats.total, linkedInStats.total]);

  // ───── Timeline (stacked area) ─────
  const timelineData = useMemo(() => {
    if (filteredComms.length === 0) return [];
    const map: Record<string, { week: string; ts: number; Email: number; Call: number; LinkedIn: number }> = {};
    filteredComms.forEach((c: any) => {
      if (!c.communication_date) return;
      const d = new Date(c.communication_date);
      const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());
      const ts = startOfDay(ws).getTime();
      const key = format(ws, "dd MMM");
      if (!map[key]) map[key] = { week: key, ts, Email: 0, Call: 0, LinkedIn: 0 };
      const t = c.communication_type === "Phone" ? "Call" : c.communication_type as "Email" | "Call" | "LinkedIn";
      if (map[key][t] !== undefined) map[key][t]++;
    });
    return Object.values(map).sort((a, b) => a.ts - b.ts);
  }, [filteredComms]);

  // ───── Response heatmap (day × time-bucket) ─────
  const heatmap = useMemo(() => {
    const responseRows = filteredComms.filter((c: any) =>
      c.communication_date && (
        c.email_status === "Replied" ||
        c.call_outcome === "Interested" ||
        c.linkedin_status === "Responded" ||
        isInbound(c)
      )
    );
    const grid: number[][] = DAY_NAMES.map(() => TIME_BUCKETS.map(() => 0));
    let total = 0;
    responseRows.forEach((c: any) => {
      const d = new Date(c.communication_date);
      const dow = (d.getDay() + 6) % 7; // Mon=0
      const h = d.getHours();
      const bIdx = TIME_BUCKETS.findIndex(b => h >= b.range[0] && h < b.range[1]);
      if (bIdx >= 0) { grid[dow][bIdx]++; total++; }
    });
    let max = 0;
    grid.forEach(r => r.forEach(v => { if (v > max) max = v; }));
    return { grid, max, total };
  }, [filteredComms]);

  // ───── Day-bar fallback when heatmap data sparse ─────
  const dayBars = useMemo(() => {
    return DAY_NAMES.map((d, i) => ({
      day: d,
      responses: heatmap.grid[i].reduce((s, v) => s + v, 0),
    }));
  }, [heatmap]);

  // ───── Breakdowns ─────
  const breakdownByRegion = useMemo(() => {
    const map: Record<string, { name: string; contacts: number; replies: number }> = {};
    contacts.forEach(c => {
      const region = c.accounts?.region || c.contacts?.region || "Unknown";
      if (!map[region]) map[region] = { name: region, contacts: 0, replies: 0 };
      map[region].contacts++;
      if (c.stage === "Responded" || c.stage === "Qualified" || c.stage === "Converted") map[region].replies++;
    });
    return Object.values(map).sort((a, b) => b.contacts - a.contacts).slice(0, 8);
  }, [contacts]);

  const breakdownByIndustry = useMemo(() => {
    const map: Record<string, { name: string; contacts: number; replies: number }> = {};
    contacts.forEach(c => {
      const ind = c.accounts?.industry || "Unknown";
      if (!map[ind]) map[ind] = { name: ind, contacts: 0, replies: 0 };
      map[ind].contacts++;
      if (c.stage === "Responded" || c.stage === "Qualified" || c.stage === "Converted") map[ind].replies++;
    });
    return Object.values(map).sort((a, b) => b.contacts - a.contacts).slice(0, 8);
  }, [contacts]);

  const breakdownByAccount = useMemo(() => {
    const map: Record<string, { name: string; touches: number; replies: number }> = {};
    filteredComms.forEach((c: any) => {
      const name = c.accounts?.account_name || "Unknown";
      if (!map[name]) map[name] = { name, touches: 0, replies: 0 };
      map[name].touches++;
      if (isInbound(c) || c.email_status === "Replied" || c.call_outcome === "Interested" || c.linkedin_status === "Responded") {
        map[name].replies++;
      }
    });
    return Object.values(map).sort((a, b) => b.replies - a.replies || b.touches - a.touches).slice(0, 5);
  }, [filteredComms]);

  // ───── Export ─────
  const handleExport = useCallback((kind: "csv" | "json") => {
    const payload = {
      exported_at: new Date().toISOString(),
      campaign_id: campaignId,
      filters: { date_range: dateRange, channel: channelFilter },
      hero: heroKpis.map(k => ({ label: k.label, value: k.value, sublabel: k.sublabel })),
      email: emailStats,
      calls: callStats,
      linkedin: linkedInStats,
      funnel,
      channels: channelData,
      timeline: timelineData,
      breakdowns: {
        region: breakdownByRegion,
        industry: breakdownByIndustry,
        top_accounts: breakdownByAccount,
      },
    };
    const ts = format(new Date(), "yyyy-MM-dd");
    if (kind === "json") {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `campaign-analytics-${ts}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      return;
    }
    // CSV
    const rows: string[][] = [];
    rows.push(["Campaign Analytics Export"]);
    rows.push(["Date Range", dateRange === "all" ? "All time" : `Last ${dateRange} days`]);
    rows.push(["Channel Filter", channelFilter]);
    rows.push([]);
    rows.push(["KPI", "Value", "Sublabel"]);
    heroKpis.forEach(k => rows.push([k.label, String(k.value), k.sublabel || ""]));
    rows.push([]);
    rows.push(["Funnel Stage", "Count"]);
    funnel.forEach(f => rows.push([f.label, String(f.value)]));
    rows.push([]);
    rows.push(["Email Metric", "Count"]);
    Object.entries(emailStats).forEach(([k, v]) => rows.push([k, String(v)]));
    rows.push([]);
    rows.push(["Region", "Contacts", "Replies"]);
    breakdownByRegion.forEach(r => rows.push([r.name, String(r.contacts), String(r.replies)]));
    rows.push([]);
    rows.push(["Industry", "Contacts", "Replies"]);
    breakdownByIndustry.forEach(r => rows.push([r.name, String(r.contacts), String(r.replies)]));
    rows.push([]);
    rows.push(["Top Accounts", "Touches", "Replies"]);
    breakdownByAccount.forEach(r => rows.push([r.name, String(r.touches), String(r.replies)]));

    const csv = rows.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `campaign-analytics-${ts}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [campaignId, dateRange, channelFilter, heroKpis, emailStats, callStats, linkedInStats, funnel, channelData, timelineData, breakdownByRegion, breakdownByIndustry, breakdownByAccount]);

  // ────────────────────────── Render ──────────────────────────
  return (
    <div className="space-y-4">
      {/* TOOLBAR */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex flex-wrap items-center gap-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <div className="hidden md:inline-flex h-8 items-center rounded-md border bg-muted/40 p-0.5 text-xs">
            {(["all", "email", "call", "linkedin"] as ChannelFilter[]).map(c => (
              <button
                key={c}
                onClick={() => setChannelFilter(c)}
                className={`px-2.5 h-7 rounded-sm capitalize transition-colors ${channelFilter === c ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {c === "all" ? "All channels" : c}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8"><Download className="h-3.5 w-3.5 mr-1" /> Export</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("csv")}>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("json")}>Export as JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" className="h-8" onClick={handleRefresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* ZONE A — Hero KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {heroKpis.map(k => (
          <HeroKpiTile key={k.label} {...k} />
        ))}
      </div>

      {/* ZONE B — Funnel + Channel Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border-border/60 shadow-sm lg:col-span-2">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Conversion Funnel
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {funnel[0].value === 0 ? (
              <EmptyHint icon={Users} message="Add contacts to this campaign to see the funnel" />
            ) : (
              <div className="space-y-3">
                {funnel.map((stage, i) => {
                  const max = funnel[0].value || 1;
                  const widthPct = pct(stage.value, max);
                  const prev = i > 0 ? funnel[i - 1].value : stage.value;
                  const conv = pct(stage.value, prev);
                  const Icon = stage.icon;
                  return (
                    <div key={stage.label}>
                      <div className="flex items-center gap-3">
                        <div className="w-32 text-xs text-muted-foreground flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5" /> {stage.label}
                        </div>
                        <div className="flex-1 bg-muted rounded-md h-7 overflow-hidden relative">
                          <div
                            className="h-full rounded-md flex items-center justify-end pr-2 transition-all"
                            style={{
                              width: `${stage.value === 0 ? 0 : Math.max(widthPct, 4)}%`,
                              background: `linear-gradient(90deg, ${CHART.primary}, ${CHART.primary} ${100 - i * 12}%, hsl(var(--primary) / 0.6))`,
                            }}
                          >
                            <span className="text-xs font-semibold text-primary-foreground tabular-nums">{stage.value}</span>
                          </div>
                        </div>
                        <div className="w-12 text-xs text-muted-foreground tabular-nums text-right">{widthPct}%</div>
                      </div>
                      {i > 0 && (
                        <div className="ml-32 pl-3 mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <ArrowRight className="h-2.5 w-2.5" />
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                            {conv}% step conversion
                          </Badge>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" /> Channel Mix
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {channelData.length === 0 ? (
              <EmptyHint icon={MessageSquare} message="No outreach yet" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={channelData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" stroke="none">
                      {channelData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <RechartsTooltip
                      formatter={(v: number, n: string) => [`${v} messages`, n]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {channelData.map(c => {
                    const total = channelData.reduce((s, x) => s + x.value, 0);
                    return (
                      <div key={c.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm" style={{ background: c.fill }} />
                          <span className="text-muted-foreground">{c.name}</span>
                        </div>
                        <span className="tabular-nums font-medium">{c.value} <span className="text-muted-foreground">({pct(c.value, total)}%)</span></span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ZONE C — Email Performance */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" /> Email Performance
            {emailStats.manualLogged > 0 && (
              <Badge variant="outline" className="ml-2 h-5 text-[10px] font-normal">
                +{emailStats.manualLogged} manual log{emailStats.manualLogged === 1 ? "" : "s"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {emailStats.sent === 0 && emailStats.manualLogged === 0 ? (
            <EmptyHint icon={Mail} message="No emails sent yet" />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: "Sent",      value: emailStats.sent,      color: CHART.primary, icon: Send },
                  { label: "Delivered", value: emailStats.delivered, color: CHART.success, icon: Inbox },
                  { label: "Opened",    value: emailStats.opened,    color: CHART.opened,  icon: Eye },
                  { label: "Replied",   value: emailStats.replied,   color: CHART.linkedin, icon: Reply },
                  { label: "Bounced",   value: emailStats.bounced,   color: CHART.failed,  icon: AlertTriangle },
                ].map(s => (
                  <div key={s.label} className="rounded-md border border-border/60 p-3 bg-card">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[11px] font-medium">{s.label}</span>
                      <s.icon className="h-3.5 w-3.5" style={{ color: s.color }} />
                    </div>
                    <div className="text-2xl font-bold tabular-nums mt-1" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-2">
                <RateRow label="Delivery Rate" num={emailStats.delivered} den={emailStats.sent} color={CHART.success}
                  hint="Delivered ÷ Sent. Sent excludes inbound replies and manual logs." />
                <RateRow label="Open Rate" num={emailStats.opened} den={emailStats.delivered} color={CHART.opened}
                  hint="Unique opens ÷ Delivered, sourced from email_history." />
                <RateRow label="Reply Rate" num={emailStats.replied} den={emailStats.sent} color={CHART.linkedin}
                  hint="Distinct conversations with at least one inbound message ÷ Sent." />
                <RateRow label="Bounce Rate" num={emailStats.bounced} den={emailStats.sent} color={CHART.failed}
                  hint="Bounces include delivery_status='failed' and email_status in (Bounced, Failed)." />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ZONE D — Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Outreach Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {timelineData.length === 0 ? (
              <EmptyHint icon={BarChart3} message="Activity will appear here over time" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timelineData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                  <Area type="monotone" dataKey="Email" stackId="1" stroke={CHART.primary} fill={CHART.primary} fillOpacity={0.35} strokeWidth={2} />
                  <Area type="monotone" dataKey="Call" stackId="1" stroke={CHART.call} fill={CHART.call} fillOpacity={0.35} strokeWidth={2} />
                  <Area type="monotone" dataKey="LinkedIn" stackId="1" stroke={CHART.linkedin} fill={CHART.linkedin} fillOpacity={0.35} strokeWidth={2} />
                  <Legend iconSize={8} formatter={(v: string) => <span className="text-xs text-muted-foreground">{v}</span>} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Response Heatmap
              <span className="text-[10px] text-muted-foreground font-normal">{heatmap.total} responses</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            {heatmap.total === 0 ? (
              <EmptyHint icon={Clock} message="Responses will appear here grouped by day & time" />
            ) : heatmap.total < 5 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dayBars} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <RechartsTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--background))" }} />
                  <Bar dataKey="responses" fill={CHART.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div>
                <div className="grid gap-1" style={{ gridTemplateColumns: `60px repeat(${TIME_BUCKETS.length}, minmax(0, 1fr))` }}>
                  <div></div>
                  {TIME_BUCKETS.map(b => (
                    <div key={b.label} className="text-[10px] text-muted-foreground text-center font-medium">{b.label}</div>
                  ))}
                  {DAY_NAMES.map((day, dIdx) => (
                    <div key={`row-${day}`} className="contents">
                      <div className="text-[10px] text-muted-foreground flex items-center font-medium">{day}</div>
                      {TIME_BUCKETS.map((_, bIdx) => {
                        const v = heatmap.grid[dIdx][bIdx];
                        const intensity = heatmap.max > 0 ? v / heatmap.max : 0;
                        return (
                          <TooltipProvider key={`${day}-${bIdx}`} delayDuration={120}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="aspect-square rounded-md border border-border/30 flex items-center justify-center text-[10px] font-medium tabular-nums transition-colors cursor-default"
                                  style={{
                                    background: v === 0 ? "hsl(var(--muted) / 0.4)" : `hsl(var(--primary) / ${0.15 + intensity * 0.75})`,
                                    color: intensity > 0.55 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                                  }}
                                >
                                  {v > 0 ? v : ""}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">{day} {TIME_BUCKETS[bIdx].label}: {v} response{v === 1 ? "" : "s"}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1 mt-3 text-[10px] text-muted-foreground">
                  Less
                  {[0.2, 0.4, 0.6, 0.8, 1].map(o => (
                    <div key={o} className="w-3 h-3 rounded-sm border border-border/30" style={{ background: `hsl(var(--primary) / ${o})` }} />
                  ))}
                  More
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ZONE E — Breakdowns */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium">Breakdowns</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <Tabs defaultValue="region">
            <TabsList className="h-8">
              <TabsTrigger value="region" className="h-7 text-xs">By Region</TabsTrigger>
              <TabsTrigger value="industry" className="h-7 text-xs">By Industry</TabsTrigger>
              <TabsTrigger value="accounts" className="h-7 text-xs">Top Accounts</TabsTrigger>
            </TabsList>
            <TabsContent value="region" className="mt-3">
              <BreakdownTable rows={breakdownByRegion.map(r => ({ name: r.name, primary: r.contacts, secondary: r.replies }))}
                primaryLabel="Contacts" secondaryLabel="Replies" emptyHint="No region data on linked accounts" />
            </TabsContent>
            <TabsContent value="industry" className="mt-3">
              <BreakdownTable rows={breakdownByIndustry.map(r => ({ name: r.name, primary: r.contacts, secondary: r.replies }))}
                primaryLabel="Contacts" secondaryLabel="Replies" emptyHint="No industry data on linked accounts" />
            </TabsContent>
            <TabsContent value="accounts" className="mt-3">
              <BreakdownTable rows={breakdownByAccount.map(r => ({ name: r.name, primary: r.touches, secondary: r.replies }))}
                primaryLabel="Touchpoints" secondaryLabel="Replies" emptyHint="No outreach yet" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function BreakdownTable({ rows, primaryLabel, secondaryLabel, emptyHint }: {
  rows: { name: string; primary: number; secondary: number }[];
  primaryLabel: string;
  secondaryLabel: string;
  emptyHint: string;
}) {
  if (rows.length === 0) return <EmptyHint icon={Filter} message={emptyHint} />;
  const max = Math.max(...rows.map(r => r.primary), 1);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium px-1">
        <div className="col-span-5">Name</div>
        <div className="col-span-5">{primaryLabel}</div>
        <div className="col-span-2 text-right">{secondaryLabel}</div>
      </div>
      {rows.map(r => (
        <div key={r.name} className="grid grid-cols-12 gap-2 items-center text-xs px-1">
          <div className="col-span-5 truncate font-medium" title={r.name}>{r.name}</div>
          <div className="col-span-5 flex items-center gap-2">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct(r.primary, max)}%`, background: CHART.primary }} />
            </div>
            <span className="tabular-nums w-8 text-right">{r.primary}</span>
          </div>
          <div className="col-span-2 text-right tabular-nums text-muted-foreground">{r.secondary}</div>
        </div>
      ))}
    </div>
  );
}
