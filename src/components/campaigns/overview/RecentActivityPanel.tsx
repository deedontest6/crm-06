import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Inbox,
  Mail,
  Phone,
  Linkedin,
  MessageSquare,
  Clock,
  ArrowRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getEmailThreads } from "../overviewMetrics";

type Filter = "all" | "email" | "call" | "linkedin" | "replied";

interface Item {
  key: string;
  type: "Email" | "Call" | "LinkedIn";
  contactName: string;
  accountName: string;
  subject: string;
  msgCount: number;
  status: "Replied" | "Sent" | "Opened" | "Failed" | "Logged";
  date: string | null;
  threadId?: string;
  contactId?: string | null;
}

interface Props {
  communications: any[];
  /** Channels enabled for the campaign — controls visible chips and item types. */
  enabledChannels?: Array<"Email" | "Phone" | "LinkedIn">;
  onOpenThread: (threadId: string) => void;
  onOpenAll: () => void;
  onOpenCall?: (contactId?: string | null) => void;
  onOpenLinkedIn?: (contactId?: string | null) => void;
}

const initial = (s?: string) =>
  (s || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

const statusClass = (s: Item["status"]) => {
  switch (s) {
    case "Replied":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "Failed":
      return "bg-destructive/15 text-destructive";
    case "Opened":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "Sent":
      return "bg-primary/15 text-primary";
    default:
      return "bg-muted text-muted-foreground";
  }
};

export function RecentActivityPanel({
  communications,
  enabledChannels,
  onOpenThread,
  onOpenAll,
  onOpenCall,
  onOpenLinkedIn,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  // Resolve channel visibility flags. Default to all-enabled for back-compat.
  const showEmail = !enabledChannels || enabledChannels.includes("Email");
  const showCall = !enabledChannels || enabledChannels.includes("Phone");
  const showLinkedIn = !enabledChannels || enabledChannels.includes("LinkedIn");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    // Email threads — only when Email channel is enabled.
    if (showEmail) {
      const threads = getEmailThreads(communications);
      threads.forEach((t) => {
        const last = t.messages[t.messages.length - 1];
        const status: Item["status"] = t.hasReply
          ? "Replied"
          : t.hasFailed
          ? "Failed"
          : t.messages.some((m: any) => m.opened_at)
          ? "Opened"
          : "Sent";
        out.push({
          key: `email-${t.threadId}`,
          type: "Email",
          contactName: last?.contacts?.contact_name || "Unknown",
          accountName: last?.accounts?.account_name || "",
          subject: t.subject || "Email",
          msgCount: t.messages.length,
          status,
          date: t.lastDate,
          threadId: t.threadId,
          contactId: t.contactId,
        });
      });
    }
    // Calls + LinkedIn rows — drop entries whose channel is disabled.
    communications.forEach((c: any) => {
      if (c.communication_type === "Email") return;
      const type =
        c.communication_type === "Phone" ? "Call" : c.communication_type;
      if (type !== "Call" && type !== "LinkedIn") return;
      if (type === "Call" && !showCall) return;
      if (type === "LinkedIn" && !showLinkedIn) return;
      out.push({
        key: `${type}-${c.id}`,
        type: type as "Call" | "LinkedIn",
        contactName: c.contacts?.contact_name || "Unknown",
        accountName: c.accounts?.account_name || "",
        subject:
          c.subject ||
          c.notes ||
          c.call_outcome ||
          c.linkedin_status ||
          `${type} activity`,
        msgCount: 1,
        status: "Logged",
        date: c.communication_date,
        contactId: c.contact_id,
      });
    });
    return out
      .sort(
        (a, b) =>
          new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      )
      .slice(0, 50);
  }, [communications, showEmail, showCall, showLinkedIn]);

  // Reset filter if its channel becomes disabled.
  useEffect(() => {
    if (filter === "email" && !showEmail) setFilter("all");
    else if (filter === "call" && !showCall) setFilter("all");
    else if (filter === "linkedin" && !showLinkedIn) setFilter("all");
  }, [filter, showEmail, showCall, showLinkedIn]);

  const filtered = items.filter((i) => {
    if (filter === "all") return true;
    if (filter === "replied") return i.status === "Replied";
    if (filter === "email") return i.type === "Email";
    if (filter === "call") return i.type === "Call";
    if (filter === "linkedin") return i.type === "LinkedIn";
    return true;
  });

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: items.length },
    showEmail && {
      id: "email" as const,
      label: "Email",
      count: items.filter((i) => i.type === "Email").length,
    },
    showCall && {
      id: "call" as const,
      label: "Calls",
      count: items.filter((i) => i.type === "Call").length,
    },
    showLinkedIn && {
      id: "linkedin" as const,
      label: "LinkedIn",
      count: items.filter((i) => i.type === "LinkedIn").length,
    },
    {
      id: "replied" as const,
      label: "Replied",
      count: items.filter((i) => i.status === "Replied").length,
    },
  ].filter(Boolean) as { id: Filter; label: string; count: number }[];

  return (
    <Card className="flex flex-col h-full w-full">
      <CardContent className="p-3 flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 mb-2">
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Recent Activity
          </h3>
          <button
            onClick={onOpenAll}
            className="ml-auto text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {chips.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                filter === c.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              {c.label} <span className="opacity-70">{c.count}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              No activity yet
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((i) => {
                const Icon =
                  i.type === "Email"
                    ? Mail
                    : i.type === "Call"
                    ? Phone
                    : i.type === "LinkedIn"
                    ? Linkedin
                    : MessageSquare;
                const clickable =
                  (i.type === "Email" && !!i.threadId) ||
                  (i.type === "Call" && !!onOpenCall) ||
                  (i.type === "LinkedIn" && !!onOpenLinkedIn);
                const handleClick = () => {
                  if (i.type === "Email" && i.threadId) onOpenThread(i.threadId);
                  else if (i.type === "Call") onOpenCall?.(i.contactId);
                  else if (i.type === "LinkedIn") onOpenLinkedIn?.(i.contactId);
                };
                return (
                  <li
                    key={i.key}
                    onClick={handleClick}
                    className={`grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-2 px-2 py-1.5 rounded-md text-[11px] ${
                      clickable
                        ? "cursor-pointer hover:bg-muted/60"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0">
                      {initial(i.contactName)}
                    </div>
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {i.contactName}
                        {i.accountName && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            · {i.accountName}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-muted-foreground">
                        {i.subject}
                        {i.msgCount > 1 && (
                          <span className="ml-1 inline-flex items-center px-1 rounded bg-muted text-[9px]">
                            {i.msgCount} msgs
                          </span>
                        )}
                      </p>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${statusClass(
                        i.status
                      )}`}
                    >
                      {i.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                      <Clock className="h-2.5 w-2.5" />
                      {i.date
                        ? formatDistanceToNow(new Date(i.date), {
                            addSuffix: false,
                          })
                        : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
