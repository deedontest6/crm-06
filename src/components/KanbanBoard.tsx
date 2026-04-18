import { Fragment, useState, useMemo, useEffect, useCallback, useRef } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Deal, DealStage, DEAL_STAGES, STAGE_COLORS } from "@/types/deal";
import { DealCard } from "./DealCard";
import { InlineDetailsPanel } from "./kanban/InlineDetailsPanel";
import { KanbanActionItemModal } from "./kanban/KanbanActionItemModal";
import type { ActionItem } from "@/hooks/useActionItems";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Plus, Search, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BulkActionsBar } from "./BulkActionsBar";
import { DealsAdvancedFilter, AdvancedFilterState } from "./DealsAdvancedFilter";
import { AnimatedStageHeaders } from "./kanban/AnimatedStageHeaders";
import { cn } from "@/lib/utils";

interface KanbanBoardProps {
  deals: Deal[];
  onUpdateDeal: (dealId: string, updates: Partial<Deal>) => Promise<void>;
  onDealClick: (deal: Deal) => void;
  onCreateDeal: (stage: DealStage) => void;
  onDeleteDeals: (dealIds: string[]) => void;
  onImportDeals: (deals: Partial<Deal>[]) => void;
  onRefresh: () => void;
  headerActions?: React.ReactNode;
}

