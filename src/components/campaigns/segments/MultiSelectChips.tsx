import { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type ColorTone = "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet";

const TONE_CLASSES: Record<ColorTone, string> = {
  indigo: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20",
  rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/20",
  sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30 hover:bg-sky-500/20",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30 hover:bg-violet-500/20",
};

interface Props {
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  tone?: ColorTone;
  allowCustom?: boolean;
  /** Maximum number of selected chips to render in the trigger; rest collapse into "+N more". */
  maxVisibleChips?: number;
}

/**
 * Compact multi-select with chips.
 * - Trigger has a fixed compact height; selections beyond `maxVisibleChips`
 *   collapse into a "+N more" pill so the filter row never grows tall.
 * - Popover offers Select all (filtered) and Clear actions.
 */
export function MultiSelectChips({
  label,
  values,
  options,
  onChange,
  placeholder = "Select...",
  tone = "indigo",
  allowCustom = false,
  maxVisibleChips = 2,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allOptions = useMemo(() => {
    const set = new Set([...options, ...values]);
    return Array.from(set).sort();
  }, [options, values]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) => o.toLowerCase().includes(q));
  }, [allOptions, search]);

  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };

  const addCustom = () => {
    const v = search.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setSearch("");
  };

  const selectAllFiltered = () => {
    const next = new Set([...values, ...filteredOptions]);
    onChange(Array.from(next));
  };
  const clearAll = () => onChange([]);

  const visibleChips = values.slice(0, maxVisibleChips);
  const overflowCount = Math.max(0, values.length - visibleChips.length);
  const allFilteredSelected =
    filteredOptions.length > 0 && filteredOptions.every((o) => values.includes(o));

  return (
    <div className="min-w-0">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="mt-1 w-full h-8 rounded-md border bg-background px-2 text-left text-xs flex items-center gap-1 overflow-hidden hover:border-primary/40 transition-colors"
          >
            {values.length === 0 ? (
              <span className="text-muted-foreground truncate">{placeholder}</span>
            ) : (
              <>
                <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                  {visibleChips.map((v) => (
                    <Badge
                      key={v}
                      variant="outline"
                      className={cn(
                        "h-5 gap-1 px-1.5 text-[10px] font-medium border max-w-[120px]",
                        TONE_CLASSES[tone],
                      )}
                    >
                      <span className="truncate">{v}</span>
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChange(values.filter((x) => x !== v));
                        }}
                        className="inline-flex items-center"
                      >
                        <X className="h-2.5 w-2.5" />
                      </span>
                    </Badge>
                  ))}
                  {overflowCount > 0 && (
                    <Badge
                      variant="outline"
                      className={cn("h-5 px-1.5 text-[10px] font-medium border shrink-0", TONE_CLASSES[tone])}
                    >
                      +{overflowCount}
                    </Badge>
                  )}
                </div>
                {values.length > 0 && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Clear ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      clearAll();
                    }}
                    className="ml-auto shrink-0 inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </>
            )}
            <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-72 p-0"
          align="start"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${label.toLowerCase()}...`}
              value={search}
              onValueChange={setSearch}
              className="h-8 text-xs"
            />
            <div className="flex items-center justify-between gap-2 px-2 py-1 border-b text-[11px]">
              <span className="text-muted-foreground">
                {values.length} selected · {filteredOptions.length} shown
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={(e) => {
                    e.preventDefault();
                    if (allFilteredSelected) {
                      // Unselect filtered subset
                      onChange(values.filter((v) => !filteredOptions.includes(v)));
                    } else {
                      selectAllFiltered();
                    }
                  }}
                  disabled={filteredOptions.length === 0}
                >
                  {allFilteredSelected ? "Unselect all" : "Select all"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={(e) => {
                    e.preventDefault();
                    clearAll();
                  }}
                  disabled={values.length === 0}
                >
                  Clear
                </Button>
              </div>
            </div>
            <CommandList className="max-h-72 overflow-y-auto overscroll-contain">
              <CommandEmpty>
                {allowCustom && search.trim() ? (
                  <Button size="sm" variant="ghost" onClick={addCustom} className="w-full justify-start text-xs h-7">
                    <Plus className="h-3 w-3 mr-1" /> Add "{search.trim()}"
                  </Button>
                ) : (
                  <span className="text-xs">No results.</span>
                )}
              </CommandEmpty>
              <CommandGroup>
                {filteredOptions.map((o) => {
                  const checked = values.includes(o);
                  return (
                    <CommandItem
                      key={o}
                      onSelect={() => toggle(o)}
                      className="text-xs gap-2 cursor-pointer"
                    >
                      <span
                        className={cn(
                          "h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0",
                          checked ? "bg-primary border-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{o}</span>
                    </CommandItem>
                  );
                })}
                {allowCustom &&
                  search.trim() &&
                  !filteredOptions.some((o) => o.toLowerCase() === search.trim().toLowerCase()) && (
                    <CommandItem onSelect={addCustom} className="text-xs gap-2 cursor-pointer text-primary">
                      <Plus className="h-3 w-3" /> Add "{search.trim()}"
                    </CommandItem>
                  )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
