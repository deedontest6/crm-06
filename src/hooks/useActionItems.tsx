import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useCRUDAudit } from '@/hooks/useCRUDAudit';

export type ActionItemPriority = 'Low' | 'Medium' | 'High';
export type ActionItemStatus = 'Open' | 'In Progress' | 'Completed' | 'Cancelled';
export type ModuleType = 'accounts' | 'contacts' | 'deals' | 'campaigns';

export interface ActionItem {
  id: string;
  module_type: ModuleType;
  module_id: string | null;
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: ActionItemPriority;
  status: ActionItemStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ActionItemFilters {
  module_type: ModuleType | 'all';
  priority: ActionItemPriority | 'all';
  status: ActionItemStatus | 'all';
  assigned_to: string | 'all';
  search: string;
  viewFilter: 'active' | 'completed' | 'cancelled';
}

export interface CreateActionItemInput {
  module_type: ModuleType;
  module_id?: string | null;
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  priority?: ActionItemPriority;
  status?: ActionItemStatus;
}

export interface UpdateActionItemInput extends Partial<CreateActionItemInput> {
  id: string;
}

const defaultFilters: ActionItemFilters = {
  module_type: 'all',
  priority: 'all',
  status: 'all',
  assigned_to: 'all',
  search: '',
  viewFilter: 'active',
};

export function useActionItems(initialFilters?: Partial<ActionItemFilters>) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ActionItemFilters>({
    ...defaultFilters,
    ...initialFilters,
  });
  const { logCreate, logUpdate, logDelete, logBulkUpdate, logBulkDelete } = useCRUDAudit();

