import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  lastSyncedAt: Date | null;
  isSyncing: boolean;
  hasError?: boolean;
  onRetry?: () => void;
  className?: string;
}

/**
 * Shared real-time sync status pill.
 * - Syncing… (spinner, muted)
 * - Updated Xs ago (green dot)
 * - Out of sync — Retry (amber dot)
 */
export function SyncStatusPill({ lastSyncedAt, isSyncing, hasError, onRetry, className }: Props) {
  // tick every 15s so "Updated X ago" stays fresh without re-rendering parents
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  let tone: "syncing" | "ok" | "error" = "ok";
  if (isSyncing) tone = "syncing";
  else if (hasError) tone = "error";

  const dotClass =
    tone === "syncing"
      ? "bg-muted-foreground/40"
      : tone === "error"
      ? "bg-amber-500"
      : "bg-emerald-500";

  const label =
    tone === "syncing"
      ? "Syncing…"
      : tone === "error"
      ? "Out of sync"
      : lastSyncedAt
      ? `Updated ${formatDistanceToNow(lastSyncedAt, { addSuffix: false })} ago`
      : "Up to date";

  const canManualSync = !!onRetry && tone !== "syncing";
  const tooltip =
    tone === "syncing"
      ? "Refreshing data…"
      : tone === "error"
      ? "Last sync failed. Click retry."
      : canManualSync
      ? "Click to re-sync replies"
      : lastSyncedAt
      ? `Last synced ${lastSyncedAt.toLocaleTimeString()}`
      : "No sync recorded yet";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={canManualSync ? onRetry : undefined}
            disabled={!canManualSync}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors",
              canManualSync && "cursor-pointer hover:bg-muted/60 hover:text-foreground",
              tone === "error" && "hover:bg-amber-50 dark:hover:bg-amber-950/30",
              className
            )}
          >
            {tone === "syncing" ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : tone === "error" ? (
              <AlertTriangle className="h-3 w-3 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            )}
            <span className="tabular-nums">{label}</span>
            {canManualSync && tone !== "error" && <RefreshCw className="h-3 w-3 opacity-70" />}
            {tone === "error" && <span className="ml-0.5 underline">Retry</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
