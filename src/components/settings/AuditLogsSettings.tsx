import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Download, Activity, Undo, Eye, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { RevertConfirmDialog } from "@/components/feeds/RevertConfirmDialog";
import { StandardPagination } from "@/components/shared/StandardPagination";
import { AuditLogFilters, ModuleFilter } from "./audit/AuditLogFilters";
import { AuditLogDetailDialog } from "./audit/AuditLogDetailDialog";
import { AuditLogStats } from "./audit/AuditLogStats";
import {
  AuditLog, FilterCategory, getExcludedActions, filterByCategory,
  generateSummary, getActivityBadgeColor, getActivityLabel, getModuleName,
  getStatsFromLogs, formatFieldValue
} from "./audit/auditLogUtils";

type ValidTableName = 'contacts' | 'deals' | 'leads' | 'action_items';

const badgeColorClasses: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  yellow: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  gray: 'bg-muted text-muted-foreground',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
};

const ITEMS_PER_PAGE = 50;

const getRowBorderColor = (action: string): string => {
  if (action === 'CREATE' || action === 'BULK_CREATE') return 'border-l-emerald-500';
  if (action === 'UPDATE' || action === 'BULK_UPDATE') return 'border-l-blue-500';
  if (action === 'DELETE' || action === 'BULK_DELETE') return 'border-l-red-500';
  if (['NOTE', 'EMAIL', 'MEETING', 'CALL'].includes(action)) return 'border-l-purple-500';
  if (action.includes('EXPORT') || action.includes('IMPORT')) return 'border-l-orange-500';
  return 'border-l-muted-foreground/30';
};

