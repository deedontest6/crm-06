import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, CheckSquare, Trash2, Check, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";

interface Props {
  campaignId: string;
}

const priorityColors: Record<string, string> = {
  High: "bg-destructive/10 text-destructive",
  Medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Low: "bg-muted text-muted-foreground",
};

export function CampaignActionItems({ campaignId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { logCreate, logUpdate, logDelete } = useCRUDAudit();
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [editItem, setEditItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: "", priority: "Medium", due_date: "", contact_id: "", account_id: "" });

  const { data: actionItems = [] } = useQuery({
    queryKey: ["campaign-action-items", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("action_items")
        .select("*")
        .eq("module_type", "campaigns")
        .eq("module_id", campaignId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: campaignContacts = [] } = useQuery({
    queryKey: ["campaign-contacts", campaignId, "action-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_contacts")
        .select("contact_id, account_id, contacts(contact_name, email, phone_no)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  const { data: campaignAccounts = [] } = useQuery({
    queryKey: ["campaign-accounts", campaignId, "action-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_accounts")
        .select("account_id, accounts(account_name)")
        .eq("campaign_id", campaignId);
      if (error) throw error;
      return data;
    },
  });

  // Resolve owner display names
  const ownerIds = [...new Set(actionItems.map((i) => i.assigned_to).filter(Boolean))] as string[];
  const { displayNames } = useUserDisplayNames(ownerIds);

  // Listen for "Add Task" events from Contacts tab
  useEffect(() => {
    const handler = (e: any) => {
      const { contactId, accountId } = e.detail || {};
      setForm((prev) => ({ ...prev, contact_id: contactId || "", account_id: accountId || "" }));
      setShowInlineForm(true);
    };
    window.addEventListener("campaign-add-task", handler);
    return () => window.removeEventListener("campaign-add-task", handler);
  }, []);

  const [form, setForm] = useState({
    title: "", description: "", priority: "Medium", due_date: "", contact_id: "", account_id: "",
  });

  const handleContactChange = (contactId: string) => {
    const cc = campaignContacts.find((c: any) => c.contact_id === contactId);
    const accountId = cc?.account_id || "";
    setForm({ ...form, contact_id: contactId, account_id: accountId });
  };

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    let enrichedDescription = form.description || "";
    const contactName = campaignContacts.find((cc: any) => cc.contact_id === form.contact_id)?.contacts?.contact_name;
    const accountName = campaignAccounts.find((ca: any) => ca.account_id === form.account_id)?.accounts?.account_name;
    const metaParts = [];
    if (contactName) metaParts.push(`Contact: ${contactName}`);
    if (accountName) metaParts.push(`Account: ${accountName}`);
    if (metaParts.length > 0) {
      enrichedDescription = enrichedDescription ? `${enrichedDescription}\n\n${metaParts.join(" | ")}` : metaParts.join(" | ");
    }

    const { error } = await supabase.from("action_items").insert({
      title: form.title, description: enrichedDescription || null,
      priority: form.priority, due_date: form.due_date || null,
      status: "Open", module_type: "campaigns", module_id: campaignId,
      created_by: user!.id, assigned_to: user!.id,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    queryClient.invalidateQueries({ queryKey: ["campaign-action-items", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["action-items"] });
    await logCreate('action_items', '', { title: form.title, module_type: 'campaigns', campaign_id: campaignId });
    setShowInlineForm(false);
    setForm({ title: "", description: "", priority: "Medium", due_date: "", contact_id: "", account_id: "" });
    toast({ title: "Task created" });
  };

  const updateStatus = async (id: string, status: string) => {
    const item = actionItems.find(i => i.id === id);
    await supabase.from("action_items").update({ status }).eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["campaign-action-items", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["action-items"] });
    await logUpdate('action_items', id, { status }, { status: item?.status });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const item = actionItems.find(i => i.id === deleteConfirm);
    await supabase.from("action_items").delete().eq("id", deleteConfirm);
    queryClient.invalidateQueries({ queryKey: ["campaign-action-items", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["action-items"] });
    await logDelete('action_items', deleteConfirm, item);
    setDeleteConfirm(null);
    toast({ title: "Task deleted" });
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    setEditForm({
      title: item.title,
      priority: item.priority,
      due_date: item.due_date || "",
      contact_id: "",
      account_id: "",
    });
  };

  const handleEditSave = async () => {
    if (!editItem || !editForm.title.trim()) return;
    await supabase.from("action_items").update({
      title: editForm.title,
      priority: editForm.priority,
      due_date: editForm.due_date || null,
    }).eq("id", editItem.id);
    queryClient.invalidateQueries({ queryKey: ["campaign-action-items", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["action-items"] });
    setEditItem(null);
    toast({ title: "Task updated" });
  };

  const today = new Date().toISOString().split("T")[0];
  const isOverdue = (item: any) => item.due_date && item.due_date < today && item.status !== "Done";

  const getContactFromDescription = (desc: string | null) => {
    if (!desc) return null;
    const match = desc.match(/Contact: (.+?)(\s*\||$)/);
    return match ? match[1] : null;
  };
  const getAccountFromDescription = (desc: string | null) => {
    if (!desc) return null;
    const match = desc.match(/Account: (.+?)(\s*\||\s*$)/);
    return match ? match[1] : null;
  };

  // Filtered items
  const filtered = actionItems.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (ownerFilter !== "all" && item.assigned_to !== ownerFilter) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckSquare className="h-4 w-4" /> Campaign Action Items
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{actionItems.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Open">Open</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Done">Done</SelectItem>
              </SelectContent>
            </Select>
            {ownerIds.length > 0 && (
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  {ownerIds.map((oid) => (
                    <SelectItem key={oid} value={oid}>{displayNames[oid] || oid}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" onClick={() => setShowInlineForm(!showInlineForm)}>
              <Plus className="h-4 w-4 mr-1" /> Add Task
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Inline Create Form */}
          {showInlineForm && (
            <div className="border border-border rounded-lg p-4 mb-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Title *</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Task title..." className="h-8 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Contact</Label>
                  <Select value={form.contact_id} onValueChange={handleContactChange}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select contact" /></SelectTrigger>
                    <SelectContent>
                      {campaignContacts.map((cc: any) => (
                        <SelectItem key={cc.contact_id} value={cc.contact_id}>
                          <span className="font-medium">{cc.contacts?.contact_name || cc.contact_id}</span>
                          {(cc.contacts?.email || cc.contacts?.phone_no) && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              · {cc.contacts?.email || cc.contacts?.phone_no}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Account</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Auto-filled" /></SelectTrigger>
                    <SelectContent>
                      {campaignAccounts.map((ca: any) => (
                        <SelectItem key={ca.account_id} value={ca.account_id}>{ca.accounts?.account_name || ca.account_id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="Low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Due Date</Label>
                  <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowInlineForm(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCreate} disabled={!form.title.trim()}>Save Task</Button>
              </div>
            </div>
          )}

          {filtered.length === 0 && !showInlineForm ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                {actionItems.length === 0 ? "No tasks yet. Create follow-up tasks for this campaign." : "No tasks match the selected filters."}
              </p>
              {actionItems.length === 0 && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowInlineForm(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Create your first task
                </Button>
              )}
            </div>
          ) : filtered.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id} className={cn(isOverdue(item) && "border-l-4 border-l-yellow-500")}>
                    <TableCell>
                      <p className="font-medium text-sm">{item.title}</p>
                    </TableCell>
                    <TableCell className="text-sm">{getContactFromDescription(item.description) || "—"}</TableCell>
                    <TableCell className="text-sm">{getAccountFromDescription(item.description) || "—"}</TableCell>
                    <TableCell className="text-sm">{item.assigned_to ? displayNames[item.assigned_to] || "—" : "—"}</TableCell>
                    <TableCell>
                      <Badge className={priorityColors[item.priority]} variant="secondary">{item.priority}</Badge>
                    </TableCell>
                    <TableCell className={cn("text-sm", isOverdue(item) && "text-destructive font-medium")}>
                      {item.due_date ? format(new Date(item.due_date + "T00:00:00"), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell>
                      <Select value={item.status} onValueChange={(v) => updateStatus(item.id, v)}>
                        <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Open">Open</SelectItem>
                          <SelectItem value="In Progress">In Progress</SelectItem>
                          <SelectItem value="Done">Done</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {item.status !== "Done" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateStatus(item.id, "Done")} title="Mark Done">
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)} title="Edit">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteConfirm(item.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>Are you sure? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Task Modal */}
      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader><DialogTitle>Edit Task</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={editForm.priority} onValueChange={(v) => setEditForm({ ...editForm, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={editForm.due_date} onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={!editForm.title.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
