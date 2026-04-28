import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, Phone, MessageSquare, RotateCcw } from "lucide-react";
import type { Channel } from "./channelVisibility";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  enabledChannels?: Channel[];
}

type GroupKey = "emails" | "scripts" | "linkedin";

type Group = {
  key: GroupKey;
  title: string;
  icon: typeof Mail;
  channel: Channel;
  items: { id: string; label: string }[];
};

const ACTION_ITEMS = [
  { id: "edit_open", label: "Edit opens modal with prefilled fields" },
  { id: "edit_save", label: "Save updates the row and shows success toast" },
  { id: "copy", label: "Copy puts content on clipboard with success toast" },
  { id: "duplicate", label: "Duplicate creates a new “(Copy)” row" },
  { id: "delete", label: "Delete removes the row after confirm" },
];

const GROUPS: Group[] = [
  {
    key: "emails",
    title: "Email templates",
    icon: Mail,
    channel: "Email",
    items: ACTION_ITEMS.map((i) => ({ id: `emails:${i.id}`, label: i.label })),
  },
  {
    key: "scripts",
    title: "Phone scripts",
    icon: Phone,
    channel: "Phone",
    items: ACTION_ITEMS.map((i) => ({ id: `scripts:${i.id}`, label: i.label })),
  },
  {
    key: "linkedin",
    title: "LinkedIn templates",
    icon: MessageSquare,
    channel: "LinkedIn",
    items: ACTION_ITEMS.map((i) => ({ id: `linkedin:${i.id}`, label: i.label })),
  },
];

export function MessageQAChecklist({ open, onOpenChange, campaignId, enabledChannels }: Props) {
  const storageKey = `campaign-message-qa:${campaignId}`;
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const visibleGroups = useMemo(() => {
    const allowed = new Set<Channel>(
      enabledChannels && enabledChannels.length > 0 ? enabledChannels : ["Email", "Phone", "LinkedIn"]
    );
    return GROUPS.filter((g) => allowed.has(g.channel));
  }, [enabledChannels]);

  const total = useMemo(
    () => visibleGroups.reduce((n, g) => n + g.items.length, 0),
    [visibleGroups]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setChecked(raw ? JSON.parse(raw) : {});
    } catch {
      setChecked({});
    }
  }, [storageKey, open]);

  const persist = (next: Record<string, boolean>) => {
    setChecked(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
  };

  const toggle = (id: string) => persist({ ...checked, [id]: !checked[id] });
  const reset = () => persist({});

  // Only count verifications for currently visible groups.
  const visibleIds = useMemo(
    () => new Set(visibleGroups.flatMap((g) => g.items.map((i) => i.id))),
    [visibleGroups]
  );
  const verified = Object.entries(checked).filter(([k, v]) => v && visibleIds.has(k)).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>QA checklist — ⋯ menu actions</SheetTitle>
          <SheetDescription>
            Verify Edit, Copy, Duplicate, and Delete on every card type before release.
            Progress is saved to this browser per campaign.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm font-medium">
            {verified} / {total} verified
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>

        <div className="mt-4 space-y-5">
          {visibleGroups.length === 0 ? (
            <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
              No channels are enabled for this campaign. Enable at least one channel in Setup → Strategy to run the QA checklist.
            </div>
          ) : (
            visibleGroups.map((g) => {
              const Icon = g.icon;
              const groupVerified = g.items.filter((i) => checked[i.id]).length;
              return (
                <div key={g.key} className="border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{g.title}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {groupVerified} / {g.items.length}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {g.items.map((item) => (
                      <li key={item.id} className="flex items-start gap-2">
                        <Checkbox
                          id={item.id}
                          checked={!!checked[item.id]}
                          onCheckedChange={() => toggle(item.id)}
                          className="mt-0.5"
                        />
                        <label
                          htmlFor={item.id}
                          className={`text-xs leading-snug cursor-pointer ${
                            checked[item.id] ? "line-through text-muted-foreground" : ""
                          }`}
                        >
                          {item.label}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        <SheetFooter className="mt-4">
          <p className="text-[11px] text-muted-foreground">
            Use this to verify the ⋯ menu actions on Email, Script, and LinkedIn cards
            behave correctly end-to-end.
          </p>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
