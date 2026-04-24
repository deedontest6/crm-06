import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useSecurityAudit } from "@/hooks/useSecurityAudit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, Eye, Copy, Search, Mail, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StandardPagination } from "@/components/shared/StandardPagination";
import TemplatePreviewModal from "./email/TemplatePreviewModal";
import { AIDraftEmailModal } from "@/components/campaigns/AIDraftEmailModal";

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

const ITEMS_PER_PAGE = 10;

const EmailTemplatesSettings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { logSecurityEvent } = useSecurityAudit();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);
  const [showAIDraft, setShowAIDraft] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    subject: "",
    body: ""
  });

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from('email_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast({
        title: "Error",
        description: "Failed to fetch email templates",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templates;
    const query = searchQuery.toLowerCase();
    return templates.filter(t => 
      t.name.toLowerCase().includes(query) || 
      t.subject.toLowerCase().includes(query)
    );
  }, [templates, searchQuery]);

  const totalPages = Math.ceil(filteredTemplates.length / ITEMS_PER_PAGE);
  const paginatedTemplates = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredTemplates.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredTemplates, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [filteredTemplates, totalPages, currentPage]);

  const handleOpenModal = (template?: EmailTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        name: template.name,
        subject: template.subject,
        body: template.body
      });
    } else {
      setEditingTemplate(null);
      setFormData({ name: "", subject: "", body: "" });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.subject || !formData.body) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const templateData = {
        name: formData.name,
        subject: formData.subject,
        body: formData.body,
        created_by: user?.id
      };

      if (editingTemplate) {
        const { error } = await (supabase as any)
          .from('email_templates')
          .update(templateData)
          .eq('id', editingTemplate.id);
        if (error) throw error;
        logSecurityEvent('UPDATE', 'email_templates', editingTemplate.id, {
          template_name: formData.name
        });
        toast({ title: "Success", description: "Template updated successfully" });
      } else {
        const { data: newTemplate, error } = await (supabase as any)
          .from('email_templates')
          .insert([templateData])
          .select('id')
          .single();
        if (error) throw error;
        logSecurityEvent('CREATE', 'email_templates', newTemplate?.id, {
          template_name: formData.name
        });
        toast({ title: "Success", description: "Template created successfully" });
      }

      setShowModal(false);
      fetchTemplates();
    } catch (error: any) {
      console.error('Error saving template:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save template",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await (supabase as any)
        .from('email_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;

      const deletedTemplate = templates.find(t => t.id === id);
      logSecurityEvent('DELETE', 'email_templates', id, {
        template_name: deletedTemplate?.name
      });

      setTemplates(prev => prev.filter(t => t.id !== id));
      setShowDeleteDialog(false);
      setTemplateToDelete(null);
      
      toast({ title: "Success", description: "Template deleted successfully" });
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: "Error",
        description: "Failed to delete template",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = async (template: EmailTemplate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSaving(true);
    try {
      const duplicateData = {
        name: `${template.name} (Copy)`,
        subject: template.subject,
        body: template.body,
        created_by: user?.id
      };

      const { error } = await (supabase as any)
        .from('email_templates')
        .insert([duplicateData]);

      if (error) throw error;

      toast({ title: "Success", description: "Template duplicated successfully" });
      fetchTemplates();
    } catch (error: any) {
      console.error('Duplicate error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate template",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const availableVariables = [
    { variable: "{{contact_name}}", description: "Contact's full name" },
    { variable: "{{company_name}}", description: "Company name" },
    { variable: "{{position}}", description: "Contact's position" },
    { variable: "{{email}}", description: "Contact's email" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading templates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle>Email Templates</CardTitle>
              <CardDescription>
                Create reusable email templates for contacting leads and contacts
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowAIDraft(true)} className="gap-2">
                <Sparkles className="h-4 w-4" />
                AI Draft
              </Button>
              <Button onClick={() => handleOpenModal()} className="gap-2">
                <Plus className="h-4 w-4" />
                New Template
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <Table>
            <caption className="sr-only">Email templates list</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTemplates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Mail className="h-10 w-10 mb-3 opacity-50" />
                      <p className="font-medium">
                        {searchQuery ? "No templates match your search" : "No email templates yet"}
                      </p>
                      <p className="text-sm mt-1">
                        {searchQuery ? "Try adjusting your search terms" : "Create your first template to get started"}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTemplates.map((template) => (
                  <TableRow 
                    key={template.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => handleOpenModal(template)}
                  >
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>{template.subject}</TableCell>
                    <TableCell>{format(new Date(template.created_at), 'dd/MM/yyyy')}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewTemplate(template);
                                setShowPreviewModal(true);
                              }}
                              aria-label={`Preview ${template.name}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Preview</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => handleDuplicate(template, e)}
                              disabled={saving}
                              aria-label={`Duplicate ${template.name}`}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Duplicate</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenModal(template);
                              }}
                              aria-label={`Edit ${template.name}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTemplateToDelete(template.id);
                                setShowDeleteDialog(true);
                              }}
                              aria-label={`Delete ${template.name}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {filteredTemplates.length > ITEMS_PER_PAGE && (
            <StandardPagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredTemplates.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setCurrentPage}
            />
          )}
        </CardContent>
      </Card>

      {/* Template Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Welcome Email, Follow-up"
                className="max-w-sm"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Email Subject *</Label>
              <Input
                id="subject"
                value={formData.subject}
                onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                placeholder="e.g., Hello {{contact_name}}, following up..."
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="body">Email Body *</Label>
              <Textarea
                id="body"
                value={formData.body}
                onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
                placeholder="Write your email content here. Use variables like {{contact_name}} for personalization."
                className="min-h-[200px]"
                required
              />
              <div className="flex flex-wrap gap-2 pt-2">
                <span className="text-xs text-muted-foreground">Insert variable:</span>
                {availableVariables.map((v) => (
                  <Badge 
                    key={v.variable} 
                    variant="outline" 
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs"
                    onClick={() => setFormData(prev => ({ ...prev, body: prev.body + v.variable }))}
                  >
                    {v.variable}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingTemplate ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this template? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => templateToDelete && handleDelete(templateToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Preview Modal */}
      <TemplatePreviewModal
        open={showPreviewModal}
        onOpenChange={setShowPreviewModal}
        template={previewTemplate}
      />

      <AIDraftEmailModal
        open={showAIDraft}
        onOpenChange={setShowAIDraft}
        onPick={(v) => {
          setEditingTemplate(null);
          setFormData({ name: "AI draft", subject: v.subject, body: v.body });
          setShowModal(true);
        }}
      />
    </div>
  );
};

export default EmailTemplatesSettings;
