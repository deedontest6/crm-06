import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Trash2, Plus, Clock } from "lucide-react";

interface Props { campaignId: string }

export function FollowUpRulesPanel({ campaignId }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [waitDays, setWaitDays] = useState(3);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [templateId, setTemplateId] = useState<string>("");

  const { data: rules = [] } = useQuery({
    queryKey: ["follow-up-rules", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_follow_up_rules")
        .select("id, template_id, wait_business_days, max_attempts, is_enabled, created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["campaign-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_email_templates")
        .select("id, template_name")
        .or(`campaign_id.eq.${campaignId},campaign_id.is.null`)
        .order("template_name");
      if (error) throw error;
      return data;
    },
  });

  const createRule = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!templateId) throw new Error("Pick a template");
      const { error } = await supabase.from("campaign_follow_up_rules").insert({
        campaign_id: campaignId,
        template_id: templateId,
        wait_business_days: waitDays,
        max_attempts: maxAttempts,
        is_enabled: true,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow-up-rules", campaignId] });
      toast({ title: "Follow-up rule created" });
      setTemplateId("");
    },
    onError: (e: any) => toast({ title: "Failed to create rule", description: e.message, variant: "destructive" }),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("campaign_follow_up_rules").update({ is_enabled: enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["follow-up-rules", campaignId] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaign_follow_up_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow-up-rules", campaignId] });
      toast({ title: "Rule deleted" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" /> Follow-up Automation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Wait (business days)</Label>
            <Input type="number" min={1} max={30} value={waitDays} onChange={e => setWaitDays(parseInt(e.target.value) || 1)} />
          </div>
          <div>
            <Label>Max attempts</Label>
            <Input type="number" min={1} max={10} value={maxAttempts} onChange={e => setMaxAttempts(parseInt(e.target.value) || 1)} />
          </div>
          <div className="md:col-span-4">
            <Button onClick={() => createRule.mutate()} disabled={createRule.isPending || !templateId} size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add rule
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {rules.length === 0 && (
            <p className="text-xs text-muted-foreground">No follow-up rules yet. Add one above to auto-send a follow-up when contacts don't reply.</p>
          )}
          {rules.map((r: any) => {
            const tpl = templates.find((t: any) => t.id === r.template_id);
            return (
              <div key={r.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{tpl?.template_name || "(deleted template)"}</span>
                  <span className="text-xs text-muted-foreground">
                    Wait {r.wait_business_days} business day(s) · Max {r.max_attempts} attempt(s)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.is_enabled} onCheckedChange={(v) => toggleRule.mutate({ id: r.id, enabled: v })} />
                  <Button variant="ghost" size="icon" onClick={() => deleteRule.mutate(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
