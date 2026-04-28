import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { useSecurityAudit } from "@/hooks/useSecurityAudit";
import type { Tables } from "@/integrations/supabase/types";

export type Campaign = Tables<"campaigns">;

export interface CampaignFormData {
  campaign_name: string;
  campaign_type: string;
  goal: string;
  owner: string;
  start_date: string;
  end_date: string;
  status: string;
  notes?: string;
  description?: string;
  region?: string;
  country?: string;
  target_audience?: string;
  message_strategy?: string;
  mart_complete?: boolean;
  priority?: string;
  primary_channel?: string;
  enabled_channels?: string[];
  tags?: string[];
}

// Lightweight columns needed for the campaigns list / dashboard.
// Avoid `select(*)` so we don't pull large text columns (notes, description, message_strategy, etc.).
// D5: dropped `region` (large JSON blob, only needed in detail view). `goal` is kept because the list-page search filters on it.
const LIST_COLUMNS =
  "id,campaign_name,campaign_type,status,priority,primary_channel,owner,start_date,end_date,tags,mart_complete,archived_at,created_at,goal,slug";

export interface UseCampaignsOptions {
  /** Set to false on detail pages so we don't fetch the full campaigns list as collateral. */
  enableLists?: boolean;
  /** Only fetch archived campaigns when the user opens the Archived view. */
  includeArchived?: boolean;
}

