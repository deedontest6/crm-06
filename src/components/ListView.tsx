import { useState, useEffect, useMemo, useRef } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Deal, DealStage, DEAL_STAGES, STAGE_COLORS } from "@/types/deal";
import { Search, X, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, MoreHorizontal, ListTodo } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { InlineEditCell } from "./InlineEditCell";
import { DealColumnCustomizer, DealColumnConfig } from "./DealColumnCustomizer";
import { BulkActionsBar } from "./BulkActionsBar";
import { DealsAdvancedFilter, AdvancedFilterState } from "./DealsAdvancedFilter";
import { DealActionItemsModal } from "./DealActionItemsModal";
import { DealActionsDropdown } from "./DealActionsDropdown";
import { useToast } from "@/hooks/use-toast";
import { useDealsColumnPreferences } from "@/hooks/useDealsColumnPreferences";
interface ListViewProps {
  deals: Deal[];
  onDealClick: (deal: Deal) => void;
  onUpdateDeal: (dealId: string, updates: Partial<Deal>) => void;
  onDeleteDeals: (dealIds: string[]) => void;
  onImportDeals: (deals: Partial<Deal>[]) => void;
  headerActions?: React.ReactNode;
}

export const ListView = ({ 
  deals, 
  onDealClick, 
  onUpdateDeal, 
  onDeleteDeals, 
  onImportDeals,
  headerActions 
}: ListViewProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<AdvancedFilterState>({
    stages: [],
    regions: [],
    leadOwners: [],
    priorities: [],
    handoffStatuses: [],
    searchTerm: "",
    probabilityRange: [0, 100],
  });
  const [sortBy, setSortBy] = useState<string>("modified_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  
  // Action Items Modal state
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedDealForActions, setSelectedDealForActions] = useState<Deal | null>(null);

  // Column customizer state
  const [columnCustomizerOpen, setColumnCustomizerOpen] = useState(false);
  
  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [dealToDelete, setDealToDelete] = useState<string | null>(null);

  // Single active editor state
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);

  // Column width and visibility preferences from database
  const { columnWidths, columns, saveColumnWidths, saveColumns } = useDealsColumnPreferences();

  // Resize state
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const [tempColumnWidths, setTempColumnWidths] = useState<Record<string, number>>(columnWidths);
  const tableRef = useRef<HTMLTableElement>(null);

  // Sync temp widths with persisted widths when they change
  useEffect(() => {
    setTempColumnWidths(columnWidths);
  }, [columnWidths]);

  const { toast } = useToast();

  const formatCurrency = (amount: number | undefined, currency: string = 'EUR') => {
    if (!amount) return '-';
    const symbols = { USD: '$', EUR: '€', INR: '₹' };
    return `${symbols[currency as keyof typeof symbols] || '€'}${amount.toLocaleString()}`;
  };

  const formatDate = (date: string | undefined) => {
    if (!date) return '-';
    try {
      return format(new Date(date), 'MMM dd, yyyy');
    } catch {
      return '-';
    }
  };

  // Handle column resize
  const handleMouseDown = (e: React.MouseEvent, field: string) => {
    setIsResizing(field);
    setStartX(e.clientX);
    setStartWidth(tempColumnWidths[field] || 120);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    const newWidth = Math.max(80, startWidth + deltaX); // Minimum width of 80px
    
    setTempColumnWidths(prev => ({
      ...prev,
      [isResizing]: newWidth
    }));
  };

  const handleMouseUp = () => {
    if (isResizing) {
      // Save to database
      saveColumnWidths(tempColumnWidths);
      setIsResizing(null);
    }
  };

  // Mouse event listeners
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, startX, startWidth, tempColumnWidths]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedDeals(new Set(filteredAndSortedDeals.map(deal => deal.id)));
    } else {
      setSelectedDeals(new Set());
    }
  };

  const handleSelectDeal = (dealId: string, checked: boolean) => {
    const newSelected = new Set(selectedDeals);
    if (checked) {
      newSelected.add(dealId);
    } else {
      newSelected.delete(dealId);
    }
    setSelectedDeals(newSelected);
  };

  const handleBulkDelete = () => {
    if (selectedDeals.size === 0) return;
    
    onDeleteDeals(Array.from(selectedDeals));
    setSelectedDeals(new Set());
    
    toast({
      title: "Deals deleted",
      description: `Successfully deleted ${selectedDeals.size} deals`,
    });
  };

  const handleBulkExport = () => {
    const selectedDealObjects = deals.filter(deal => selectedDeals.has(deal.id));
    // Export logic handled by DealActionsDropdown
  };

  const handleInlineEdit = async (dealId: string, field: string, value: any) => {
    try {
      await onUpdateDeal(dealId, { [field]: value });
      toast({
        title: "Deal updated",
        description: "Field updated successfully",
      });
    } catch (error) {
      toast({
        title: "Update failed",
        description: "Failed to update deal field",
        variant: "destructive",
      });
    }
  };

  const getFieldType = (field: string): 'text' | 'number' | 'date' | 'select' | 'textarea' | 'boolean' | 'stage' | 'priority' | 'currency' => {
    if (field === 'stage') return 'stage';
    if (field === 'priority') return 'priority';
    if (['total_contract_value', 'total_revenue'].includes(field)) return 'currency';
    if (['expected_closing_date', 'start_date', 'end_date', 'proposal_due_date', 'rfq_received_date', 'signed_contract_date', 'implementation_start_date'].includes(field)) return 'date';
    if (['probability', 'project_duration', 'quarterly_revenue_q1', 'quarterly_revenue_q2', 'quarterly_revenue_q3', 'quarterly_revenue_q4'].includes(field)) return 'number';
    if (['customer_challenges', 'business_value', 'decision_maker_level'].includes(field)) return 'select';
    if (field === 'relationship_strength') return 'select';
    if (field === 'rfq_status') return 'select';
    if (field === 'handoff_status') return 'select';
    if (field === 'is_recurring') return 'select';
    if (field === 'currency_type') return 'select';
    if (['internal_comment', 'customer_need', 'action_items', 'won_reason', 'lost_reason', 'need_improvement', 'drop_reason'].includes(field)) return 'textarea';
    return 'text';
  };

  const getFieldOptions = (field: string): string[] => {
    const optionsMap: Record<string, string[]> = {
      customer_challenges: ['Open', 'Ongoing', 'Done'],
      business_value: ['Open', 'Ongoing', 'Done'],
      decision_maker_level: ['Open', 'Ongoing', 'Done'],
      relationship_strength: ['Low', 'Medium', 'High'],
      rfq_status: ['Drafted', 'Submitted', 'Rejected', 'Accepted'],
      handoff_status: ['Not Started', 'In Progress', 'Complete'],
      is_recurring: ['Yes', 'No', 'Unclear'],
      currency_type: ['EUR', 'USD', 'INR'],
    };
    return optionsMap[field] || [];
  };

  const visibleColumns = columns
    .filter(col => col.visible)
    .sort((a, b) => a.order - b.order);

  // Generate available options for multi-select filters
  const availableOptions = useMemo(() => {
    const regions = Array.from(new Set(deals.map(d => d.region).filter(Boolean)));
    const leadOwners = Array.from(new Set(deals.map(d => d.lead_owner).filter(Boolean)));
    const priorities = Array.from(new Set(deals.map(d => String(d.priority)).filter(p => p !== 'undefined')));
    const handoffStatuses = Array.from(new Set(deals.map(d => d.handoff_status).filter(Boolean)));
    
    return {
      regions,
      leadOwners,
      priorities,
      handoffStatuses,
    };
  }, [deals]);

  useEffect(() => {
    const savedFilters = localStorage.getItem('deals-filters');
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        setFilters(parsed);
        setSearchTerm(parsed.searchTerm || "");
      } catch (e) {
        console.error('Failed to parse saved filters:', e);
      }
    }
  }, []);

  useEffect(() => {
    const filtersWithSearch = { ...filters, searchTerm };
    localStorage.setItem('deals-filters', JSON.stringify(filtersWithSearch));
  }, [filters, searchTerm]);

  const filteredAndSortedDeals = deals
    .filter(deal => {
      // Combine search from both searchTerm and filters.searchTerm
      const allSearchTerms = [searchTerm, filters.searchTerm].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !allSearchTerms || 
        deal.deal_name?.toLowerCase().includes(allSearchTerms) ||
        deal.project_name?.toLowerCase().includes(allSearchTerms) ||
        deal.lead_name?.toLowerCase().includes(allSearchTerms) ||
        deal.customer_name?.toLowerCase().includes(allSearchTerms) ||
        deal.region?.toLowerCase().includes(allSearchTerms);
      
      // Apply multi-select filters
      const matchesStages = filters.stages.length === 0 || filters.stages.includes(deal.stage);
      const matchesRegions = filters.regions.length === 0 || filters.regions.includes(deal.region || '');
      const matchesLeadOwners = filters.leadOwners.length === 0 || filters.leadOwners.includes(deal.lead_owner || '');
      const matchesPriorities = filters.priorities.length === 0 || filters.priorities.includes(String(deal.priority || ''));
      const matchesHandoffStatuses = filters.handoffStatuses.length === 0 || filters.handoffStatuses.includes(deal.handoff_status || '');
      
      // Probability range filter
      const dealProbability = deal.probability || 0;
      const matchesProbabilityRange = dealProbability >= filters.probabilityRange[0] && dealProbability <= filters.probabilityRange[1];
      
      return matchesSearch && matchesStages && matchesRegions && matchesLeadOwners && 
             matchesPriorities && matchesHandoffStatuses && matchesProbabilityRange;
    })
    .sort((a, b) => {
      let aValue: any;
      let bValue: any;

      // Get the values for the sort field
      if (['priority', 'probability', 'project_duration'].includes(sortBy)) {
        aValue = a[sortBy as keyof Deal] || 0;
        bValue = b[sortBy as keyof Deal] || 0;
      } else if (['total_contract_value', 'total_revenue'].includes(sortBy)) {
        aValue = a[sortBy as keyof Deal] || 0;
        bValue = b[sortBy as keyof Deal] || 0;
      } else if (['expected_closing_date', 'start_date', 'end_date', 'created_at', 'modified_at', 'proposal_due_date'].includes(sortBy)) {
        const aDateValue = a[sortBy as keyof Deal];
        const bDateValue = b[sortBy as keyof Deal];
        aValue = new Date(typeof aDateValue === 'string' ? aDateValue : 0);
        bValue = new Date(typeof bDateValue === 'string' ? bDateValue : 0);
      } else {
        // String fields
        aValue = String(a[sortBy as keyof Deal] || '').toLowerCase();
        bValue = String(b[sortBy as keyof Deal] || '').toLowerCase();
      }

      if (sortOrder === "asc") {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedDeals.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedDeals = filteredAndSortedDeals.slice(startIndex, startIndex + itemsPerPage);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, searchTerm]);

  const getActiveFiltersCount = () => {
    let count = 0;
    if (filters.stages.length > 0) count++;
    if (filters.regions.length > 0) count++;
    if (filters.leadOwners.length > 0) count++;
    if (filters.priorities.length > 0) count++;
    if (filters.handoffStatuses.length > 0) count++;
    if (filters.searchTerm) count++;
    if (filters.probabilityRange[0] > 0 || filters.probabilityRange[1] < 100) count++;
    return count;
  };

  const clearAllFilters = () => {
    setFilters({
      stages: [],
      regions: [],
      leadOwners: [],
      priorities: [],
      handoffStatuses: [],
      searchTerm: "",
      probabilityRange: [0, 100],
    });
    setSearchTerm("");
  };

  const activeFiltersCount = getActiveFiltersCount();
  const hasActiveFilters = activeFiltersCount > 0 || searchTerm;

  // Get selected deal objects for export
  const selectedDealObjects = deals.filter(deal => selectedDeals.has(deal.id));

  const handleActionClick = (deal: Deal) => {
    setSelectedDealForActions(deal);
    setActionModalOpen(true);
  };

  // Handle page size change
  const handlePageSizeChange = (size: string) => {
    setItemsPerPage(Number(size));
    setCurrentPage(1);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Filter Bar - consistent with other modules */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search - responsive width like Action Items */}
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search all deal details..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 transition-all hover:border-primary/50 focus:border-primary"
            />
          </div>
          
          <DealsAdvancedFilter 
            filters={filters} 
            onFiltersChange={setFilters}
            availableRegions={availableOptions.regions}
            availableLeadOwners={availableOptions.leadOwners}
            availablePriorities={availableOptions.priorities}
            availableHandoffStatuses={availableOptions.handoffStatuses}
          />

          {hasActiveFilters && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={clearAllFilters}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
              Clear All
            </Button>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          <DealActionsDropdown
            deals={deals}
            onImport={onImportDeals}
            onRefresh={() => {}}
            selectedDeals={selectedDealObjects}
            onColumnCustomize={() => setColumnCustomizerOpen(true)}
            showColumns={true}
          />

          {headerActions}
        </div>
      </div>

      {/* Content Area - single scroll container */}
      <div className="flex-1 min-h-0 overflow-scroll always-show-scrollbars">
        <Table ref={tableRef} className="w-full">
          <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-20 border-b-2">
            <TableRow className="hover:bg-muted/60 transition-colors border-b">
              <TableHead className="w-10 min-w-10 py-3 px-3 h-11 bg-muted/80">
                  <Checkbox
                    checked={selectedDeals.size === paginatedDeals.length && paginatedDeals.length > 0}
                    onCheckedChange={handleSelectAll}
                    className="transition-all hover:scale-110"
                  />
                </TableHead>
              {visibleColumns.map(column => (
                <TableHead 
                  key={column.field} 
                  className="text-sm font-semibold cursor-pointer hover:bg-muted transition-colors relative bg-muted/80 py-3 px-3 h-11"
                  style={{ 
                    width: `${tempColumnWidths[column.field] || 120}px`,
                    minWidth: `${tempColumnWidths[column.field] || 120}px`,
                    maxWidth: `${tempColumnWidths[column.field] || 120}px`
                  }}
                  onClick={() => {
                    if (sortBy === column.field) {
                      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
                    } else {
                      setSortBy(column.field);
                      setSortOrder("desc");
                    }
                  }}
                >
                  <div className="flex items-center gap-2 pr-4 text-foreground whitespace-nowrap">
                    {column.label}
                    {sortBy !== column.field ? (
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/40" />
                    ) : (
                      sortOrder === "asc" ? <ArrowUp className="w-3 h-3 text-foreground" /> : <ArrowDown className="w-3 h-3 text-foreground" />
                    )}
                  </div>
                  <div
                    className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary/40 bg-transparent"
                    onMouseDown={(e) => handleMouseDown(e, column.field)}
                    style={{
                      background: isResizing === column.field ? 'hsl(var(--primary) / 0.5)' : undefined
                    }}
                  />
                </TableHead>
              ))}
              <TableHead className="w-20 min-w-20 bg-muted/80 py-3 px-3 h-11"></TableHead>
              </TableRow>
            </TableHeader>
          <TableBody>
            {filteredAndSortedDeals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length + 2} className="text-center py-8 text-muted-foreground">
                  No deals found
                </TableCell>
              </TableRow>
            ) : (
              paginatedDeals.map((deal) => (
                <TableRow 
                  key={deal.id} 
                  className={`group hover:bg-muted/30 transition-all ${
                    selectedDeals.has(deal.id) ? 'bg-primary/5' : 'even:bg-muted/10'
                  }`}
                >
                  <TableCell className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedDeals.has(deal.id)}
                      onCheckedChange={(checked) => handleSelectDeal(deal.id, Boolean(checked))}
                    />
                  </TableCell>
                  {visibleColumns.map(column => (
                    <TableCell 
                      key={column.field} 
                      className="text-sm py-2 px-3"
                      style={{ 
                        width: `${tempColumnWidths[column.field] || 120}px`,
                        minWidth: `${tempColumnWidths[column.field] || 120}px`,
                        maxWidth: `${tempColumnWidths[column.field] || 120}px`
                      }}
                    >
                      <InlineEditCell
                        value={deal[column.field as keyof Deal]}
                        field={column.field}
                        dealId={deal.id}
                        onSave={handleInlineEdit}
                        type={getFieldType(column.field)}
                        options={getFieldOptions(column.field)}
                        isEditing={editingCellKey === `${deal.id}-${column.field}`}
                        onEditStart={() => setEditingCellKey(`${deal.id}-${column.field}`)}
                        onEditEnd={() => setEditingCellKey(null)}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex justify-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onDealClick(deal)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleActionClick(deal)}>
                            <ListTodo className="h-4 w-4 mr-2" />
                            Action Items
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            onClick={() => {
                              setDealToDelete(deal.id);
                              setDeleteDialogOpen(true);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Bulk Actions Bar */}
      {selectedDeals.size > 0 && (
        <div className="flex-shrink-0 border-t bg-primary/5">
          <BulkActionsBar
            selectedCount={selectedDeals.size}
            onDelete={handleBulkDelete}
            onExport={handleBulkExport}
            onClearSelection={() => setSelectedDeals(new Set())}
          />
        </div>
      )}

      {/* Standard Pagination Footer - matching Action Items */}
      {filteredAndSortedDeals.length > 0 && (
        <div className="flex-shrink-0 border-t bg-background px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredAndSortedDeals.length)} of {filteredAndSortedDeals.length} deals
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Show:</span>
                <Select value={itemsPerPage.toString()} onValueChange={handlePageSizeChange}>
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
                className="shadow-sm"
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
                className="shadow-sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this deal? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (dealToDelete) {
                  onDeleteDeals([dealToDelete]);
                  toast({
                    title: "Deal deleted",
                    description: "Deal has been successfully deleted",
                  });
                }
                setDealToDelete(null);
                setDeleteDialogOpen(false);
              }} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DealActionItemsModal
        open={actionModalOpen}
        onOpenChange={setActionModalOpen}
        deal={selectedDealForActions}
      />

      <DealColumnCustomizer
        open={columnCustomizerOpen}
        onOpenChange={setColumnCustomizerOpen}
        columns={columns}
        onColumnsChange={saveColumns}
      />
    </div>
  );
};
