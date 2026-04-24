import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Sparkles, Loader2 } from "lucide-react";

interface Variant { subject: string; body: string; angle: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId?: string;
  onPick?: (variant: Variant) => void;
}

export function AIDraftEmailModal({ open, onOpenChange, campaignId, onPick }: Props) {
  const [persona, setPersona] = useState("");
  const [goal, setGoal] = useState("");
  const [tone, setTone] = useState("professional, warm");
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);

  const generate = async () => {
    if (!persona.trim() || !goal.trim()) {
      toast({ title: "Persona and goal are required", variant: "destructive" });
      return;
    }
    setLoading(true);
    setVariants([]);
    try {
      const { data, error } = await supabase.functions.invoke("ai-draft-campaign-email", {
        body: { campaign_id: campaignId, persona, goal, tone },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setVariants(data?.variants ?? []);
    } catch (e: any) {
      toast({ title: "Couldn't generate drafts", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI draft email variants</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Persona</Label>
            <Input placeholder="e.g. Head of Procurement at mid-size automotive supplier"
              value={persona} onChange={e => setPersona(e.target.value)} />
          </div>
          <div>
            <Label>Campaign goal</Label>
            <Textarea placeholder="e.g. Book a 20-min discovery call about cost reduction in tooling"
              value={goal} onChange={e => setGoal(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Tone</Label>
            <Input value={tone} onChange={e => setTone(e.target.value)} />
          </div>

          <Button onClick={generate} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate 3 variants
          </Button>

          {variants.length > 0 && (
            <div className="space-y-3 pt-2">
              {variants.map((v, i) => (
                <Card key={i} className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">Variant {String.fromCharCode(65 + i)}</Badge>
                    <Button size="sm" variant="secondary" onClick={() => { onPick?.(v); onOpenChange(false); }}>
                      Use this
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground italic">{v.angle}</p>
                  <div>
                    <Label className="text-xs">Subject</Label>
                    <p className="text-sm font-medium">{v.subject}</p>
                  </div>
                  <div>
                    <Label className="text-xs">Body</Label>
                    <p className="text-sm whitespace-pre-wrap">{v.body}</p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