  // Fetch action items
  const {
    data: actionItems = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: [
      'action_items',
      filters.module_type,
      filters.priority,
      filters.status,
      filters.assigned_to,
      filters.search,
      filters.viewFilter,
    ],
    queryFn: async () => {
      let query = supabase
        .from('action_items')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(500);

      if (filters.module_type !== 'all') {
        query = query.eq('module_type', filters.module_type);
      }
      if (filters.priority !== 'all') {
        query = query.eq('priority', filters.priority);
      }
      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.assigned_to !== 'all') {
        query = query.eq('assigned_to', filters.assigned_to);
      }
      if (filters.search) {
        query = query.ilike('title', `%${filters.search}%`);
      }
      
      // Filter by view (active / completed / cancelled)
      if (filters.viewFilter === 'completed') {
        query = query.or('status.eq.Completed,archived_at.not.is.null');
      } else if (filters.viewFilter === 'cancelled') {
        query = query.eq('status', 'Cancelled').is('archived_at', null);
      } else {
        // active: not archived, not completed, not cancelled
        query = query
          .is('archived_at', null)
          .not('status', 'in', '(Completed,Cancelled)');
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ActionItem[];
    },
    enabled: !!user,
  });

  // Helper: get all matching query keys for optimistic updates
  const getActionItemsQueryKeys = () => {
    return queryClient.getQueryCache()
      .findAll({ queryKey: ['action_items'] })
      .map(q => q.queryKey as readonly unknown[]);
  };

  // Create action item — with optimistic updates
  const createMutation = useMutation({
    mutationFn: async (input: CreateActionItemInput) => {
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('action_items')
        .insert({
          ...input,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['action_items'] });

      const tempId = `temp-${Date.now()}`;
      const optimisticItem: ActionItem = {
        id: tempId,
        module_type: input.module_type,
        module_id: input.module_id ?? null,
        title: input.title,
        description: input.description ?? null,
        assigned_to: input.assigned_to ?? null,
        due_date: input.due_date ?? null,
        due_time: input.due_time ?? null,
        priority: input.priority ?? 'Medium',
        status: input.status ?? 'Open',
        created_by: user!.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const queryKeys = getActionItemsQueryKeys();
      const previousSnapshots: { queryKey: readonly unknown[]; data: unknown }[] = [];

      for (const queryKey of queryKeys) {
        const data = queryClient.getQueryData(queryKey);
        previousSnapshots.push({ queryKey, data });

        queryClient.setQueryData(queryKey, (old: ActionItem[] | undefined) => {
          if (!old) return [optimisticItem];
          return [optimisticItem, ...old];
        });
      }

      return { previousSnapshots, tempId };
    },
    onError: (error, _input, context) => {
      console.error('Error creating action item:', error);
      toast.error('Failed to create action item');
      if (context?.previousSnapshots) {
        for (const { queryKey, data } of context.previousSnapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSuccess: (data) => {
      toast.success('Action item created successfully');
      if (data) {
        logCreate('action_items', data.id, {
          title: data.title,
          module_type: data.module_type,
          module_id: data.module_id,
          assigned_to: data.assigned_to,
          priority: data.priority,
          status: data.status,
          due_date: data.due_date,
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['action_items'] });
    },
  });

  // Update action item — with optimistic updates
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...input }: UpdateActionItemInput) => {
      const { data, error } = await supabase
        .from('action_items')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async (updatedItem) => {
      await queryClient.cancelQueries({ queryKey: ['action_items'] });

      const queryKeys = getActionItemsQueryKeys();
      const previousSnapshots: { queryKey: readonly unknown[]; data: unknown }[] = [];
      // Capture old data for audit
      let oldItem: ActionItem | undefined;

      for (const queryKey of queryKeys) {
        const data = queryClient.getQueryData(queryKey);
        previousSnapshots.push({ queryKey, data });

        if (!oldItem && Array.isArray(data)) {
          oldItem = (data as ActionItem[]).find(item => item.id === updatedItem.id);
        }

        queryClient.setQueryData(queryKey, (old: ActionItem[] | undefined) => {
          if (!old) return old;
          return old.map(item =>
            item.id === updatedItem.id
              ? { ...item, ...updatedItem, updated_at: new Date().toISOString() }
              : item
          );
        });
      }

      // If old item not found in cache, fetch from DB (DB still has old data at onMutate time)
      if (!oldItem) {
        try {
          const { data } = await supabase
            .from('action_items')
            .select('*')
            .eq('id', updatedItem.id)
            .single();
          if (data) oldItem = data as ActionItem;
        } catch { /* proceed without old data */ }
      }

      return { previousSnapshots, oldItem };
    },
    onError: (error: any, _updatedItem, context) => {
      console.error('Error updating action item:', error);
      const message = error?.message || error?.details || 'Failed to update action item';
      toast.error(message);
      // Rollback all caches
      if (context?.previousSnapshots) {
        for (const { queryKey, data } of context.previousSnapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSuccess: (data, variables, context) => {
      toast.success('Action item updated successfully');
      if (data) {
        const { id, ...updates } = variables;
        logUpdate('action_items', id, updates, context?.oldItem || {});
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['action_items'] });
    },
  });

  // Delete action item — with optimistic updates
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('action_items')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: ['action_items'] });

      const queryKeys = getActionItemsQueryKeys();
      const previousSnapshots: { queryKey: readonly unknown[]; data: unknown }[] = [];
      let deletedItem: ActionItem | undefined;

      for (const queryKey of queryKeys) {
        const data = queryClient.getQueryData(queryKey);
        previousSnapshots.push({ queryKey, data });

        if (!deletedItem && Array.isArray(data)) {
          deletedItem = (data as ActionItem[]).find(item => item.id === deletedId);
        }

        queryClient.setQueryData(queryKey, (old: ActionItem[] | undefined) => {
          if (!old) return old;
          return old.filter(item => item.id !== deletedId);
        });
      }

      return { previousSnapshots, deletedItem };
    },
    onError: (error, _deletedId, context) => {
      console.error('Error deleting action item:', error);
      toast.error('Failed to delete action item');
      if (context?.previousSnapshots) {
        for (const { queryKey, data } of context.previousSnapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSuccess: (_data, deletedId, context) => {
      toast.success('Action item deleted successfully');
      logDelete('action_items', deletedId, context?.deletedItem || {});
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['action_items'] });
    },
  });

  // Bulk update status — with optimistic updates
  const bulkUpdateStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: ActionItemStatus }) => {
      const { error } = await supabase
        .from('action_items')
        .update({ status })
        .in('id', ids);

      if (error) throw error;
    },
    onMutate: async ({ ids, status }) => {
      await queryClient.cancelQueries({ queryKey: ['action_items'] });

      const queryKeys = getActionItemsQueryKeys();
      const previousSnapshots: { queryKey: readonly unknown[]; data: unknown }[] = [];
      let oldItems: ActionItem[] = [];

      for (const queryKey of queryKeys) {
        const data = queryClient.getQueryData(queryKey);
        previousSnapshots.push({ queryKey, data });

        // Capture old items for audit logging (only once)
        if (oldItems.length === 0 && Array.isArray(data)) {
          const idSet = new Set(ids);
          oldItems = (data as ActionItem[]).filter(item => idSet.has(item.id));
        }

        queryClient.setQueryData(queryKey, (old: ActionItem[] | undefined) => {
          if (!old) return old;
          const idSet = new Set(ids);
          return old.map(item =>
            idSet.has(item.id)
              ? { ...item, status, updated_at: new Date().toISOString() }
              : item
          );
        });
      }

      // If old items not found in cache, fetch from DB (DB still has old data at onMutate time)
      if (oldItems.length === 0) {
        try {
          const { data } = await supabase
            .from('action_items')
            .select('*')
            .in('id', ids);
          if (data) oldItems = data as ActionItem[];
        } catch { /* proceed without old data */ }
      }

      return { previousSnapshots, oldItems };
    },
    onError: (error, _vars, context) => {
      console.error('Error updating action items:', error);
      toast.error('Failed to update action items');
      if (context?.previousSnapshots) {
        for (const { queryKey, data } of context.previousSnapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSuccess: async (_data, variables, context) => {
      toast.success('Action items updated successfully');
      const oldItems = context?.oldItems || [];
      
      // Single item: log as regular UPDATE with field-level changes
      if (variables.ids.length === 1) {
        const itemId = variables.ids[0];
        const item = oldItems[0];
        
        const oldStatus = item?.status || 'Open';
        const itemTitle = item?.title || 'Untitled Action Item';
        logUpdate('action_items', itemId, 
          { status: variables.status },
          { status: oldStatus, title: itemTitle, module_type: item?.module_type || 'action_items' }
        );
      } else {
        // Multiple items: log as BULK_UPDATE with titles
        const itemTitles = oldItems.map(i => i.title).filter(Boolean);
        
        logBulkUpdate('action_items', variables.ids.length, {
          status: variables.status,
          record_ids: variables.ids.slice(0, 10),
          item_titles: itemTitles.slice(0, 10),
          module: 'action_items',
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['action_items'] });
    },
  });

  // Bulk delete — with optimistic updates
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('action_items')
        .delete()
        .in('id', ids);

      if (error) throw error;
    },
    onMutate: async (deletedIds) => {
      await queryClient.cancelQueries({ queryKey: ['action_items'] });

      const queryKeys = getActionItemsQueryKeys();
      const previousSnapshots: { queryKey: readonly unknown[]; data: unknown }[] = [];

      for (const queryKey of queryKeys) {
        const data = queryClient.getQueryData(queryKey);
        previousSnapshots.push({ queryKey, data });

        queryClient.setQueryData(queryKey, (old: ActionItem[] | undefined) => {
          if (!old) return old;
          const idSet = new Set(deletedIds);
          return old.filter(item => !idSet.has(item.id));
        });
      }

      return { previousSnapshots };
    },
    onError: (error, _ids, context) => {
      console.error('Error deleting action items:', error);
      toast.error('Failed to delete action items');
      if (context?.previousSnapshots) {
        for (const { queryKey, data } of context.previousSnapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSuccess: (_data, deletedIds) => {
      toast.success('Action items deleted successfully');
      logBulkDelete('action_items', deletedIds.length, deletedIds);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['action_items'] });
    },
  });

  // Real-time subscription
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('action_items_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'action_items' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['action_items'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return {
    actionItems,
    isLoading,
    error,
    filters,
    setFilters,
    updateFilter: (key: keyof ActionItemFilters, value: string) => {
      setFilters((prev) => ({ ...prev, [key]: value as never }));
    },
    resetFilters: () => setFilters(defaultFilters),
    createActionItem: createMutation.mutateAsync,
    updateActionItem: updateMutation.mutateAsync,
    deleteActionItem: deleteMutation.mutateAsync,
    bulkUpdateStatus: bulkUpdateStatusMutation.mutateAsync,
    bulkDelete: bulkDeleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
