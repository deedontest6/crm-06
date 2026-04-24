import { ContactTable } from "@/components/ContactTable";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Settings, MoreVertical, Upload, Plus, Trash2, Download, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useSimpleContactsImportExport } from "@/hooks/useSimpleContactsImportExport";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";

const Contacts = () => {
  const { toast } = useToast();
  const { logBulkDelete } = useCRUDAudit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [initialEditContactId, setInitialEditContactId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deep-link: when arriving with ?id=<contact_id>, search for that contact
  // and auto-open the edit modal so links from Log Outreach land on the right row.
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id) return;
    (async () => {
      const { data } = await supabase
        .from("contacts")
        .select("contact_name")
        .eq("id", id)
        .maybeSingle();
      if (data?.contact_name) {
        setSearchTerm(data.contact_name);
      }
      // Trigger ContactTable to auto-open edit modal for this contact id.
      setInitialEditContactId(id);
      // Clear the param so reloads don't keep retriggering.
      const next = new URLSearchParams(searchParams);
      next.delete("id");
      setSearchParams(next, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const { handleImport, handleExport, isImporting } = useSimpleContactsImportExport(onRefresh);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await handleImport(file);
      event.target.value = '';
    } catch (error: any) {
      console.error('Contacts page: Import error caught:', error);
      event.target.value = '';
    }
  };

  const handleBulkDelete = async () => {
    if (selectedContacts.length === 0) return;
    try {
      const { error } = await supabase.from('contacts').delete().in('id', selectedContacts);
      if (error) throw error;

      await logBulkDelete('contacts', selectedContacts.length, selectedContacts);
      toast({
        title: "Success",
        description: `${selectedContacts.length} contacts deleted successfully`
      });
      setSelectedContacts([]);
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete contacts",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header - fixed height matching sidebar */}
      <div className="flex-shrink-0 h-16 border-b bg-background px-6 flex items-center">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-semibold text-foreground">Contacts</h1>
          <Button onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        </div>
      </div>

      {/* Filter Bar - consistent padding and styling */}
      <div className="flex-shrink-0 border-b bg-muted/30 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search input */}
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search contacts..." 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
              className="pl-9" 
            />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" disabled={isImporting}>
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowColumnCustomizer(true)}>
                <Settings className="w-4 h-4 mr-2" />
                Columns
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImportClick} disabled={isImporting}>
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
              {selectedContacts.length > 0 && (
                <DropdownMenuItem onClick={handleBulkDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Selected ({selectedContacts.length})
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Hidden file input for CSV import */}
      <input 
        ref={fileInputRef} 
        type="file" 
        accept=".csv" 
        onChange={handleImportCSV} 
        className="hidden" 
        disabled={isImporting} 
      />

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ContactTable 
          showColumnCustomizer={showColumnCustomizer} 
          setShowColumnCustomizer={setShowColumnCustomizer} 
          showModal={showModal} 
          setShowModal={setShowModal} 
          selectedContacts={selectedContacts} 
          setSelectedContacts={setSelectedContacts} 
          refreshTrigger={refreshTrigger}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          initialEditContactId={initialEditContactId}
          onInitialEditConsumed={() => setInitialEditContactId(null)}
        />
      </div>
    </div>
  );
};

export default Contacts;
