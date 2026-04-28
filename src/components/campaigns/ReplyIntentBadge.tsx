import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThumbsUp, ThumbsDown, Clock, HelpCircle, Ban, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ReplyIntent =
  | "positive"
  | "negative"
  | "neutral"
  | "question"
  | "out_of_office"
  | "unsubscribe"
  | string
  | null
  | undefined;

const MAP: Record<string, { label: string; icon: LucideIcon; className: string; help: string }> = {
  positive: {
    label: "Positive",
    icon: ThumbsUp,
    className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30",
    help: "Reply expresses interest or agreement.",
  },
  negative: {
    label: "Negative",
    icon: ThumbsDown,
    className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
    help: "Reply expresses disinterest or rejection.",
  },
  neutral: {
    label: "Neutral",
    icon: Sparkles,
    className: "bg-muted text-muted-foreground border-border",
    help: "Reply is informational without strong signal.",
  },
  question: {
    label: "Question",
    icon: HelpCircle,
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
    help: "Reply asks a question — needs response.",
  },
  out_of_office: {
    label: "OOO",
    icon: Clock,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    help: "Out-of-office auto-reply.",
  },
  unsubscribe: {
    label: "Unsubscribe",
    icon: Ban,
    className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
    help: "Recipient asked to be removed.",
  },
};

export function ReplyIntentBadge({ intent }: { intent: ReplyIntent }) {
  if (!intent) return null;
  const cfg = MAP[intent.toLowerCase()] ?? {
    label: intent,
    icon: Sparkles,
    className: "bg-muted text-muted-foreground border-border",
    help: "Classified reply intent.",
  };
  const Icon = cfg.icon;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`gap-1 text-[10px] px-1.5 py-0 h-5 ${cfg.className}`}>
            <Icon className="h-3 w-3" />
            {cfg.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{cfg.help}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
