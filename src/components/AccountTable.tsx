import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCRUDAudit } from "@/hooks/useCRUDAudit";
import { useColumnPreferences } from "@/hooks/useColumnPreferences";
import { Button } from "@/components/ui/button";
import { Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { AccountTableBody } from "./account-table/AccountTableBody";
import { AccountModal } from "./AccountModal";
import { AccountColumnCustomizer, AccountColumnConfig } from "./AccountColumnCustomizer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { fetchPaginatedData } from "@/utils/supabasePagination";

interface Account {
  id: string;
  account_name: string;
  phone?: string;
  website?: string;
  industry?: string;
  company_type?: string;
  country?: string;
  region?: string;
  status?: string;
  description?: string;
  account_owner?: string;
  created_by?: string;
  modified_by?: string;
  created_time?: string;
  modified_time?: string;
  last_activity_time?: string;
  currency?: string;
}

const defaultColumns: AccountColumnConfig[] = [
  { field: 'account_name', label: 'Account Name', visible: true, order: 0 },
  { field: 'description', label: 'Description', visible: true, order: 1 },
  { field: 'linked_contacts', label: 'Linked', visible: true, order: 2 },
  { field: 'status', label: 'Status', visible: true, order: 3 },
  { field: 'company_type', label: 'Company Type', visible: true, order: 4 },
  { field: 'industry', label: 'Industry', visible: true, order: 5 },
  { field: 'phone', label: 'Phone', visible: true, order: 6 },
  { field: 'website', label: 'Website', visible: true, order: 7 },
  { field: 'country', label: 'Country', visible: true, order: 8 },
  { field: 'region', label: 'Region', visible: true, order: 9 },
  { field: 'currency', label: 'Currency', visible: true, order: 10 },
  { field: 'created_time', label: 'Created', visible: false, order: 11 },
  { field: 'account_owner', label: 'Account Owner', visible: true, order: 12 },
];

interface AccountTableProps {
  showColumnCustomizer: boolean;
  setShowColumnCustomizer: (show: boolean) => void;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  selectedAccounts: string[];
  setSelectedAccounts: React.Dispatch<React.SetStateAction<string[]>>;
  refreshTrigger?: number;
  searchTerm?: string;
  statusFilter?: string;
  ownerFilter?: string;
}

export const AccountTable = ({ 
  showColumnCustomizer, 
  setShowColumnCustomizer, 
  showModal, 
  setShowModal,
  selectedAccounts,
  setSelectedAccounts,
  refreshTrigger,
  searchTerm = "",
  statusFilter = "all",
  ownerFilter = "all",
}: AccountTableProps) => {
  const { toast } = useToast();
  const { logDelete, logBulkDelete } = useCRUDAudit();
  const [pageAccounts, setPageAccounts] = useState<Account[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<string | null>(null);
  const { columns, setColumns } = useColumnPreferences<AccountColumnConfig>('accounts', defaultColumns);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // contactCounts derived from cached query below

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, ownerFilter]);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);

      const filters: Record<string, string> = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      if (ownerFilter !== 'all') filters.account_owner = ownerFilter;

      const result = await fetchPaginatedData<Account>('accounts', {
        page: currentPage,
        pageSize: itemsPerPage,
        sortField: sortField || undefined,
        sortDirection,
        searchTerm: debouncedSearch || undefined,
        searchFields: ['account_name', 'description', 'phone', 'country', 'industry', 'company_type', 'website'],
        filters,
      });

      setPageAccounts(result.data);
      setTotalCount(result.totalCount);
    } catch (error) {
      console.error('AccountTable: Error fetching accounts:', error);
      toast({ title: "Error", description: "Failed to fetch accounts.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, sortField, sortDirection, debouncedSearch, statusFilter, ownerFilter, toast]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) fetchAccounts();
  }, [refreshTrigger, fetchAccounts]);

  // Fetch linked contact counts for visible accounts (cached per visible-name set)
  const visibleAccountNames = useMemo(
    () => pageAccounts.map((a) => a.account_name).filter(Boolean).sort(),
    [pageAccounts]
  );

  const { data: contactCounts = {} } = useQuery({
    queryKey: ['account-contact-counts', visibleAccountNames.join('|')],
    enabled: visibleAccountNames.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('company_name')
        .in('company_name', visibleAccountNames);

      const counts: Record<string, number> = {};
      if (!error && data) {
        data.forEach((row: any) => {
          const name = row.company_name;
          if (name) counts[name] = (counts[name] || 0) + 1;
        });
      }
      return counts;
    },
  });

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
      const { error } = await supabase.from('accounts').delete().eq('id', id);
      if (error) throw error;
      const deletedAccount = pageAccounts.find(a => a.id === id);
      await logDelete('accounts', id, deletedAccount);
      toast({ title: "Success", description: "Account deleted successfully" });
      fetchAccounts();
    } catch (error) {
      console.error('Delete error:', error);
      toast({ title: "Error", description: "Failed to delete account", variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedAccounts.length === 0) return;
    try {
      const { error } = await supabase.from('accounts').delete().in('id', selectedAccounts);
      if (error) throw error;
      await logBulkDelete('accounts', selectedAccounts.length, selectedAccounts);
      toast({ title: "Success", description: `${selectedAccounts.length} account${selectedAccounts.length !== 1 ? 's' : ''} deleted successfully` });
      setSelectedAccounts([]);
      fetchAccounts();
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast({ title: "Error", description: "Failed to delete accounts", variant: "destructive" });
    }
    setShowBulkDeleteDialog(false);
  };

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account);
    setShowModal(true);
  };

  const visibleColumns = columns.filter(col => col.visible);
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalCount);

  // Render table chrome immediately; the body component shows skeleton rows while loading.

  return (
    <div className="flex flex-col h-full">
      {selectedAccounts.length > 0 && (
        <div className="flex-shrink-0 px-4 py-1.5 border-b bg-background">
          <Button variant="destructive" size="sm" onClick={() => setShowBulkDeleteDialog(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Selected ({selectedAccounts.length})
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <AccountTableBody
          loading={loading}
          pageAccounts={pageAccounts}
          visibleColumns={visibleColumns}
          selectedAccounts={selectedAccounts}
          setSelectedAccounts={setSelectedAccounts}
          onEdit={handleEditAccount}
          onDelete={(id) => { setAccountToDelete(id); setShowDeleteDialog(true); }}
          searchTerm={searchTerm}
          onRefresh={fetchAccounts}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          contactCounts={contactCounts}
        />
      </div>

      {/* Pagination Footer */}
      <div className="flex-shrink-0 border-t bg-background px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Showing {totalCount === 0 ? 0 : startIndex + 1}-{endIndex} of {totalCount} accounts
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Show:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm px-2">
              Page {currentPage} of {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AccountModal
        open={showModal}
        onOpenChange={(open) => { setShowModal(open); if (!open) setEditingAccount(null); }}
        account={editingAccount}
        onSuccess={() => { fetchAccounts(); setEditingAccount(null); }}
      />
      <AccountColumnCustomizer open={showColumnCustomizer} onOpenChange={setShowColumnCustomizer} columns={columns} onColumnsChange={setColumns} />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone. This will permanently delete the account.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (accountToDelete) { handleDelete(accountToDelete); setAccountToDelete(null); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedAccounts.length} Account{selectedAccounts.length !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
