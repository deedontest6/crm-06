import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Send, FileText, Eye } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Contact {
  contact_id: string;
  account_id: string | null;
  contacts: { contact_name: string; email: string | null; company_name: string | null; position: string | null } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  contacts: Contact[];
  preselectedContactId?: string;
  replyTo?: { parent_id: string; thread_id: string | null; subject: string; contactId: string };
  onEmailSent: (contactId?: string) => void;
}

function substituteVariables(text: string, contact: Contact): string {
  const c = contact.contacts;
  return text
    .replace(/\{contact_name\}/gi, c?.contact_name || "")
    .replace(/\{first_name\}/gi, c?.contact_name?.split(" ")[0] || "")
    .replace(/\{company_name\}/gi, c?.company_name || "")
    .replace(/\{position\}/gi, c?.position || "")
    .replace(/\{email\}/gi, c?.email || "");
}

export function EmailComposeModal({ open, onOpenChange, campaignId, contacts, preselectedContactId, replyTo, onEmailSent }: Props) {
  const [contactId, setContactId] = useState(preselectedContactId || "");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [previewTab, setPreviewTab] = useState("edit");

  useEffect(() => {
    if (replyTo) {
      setContactId(replyTo.contactId);
      setSubject(replyTo.subject.startsWith("Re: ") ? replyTo.subject : `Re: ${replyTo.subject}`);
      setBody("");
    } else if (preselectedContactId) {
      setContactId(preselectedContactId);
    }
  }, [preselectedContactId, replyTo]);

  const { data: templates = [] } = useQuery({
    queryKey: ["campaign-email-templates", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_email_templates")
        .select("*")
        .eq("campaign_id", campaignId)
        .not("email_type", "in", '("LinkedIn-Connection","LinkedIn-Followup")');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const selectedContact = contacts.find(c => c.contact_id === contactId);

  const handleTemplateSelect = (tid: string) => {
    setTemplateId(tid);
    const tpl = templates.find(t => t.id === tid);
    if (tpl) {
      setSubject(tpl.subject || "");
      setBody(tpl.body || "");
    }
  };

  const getPreviewText = (text: string) => {
    if (!selectedContact) return text;
    return substituteVariables(text, selectedContact);
  };

  const handleSend = async () => {
    if (!contactId) { toast.warning("Select a contact"); return; }
    if (!selectedContact?.contacts?.email) { toast.error("Selected contact has no email address"); return; }
    if (!subject.trim()) { toast.warning("Subject is required"); return; }
    if (!body.trim()) { toast.warning("Body is required"); return; }

    setSending(true);
    try {
      const finalSubject = getPreviewText(subject);
      const finalBody = getPreviewText(body);

      const { data, error } = await supabase.functions.invoke("send-campaign-email", {
        body: {
          campaign_id: campaignId,
          contact_id: contactId,
          account_id: selectedContact.account_id,
          template_id: templateId || undefined,
          subject: finalSubject,
          body: finalBody,
          recipient_email: selectedContact.contacts.email,
          recipient_name: selectedContact.contacts.contact_name,
          ...(replyTo ? { parent_id: replyTo.parent_id, thread_id: replyTo.thread_id || replyTo.parent_id } : {}),
        },
      });

      if (error) throw error;
      if (data?.success) {
        toast.success(`Email sent to ${selectedContact.contacts.contact_name}`);
        onEmailSent(contactId);
        onOpenChange(false);
        resetForm();
      } else {
        const errorDetail = data?.errorCode === "NOT_CONFIGURED"
          ? "Email sending is not configured. Azure credentials are missing — contact your administrator."
          : data?.errorCode === "AUTH_FAILED"
          ? "Failed to authenticate with email provider. Check Azure credentials."
          : `Failed to send email: ${data?.error || "Unknown error"}`;
        toast.error(errorDetail);
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setContactId("");
    setTemplateId("");
    setSubject("");
    setBody("");
    setPreviewTab("edit");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Compose Campaign Email
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Contact & Template selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">To (Contact) *</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select contact" /></SelectTrigger>
                <SelectContent>
                  {contacts.map(c => (
                    <SelectItem key={c.contact_id} value={c.contact_id}>
                      <div className="flex items-center gap-2">
                        <span>{c.contacts?.contact_name}</span>
                        {c.contacts?.email ? (
                          <span className="text-xs text-muted-foreground">{c.contacts.email}</span>
                        ) : (
                          <Badge variant="destructive" className="text-[10px] px-1 py-0">No email</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Template</Label>
              <Select value={templateId} onValueChange={handleTemplateSelect}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select template (optional)" /></SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <FileText className="h-3 w-3" />
                        <span>{t.template_name}</span>
                        {t.email_type && <Badge variant="secondary" className="text-[10px] px-1 py-0">{t.email_type}</Badge>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Variable hints */}
          <div className="flex flex-wrap gap-1">
            <span className="text-[10px] text-muted-foreground">Variables:</span>
          {["{contact_name}", "{first_name}", "{company_name}", "{position}", "{email}"].map(v => (
              <Badge key={v} variant="outline" className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted"
                onClick={() => {
                  // Append variable to body by default (most common use case)
                  setBody(prev => prev + v);
                }}>
                {v}
              </Badge>
            ))}
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-xs">Subject *</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject..." className="text-sm" data-field="subject" />
          </div>

          {/* Body with edit/preview tabs */}
          <Tabs value={previewTab} onValueChange={setPreviewTab}>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Body *</Label>
              <TabsList className="h-7">
                <TabsTrigger value="edit" className="text-xs h-6 px-2">Edit</TabsTrigger>
                <TabsTrigger value="preview" className="text-xs h-6 px-2 gap-1">
                  <Eye className="h-3 w-3" /> Preview
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="edit" className="mt-1.5">
              <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Email body... (supports HTML)" rows={8} className="text-sm font-mono" />
            </TabsContent>
            <TabsContent value="preview" className="mt-1.5">
              <div className="border rounded-lg p-4 min-h-[200px] bg-background">
                {selectedContact ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">To: {selectedContact.contacts?.contact_name} &lt;{selectedContact.contacts?.email}&gt;</p>
                    <p className="text-sm font-medium mb-3">{getPreviewText(subject)}</p>
                    <div className="text-sm whitespace-pre-wrap">{getPreviewText(body)}</div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a contact to preview variable substitution</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending} className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending..." : "Send Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
