import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { AlertTriangle, Link2, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  campaignId: string;
}

export function UnmatchedRepliesPanel({ campaignId }: Props) {
  const qc = useQueryClient();
  const [mapTarget, setMapTarget] = useState<any | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string>("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["unmatched-replies"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("campaign_unmatched_replies")
        .select("id, received_at, from_email, from_name, subject, body_preview, conversation_id, status")
        .eq("status", "pending")
        .order("received_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  // Contacts for this campaign — used to map a reply to a known contact.
  const { data: contacts = [] } = useQuery({
    queryKey: ["campaign-contacts-for-mapping", campaignId],
    enabled: !!mapTarget,
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_contacts")
        .select("contact_id, account_id, contacts:contact_id(contact_name, email, company_name)")
        .eq("campaign_id", campaignId);
      return (data ?? []) as any[];
    },
  });

  if (!isLoading && rows.length === 0) return null;

  const onMap = async () => {
    if (!mapTarget || !selectedContactId) return;
    const cc = contacts.find((c: any) => c.contact_id === selectedContactId);
    const { error } = await (supabase as any).rpc("map_unmatched_reply", {
      _unmatched_id: mapTarget.id,
      _campaign_id: campaignId,
      _contact_id: selectedContactId,
      _account_id: cc?.account_id || null,
      _create_comm: true,
    });
    if (error) {
      toast({ title: "Failed to map reply", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Reply mapped", description: "Contact stage will update shortly." });
    setMapTarget(null);
    setSelectedContactId("");
    qc.invalidateQueries({ queryKey: ["unmatched-replies"] });
    qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    qc.invalidateQueries({ queryKey: ["campaign-communications", campaignId] });
  };

  const onDiscard = async (id: string) => {
    const { error } = await (supabase as any).rpc("discard_unmatched_reply", {
      _unmatched_id: id,
      _note: null,
    });
    if (error) {
      toast({ title: "Failed to discard", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["unmatched-replies"] });
  };

  return (
    <Card className="border-amber-300 dark:border-amber-700">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Unmatched replies
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Inbound emails that couldn't be linked to a tracked conversation. Map them to a contact to update the
          campaign or discard noise.
        </p>
        <div className="space-y-2">
          {rows.map((r: any) => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 border rounded-md p-2 text-sm bg-card"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground truncate">{r.from_name || r.from_email}</span>
                  <span className="truncate">&lt;{r.from_email}&gt;</span>
                  <span>·</span>
                  <span>{formatDistanceToNow(new Date(r.received_at), { addSuffix: true })}</span>
                </div>
                <div className="font-medium truncate">{r.subject || "(no subject)"}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{r.body_preview}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="outline" onClick={() => setMapTarget(r)}>
                  <Link2 className="h-3.5 w-3.5 mr-1" /> Map
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDiscard(r.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={!!mapTarget} onOpenChange={(o) => !o && setMapTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map reply to contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              <div className="text-muted-foreground">From</div>
              <div className="font-medium">{mapTarget?.from_name || mapTarget?.from_email}</div>
              <div className="text-xs text-muted-foreground">{mapTarget?.from_email}</div>
            </div>
            <div>
              <Label>Map to contact</Label>
              <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a campaign contact" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c: any) => (
                    <SelectItem key={c.contact_id} value={c.contact_id}>
                      {c.contacts?.contact_name || "(unnamed)"} — {c.contacts?.email || c.contacts?.company_name || ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMapTarget(null)}>Cancel</Button>
            <Button onClick={onMap} disabled={!selectedContactId}>Map reply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}