export function useCampaigns(options: UseCampaignsOptions = {}) {
  const { enableLists = true, includeArchived = false } = options;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { logSecurityEvent } = useSecurityAudit();

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select(LIST_COLUMNS)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Campaign[];
    },
    enabled: !!user && enableLists,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch Strategy status for all campaigns (for list page Strategy column)
  const strategyQuery = useQuery({
    queryKey: ["campaign-mart-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_mart")
        .select("campaign_id,message_done,audience_done,region_done,timing_done");
      if (error) throw error;
      return data;
    },
    enabled: !!user && enableLists,
    staleTime: 2 * 60 * 1000,
  });

  const createCampaign = useMutation({
    mutationFn: async (formData: CampaignFormData) => {
      const newId = crypto.randomUUID();
      const { error } = await supabase
        .from("campaigns")
        .insert({
          id: newId,
          campaign_name: formData.campaign_name,
          campaign_type: formData.campaign_type,
          goal: formData.goal,
          owner: formData.owner,
          start_date: formData.start_date,
          end_date: formData.end_date,
          status: formData.status || "Draft",
          notes: formData.notes || null,
          description: formData.description || null,
          region: formData.region || null,
          country: formData.country || null,
          target_audience: formData.target_audience || null,
          message_strategy: formData.message_strategy || null,
          priority: formData.priority || "Medium",
          primary_channel: formData.primary_channel || null,
          enabled_channels: (formData.enabled_channels && formData.enabled_channels.length > 0)
            ? formData.enabled_channels
            : ["Email", "Phone", "LinkedIn"],
          tags: formData.tags && formData.tags.length > 0 ? formData.tags : null,
          created_by: user!.id,
        } as any);
      if (error) throw error;

      // Auto-create campaign_mart row (Strategy progress tracking).
      // Upsert so a DB trigger that auto-creates this row won't cause a conflict.
      const { error: strategyError } = await supabase
        .from("campaign_mart")
        .upsert({ campaign_id: newId }, { onConflict: "campaign_id" });
      if (strategyError) console.error("Failed to create strategy row:", strategyError);

      // Read back the row with the trigger-generated columns (slug, created_at)
      // so we can surgically prepend it to the cached list (B6 — no full refetch).
      const { data: newRow } = await supabase
        .from("campaigns")
        .select(LIST_COLUMNS)
        .eq("id", newId)
        .maybeSingle();
      return { id: newId, row: newRow as Campaign | null };
    },
    onSuccess: ({ row }) => {
      // B6: surgical insert into the active campaigns list.
      if (row) {
        queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
          prev ? [row, ...prev.filter((c) => c.id !== row.id)] : prev,
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      }
      queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });
      toast({ title: "Campaign created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error creating campaign", description: error.message, variant: "destructive" });
    },
  });

  const updateCampaign = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CampaignFormData> & { id: string }) => {
      // Status changes must go through transition_campaign_status RPC (lifecycle guard).
      // If a caller passes `status` here, route it via the RPC and strip it from the
      // direct update — the trigger on `campaigns` will reject any direct status write.
      const { status: nextStatus, ...rest } = updates as any;

      if (nextStatus !== undefined) {
        const { data: existing } = await supabase
          .from("campaigns").select("status").eq("id", id).maybeSingle();
        if (existing?.status !== nextStatus) {
          const { error: rpcError } = await supabase.rpc("transition_campaign_status", {
            _campaign_id: id, _new_status: nextStatus, _reason: "user-update",
          });
          if (rpcError) throw rpcError;
        }
      }

      const hasOtherUpdates = Object.keys(rest).length > 0;
      if (!hasOtherUpdates) {
        const { data, error } = await supabase
          .from("campaigns").select().eq("id", id).single();
        if (error) throw error;
        return data;
      }

      const { data, error } = await supabase
        .from("campaigns")
        .update({ ...rest, modified_by: user!.id, modified_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // B6: surgically patch the row in cache instead of refetching the whole list.
      queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
        prev ? prev.map((c) => (c.id === data.id ? { ...c, ...data } : c)) : prev,
      );
      queryClient.setQueryData<Campaign[]>(["archived-campaigns"], (prev) =>
        prev ? prev.map((c) => (c.id === data.id ? { ...c, ...data } : c)) : prev,
      );
      queryClient.setQueryData(["campaign", data.id], data);
      queryClient.invalidateQueries({ queryKey: ["campaign-primary-channel", data.id] });
      queryClient.invalidateQueries({ queryKey: ["campaign-meta-table", data.id] });
      toast({ title: "Campaign updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error updating campaign", description: error.message, variant: "destructive" });
    },
  });

  // Dedicated, explicit lifecycle transition. Prefer this from UI dropdowns.
  const transitionStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("transition_campaign_status", {
        _campaign_id: id, _new_status: status, _reason: reason ?? null,
      });
      if (error) throw error;
      return data;
    },
    // B6: optimistic UI — flip the chip instantly so the user sees feedback,
    // then roll back if the RPC rejects the transition.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["campaigns"] });
      await queryClient.cancelQueries({ queryKey: ["campaign", vars.id] });
      const prevList = queryClient.getQueryData<Campaign[]>(["campaigns"]);
      const prevDetail = queryClient.getQueryData<Campaign>(["campaign", vars.id]);
      queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
        prev ? prev.map((c) => (c.id === vars.id ? { ...c, status: vars.status } : c)) : prev,
      );
      queryClient.setQueryData<Campaign | undefined>(["campaign", vars.id], (prev) =>
        prev ? { ...prev, status: vars.status } : prev,
      );
      return { prevList, prevDetail };
    },
    onSuccess: (_d, vars) => {
      // B6: surgical update — patch the row in cache instead of refetching the whole list.
      queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
        prev ? prev.map((c) => (c.id === vars.id ? { ...c, status: vars.status } : c)) : prev,
      );
      queryClient.invalidateQueries({ queryKey: ["campaign", vars.id] });
      queryClient.invalidateQueries({ queryKey: ["campaign-events", vars.id] });
    },
    onError: (error: Error, vars, context) => {
      // Roll back the optimistic flip.
      if (context?.prevList) queryClient.setQueryData(["campaigns"], context.prevList);
      if (context?.prevDetail) queryClient.setQueryData(["campaign", vars.id], context.prevDetail);
      toast({ title: "Cannot change status", description: error.message, variant: "destructive" });
    },
  });

  const deleteCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("delete_campaign_cascade", { _id: id });
      if (error) throw error;
      if (!data) throw new Error("Campaign was not deleted (not found or no permission).");
      return data as string;
    },
    onSuccess: (deletedId: string) => {
      logSecurityEvent('DELETE', 'campaigns', deletedId, { operation: 'PERMANENT_DELETE', status: 'Success' });
      // B6: surgically remove from caches instead of full refetch.
      queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
        prev ? prev.filter((c) => c.id !== deletedId) : prev,
      );
      queryClient.setQueryData<Campaign[]>(["archived-campaigns"], (prev) =>
        prev ? prev.filter((c) => c.id !== deletedId) : prev,
      );
      queryClient.removeQueries({ queryKey: ["campaign", deletedId] });
      queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });
      toast({ title: "Campaign deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting campaign", description: error.message, variant: "destructive" });
    },
  });

  const deleteCampaignsBulk = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return [] as string[];
      const { data, error } = await supabase.rpc("delete_campaigns_cascade", { _ids: ids });
      if (error) throw error;
      return (data || []) as string[];
    },
    onSuccess: (deletedIds: string[], requestedIds) => {
      const deletedSet = new Set(deletedIds);
      deletedIds.forEach((id) => {
        logSecurityEvent('DELETE', 'campaigns', id, { operation: 'PERMANENT_DELETE_BULK', status: 'Success' });
        queryClient.removeQueries({ queryKey: ["campaign", id] });
      });
      // B6: surgically prune caches.
      queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
        prev ? prev.filter((c) => !deletedSet.has(c.id)) : prev,
      );
      queryClient.setQueryData<Campaign[]>(["archived-campaigns"], (prev) =>
        prev ? prev.filter((c) => !deletedSet.has(c.id)) : prev,
      );
      queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });

      const requested = requestedIds.length;
      const succeeded = deletedIds.length;
      if (succeeded === requested) {
        toast({ title: `Deleted ${succeeded} campaign${succeeded > 1 ? "s" : ""}` });
      } else {
        toast({
          title: `Deleted ${succeeded} of ${requested} campaigns`,
          description: `${requested - succeeded} could not be deleted (no permission or already removed).`,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Bulk delete failed", description: error.message, variant: "destructive" });
    },
  });

  const archiveCampaign = useMutation({
    mutationFn: async (id: string) => {
      // Pause Active/Paused campaigns on archive so background runners
      // (campaign-follow-up-runner, ab-winner-evaluator, etc.) stop touching them.
      // Drafts and Completed campaigns keep their status.
      const { data: existing } = await supabase
        .from("campaigns")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      // If currently Active, transition to Paused via the lifecycle RPC FIRST
      // so the audit log records it and the status guard does not block the archive update.
      if (existing?.status === "Active") {
        const { error: tErr } = await supabase.rpc("transition_campaign_status", {
          _campaign_id: id, _new_status: "Paused", _reason: "auto-pause on archive",
        });
        if (tErr) throw tErr;
      }
      const { error } = await supabase
        .from("campaigns")
        .update({
          archived_at: new Date().toISOString(),
          archived_by: user!.id,
        })
        .eq("id", id);
      if (error) throw error;

      // Also disable follow-up rules so any in-flight cron cycle between
      // archive and the next runner tick does NOT keep sending follow-ups.
      // The runner already skips Paused campaigns, but the rules table is
      // the second-line defence in case a runner reads stale campaign rows.
      // We do not snapshot prior is_enabled state — restore leaves rules
      // disabled and the user re-enables intentionally on the detail page.
      await supabase
        .from("campaign_follow_up_rules")
        .update({ is_enabled: false })
        .eq("campaign_id", id);
    },
    onSuccess: (_: any, id: string) => {
      logSecurityEvent('ARCHIVE', 'campaigns', id, { operation: 'ARCHIVE', status: 'Success' });
      // B6: move row from active list → archived list without refetching either.
      let movedRow: Campaign | undefined;
      queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) => {
        if (!prev) return prev;
        movedRow = prev.find((c) => c.id === id);
        return prev.filter((c) => c.id !== id);
      });
      if (movedRow) {
        const archivedRow = { ...movedRow, archived_at: new Date().toISOString() } as Campaign;
        queryClient.setQueryData<Campaign[]>(["archived-campaigns"], (prev) =>
          prev ? [archivedRow, ...prev.filter((c) => c.id !== id)] : prev,
        );
        queryClient.setQueryData(["campaign", id], (prev: Campaign | undefined) =>
          prev ? { ...prev, archived_at: archivedRow.archived_at } : prev,
        );
      } else {
        // Fallback if list not yet loaded (e.g., archived from detail page).
        queryClient.invalidateQueries({ queryKey: ["archived-campaigns"] });
      }
      queryClient.invalidateQueries({ queryKey: ["follow-up-rules", id] });
      toast({ title: "Campaign archived", description: "Follow-up rules disabled. Re-enable them after restore if needed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error archiving campaign", description: error.message, variant: "destructive" });
    },
  });

  const restoreCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("campaigns")
        .update({ archived_at: null, archived_by: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_: any, id: string) => {
      logSecurityEvent('RESTORE', 'campaigns', id, { operation: 'RESTORE', status: 'Success' });
      // B6: move row from archived list → active list surgically.
      let movedRow: Campaign | undefined;
      queryClient.setQueryData<Campaign[]>(["archived-campaigns"], (prev) => {
        if (!prev) return prev;
        movedRow = prev.find((c) => c.id === id);
        return prev.filter((c) => c.id !== id);
      });
      if (movedRow) {
        const restoredRow = { ...movedRow, archived_at: null, archived_by: null } as Campaign;
        queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
          prev ? [restoredRow, ...prev.filter((c) => c.id !== id)] : prev,
        );
        queryClient.setQueryData(["campaign", id], (prev: Campaign | undefined) =>
          prev ? { ...prev, archived_at: null, archived_by: null } : prev,
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      }
      toast({ title: "Campaign restored" });
    },
    onError: (error: Error) => {
      toast({ title: "Error restoring campaign", description: error.message, variant: "destructive" });
    },
  });

  const archivedCampaignsQuery = useQuery({
    queryKey: ["archived-campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select(LIST_COLUMNS)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false });
      if (error) throw error;
      return data as Campaign[];
    },
    // Only fetch archived list when caller actually opens the archive view.
    enabled: !!user && enableLists && includeArchived,
    staleTime: 2 * 60 * 1000,
  });

  const cloneCampaign = useMutation({
    mutationFn: async (sourceId: string) => {
      // 1. Fetch source campaign
      const { data: source, error: srcErr } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", sourceId)
        .single();
      if (srcErr || !source) throw srcErr || new Error("Campaign not found");

      // 2. Insert cloned campaign (generate ID client-side to avoid SELECT RLS on RETURNING)
      const newId = crypto.randomUUID();
      const { error: insertErr } = await supabase
        .from("campaigns")
        .insert({
          id: newId,
          campaign_name: source.campaign_name + " (Copy)",
          campaign_type: source.campaign_type,
          goal: source.goal,
          owner: source.owner,
          start_date: source.start_date,
          end_date: source.end_date,
          status: "Draft",
          notes: source.notes,
          description: source.description,
          region: source.region,
          country: source.country,
          target_audience: source.target_audience,
          message_strategy: source.message_strategy,
          mart_complete: false,
          priority: (source as any).priority || "Medium",
          primary_channel: (source as any).primary_channel || null,
          enabled_channels: (source as any).enabled_channels || ["Email", "Phone", "LinkedIn"],
          tags: (source as any).tags || null,
          created_by: user!.id,
        } as any);
      if (insertErr) throw insertErr;

      // 3. Clone Strategy progress (reset all flags)
      // Use upsert so we don't conflict with a DB trigger that may have already
      // auto-created the campaign_mart row when the campaign was inserted above.
      await supabase
        .from("campaign_mart")
        .upsert({ campaign_id: newId }, { onConflict: "campaign_id" });

      // 4. Clone email templates
      const { data: templates } = await supabase
        .from("campaign_email_templates")
        .select("*")
        .eq("campaign_id", sourceId);
      if (templates?.length) {
        await supabase.from("campaign_email_templates").insert(
          templates.map((t) => ({
            campaign_id: newId,
            template_name: t.template_name,
            subject: t.subject,
            body: t.body,
            email_type: t.email_type,
            audience_segment: t.audience_segment,
            created_by: user!.id,
          }))
        );
      }

      // 5. Clone phone scripts
      const { data: scripts } = await supabase
        .from("campaign_phone_scripts")
        .select("*")
        .eq("campaign_id", sourceId);
      if (scripts?.length) {
        await supabase.from("campaign_phone_scripts").insert(
          scripts.map((s) => ({
            campaign_id: newId,
            script_name: s.script_name,
            opening_script: s.opening_script,
            key_talking_points: s.key_talking_points,
            discovery_questions: s.discovery_questions,
            objection_handling: s.objection_handling,
            audience_segment: s.audience_segment,
            created_by: user!.id,
          }))
        );
      }

      // 6. Clone accounts
      const { data: accounts } = await supabase
        .from("campaign_accounts")
        .select("*")
        .eq("campaign_id", sourceId);
      if (accounts?.length) {
        await supabase.from("campaign_accounts").insert(
          accounts.map((a) => ({
            campaign_id: newId,
            account_id: a.account_id,
            status: "Not Contacted",
            created_by: user!.id,
          }))
        );
      }

      // 7. Clone contacts
      const { data: contacts } = await supabase
        .from("campaign_contacts")
        .select("*")
        .eq("campaign_id", sourceId);
      if (contacts?.length) {
        await supabase.from("campaign_contacts").insert(
          contacts.map((c) => ({
            campaign_id: newId,
            contact_id: c.contact_id,
            account_id: c.account_id,
            stage: "Not Contacted",
            linkedin_status: "Not Contacted",
            created_by: user!.id,
          }))
        );
      }

      // 8. Clone marketing materials (file references — same storage paths,
      // since we don't deep-copy the underlying files in storage).
      const { data: matRows } = await supabase
        .from("campaign_materials")
        .select("*")
        .eq("campaign_id", sourceId);
      if (matRows?.length) {
        await supabase.from("campaign_materials").insert(
          matRows.map((m) => ({
            campaign_id: newId,
            file_name: m.file_name,
            file_path: m.file_path,
            file_type: m.file_type,
            created_by: user!.id,
          }))
        );
      }

      // 9. Clone audience segments (filter definitions only — segment
      // membership is recomputed at send time from the cloned contacts).
      const { data: segments } = await supabase
        .from("campaign_audience_segments")
        .select("segment_name, filters")
        .eq("campaign_id", sourceId);
      if (segments?.length) {
        await supabase.from("campaign_audience_segments").insert(
          segments.map((s) => ({
            campaign_id: newId,
            segment_name: s.segment_name,
            filters: s.filters,
            created_by: user!.id,
          }))
        );
      }

      // 10. Clone multi-touch sequences (template references stay valid because
      // we already cloned templates in step 4 — but step 4 produced NEW
      // template ids, so we need a name-keyed map to translate).
      const { data: srcTemplates } = await supabase
        .from("campaign_email_templates")
        .select("id, template_name, subject")
        .eq("campaign_id", sourceId);
      const { data: clonedTemplates } = await supabase
        .from("campaign_email_templates")
        .select("id, template_name, subject")
        .eq("campaign_id", newId);
      const templateIdMap = new Map<string, string>();
      if (srcTemplates && clonedTemplates) {
        for (const src of srcTemplates) {
          const match = clonedTemplates.find(
            (t) => t.template_name === src.template_name && t.subject === src.subject,
          );
          if (match) templateIdMap.set(src.id, match.id);
        }
      }

      const { data: sequences } = await supabase
        .from("campaign_sequences")
        .select("step_number, template_id, wait_business_days, condition, target_segment_id")
        .eq("campaign_id", sourceId);
      if (sequences?.length) {
        await supabase.from("campaign_sequences").insert(
          sequences.map((seq) => ({
            campaign_id: newId,
            step_number: seq.step_number,
            template_id: seq.template_id ? templateIdMap.get(seq.template_id) ?? null : null,
            wait_business_days: seq.wait_business_days,
            condition: seq.condition,
            target_segment_id: null, // Segment ids change on clone; user must re-link.
            is_enabled: false,        // Default OFF on clone — user opts in.
            created_by: user!.id,
          })),
        );
      }

      // 11. Clone follow-up rules — disabled by default so the cloned campaign
      // doesn't immediately start auto-sending.
      const { data: followUps } = await supabase
        .from("campaign_follow_up_rules")
        .select("template_id, trigger_event, wait_business_days, max_attempts")
        .eq("campaign_id", sourceId);
      if (followUps?.length) {
        await supabase.from("campaign_follow_up_rules").insert(
          followUps.map((r) => ({
            campaign_id: newId,
            template_id: r.template_id ? templateIdMap.get(r.template_id) ?? null : null,
            trigger_event: r.trigger_event,
            wait_business_days: r.wait_business_days,
            max_attempts: r.max_attempts,
            is_enabled: false,
            created_by: user!.id,
          })),
        );
      }

      // 12. Clone campaign-scoped send caps (only scope='campaign' rows;
      // global / per_user / per_mailbox caps are tenant-wide).
      const { data: caps } = await supabase
        .from("campaign_send_caps")
        .select("scope, daily_limit, hourly_limit, is_enabled")
        .eq("campaign_id", sourceId)
        .eq("scope", "campaign");
      if (caps?.length) {
        await supabase.from("campaign_send_caps").insert(
          caps.map((c) => ({
            campaign_id: newId,
            scope: c.scope,
            daily_limit: c.daily_limit,
            hourly_limit: c.hourly_limit,
            is_enabled: c.is_enabled,
            created_by: user!.id,
          })),
        );
      }

      // 13. Clone timing windows.
      const { data: windows } = await supabase
        .from("campaign_timing_windows")
        .select("*")
        .eq("campaign_id", sourceId);
      if (windows?.length) {
        await supabase.from("campaign_timing_windows").insert(
          windows.map((w: any) => {
            const { id: _id, campaign_id: _cid, created_at: _ca, updated_at: _ua, ...rest } = w;
            return { ...rest, campaign_id: newId, created_by: user!.id };
          }),
        );
      }

      // Re-read the full list-shape row so we can surgically insert it into the cache.
      const { data: cloned } = await supabase
        .from("campaigns")
        .select(LIST_COLUMNS)
        .eq("id", newId)
        .maybeSingle();
      const row = cloned as Campaign | null;
      return {
        id: newId,
        slug: row?.slug ?? null,
        campaign_name: row?.campaign_name ?? null,
        row,
      };
    },
    onSuccess: ({ row }) => {
      // B6: surgical insert into the active campaigns list.
      if (row) {
        queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
          prev ? [row, ...prev.filter((c) => c.id !== row.id)] : prev,
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      }
      queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });
      toast({ title: "Campaign cloned successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error cloning campaign", description: error.message, variant: "destructive" });
    },
  });

  // Compute Strategy progress for each campaign at list level
  const getStrategyProgress = (campaignId: string) => {
    const row = strategyQuery.data?.find((m) => m.campaign_id === campaignId);
    if (!row) return { count: 0, total: 4 };
    const count = [row.message_done, row.audience_done, row.region_done, row.timing_done].filter(Boolean).length;
    return { count, total: 4 };
  };

  // Per-flag detail for tooltips
  const getStrategyDetail = (campaignId: string) => {
    const row = strategyQuery.data?.find((m) => m.campaign_id === campaignId);
    return {
      message: !!row?.message_done,
      audience: !!row?.audience_done,
      region: !!row?.region_done,
      timing: !!row?.timing_done,
    };
  };

  return {
    campaigns: campaignsQuery.data || [],
    archivedCampaigns: archivedCampaignsQuery.data || [],
    isLoading: campaignsQuery.isLoading,
    error: campaignsQuery.error,
    createCampaign,
    updateCampaign,
    transitionStatus,
    deleteCampaign,
    deleteCampaignsBulk,
    archiveCampaign,
    restoreCampaign,
    cloneCampaign,
    getStrategyProgress,
    getStrategyDetail,
  };
}