export const KanbanBoard = ({ 
  deals, 
  onUpdateDeal, 
  onDealClick, 
  onCreateDeal, 
  onDeleteDeals, 
  onImportDeals,
  onRefresh,
  headerActions 
}: KanbanBoardProps) => {
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedDeal, setExpandedDeal] = useState<{
    dealId: string;
    stageIndex: number;
  } | null>(null);
  const [filters, setFilters] = useState<AdvancedFilterState>({
    stages: [],
    regions: [],
    leadOwners: [],
    priorities: [],
    handoffStatuses: [],
    searchTerm: "",
    probabilityRange: [0, 100],
  });
  const { toast } = useToast();
  
  // Transition state machine for smooth expand/collapse animations
  type TransitionState = 'idle' | 'expanding' | 'expanded' | 'collapsing';
  const [transition, setTransition] = useState<TransitionState>('idle');
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<DealStage | null>(null);
  const [pendingExpandId, setPendingExpandId] = useState<string | null>(null);
  const [detailsSpacerHeight, setDetailsSpacerHeight] = useState<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollPosition = useRef<{ top: number; left: number }>({ top: 0, left: 0 });
  const TRANSITION_MS = 300;
   
   // Action item modal state — useActionItems() is lazy-mounted inside KanbanActionItemModal
   const [actionModalOpen, setActionModalOpen] = useState(false);
   const [editingActionItem, setEditingActionItem] = useState<ActionItem | null>(null);
   const [actionModalDealId, setActionModalDealId] = useState<string | null>(null);
   
   // Add Detail modal state (triggered from AnimatedStageHeaders "Add" button)
   const [addDetailOpen, setAddDetailOpen] = useState(false);

  // Handle keyboard escape to close expanded panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (transition === 'expanded' || transition === 'expanding')) {
        beginCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transition]);

  // Handle transition state changes
  useEffect(() => {
    if (transition === 'expanding') {
      const timer = setTimeout(() => setTransition('expanded'), TRANSITION_MS);
      return () => clearTimeout(timer);
    }
    if (transition === 'collapsing') {
      const timer = setTimeout(() => {
        setTransition('idle');
        setExpandedDealId(null);
        // Restore scroll position after collapse
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            top: savedScrollPosition.current.top,
            left: savedScrollPosition.current.left,
            behavior: 'smooth',
          });
        }
        // Handle pending expand (switching deals)
        if (pendingExpandId) {
          const nextId = pendingExpandId;
          setPendingExpandId(null);
          setTimeout(() => beginExpand(nextId), 50);
        }
      }, TRANSITION_MS);
      return () => clearTimeout(timer);
    }
  }, [transition, pendingExpandId]);

  // Begin expand animation
  const beginExpand = useCallback((dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;
    
    // Exit selection mode when expanding
    if (selectionMode) {
      setSelectionMode(false);
      setSelectedDeals(new Set());
    }
    // Save scroll position before expanding
    if (scrollContainerRef.current) {
      savedScrollPosition.current = {
        top: scrollContainerRef.current.scrollTop,
        left: scrollContainerRef.current.scrollLeft,
      };
      
      // Card offset will be measured post-layout in a useEffect
    }
    setExpandedDealId(dealId);
    setExpandedStage(deal.stage as DealStage);
    setTransition('expanding');
  }, [selectionMode, deals]);

  // Begin collapse animation
  const beginCollapse = useCallback(() => {
    setTransition('collapsing');
  }, []);
  
  // Clear expanded stage after collapse animation completes
  useEffect(() => {
    if (transition === 'idle') {
      // Don't clear immediately - let state settle
      const timer = setTimeout(() => {
        if (transition === 'idle') {
          setExpandedStage(null);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [transition]);

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
    const savedFilters = localStorage.getItem('deals-kanban-filters');
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
    localStorage.setItem('deals-kanban-filters', JSON.stringify(filtersWithSearch));
  }, [filters, searchTerm]);

  const filterDeals = (deals: Deal[]) => {
    return deals.filter(deal => {
      // Combine search from both searchTerm and filters.searchTerm
      const allSearchTerms = [searchTerm, filters.searchTerm].filter(Boolean).join(' ').toLowerCase();
      const searchMatch = !allSearchTerms || 
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
      
      return searchMatch && matchesStages && matchesRegions && matchesLeadOwners && 
             matchesPriorities && matchesHandoffStatuses && matchesProbabilityRange;
    });
  };

  const getDealsByStage = (stage: DealStage) => {
    const filteredDeals = filterDeals(deals);
    return filteredDeals.filter(deal => deal.stage === stage);
  };

  const getVisibleStages = () => {
    const leadDeals = getDealsByStage('Lead');
    const lostDeals = getDealsByStage('Lost');
    const droppedDeals = getDealsByStage('Dropped');
    
    return DEAL_STAGES.filter(stage => {
      if (stage === 'Lead') return leadDeals.length > 0;
      if (stage === 'Lost') return lostDeals.length > 0;
      if (stage === 'Dropped') return droppedDeals.length > 0;
      return true;
    });
  };

  const onDragStart = (start: any) => {
    setDraggedDeal(start.draggableId);
  };

  const onDragEnd = async (result: DropResult) => {
    setDraggedDeal(null);
    
    if (!result.destination) return;

    const { draggableId, destination } = result;
    const newStage = destination.droppableId as DealStage;
    const deal = deals.find(d => d.id === draggableId);
    
    if (!deal || deal.stage === newStage) return;

    console.log(`Moving deal from ${deal.stage} to ${newStage}`);

    try {
      console.log(`Moving deal ${draggableId} to stage ${newStage}`);
      
      // Create update object with the new stage
      const updates: Partial<Deal> = {
        stage: newStage
      };
      
      await onUpdateDeal(draggableId, updates);
      
      toast({
        title: "Deal Updated",
        description: `Deal moved to ${newStage} stage`,
      });
    } catch (error) {
      console.error("Error updating deal stage:", error);
      toast({
        title: "Error",
        description: "Failed to update deal stage",
        variant: "destructive",
      });
    }
  };

  const handleSelectDeal = (dealId: string, checked: boolean, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    
    const newSelected = new Set(selectedDeals);
    if (checked) {
      newSelected.add(dealId);
    } else {
      newSelected.delete(dealId);
    }
    setSelectedDeals(newSelected);
  };

  const handleSelectAllInStage = (stage: DealStage, checked: boolean) => {
    const stageDeals = getDealsByStage(stage);
    const newSelected = new Set(selectedDeals);
    
    stageDeals.forEach(deal => {
      if (checked) {
        newSelected.add(deal.id);
      } else {
        newSelected.delete(deal.id);
      }
    });
    
    setSelectedDeals(newSelected);
  };

  const handleBulkDelete = () => {
    if (selectedDeals.size === 0) return;
    
    onDeleteDeals(Array.from(selectedDeals));
    setSelectedDeals(new Set());
    setSelectionMode(false);
    
    toast({
      title: "Deals deleted",
      description: `Successfully deleted ${selectedDeals.size} deals`,
    });
  };

  const handleBulkExport = () => {
    // Export logic handled by ImportExportBar
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) {
      setSelectedDeals(new Set());
    }
  };

  const handleDealCardAction = async (dealId: string, newStage: DealStage) => {
    try {
      console.log(`Card action: Moving deal ${dealId} to stage ${newStage}`);
      
      // Create update object with the new stage
      const updates: Partial<Deal> = {
        stage: newStage
      };
      
      await onUpdateDeal(dealId, updates);
      
      toast({
        title: "Deal Updated",
        description: `Deal moved to ${newStage} stage`,
      });
    } catch (error) {
      console.error("Error updating deal stage:", error);
      toast({
        title: "Error",
        description: "Failed to update deal stage",
        variant: "destructive",
      });
    }
  };

  // Get selected deal objects for export
  const selectedDealObjects = deals.filter(deal => selectedDeals.has(deal.id));

  const visibleStages = getVisibleStages();


  // Layout-safe scroll helper: waits for 3 animation frames before measuring
  const performLayoutSafeScroll = useCallback(() => {
    if (!scrollContainerRef.current || !expandedDealId || !expandedStage) return;

    const container = scrollContainerRef.current;
    
    // Triple rAF ensures full layout reflow after grid column changes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!container) return;

          // Measure sticky header height dynamically
          const stickyHeader = container.querySelector('.sticky.top-0');
          const stickyHeaderHeight = stickyHeader?.getBoundingClientRect().height || 65;

          // Find the stage column element
          const stageEl = container.querySelector(`[data-stage-column="${expandedStage}"]`);
          const cardEl = container.querySelector(`[data-deal-id="${expandedDealId}"]`);

          if (!stageEl) return;

          const paddingMargin = 8;

          // Horizontal: scroll so the expanded stage column is at the left edge
          let targetScrollLeft = (stageEl as HTMLElement).offsetLeft - paddingMargin;

          // Clamp horizontal scroll to valid range
          const maxScrollLeft = container.scrollWidth - container.clientWidth;
          targetScrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));

          // Vertical: scroll so the expanded card is near the top (below sticky header)
          let targetScrollTop = 0;
          if (cardEl) {
            const cardOffsetTop = (cardEl as HTMLElement).offsetTop;
            targetScrollTop = cardOffsetTop - stickyHeaderHeight - paddingMargin;
            const maxScrollTop = container.scrollHeight - container.clientHeight;
            targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
          }


          container.scrollTo({
            left: targetScrollLeft,
            top: targetScrollTop,
            behavior: 'smooth'
          });
        });
      });
    });
  }, [expandedDealId, expandedStage]);

  // Post-layout measurement: measure expanded card's vertical offset within its stage column
  useEffect(() => {
    if ((transition === 'expanding' || transition === 'expanded') && expandedDealId && expandedStage && scrollContainerRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const container = scrollContainerRef.current;
            if (!container) return;
            
            const cardEl = container.querySelector(`[data-deal-id="${expandedDealId}"]`);
            const stageCol = container.querySelector(`[data-stage-column="${expandedStage}"]`);
            
            if (cardEl && stageCol) {
              const stageRect = stageCol.getBoundingClientRect();
              const cardRect = cardEl.getBoundingClientRect();
              const offset = cardRect.top - stageRect.top;
              setDetailsSpacerHeight(Math.max(0, offset));
            }
          });
        });
      });
    }
  }, [transition, expandedDealId, expandedStage]);

  // Auto-scroll when expansion starts, with post-transition correction
  useEffect(() => {
    if (transition === 'expanding' && expandedStage && scrollContainerRef.current) {
      // Initial scroll after layout settles
      performLayoutSafeScroll();

      // Post-transition correction (grid animation may shift elements)
      const correctionTimer = setTimeout(() => {
        performLayoutSafeScroll();
      }, TRANSITION_MS + 50);

      return () => clearTimeout(correctionTimer);
    }
  }, [transition, expandedStage, performLayoutSafeScroll]);

   // Handle opening action item modal from expanded panel
   const handleOpenActionItemModal = (actionItem?: any) => {
     // Capture the current deal ID at the time of opening
     setActionModalDealId(expandedDealId);
     if (actionItem?.id) {
       // Convert to ActionItem type for editing
       setEditingActionItem(actionItem as ActionItem);
     } else {
       setEditingActionItem(null);
     }
     setActionModalOpen(true);
   };
 
   // Save handler now lives inside KanbanActionItemModal (lazy-mounted)
 
  // Get grid columns - insert expanded panel column when needed
  const getGridColumns = () => {
    const isInlineExpanded = (transition === 'expanded' || transition === 'expanding' || transition === 'collapsing') && expandedStage;
    
    if (isInlineExpanded) {
      const expandedIndex = visibleStages.indexOf(expandedStage);
      const beforeCount = expandedIndex;
      const afterCount = visibleStages.length - expandedIndex - 1;
      
      // Grid: [before stages] [expanded stage 280px] [details ~50%] [after stages]
      const parts: string[] = [];
      if (beforeCount > 0) parts.push(`repeat(${beforeCount}, minmax(240px, 1fr))`);
      parts.push('minmax(240px, 1fr)'); // expanded stage same as others
      parts.push('minmax(825px, 3.5fr)'); // details panel
      if (afterCount > 0) parts.push(`repeat(${afterCount}, minmax(240px, 1fr))`);
      
      return parts.join(' ');
    }
    return `repeat(${visibleStages.length}, minmax(240px, 1fr))`;
  };

  // Handle expand deal
  const handleExpandDeal = (dealId: string) => {
    const deal = deals.find(d => d.id === dealId);
    if (!deal) return;

    // Toggle if same deal, otherwise expand new one
    if (expandedDealId === dealId) {
      beginCollapse();
    } else if (transition === 'expanded') {
      // Already expanded with different deal - queue the new one
      setPendingExpandId(dealId);
      beginCollapse();
    } else {
      beginExpand(dealId);
    }
  };

  // Get expanded deal object
  const expandedDealObject = expandedDealId 
    ? deals.find(d => d.id === expandedDealId) 
    : null;

  // Inline expansion state
  const isInlineExpanded = (transition === 'expanded' || transition === 'expanding' || transition === 'collapsing') && expandedStage;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header with Search/Filter Bar - above divider */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search all deal details..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 transition-all hover:border-primary/50 focus:border-primary w-full"
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

          {(searchTerm || filters.stages.length > 0 || filters.regions.length > 0 || filters.leadOwners.length > 0 || filters.priorities.length > 0 || filters.handoffStatuses.length > 0) && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => {
                setSearchTerm("");
                setFilters({
                  stages: [],
                  regions: [],
                  leadOwners: [],
                  priorities: [],
                  handoffStatuses: [],
                  searchTerm: "",
                  probabilityRange: [0, 100],
                });
              }}
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
              Clear All
            </Button>
          )}
          
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              onClick={toggleSelectionMode}
              className="hover-scale transition-all whitespace-nowrap text-sm h-9 px-3"
            >
              {selectionMode ? "Exit Selection" : "Select Deals"}
            </Button>
            
            {selectionMode && selectedDeals.size > 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                <span className="font-medium">{selectedDeals.size} selected</span>
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {headerActions}
        </div>
      </div>

      {/* Main Content Area - single inline view */}
      <div className="flex-1 min-h-0 relative">
        <style>
          {`
            .deals-scrollbar::-webkit-scrollbar {
              width: 2px;
              height: 2px;
            }
            .deals-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .deals-scrollbar::-webkit-scrollbar-thumb {
              background: hsl(var(--border));
              border-radius: 1px;
            }
            .deals-scrollbar::-webkit-scrollbar-thumb:hover {
              background: hsl(var(--muted-foreground));
            }
          `}
        </style>

        {/* Single unified view with inline expansion */}
        <div 
          className="absolute inset-0 overflow-auto deals-scrollbar"
          ref={scrollContainerRef}
          style={{ 
            scrollbarWidth: 'thin',
            scrollbarColor: 'hsl(var(--border)) transparent',
          }}
        >
          {/* Sticky Stage Headers - scrolls horizontally with content, sticks to top on vertical scroll */}
          <div className="sticky top-0 z-20 bg-background px-3 py-2 border-b border-border/30">
            <AnimatedStageHeaders
              visibleStages={visibleStages}
              expandedStage={expandedStage}
              transition={transition}
              selectionMode={selectionMode}
              getDealsByStage={getDealsByStage}
              selectedDeals={selectedDeals}
              onSelectAllInStage={handleSelectAllInStage}
              onCreateDeal={onCreateDeal}
              onAddDetail={() => setAddDetailOpen(true)}
            />
          </div>

          {/* Deal content grid with inline details panel */}
          <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div 
              className="grid gap-2 px-3 py-2 transition-all duration-300 ease-out"
              style={{ 
                gridTemplateColumns: getGridColumns()
              }}
            >
              {visibleStages.map((stage, stageIndex) => {
                const stageDeals = getDealsByStage(stage);
                const isExpandedStage = stage === expandedStage;
                
                return (
                  <Fragment key={stage}>
                    {/* Stage column - add data attribute for DOM measurement */}
                    <div 
                      className="flex flex-col min-w-0"
                      data-stage-column={stage}
                    >
                      <Droppable droppableId={stage} isDropDisabled={!!isInlineExpanded}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              'flex-1 space-y-1.5 p-1.5 rounded-lg transition-all min-h-[400px]',
                              snapshot.isDraggingOver && 'bg-muted/50 shadow-inner'
                            )}
                          >
                            {stageDeals.map((deal, index) => {
                              const isExpandedDeal = deal.id === expandedDealId;
                              const shouldDim = isInlineExpanded && !isExpandedDeal;
                              
                              return (
                                <Draggable 
                                  key={deal.id} 
                                  draggableId={deal.id} 
                                  index={index}
                                  isDragDisabled={selectionMode || !!isInlineExpanded}
                                >
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      {...(!selectionMode && !isInlineExpanded ? provided.dragHandleProps : {})}
                                      className="relative group"
                                      data-deal-id={deal.id}
                                    >
                                      {selectionMode && (
                                        <div className="absolute top-1.5 left-1.5 z-10">
                                          <Checkbox
                                            checked={selectedDeals.has(deal.id)}
                                            onCheckedChange={(checked) => handleSelectDeal(deal.id, Boolean(checked))}
                                            className="bg-background border-2 transition-colors h-3 w-3"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                        </div>
                                      )}
                                      <DealCard
                                        deal={deal}
                                        onClick={(e) => {
                                          if (selectionMode) {
                                            handleSelectDeal(deal.id, !selectedDeals.has(deal.id), e);
                                          } else if (isInlineExpanded && !isExpandedDeal) {
                                            // Switch to this deal when clicking a dimmed card
                                            handleExpandDeal(deal.id);
                                          } else {
                                            onDealClick(deal);
                                          }
                                        }}
                                        isDragging={snapshot.isDragging}
                                        isSelected={selectedDeals.has(deal.id)}
                                        isExpanded={isExpandedDeal}
                                        isDimmed={shouldDim}
                                        selectionMode={selectionMode}
                                        onStageChange={handleDealCardAction}
                                        onExpand={handleExpandDeal}
                                      />
                                    </div>
                                  )}
                                </Draggable>
                              );
                            })}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </div>
                    
                    {/* Inline Details Panel - aligned with selected card via spacer */}
                    {isExpandedStage && isInlineExpanded && expandedDealObject && (
                      <div 
                        data-details-panel="true"
                        className="flex flex-col"
                        style={{ 
                          minHeight: 0,
                          height: 'fit-content',
                        }}
                      >
                        {/* Spacer to align details panel with expanded card */}
                        {detailsSpacerHeight > 0 && (
                          <div style={{ height: `${detailsSpacerHeight}px`, flexShrink: 0 }} />
                        )}
                        <InlineDetailsPanel
                          deal={expandedDealObject}
                          transition={transition}
                          onClose={beginCollapse}
                          onOpenActionItemModal={handleOpenActionItemModal}
                          addDetailOpen={addDetailOpen}
                          onAddDetailOpenChange={setAddDetailOpen}
                        />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </DragDropContext>
        </div>
      </div>

      {/* Fixed bottom bulk actions */}
      <div className="flex-shrink-0">
        <BulkActionsBar
          selectedCount={selectedDeals.size}
          onDelete={handleBulkDelete}
          onExport={handleBulkExport}
          onClearSelection={() => setSelectedDeals(new Set())}
        />
      </div>
       
      {/* Action Item Modal — lazy-mounted: useActionItems hook only fires when open */}
      {actionModalOpen && (
        <KanbanActionItemModal
          open={actionModalOpen}
          onOpenChange={(open) => {
            setActionModalOpen(open);
            if (!open) {
              setEditingActionItem(null);
              setActionModalDealId(null);
            }
          }}
          actionItem={editingActionItem}
          defaultModuleId={actionModalDealId || expandedDealId || undefined}
          onSaved={() => {
            setActionModalOpen(false);
            setEditingActionItem(null);
            setActionModalDealId(null);
          }}
        />
      )}
    </div>
  );
};
