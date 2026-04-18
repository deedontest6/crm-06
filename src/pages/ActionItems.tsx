import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Plus, Search, Trash2, CheckCircle, X, List, LayoutGrid, Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useActionItems, ActionItem, ActionItemStatus, ActionItemPriority, CreateActionItemInput } from '@/hooks/useActionItems';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ActionItemsTable } from '@/components/ActionItemsTable';
import { ActionItemsKanban } from '@/components/ActionItemsKanban';
import { ActionItemsCalendar } from '@/components/ActionItemsCalendar';
import { ActionItemModal } from '@/components/ActionItemModal';
import { useAllUsers } from '@/hooks/useUserDisplayNames';
import { useActionItemColumnPreferences } from '@/hooks/useActionItemColumnPreferences';
import { Badge } from '@/components/ui/badge';

type ViewMode = 'list' | 'kanban' | 'calendar';
export default function ActionItems() {
  const {
    toast
  } = useToast();
  const {
    actionItems,
    isLoading,
    filters,
    updateFilter,
    resetFilters,
    createActionItem,
    updateActionItem,
    deleteActionItem,
    bulkUpdateStatus,
    bulkDelete
  } = useActionItems();
  const {
    users
  } = useAllUsers();
  const {
    columnWidths,
    updateColumnWidth
  } = useActionItemColumnPreferences();
  

  // URL params for highlight from notifications
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [highlightProcessed, setHighlightProcessed] = useState(false);

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Pagination state
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Sorting state
  const [sortField, setSortField] = useState<string | null>('due_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Selection and modal state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ActionItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Helper to check if string is a UUID
  const isUuid = useCallback((str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str), []);

  // Handle highlight from notification/email click
  useEffect(() => {
    if (!highlightId || highlightProcessed) return;
    if (isLoading) return; // wait for initial load

    const findAndOpenItem = async () => {
      // 1. Try local list first (by id or title for backward compat)
      let found = actionItems.find(a => a.id === highlightId || a.title === highlightId);

      // 2. If not in local list, query DB directly
      if (!found) {
        try {
          if (isUuid(highlightId)) {
            const { data } = await supabase
              .from('action_items')
              .select('*')
              .eq('id', highlightId)
              .maybeSingle();
            if (data) found = data as unknown as ActionItem;
          }
          // Fallback: title-based lookup (old email links)
          if (!found) {
            const { data } = await supabase
              .from('action_items')
              .select('*')
              .ilike('title', highlightId)
              .limit(1)
              .maybeSingle();
            if (data) found = data as unknown as ActionItem;
          }
        } catch (err) {
          console.error('Error fetching highlighted action item:', err);
        }
      }

      if (found) {
        setEditingItem(found);
        setModalOpen(true);
      } else {
        toast({
          title: "Item not found",
          description: "The action item you're looking for may have been deleted."
        });
      }

      setSearchParams({}, { replace: true });
      setHighlightProcessed(true);
    };

    findAndOpenItem();
  }, [highlightId, actionItems, isLoading, highlightProcessed, isUuid, setSearchParams, toast]);

  // Reset processed state when highlightId changes
  useEffect(() => {
    if (highlightId) {
      setHighlightProcessed(false);
    }
  }, [highlightId]);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const hasActiveFilters = filters.module_type !== 'all' || filters.priority !== 'all' || filters.status !== 'all' || filters.assigned_to !== 'all' || filters.search !== '' || (filters as any).campaign_filter !== undefined;

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.module_type, filters.priority, filters.status, filters.assigned_to, filters.search, filters.showArchived]);

  // Sort action items (memoized — avoids re-sorting 70+ items on every render)
  const sortedActionItems = useMemo(() => {
    return [...actionItems].sort((a, b) => {
      if (!sortField) return 0;
      let aValue: any = a[sortField as keyof ActionItem];
      let bValue: any = b[sortField as keyof ActionItem];

      // Handle null/undefined values
      if (aValue === null || aValue === undefined) aValue = '';
      if (bValue === null || bValue === undefined) bValue = '';

      // String comparison
      const comparison = String(aValue).localeCompare(String(bValue));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [actionItems, sortField, sortDirection]);

  // Pagination calculations
  const totalItems = sortedActionItems.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Paginated items for list view (memoized)
  const paginatedItems = useMemo(
    () => sortedActionItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedActionItems, currentPage, pageSize]
  );

  // Reset to page 1 when filters change or page size changes
  const handlePageSizeChange = (size: string) => {
    setPageSize(Number(size));
    setCurrentPage(1);
  };
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };
  const handleCreateNew = () => {
    setEditingItem(null);
    setModalOpen(true);
  };
  const handleEdit = (item: ActionItem) => {
    // Look up fresh data from current actionItems to avoid stale modal
    const freshItem = actionItems.find(a => a.id === item.id) || item;
    setEditingItem(freshItem);
    setModalOpen(true);
  };
  const handleSave = async (data: CreateActionItemInput) => {
    if (editingItem) {
      await updateActionItem({
        id: editingItem.id,
        ...data
      });
    } else {
      await createActionItem(data);
    }
    setEditingItem(null);
  };
  const handleDelete = (id: string) => {
    setItemToDelete(id);
    setDeleteDialogOpen(true);
  };
  const confirmDelete = async () => {
    if (itemToDelete) {
      await deleteActionItem(itemToDelete);
      setItemToDelete(null);
    }
    setDeleteDialogOpen(false);
  };
  const handleStatusChange = async (id: string, status: ActionItemStatus) => {
    try {
      await updateActionItem({ id, status });
      if (status === 'Completed' && !filters.showArchived) {
        toast({ title: "Item completed", description: "Moved to the Completed view." });
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };
  const handlePriorityChange = async (id: string, priority: ActionItemPriority) => {
    try {
      await updateActionItem({ id, priority });
    } catch (error) {
      console.error('Failed to update priority:', error);
    }
  };
  const handleAssignedToChange = async (id: string, userId: string | null) => {
    try {
      await updateActionItem({ id, assigned_to: userId });
    } catch (error) {
      console.error('Failed to update assignee:', error);
    }
  };
  const handleDueDateChange = async (id: string, date: string | null) => {
    try {
      await updateActionItem({ id, due_date: date });
    } catch (error) {
      console.error('Failed to update due date:', error);
    }
  };
  const handleBulkComplete = async () => {
    if (selectedIds.length === 1) {
      await updateActionItem({
        id: selectedIds[0],
        status: 'Completed'
      });
    } else {
      await bulkUpdateStatus({
        ids: selectedIds,
        status: 'Completed'
      });
    }
    setSelectedIds([]);
  };
  const handleBulkDelete = async () => {
    await bulkDelete(selectedIds);
    setSelectedIds([]);
    setBulkDeleteDialogOpen(false);
  };
  return <div className="flex flex-col h-full overflow-hidden">
      {/* Header - fixed height matching sidebar */}
      <div className="flex-shrink-0 h-16 border-b bg-background px-6 flex items-center">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-2xl font-semibold text-foreground">Action Items</h1>
          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <ToggleGroup type="single" value={viewMode} onValueChange={value => value && setViewMode(value as ViewMode)}>
              <ToggleGroupItem value="list" aria-label="List view" className="px-3">
                <List className="h-4 w-4 mr-1" />
                List
              </ToggleGroupItem>
              <ToggleGroupItem value="kanban" aria-label="Kanban view" className="px-3">
                <LayoutGrid className="h-4 w-4 mr-1" />
                Kanban
              </ToggleGroupItem>
              <ToggleGroupItem value="calendar" aria-label="Calendar view" className="px-3">
                <Calendar className="h-4 w-4 mr-1" />
                Calendar
              </ToggleGroupItem>
            </ToggleGroup>
            
            <Button onClick={handleCreateNew}>
              <Plus className="mr-2 h-4 w-4" />
              Add Action Item
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b bg-muted/30 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search action items..." value={filters.search} onChange={e => updateFilter('search', e.target.value)} className="pl-9" />
          </div>


          {/* Module Type Filter */}
          <Select value={filters.module_type} onValueChange={value => updateFilter('module_type', value)}>
            <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              <SelectItem value="accounts">Accounts</SelectItem>
              <SelectItem value="contacts">Contacts</SelectItem>
              <SelectItem value="deals">Deals</SelectItem>
              <SelectItem value="campaigns">Campaigns</SelectItem>
            </SelectContent>
          </Select>

          {/* Priority Filter */}
          <Select value={filters.priority} onValueChange={value => updateFilter('priority', value)}>
            <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={filters.status} onValueChange={value => updateFilter('status', value)}>
            <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Open">Open</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Completed">Completed</SelectItem>
              <SelectItem value="Cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          {/* Assigned To Filter */}
          <Select value={filters.assigned_to} onValueChange={value => updateFilter('assigned_to', value)}>
            <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
              <SelectValue placeholder="Assigned To" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              {users.map(user => <SelectItem key={user.id} value={user.id}>
                  {user.display_name}
                </SelectItem>)}
            </SelectContent>
          </Select>

          {hasActiveFilters && <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="mr-1 h-4 w-4" />
              Clear Filters
            </Button>}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Archived Toggle - Right side */}
          <Button variant={filters.showArchived ? "secondary" : "outline"} size="sm" onClick={() => updateFilter('showArchived', filters.showArchived ? 'false' : 'true')} className="flex items-center gap-1.5">
            Completed
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && viewMode === 'list' && <div className="border-b bg-primary/5 px-6 py-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {selectedIds.length} item{selectedIds.length > 1 ? 's' : ''} selected
            </span>
            <Button variant="outline" size="sm" onClick={handleBulkComplete}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Mark Complete
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkDeleteDialogOpen(true)} className="text-destructive hover:text-destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              Clear Selection
            </Button>
          </div>
        </div>}

      {/* Content Area */}
      <div className={viewMode === 'list' ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-auto p-6'}>
        {isLoading ? <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div> : <>
            {viewMode === 'list' && <div className="h-full overflow-auto">
                <ActionItemsTable actionItems={paginatedItems} selectedIds={selectedIds} onSelectionChange={setSelectedIds} onEdit={handleEdit} onDelete={handleDelete} onStatusChange={handleStatusChange} onPriorityChange={handlePriorityChange} onAssignedToChange={handleAssignedToChange} onDueDateChange={handleDueDateChange} sortField={sortField} sortDirection={sortDirection} onSort={handleSort} columnWidths={columnWidths} onColumnResize={updateColumnWidth} />
              </div>}
            {viewMode === 'kanban' && <ActionItemsKanban actionItems={actionItems} onEdit={handleEdit} onDelete={handleDelete} onStatusChange={handleStatusChange} />}
            {viewMode === 'calendar' && <ActionItemsCalendar actionItems={actionItems} onEdit={handleEdit} />}
          </>}
      </div>

      {/* Pagination Footer - only for list view */}
      {viewMode === 'list' && totalItems > 0 && <div className="border-t bg-background px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                Showing {startItem}-{endItem} of {totalItems} action items
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Show:</span>
                <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
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
              
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm px-2">
                Page {currentPage} of {totalPages || 1}
              </span>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage >= totalPages}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
              
            </div>
          </div>
        </div>}

      {/* Action Item Modal */}
      <ActionItemModal open={modalOpen} onOpenChange={setModalOpen} actionItem={editingItem} onSave={handleSave} />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Action Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this action item? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.length} Action Items</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.length} action item
              {selectedIds.length > 1 ? 's' : ''}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>;
}