export interface CampaignDetailEnabledTabs {
  /** Overview tab needs accounts, contacts, communications */
  overview?: boolean;
  /** Setup tab needs accounts, contacts, email templates, phone scripts, materials */
  setup?: boolean;
  /** Monitoring tab needs communications + accounts/contacts for filters */
  monitoring?: boolean;
  /** Action items tab needs nothing extra */
  actionItems?: boolean;
}

const DETAIL_STALE_TIME = 60 * 1000;       // 1 min — tab switches don't refetch
const DETAIL_GC_TIME = 5 * 60 * 1000;      // 5 min — keep data warm in cache

export function useCampaignDetail(
  campaignId: string | undefined,
  enabled: CampaignDetailEnabledTabs = { overview: true, setup: true, monitoring: true, actionItems: true }
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const baseEnabled = !!user && !!campaignId;
  // Aggregate gates: which datasets need to be loaded based on which tabs are enabled
  const needAccounts = baseEnabled && (enabled.overview || enabled.setup || enabled.monitoring);
  const needContacts = baseEnabled && (enabled.overview || enabled.setup || enabled.monitoring);
  const needCommunications = baseEnabled && (enabled.overview || enabled.monitoring);
  const needEmailTemplates = baseEnabled && enabled.setup;
  const needPhoneScripts = baseEnabled && enabled.setup;
  const needMaterials = baseEnabled && enabled.setup;

  const campaignQuery = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", campaignId!)
        .single();
      if (error) throw error;
      return data as Campaign;
    },
    enabled: baseEnabled,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  // Strategy state from explicit table
  const strategyQuery = useQuery({
    queryKey: ["campaign-mart", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_mart")
        .select("*")
        .eq("campaign_id", campaignId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: baseEnabled,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  const accountsQuery = useQuery({
    queryKey: ["campaign-accounts", campaignId, "detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("*, accounts(account_name, industry, region, country)")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: needAccounts,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  const contactsQuery = useQuery({
    queryKey: ["campaign-contacts", campaignId, "detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("*, contacts(contact_name, email, position, company_name, region)")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: needContacts,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  const communicationsQuery = useQuery({
    queryKey: ["campaign-communications", campaignId, "detail"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_communications")
        .select("*, contacts(contact_name), accounts(account_name)")
        .eq("campaign_id", campaignId!)
        .order("communication_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: needCommunications,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  const emailTemplatesQuery = useQuery({
    queryKey: ["campaign-email-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_email_templates")
        .select("*")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: needEmailTemplates,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  const phoneScriptsQuery = useQuery({
    queryKey: ["campaign-phone-scripts", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_phone_scripts")
        .select("*")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: needPhoneScripts,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  const materialsQuery = useQuery({
    queryKey: ["campaign-materials", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_materials")
        .select("*")
        .eq("campaign_id", campaignId!);
      if (error) throw error;
      return data;
    },
    enabled: needMaterials,
    staleTime: DETAIL_STALE_TIME,
    gcTime: DETAIL_GC_TIME,
  });

  // Strategy completion from explicit flags
  const strategyRow = strategyQuery.data;
  const isStrategyComplete = {
    message: strategyRow?.message_done ?? false,
    audience: strategyRow?.audience_done ?? false,
    region: strategyRow?.region_done ?? false,
    timing: strategyRow?.timing_done ?? false,
  };

  const strategyProgress = Object.values(isStrategyComplete).filter(Boolean).length;
  const isFullyStrategyComplete = strategyProgress === 4;

  // Campaign ended check — compare date strings to avoid timezone issues
  const isCampaignEnded = campaignQuery.data?.end_date
    ? campaignQuery.data.end_date < new Date().toISOString().split("T")[0]
    : false;

  const daysRemaining = campaignQuery.data?.end_date
    ? Math.max(0, Math.ceil((new Date(campaignQuery.data.end_date + "T00:00:00").getTime() - new Date(new Date().toISOString().split("T")[0] + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24)))
    : null;

  // Update Strategy flag
  const updateStrategyFlag = async (flag: string, value: boolean) => {
    if (!campaignId) return;

    // Ensure strategy row exists
    const { data: existing } = await supabase
      .from("campaign_mart")
      .select("campaign_id")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    if (!existing) {
      await supabase.from("campaign_mart").insert({ campaign_id: campaignId, [flag]: value } as any);
    } else {
      await supabase.from("campaign_mart").update({ [flag]: value } as any).eq("campaign_id", campaignId);
    }

    // Check if all 4 are now done
    const { data: updated } = await supabase
      .from("campaign_mart")
      .select("*")
      .eq("campaign_id", campaignId)
      .single();

    let nextMartComplete: boolean | null = null;
    if (updated) {
      const allDone = !!(updated.message_done && updated.audience_done && updated.region_done && updated.timing_done);
      await supabase.from("campaigns").update({ mart_complete: allDone }).eq("id", campaignId);
      nextMartComplete = allDone;
    }

    queryClient.invalidateQueries({ queryKey: ["campaign-mart", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["campaign-mart-all"] });
    // B6: surgically patch `mart_complete` on the cached detail + list rows.
    if (nextMartComplete !== null) {
      queryClient.setQueryData(["campaign", campaignId], (prev: Campaign | undefined) =>
        prev ? { ...prev, mart_complete: nextMartComplete } : prev,
      );
      queryClient.setQueryData<Campaign[]>(["campaigns"], (prev) =>
        prev
          ? prev.map((c) => (c.id === campaignId ? { ...c, mart_complete: nextMartComplete } : c))
          : prev,
      );
    }
  };

  return {
    campaign: campaignQuery.data,
    isLoading: campaignQuery.isLoading,
    strategy: strategyQuery.data,
    accounts: accountsQuery.data || [],
    contacts: contactsQuery.data || [],
    communications: communicationsQuery.data || [],
    emailTemplates: emailTemplatesQuery.data || [],
    phoneScripts: phoneScriptsQuery.data || [],
    materials: materialsQuery.data || [],
    isStrategyComplete,
    strategyProgress,
    isFullyStrategyComplete,
    isCampaignEnded,
    daysRemaining,
    updateStrategyFlag,
  };
}

/**
 * Resolve a slug-or-UUID URL parameter to a campaign UUID with a single
 * lightweight query — avoids loading the full campaigns list on detail pages.
 */
export function useCampaignIdFromSlug(rawId: string | undefined) {
  const { user } = useAuth();
  const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const extractedId = rawId?.includes("--") ? rawId.split("--").pop() : rawId;
  const isDirectUUID = extractedId ? isUUID(extractedId) : false;

  const slugQuery = useQuery({
    queryKey: ["campaign-id-by-slug", rawId],
    queryFn: async () => {
      if (!rawId) return null;
      // O(1) lookup via the indexed `slug` column maintained by a DB trigger.
      const { data: bySlug } = await (supabase
        .from("campaigns")
        .select("id") as any)
        .eq("slug", rawId)
        .maybeSingle();
      if (bySlug?.id) return bySlug.id as string;

      // Legacy fallback: older URLs may use the plain slugified name (no
      // unique suffix). Use a server-side filter via an `ilike` on
      // campaign_name reconstructed from the slug — bounded to 5 candidates,
      // ordered by created_at, instead of fetching every campaign in the
      // workspace just to JS-filter.
      // Slug example "acme-q4-launch" → name pattern "acme q4 launch".
      const namePattern = rawId.replace(/-/g, " ");
      const { data, error } = await supabase
        .from("campaigns")
        .select("id, campaign_name, created_at")
        .is("archived_at", null)
        .ilike("campaign_name", namePattern)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      const match = (data || []).find((c) => {
        const slug = c.campaign_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return slug === rawId;
      });
      return match?.id || null;
    },
    enabled: !!user && !!rawId && !isDirectUUID,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    id: isDirectUUID ? extractedId : slugQuery.data || undefined,
    isResolving: !isDirectUUID && slugQuery.isLoading,
  };
}
