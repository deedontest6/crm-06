import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Trash2, Plus, Users, Filter, Ban, Combine, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { MultiSelectChips } from "./segments/MultiSelectChips";
import { useAudienceOptions } from "./segments/useAudienceOptions";

interface Props {
  campaignId: string;
  /** When true (default), the component renders its own bordered card chrome.
   *  When false (sub-tab embed), the outer card/header are stripped and the
   *  body becomes a borderless section. */
  withChrome?: boolean;
}

type Filters = {
  industries: string[];
  regions: string[];
  countries: string[];
  positions: string[];
  excludes?: {
    industries?: string[];
    regions?: string[];
    countries?: string[];
  };
  combine_segment_ids?: string[];
};

const emptyFilters: Filters = {
  industries: [], regions: [], countries: [], positions: [],
  excludes: { industries: [], regions: [], countries: [] },
  combine_segment_ids: [],
};

export function SegmentManager({ campaignId, withChrome = true }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showExcludes, setShowExcludes] = useState(false);
  const [showCombine, setShowCombine] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);

  const opts = useAudienceOptions(filters.regions);

  const { data: segments = [] } = useQuery({
    queryKey: ["campaign-segments", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_audience_segments")
        .select("id, segment_name, filters, created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const reset = () => {
    setName("");
    setFilters(emptyFilters);
    setShowExcludes(false);
    setShowCombine(false);
    setShowBuilder(false);
  };

  const createSeg = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!name.trim()) throw new Error("Segment name required");
      const cleanFilters: Filters = { ...filters };
      const ex = cleanFilters.excludes || {};
      const exClean: Filters["excludes"] = {};
      if (ex.industries?.length) exClean.industries = ex.industries;
      if (ex.regions?.length) exClean.regions = ex.regions;
      if (ex.countries?.length) exClean.countries = ex.countries;
      if (Object.keys(exClean).length === 0) delete cleanFilters.excludes;
      else cleanFilters.excludes = exClean;
      if (!cleanFilters.combine_segment_ids?.length) delete cleanFilters.combine_segment_ids;

      const { error } = await supabase.from("campaign_audience_segments").insert({
        campaign_id: campaignId,
        segment_name: name.trim(),
        filters: cleanFilters as any,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-segments", campaignId] });
      toast({ title: "Segment saved" });
      reset();
    },
    onError: (e: any) =>
      toast({ title: "Failed to save segment", description: e.message, variant: "destructive" }),
  });

  const deleteSeg = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaign_audience_segments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-segments", campaignId] });
      toast({ title: "Segment deleted" });
    },
  });

  const summarize = (f: any) => {
    const parts: string[] = [];
    if (f?.industries?.length) parts.push(`${f.industries.length} industry`);
    if (f?.regions?.length) parts.push(`${f.regions.length} region`);
    if (f?.countries?.length) parts.push(`${f.countries.length} country`);
    if (f?.positions?.length) parts.push(`${f.positions.length} position`);
    const ex = f?.excludes || {};
    const exCount = (ex.industries?.length || 0) + (ex.regions?.length || 0) + (ex.countries?.length || 0);
    if (exCount > 0) parts.push(`excludes ${exCount}`);
    if (f?.combine_segment_ids?.length) parts.push(`AND ${f.combine_segment_ids.length} segment${f.combine_segment_ids.length > 1 ? "s" : ""}`);
    return parts.length ? parts.join(" · ") : "No filters";
  };

  const setExclude = (key: "industries" | "regions" | "countries", v: string[]) =>
    setFilters((f) => ({ ...f, excludes: { ...(f.excludes || {}), [key]: v } }));

  const toggleCombine = (id: string) => {
    const cur = filters.combine_segment_ids || [];
    setFilters((f) => ({
      ...f,
      combine_segment_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    }));
  };

  const hasAnyFilter =
    filters.industries.length > 0 ||
    filters.regions.length > 0 ||
    filters.countries.length > 0 ||
    filters.positions.length > 0 ||
    (filters.excludes?.industries?.length || 0) > 0 ||
    (filters.excludes?.regions?.length || 0) > 0 ||
    (filters.excludes?.countries?.length || 0) > 0;

  const headerChrome = (
    <div className={`flex items-center gap-2 ${withChrome ? "px-3 py-2" : "py-1"}`}>
      {withChrome && <Users className="h-3.5 w-3.5 text-primary" />}
      {withChrome && (
        <span className="text-xs font-semibold uppercase tracking-wide">Audience segments</span>
      )}
      {withChrome && segments.length > 0 && (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{segments.length}</Badge>
      )}
      <Button
        size="sm"
        variant={showBuilder ? "secondary" : "ghost"}
        className={`${withChrome ? "ml-auto" : ""} h-7 text-xs gap-1`}
        onClick={() => setShowBuilder((s) => !s)}
      >
        {showBuilder ? (
          <>Hide builder <ChevronDown className="h-3 w-3 rotate-180" /></>
        ) : (
          <><Plus className="h-3 w-3" /> Add segment</>
        )}
      </Button>
    </div>
  );

  const wrapperClass = withChrome ? "rounded-md border bg-card" : "";
  const segListClass = withChrome ? "px-3 pb-2 space-y-1.5 border-t pt-2" : "space-y-1.5 pt-2";
  const builderInnerClass = withChrome ? "p-3 space-y-3 border-t" : "py-3 space-y-3";

  return (
    <div className={wrapperClass}>
      {headerChrome}

      {segments.length > 0 && (
        <div className={segListClass}>
          {segments.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between border rounded-md px-2 py-1.5 text-sm bg-muted/30">
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate text-[13px]">{s.segment_name}</span>
                <span className="text-[11px] text-muted-foreground truncate">{summarize(s.filters)}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => deleteSeg.mutate(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Collapsible open={showBuilder} onOpenChange={setShowBuilder}>
        <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
          <div className={builderInnerClass}>
            {segments.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Reusable audience slices (e.g. "EU Decision Makers in Auto") for targeted steps. Combine with AND, or exclude rows that match other criteria.
              </p>
            )}

            <div className="max-w-sm">
              <Label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Segment name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. EU Auto Decision Makers"
                className="h-8 text-sm mt-1"
              />
            </div>

            {/* Include rules */}
            <div className="rounded-md border p-2.5 space-y-2 bg-primary/[0.02]">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Filter className="h-3.5 w-3.5 text-primary" /> Include rules
                <span className="text-muted-foreground font-normal text-[11px]">— contact must match all</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <MultiSelectChips
                  label="Industries"
                  values={filters.industries}
                  options={opts.industries}
                  onChange={(v) => setFilters((f) => ({ ...f, industries: v }))}
                  placeholder="Any industry"
                  tone="indigo"
                />
                <MultiSelectChips
                  label="Regions"
                  values={filters.regions}
                  options={opts.regions}
                  onChange={(v) => setFilters((f) => ({ ...f, regions: v }))}
                  placeholder="Any region"
                  tone="emerald"
                />
                <MultiSelectChips
                  label="Countries"
                  values={filters.countries}
                  options={opts.countries}
                  onChange={(v) => setFilters((f) => ({ ...f, countries: v }))}
                  placeholder={filters.regions.length ? "From selected regions" : "Any country"}
                  tone="amber"
                />
                <MultiSelectChips
                  label="Positions"
                  values={filters.positions}
                  options={opts.positions}
                  onChange={(v) => setFilters((f) => ({ ...f, positions: v }))}
                  placeholder="Any position"
                  tone="rose"
                  allowCustom
                />
              </div>
            </div>

            {/* Exclude rules */}
            <div className="rounded-md border p-2.5 space-y-2 bg-destructive/[0.02]">
              <button
                type="button"
                onClick={() => setShowExcludes((s) => !s)}
                className="flex items-center gap-1.5 text-xs font-medium w-full text-left"
              >
                <Ban className="h-3.5 w-3.5 text-destructive" />
                Exclude rules <ChevronDown className={`h-3 w-3 transition-transform ${showExcludes ? "rotate-180" : ""}`} />
                <span className="text-muted-foreground font-normal">— remove contacts matching any of these</span>
              </button>
              {showExcludes && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                  <MultiSelectChips
                    label="Exclude industries"
                    values={filters.excludes?.industries || []}
                    options={opts.industries}
                    onChange={(v) => setExclude("industries", v)}
                    placeholder="None"
                    tone="rose"
                  />
                  <MultiSelectChips
                    label="Exclude regions"
                    values={filters.excludes?.regions || []}
                    options={opts.regions}
                    onChange={(v) => setExclude("regions", v)}
                    placeholder="None"
                    tone="rose"
                  />
                  <MultiSelectChips
                    label="Exclude countries"
                    values={filters.excludes?.countries || []}
                    options={opts.countries}
                    onChange={(v) => setExclude("countries", v)}
                    placeholder="None"
                    tone="rose"
                  />
                </div>
              )}
            </div>

            {/* Combine with other segments */}
            {segments.length > 0 && (
              <div className="rounded-md border p-2.5 space-y-2 bg-violet-500/[0.04]">
                <button
                  type="button"
                  onClick={() => setShowCombine((s) => !s)}
                  className="flex items-center gap-1.5 text-xs font-medium w-full text-left"
                >
                  <Combine className="h-3.5 w-3.5 text-violet-500" />
                  Combine with other segments (AND) <ChevronDown className={`h-3 w-3 transition-transform ${showCombine ? "rotate-180" : ""}`} />
                  <span className="text-muted-foreground font-normal">— must also match every selected segment</span>
                </button>
                {showCombine && (
                  <div className="space-y-1 pt-1">
                    {segments.map((s: any) => {
                      const checked = (filters.combine_segment_ids || []).includes(s.id);
                      return (
                        <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                          <Checkbox checked={checked} onCheckedChange={() => toggleCombine(s.id)} />
                          <span className="font-medium">{s.segment_name}</span>
                          <span className="text-muted-foreground truncate">— {summarize(s.filters)}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={reset}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => createSeg.mutate()}
                disabled={createSeg.isPending || !name.trim() || !hasAnyFilter}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Save segment
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
