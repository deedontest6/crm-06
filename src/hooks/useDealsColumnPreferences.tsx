import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DealColumnConfig } from '@/components/DealColumnCustomizer';

const defaultColumnWidths: Record<string, number> = {
  'project_name': 200,
  'customer_name': 150,
  'lead_name': 150,
  'lead_owner': 140,
  'stage': 120,
  'priority': 100,
  'total_contract_value': 120,
  'probability': 120,
  'expected_closing_date': 140,
  'region': 120,
  'project_duration': 120,
  'start_date': 120,
  'end_date': 120,
  'proposal_due_date': 140,
  'total_revenue': 120,
};

const defaultColumns: DealColumnConfig[] = [
  { field: 'project_name', label: 'Project', visible: true, order: 0 },
  { field: 'customer_name', label: 'Customer', visible: true, order: 1 },
  { field: 'lead_name', label: 'Lead Name', visible: true, order: 2 },
  { field: 'lead_owner', label: 'Lead Owner', visible: true, order: 3 },
  { field: 'stage', label: 'Stage', visible: true, order: 4 },
  { field: 'priority', label: 'Priority', visible: true, order: 5 },
  { field: 'total_contract_value', label: 'Value', visible: true, order: 6 },
  { field: 'probability', label: 'Probability', visible: true, order: 7 },
  { field: 'expected_closing_date', label: 'Expected Close', visible: true, order: 8 },
  { field: 'region', label: 'Region', visible: false, order: 9 },
  { field: 'project_duration', label: 'Duration', visible: false, order: 10 },
  { field: 'start_date', label: 'Start Date', visible: false, order: 11 },
  { field: 'end_date', label: 'End Date', visible: false, order: 12 },
  { field: 'proposal_due_date', label: 'Proposal Due', visible: false, order: 13 },
  { field: 'total_revenue', label: 'Total Revenue', visible: false, order: 14 },
];

const MODULE_NAME = 'deals';

interface ColumnPreferencesData {
  widths: Record<string, number>;
  visibility: Array<{ field: string; visible: boolean; order: number }>;
}

interface DealPrefsState {
  columnWidths: Record<string, number>;
  columns: DealColumnConfig[];
}

const defaultState: DealPrefsState = {
  columnWidths: defaultColumnWidths,
  columns: defaultColumns,
};

export function useDealsColumnPreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['column-preferences', user?.id, MODULE_NAME];

  const { data = defaultState, isLoading } = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<DealPrefsState> => {
      const { data, error } = await supabase
        .from('column_preferences')
        .select('column_widths')
        .eq('user_id', user!.id)
        .eq('module', MODULE_NAME)
        .maybeSingle();

      if (error || !data?.column_widths) return defaultState;

      const prefs = data.column_widths as unknown as ColumnPreferencesData;
      let columnWidths = defaultColumnWidths;
      let columns = defaultColumns;

      if (prefs.widths) {
        columnWidths = { ...defaultColumnWidths, ...prefs.widths };
      } else {
        columnWidths = { ...defaultColumnWidths, ...(data.column_widths as Record<string, number>) };
      }

      if (prefs.visibility && Array.isArray(prefs.visibility)) {
        const updated = defaultColumns.map((col) => {
          const saved = prefs.visibility.find((v) => v.field === col.field);
          if (saved) return { ...col, visible: saved.visible, order: saved.order };
          return col;
        });
        columns = updated.sort((a, b) => a.order - b.order);
      }

      return { columnWidths, columns };
    },
  });

  const persist = useCallback(
    async (next: DealPrefsState) => {
      queryClient.setQueryData(queryKey, next);
      if (!user) return;
      const prefs: ColumnPreferencesData = {
        widths: next.columnWidths,
        visibility: next.columns.map((col) => ({
          field: col.field,
          visible: col.visible,
          order: col.order,
        })),
      };
      const { error } = await supabase.from('column_preferences').upsert(
        {
          user_id: user.id,
          module: MODULE_NAME,
          column_widths: prefs as unknown as Record<string, number>,
        },
        { onConflict: 'user_id,module' }
      );
      if (error) console.error('Failed to save deals column prefs:', error);
    },
    [user, queryClient, queryKey]
  );

  const saveColumnWidths = useCallback(
    async (newWidths: Record<string, number>) => {
      await persist({ columnWidths: newWidths, columns: data.columns });
    },
    [persist, data.columns]
  );

  const saveColumns = useCallback(
    async (newColumns: DealColumnConfig[]) => {
      await persist({ columnWidths: data.columnWidths, columns: newColumns });
    },
    [persist, data.columnWidths]
  );

  const updateColumnWidth = useCallback(
    (field: string, width: number) => {
      saveColumnWidths({ ...data.columnWidths, [field]: width });
    },
    [data.columnWidths, saveColumnWidths]
  );

  const resetToDefaults = useCallback(() => {
    persist({ columnWidths: defaultColumnWidths, columns: defaultColumns });
  }, [persist]);

  return {
    columnWidths: data.columnWidths,
    columns: data.columns,
    isLoading,
    isSaving: false,
    updateColumnWidth,
    saveColumnWidths,
    saveColumns,
    resetToDefaults,
    defaultColumnWidths,
    defaultColumns,
  };
}
