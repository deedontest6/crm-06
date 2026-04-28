import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, FileSignature, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface EmailSignatureCardProps {
  userId: string;
  fullName: string;
  email: string;
}

/**
 * Stored on `profiles.email_signature` and appended automatically by the
 * `send-campaign-email` edge function. HTML is allowed but stripped of
 * <script>/<iframe> tags before save.
 */
const sanitize = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/javascript:/gi, "");

const buildDefault = (name: string, email: string) => `<p style="margin:0;color:#475569;font-size:13px;line-height:1.5;">
  Best regards,<br/>
  <strong style="color:#0f172a;">${name || "Your Name"}</strong><br/>
  <a href="mailto:${email}" style="color:#2563eb;text-decoration:none;">${email}</a>
</p>`;

const EmailSignatureCard = ({ userId, fullName, email }: EmailSignatureCardProps) => {
  const [signature, setSignature] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const initialRef = useRef<string>("");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("profiles")
        .select("email_signature")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const s = (data?.email_signature as string) || "";
      setSignature(s);
      initialRef.current = s;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dirty = signature !== initialRef.current;

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const cleaned = sanitize(signature.trim());
      const { error } = await supabase
        .from("profiles")
        .update({ email_signature: cleaned || null })
        .eq("id", userId);
      if (error) throw error;
      initialRef.current = cleaned;
      setSignature(cleaned);
      toast.success("Signature saved — will be appended to outbound campaign emails.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save signature");
    } finally {
      setSaving(false);
    }
  };

  const insertDefault = () => setSignature(buildDefault(fullName, email));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSignature className="h-4 w-4" />
          Email Signature
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Automatically appended to every outbound campaign email. HTML is supported. Scripts and inline event handlers
          are stripped on save for security.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">HTML</Label>
              <Button
                size="sm"
                variant="ghost"
                onClick={insertDefault}
                className="h-6 text-xs gap-1.5"
                disabled={loading}
              >
                <Sparkles className="h-3 w-3" />
                Use template
              </Button>
            </div>
            <Textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="<p>Best regards,<br/><strong>Your Name</strong></p>"
              rows={10}
              className="font-mono text-xs"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">Live preview</Label>
            <div className="border rounded-md bg-background p-4 min-h-[230px] text-sm">
              {signature ? (
                <div dangerouslySetInnerHTML={{ __html: sanitize(signature) }} />
              ) : (
                <p className="text-xs text-muted-foreground italic">Your preview will appear here.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          {dirty && (
            <span className="text-xs text-amber-600 mr-auto">You have unsaved changes</span>
          )}
          <Button onClick={handleSave} disabled={!dirty || saving || loading} size="sm">
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Save signature
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default EmailSignatureCard;
