import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface ColumnConfig {
  field: string;
  label: string;
  visible: boolean;
  order: number;
}

interface ColumnPreferencesData {
  visibility: Array<{ field: string; visible: boolean; order: number }>;
}

/**
 * Generic hook to persist column visibility/order preferences per user per module.
 * Cached via React Query (staleTime: Infinity) — eliminates per-mount round trips.
 */
export function useColumnPreferences<T extends ColumnConfig>(
  moduleName: string,
  defaultColumns: T[]
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['column-preferences', user?.id, moduleName];

  const { data: columns = defaultColumns, isLoading } = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('column_preferences')
        .select('column_widths')
        .eq('user_id', user!.id)
        .eq('module', moduleName)
        .maybeSingle();

      if (error || !data?.column_widths) return defaultColumns;

      const prefs = data.column_widths as unknown as ColumnPreferencesData;
      if (!prefs.visibility || !Array.isArray(prefs.visibility)) return defaultColumns;

      const updatedColumns = defaultColumns.map((col) => {
        const saved = prefs.visibility.find((v) => v.field === col.field);
        if (saved) return { ...col, visible: saved.visible, order: saved.order };
        return col;
      }) as T[];
      return updatedColumns.sort((a, b) => a.order - b.order);
    },
  });

  const setColumns = useCallback(
    async (newColumns: T[]) => {
      queryClient.setQueryData(queryKey, newColumns);
      if (!user) return;
      try {
        const visibility = newColumns.map((col) => ({
          field: col.field,
          visible: col.visible,
          order: col.order,
        }));
        const prefs: ColumnPreferencesData = { visibility };
        const { error } = await supabase.from('column_preferences').upsert(
          {
            user_id: user.id,
            module: moduleName,
            column_widths: prefs as unknown as Record<string, number>,
          },
          { onConflict: 'user_id,module' }
        );
        if (error) console.error(`Failed to save ${moduleName} column preferences:`, error);
      } catch (error) {
        console.error(`Failed to save ${moduleName} column preferences:`, error);
      }
    },
    [user, moduleName, queryClient, queryKey]
  );

  return { columns, setColumns, isLoading };
}