const AuditLogsSettings = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [category, setCategory] = useState<FilterCategory>('all_except_auth');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);
  const [reverting, setReverting] = useState(false);
  const { toast } = useToast();

  useEffect(() => { fetchAuditLogs(); }, []);
  useEffect(() => { if (logs.length > 0) fetchUserNames(); }, [logs]);

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('security_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) throw error;

      const excluded = getExcludedActions();
      let transformedLogs: AuditLog[] = (data || [])
        .filter(log => !excluded.includes(log.action))
        .map(log => ({
          id: log.id,
          user_id: log.user_id || '',
          action: log.action,
          resource_type: log.resource_type,
          resource_id: log.resource_id || undefined,
          details: log.details || undefined,
          ip_address: log.ip_address ? String(log.ip_address) : undefined,
          created_at: log.created_at
        }));

      const legacyActionItemIds = Array.from(new Set(
        transformedLogs
          .filter(log => log.resource_type === 'action_items' && log.action === 'BULK_UPDATE')
          .flatMap(log => {
            const existingTitles = log.details?.update_data?.item_titles || log.details?.item_titles;
            if (Array.isArray(existingTitles) && existingTitles.length > 0) return [];

            const recordIds = log.details?.update_data?.record_ids || log.details?.record_ids;
            if (Array.isArray(recordIds) && recordIds.length > 0) return recordIds;

            return log.resource_id ? [log.resource_id] : [];
          })
          .filter(Boolean)
      ));

      if (legacyActionItemIds.length > 0) {
        const { data: actionItemRecords, error: actionItemError } = await supabase
          .from('action_items')
          .select('id, title')
          .in('id', legacyActionItemIds);

        if (actionItemError) throw actionItemError;

        const titleMap = Object.fromEntries((actionItemRecords || []).map(item => [item.id, item.title]));

        transformedLogs = transformedLogs.map(log => {
          if (log.resource_type !== 'action_items' || log.action !== 'BULK_UPDATE') return log;

          const recordCount = log.details?.record_count ?? 1;
          const existingTitles = log.details?.update_data?.item_titles || log.details?.item_titles;
          const recordIds = log.details?.update_data?.record_ids || log.details?.record_ids || (log.resource_id ? [log.resource_id] : []);
          
          // Resolve missing titles from DB
          let resolvedTitles = existingTitles;
          if (!Array.isArray(existingTitles) || existingTitles.length === 0) {
            resolvedTitles = Array.isArray(recordIds)
              ? recordIds.map((id: string) => titleMap[id]).filter(Boolean)
              : [];
          }

          // Normalize single-record BULK_UPDATE → UPDATE
          if (recordCount === 1 || (Array.isArray(recordIds) && recordIds.length === 1)) {
            const title = resolvedTitles?.[0] || '';
            const targetStatus = log.details?.update_data?.status || log.details?.status;
            return {
              ...log,
              action: 'UPDATE',
              resource_id: log.resource_id || recordIds?.[0],
              details: {
                ...(log.details || {}),
                operation: 'UPDATE',
                old_data: { title, status: null, module_type: 'action_items' },
                updated_fields: targetStatus ? { status: targetStatus } : log.details?.update_data,
                field_changes: targetStatus ? { status: { old: null, new: targetStatus } } : {},
                module: 'Action_items',
              },
            };
          }

          // Multi-record: just attach resolved titles
          if (!Array.isArray(resolvedTitles) || resolvedTitles.length === 0) return log;
          return {
            ...log,
            resource_id: log.resource_id || recordIds[0],
            details: {
              ...(log.details || {}),
              item_titles: resolvedTitles,
              update_data: {
                ...(log.details?.update_data || {}),
                item_titles: resolvedTitles,
                record_ids: recordIds,
              },
            },
          };
        });
      }

      setLogs(transformedLogs);
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to fetch audit logs: " + (error.message || 'Unknown error'), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchUserNames = async () => {
    try {
      const uniqueUserIds = Array.from(new Set(logs.map(log => log.user_id).filter(Boolean)));
      if (uniqueUserIds.length === 0) return;
      try {
        const { data, error } = await supabase.functions.invoke('fetch-user-display-names', {
          body: { userIds: uniqueUserIds }
        });
        if (!error && data?.userDisplayNames) { setUserNames(data.userDisplayNames); return; }
      } catch { /* fallback */ }
      const fallback: Record<string, string> = {};
      uniqueUserIds.forEach((id, i) => { fallback[id] = `User ${i + 1}`; });
      setUserNames(fallback);
    } catch { /* silent */ }
  };

  // Filtered logs
  const filteredLogs = useMemo(() => {
    let result = filterByCategory(logs, category);

    // Module filter
    if (moduleFilter !== 'all') {
      result = result.filter(log =>
        log.resource_type === moduleFilter ||
        log.details?.module?.toLowerCase() === moduleFilter
      );
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(log =>
        log.action.toLowerCase().includes(term) ||
        log.resource_type.toLowerCase().includes(term) ||
        generateSummary(log).toLowerCase().includes(term) ||
        (userNames[log.user_id] || '').toLowerCase().includes(term)
      );
    }

    if (dateFrom) {
      const from = new Date(dateFrom); from.setHours(0, 0, 0, 0);
      result = result.filter(log => new Date(log.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo); to.setHours(23, 59, 59, 999);
      result = result.filter(log => new Date(log.created_at) <= to);
    }

    return result;
  }, [logs, category, moduleFilter, searchTerm, dateFrom, dateTo, userNames]);

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [category, moduleFilter, searchTerm, dateFrom, dateTo]);

  // Stats
  const stats = useMemo(() => getStatsFromLogs(filteredLogs), [filteredLogs]);

  const getUserName = (userId: string) => userId ? (userNames[userId] || `User ${userId.substring(0, 8)}`) : 'System';
  const getUserInitial = (userId: string) => {
    const name = getUserName(userId);
    return name.charAt(0).toUpperCase();
  };

  const canRevert = (log: AuditLog) =>
    ['CREATE', 'UPDATE', 'DELETE'].includes(log.action) &&
    ['contacts', 'deals', 'leads', 'action_items'].includes(log.resource_type) &&
    log.resource_id && log.details;

  const isValidTableName = (t: string): t is ValidTableName => ['contacts', 'deals', 'leads', 'action_items'].includes(t);

  const handleRevertClick = (log: AuditLog) => { setSelectedLog(log); setRevertDialogOpen(true); };

  const revertAction = async () => {
    if (!selectedLog) return;
    setReverting(true);
    try {
      const { action, resource_type, resource_id, details } = selectedLog;
      if (!isValidTableName(resource_type)) throw new Error(`Reverting ${resource_type} is not supported`);
      if (!resource_id) throw new Error('Resource ID required');

      if (action === 'DELETE' && details?.deleted_data) {
        const record = { ...details.deleted_data };
        if (!record.id) record.id = resource_id;
        const { error } = await supabase.from(resource_type).insert([record]);
        if (error) throw error;
        toast({ title: "Success", description: `Deleted ${resource_type} record restored` });
      } else if (action === 'UPDATE' && details?.old_data) {
        const { error } = await supabase.from(resource_type).update(details.old_data).eq('id', resource_id);
        if (error) throw error;
        toast({ title: "Success", description: `${resource_type} record reverted` });
      } else if (action === 'UPDATE' && details?.field_changes) {
        const oldData: Record<string, any> = {};
        Object.entries(details.field_changes).forEach(([field, change]: [string, any]) => {
          if (change && typeof change === 'object' && 'old' in change) oldData[field] = change.old;
        });
        if (Object.keys(oldData).length === 0) throw new Error('No revertible data found');
        const { error } = await supabase.from(resource_type).update(oldData as any).eq('id', resource_id);
        if (error) throw error;
        toast({ title: "Success", description: `${resource_type} record reverted` });
      } else if (action === 'CREATE') {
        const { error } = await supabase.from(resource_type).delete().eq('id', resource_id);
        if (error) throw error;
        toast({ title: "Success", description: `Created ${resource_type} record removed` });
      } else {
        throw new Error(`Cannot revert ${action} - insufficient data`);
      }
      await fetchAuditLogs();
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to revert: ${error.message}`, variant: "destructive" });
    } finally {
      setReverting(false); setRevertDialogOpen(false); setSelectedLog(null);
    }
  };

  const exportAuditTrail = () => {
    try {
      const csvContent = [
        ['Date/Time', 'User', 'Activity', 'Module', 'Summary', 'Resource ID'].join(','),
        ...filteredLogs.map(log => [
          `"${format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')}"`,
          `"${getUserName(log.user_id)}"`,
          `"${getActivityLabel(log.action)}"`,
          `"${getModuleName(log)}"`,
          `"${generateSummary(log).replace(/"/g, '""')}"`,
          `"${log.resource_id || ''}"`,
        ].join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-trail-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: "Success", description: "Audit trail exported successfully" });
    } catch {
      toast({ title: "Error", description: "Failed to export", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <AuditLogStats
        total={stats.total}
        todayCount={stats.todayCount}
        weekCount={stats.weekCount}
        byModule={stats.byModule}
        byUser={stats.byUser}
        userNames={userNames}
        onDatePreset={(from, to) => { setDateFrom(from); setDateTo(to); }}
        onModuleFilter={setModuleFilter}
        activeModuleFilter={moduleFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* Main Log Table */}
      <Card>
        <CardHeader className="px-4 py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              Audit Logs
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button onClick={fetchAuditLogs} variant="outline" size="sm" className="h-7 text-xs" disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button onClick={exportAuditTrail} size="sm" variant="outline" className="h-7 text-xs">
                <Download className="h-3.5 w-3.5 mr-1" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          <AuditLogFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            category={category}
            onCategoryChange={setCategory}
            moduleFilter={moduleFilter}
            onModuleFilterChange={setModuleFilter}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
          />

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[10%] py-2 text-xs">Activity</TableHead>
                      <TableHead className="w-[10%] py-2 text-xs">Module</TableHead>
                      <TableHead className="w-[50%] py-2 text-xs">Summary</TableHead>
                      <TableHead className="w-[10%] py-2 text-xs">User</TableHead>
                      <TableHead className="w-[10%] py-2 text-xs">Time</TableHead>
                      <TableHead className="w-[10%] py-2 text-xs text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedLogs.map((log) => {
                      const color = getActivityBadgeColor(log.action);
                      const userName = getUserName(log.user_id);
                      const summary = generateSummary(log);
                      const borderColor = getRowBorderColor(log.action);

                      return (
                        <TableRow key={log.id} className={`border-l-[3px] ${borderColor}`}>
                          <TableCell className="py-1.5">
                            <Badge className={`${badgeColorClasses[color]} border-0 text-[10px] px-1.5 py-0`}>
                              {getActivityLabel(log.action)}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-1.5 text-xs">
                            {getModuleName(log)}
                          </TableCell>
                          <TableCell className="py-1.5 text-xs">
                            <span className="block break-words whitespace-normal">{summary}</span>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                                {getUserInitial(log.user_id)}
                              </div>
                              <span className="text-xs font-medium truncate">{userName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(log.created_at), 'MMM dd, h:mm a')}
                          </TableCell>
                          <TableCell className="py-1.5 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              {log.details && (
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDetailLog(log)}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              {canRevert(log) && (
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleRevertClick(log)} disabled={reverting}>
                                  <Undo className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {filteredLogs.length === 0 && (
                  <div className="text-center py-8">
                    <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground text-sm font-medium">
                      {searchTerm || category !== 'all_except_auth' || dateFrom || dateTo ? 'No logs match your filters' : 'No audit logs found'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {searchTerm || category !== 'all_except_auth' ? 'Try adjusting your filters' : 'Start using the application to generate logs'}
                    </p>
                  </div>
                )}
              </div>

              {filteredLogs.length > 0 && (
                <StandardPagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={filteredLogs.length}
                  itemsPerPage={ITEMS_PER_PAGE}
                  onPageChange={setCurrentPage}
                  entityName="entries"
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <AuditLogDetailDialog
        log={detailLog}
        open={!!detailLog}
        onOpenChange={(open) => { if (!open) setDetailLog(null); }}
        userName={detailLog ? getUserName(detailLog.user_id) : ''}
      />

      {/* Revert Dialog */}
      <RevertConfirmDialog
        open={revertDialogOpen}
        onConfirm={revertAction}
        onCancel={() => { setRevertDialogOpen(false); setSelectedLog(null); }}
      />
    </div>
  );
};

export default AuditLogsSettings;
