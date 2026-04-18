import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { useColumnPreferences } from "@/hooks/useColumnPreferences";
import { ContactTableBody } from "./contact-table/ContactTableBody";
import { ContactModal } from "./ContactModal";
import { ContactColumnCustomizer, ContactColumnConfig } from "./ContactColumnCustomizer";
import { StandardPagination } from "./shared/StandardPagination";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { fetchPaginatedData } from "@/utils/supabasePagination";

interface Contact {
  id: string;
  contact_name: string;
  company_name?: string;
  position?: string;
  email?: string;
  phone_no?: string;
  mobile_no?: string;
  region?: string;
  city?: string;
  state?: string;
  contact_owner?: string;
  created_time?: string;
  modified_time?: string;
  last_activity_time?: string;
  lead_status?: string;
  industry?: string;
  contact_source?: string;
  linkedin?: string;
  website?: string;
  description?: string;
  annual_revenue?: number;
  no_of_employees?: number;
  created_by?: string;
  modified_by?: string;
}

const defaultColumns: ContactColumnConfig[] = [
  { field: 'contact_name', label: 'Contact Name', visible: true, order: 0 },
  { field: 'company_name', label: 'Account', visible: true, order: 1 },
  { field: 'position', label: 'Position', visible: true, order: 2 },
  { field: 'email', label: 'Email', visible: true, order: 3 },
  { field: 'phone_no', label: 'Phone', visible: true, order: 4 },
  { field: 'region', label: 'Region', visible: true, order: 5 },
  { field: 'contact_owner', label: 'Contact Owner', visible: true, order: 6 },
  { field: 'industry', label: 'Industry', visible: true, order: 7 },
  { field: 'contact_source', label: 'Source', visible: true, order: 8 },
  { field: 'last_activity_time', label: 'Last Activity', visible: false, order: 9 },
];

interface ContactTableProps {
  showColumnCustomizer: boolean;
  setShowColumnCustomizer: (show: boolean) => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  selectedContacts: string[];
  setSelectedContacts: React.Dispatch<React.SetStateAction<string[]>>;
  refreshTrigger?: number;
  searchTerm?: string;
  setSearchTerm?: (term: string) => void;
}

export const ContactTable = ({ 
  showColumnCustomizer, 
  setShowColumnCustomizer, 
  showModal, 
  setShowModal,
  selectedContacts,
  setSelectedContacts,
  refreshTrigger,
  searchTerm = "",
  setSearchTerm
}: ContactTableProps) => {
  const { toast } = useToast();
  const { logDelete, logCreate } = useCRUDAudit();
  const [pageContacts, setPageContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<string | null>(null);
  const { columns, setColumns } = useColumnPreferences<ContactColumnConfig>('contacts', defaultColumns);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm]);

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);

      const result = await fetchPaginatedData<Contact>('contacts', {
        page: currentPage,
        pageSize: itemsPerPage,
        sortField: sortField || undefined,
        sortDirection,
        searchTerm: debouncedSearch || undefined,
        searchFields: ['contact_name', 'company_name', 'email'],
      });

      setPageContacts(result.data);
      setTotalCount(result.totalCount);
    } catch (error) {
      console.error('ContactTable: Error fetching contacts:', error);
      toast({
        title: "Error",
        description: "Failed to fetch contacts. Please refresh the page.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, sortField, sortDirection, debouncedSearch, toast]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchContacts();
    }
  }, [refreshTrigger, fetchContacts]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const contact = pageContacts.find(c => c.id === id);
      
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await logDelete('contacts', id, contact);

      toast({
        title: "Success",
        description: "Contact deleted successfully",
      });
      
      fetchContacts();
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: "Error",
        description: "Failed to delete contact",
        variant: "destructive",
      });
    }
  };

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setShowModal(true);
  };

  const visibleColumns = columns.filter(col => col.visible);
  const totalPages = Math.ceil(totalCount / itemsPerPage);

  // Render table chrome immediately; the body component shows skeleton rows while loading.


  const handleAddActionItem = (contact: Contact) => {
    toast({
      title: "Coming Soon",
      description: `Action item creation for ${contact.contact_name} will be available soon.`,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Table Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <ContactTableBody
          loading={loading}
          pageContacts={pageContacts}
          visibleColumns={visibleColumns}
          selectedContacts={selectedContacts}
          setSelectedContacts={setSelectedContacts}
          onEdit={handleEditContact}
          onDelete={(id) => {
            setContactToDelete(id);
            setShowDeleteDialog(true);
          }}
          searchTerm={searchTerm}
          onRefresh={fetchContacts}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          
          onAddActionItem={handleAddActionItem}
        />
      </div>

      {/* Always show pagination */}
      <StandardPagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalCount}
        itemsPerPage={itemsPerPage}
        onPageChange={setCurrentPage}
        onPageSizeChange={(size) => { setItemsPerPage(size); setCurrentPage(1); }}
        entityName="contacts"
      />

      {/* Modals */}
      <ContactModal
        open={showModal}
        onOpenChange={setShowModal}
        contact={editingContact}
        onSuccess={() => {
          fetchContacts();
          setEditingContact(null);
        }}
      />

      <ContactColumnCustomizer
        open={showColumnCustomizer}
        onOpenChange={setShowColumnCustomizer}
        columns={columns}
        onColumnsChange={setColumns}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the contact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (contactToDelete) {
                  handleDelete(contactToDelete);
                  setContactToDelete(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
