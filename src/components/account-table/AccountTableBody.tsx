import { useState, useEffect, useCallback } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AccountColumnConfig } from "../AccountColumnCustomizer";
import { format } from "date-fns";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";
import { LinkedContactsDialog } from "../LinkedContactsDialog";
import { cn } from "@/lib/utils";
import { useAccountColumnWidths } from "@/hooks/useAccountColumnWidths";

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
  tags?: string[];
  description?: string;
  account_owner?: string;
  created_by?: string;
  modified_by?: string;
  created_time?: string;
  modified_time?: string;
  last_activity_time?: string;
  currency?: string;
}

interface AccountTableBodyProps {
  loading: boolean;
  pageAccounts: Account[];
  visibleColumns: AccountColumnConfig[];
  selectedAccounts: string[];
  setSelectedAccounts: React.Dispatch<React.SetStateAction<string[]>>;
  onEdit: (account: Account) => void;
  onDelete: (id: string) => void;
  searchTerm: string;
  onRefresh: () => void;
  sortField: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
  contactCounts?: Record<string, number>;
}

const getStatusDotColor = (status: string | undefined) => {
  switch (status) {
    case 'New': return 'bg-blue-500';
    case 'Working': return 'bg-yellow-500';
    case 'Qualified': return 'bg-green-500';
    case 'Inactive': return 'bg-gray-400';
    default: return 'bg-gray-400';
  }
};

const getWebsiteUrl = (value: string): string => {
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `https://${value}`;
};

const getWebsiteDisplay = (value: string): string => {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
};

export const AccountTableBody = ({
  loading, pageAccounts, visibleColumns, selectedAccounts, setSelectedAccounts,
  onEdit, onDelete, sortField, sortDirection, onSort, contactCounts = {},
}: AccountTableBodyProps) => {
  const [linkedAccountName, setLinkedAccountName] = useState<string | null>(null);
  const [showLinkedDialog, setShowLinkedDialog] = useState(false);
  const { columnWidths, updateColumnWidth } = useAccountColumnWidths();

  // Column resize state
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);

  // Column resize handlers
  const handleMouseDown = (e: React.MouseEvent, field: string) => {
    if (field === 'linked_contacts') return; // Don't allow resizing linked contacts column
    setIsResizing(field);
    setStartX(e.clientX);
    setStartWidth(columnWidths[field] || 120);
    e.preventDefault();
    e.stopPropagation();
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const deltaX = e.clientX - startX;
    const newWidth = Math.max(60, startWidth + deltaX);
    updateColumnWidth(isResizing, newWidth);
  }, [isResizing, startX, startWidth, updateColumnWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const userIds = pageAccounts.reduce<string[]>((acc, account) => {
    if (account.account_owner) acc.push(account.account_owner);
    if (account.created_by) acc.push(account.created_by);
    if (account.modified_by) acc.push(account.modified_by);
    return acc;
  }, []);
  const { displayNames } = useUserDisplayNames(userIds);

  const handleSelectAll = (checked: boolean) => {
    setSelectedAccounts(checked ? pageAccounts.map(a => a.id) : []);
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    setSelectedAccounts(prev => checked ? [...prev, id] : prev.filter(i => i !== id));
  };

  const resolveUserName = (userId: string | undefined): string => {
    if (!userId) return '-';
    return displayNames[userId] || 'Loading...';
  };

  const handleLinkedContactsClick = (accountName: string) => {
    setLinkedAccountName(accountName);
    setShowLinkedDialog(true);
  };

  const formatCellValue = (account: Account, field: string) => {
    if (field === 'linked_contacts') {
      const count = contactCounts[account.account_name] || 0;
      return (
        <button
          onClick={() => handleLinkedContactsClick(account.account_name)}
          className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          title={`View ${count} linked contact${count !== 1 ? 's' : ''}`}
        >
          {count}
        </button>
      );
    }

    const value = account[field as keyof Account];
    
    if (field === 'account_owner' || field === 'created_by' || field === 'modified_by') {
      return resolveUserName(value as string);
    }
    if (field === 'created_time' || field === 'modified_time' || field === 'last_activity_time') {
      return value ? format(new Date(value as string), 'dd MMM yyyy') : '-';
    }
    if (field === 'status') {
      return (
        <div className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', getStatusDotColor(value as string))} />
          <span>{value || '-'}</span>
        </div>
      );
    }
    if (field === 'website' && value) {
      const url = getWebsiteUrl(value as string);
      const display = getWebsiteDisplay(value as string);
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[#2e538e] hover:underline flex items-center gap-1 truncate" title={display}>
          <ExternalLink className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{display}</span>
        </a>
      );
    }
    if (field === 'tags' && Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : '-';
    }
    if (field === 'account_name') {
      return (
        <button 
          className="text-[#2e538e] font-normal cursor-pointer hover:underline text-left line-clamp-2" 
          onClick={() => onEdit(account)} 
          title={value as string}
        >
          {value || '-'}
        </button>
      );
    }
    if (field === 'description') {
      return (
        <span className="line-clamp-2 text-muted-foreground text-xs" title={value as string}>
          {value || '-'}
        </span>
      );
    }
    return <span className="truncate block" title={value as string}>{value || '-'}</span>;
  };

  const getSortIcon = (field: string) => {
    if (field === 'linked_contacts') return null;
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/60" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="ml-1 h-3 w-3 text-foreground" />
      : <ArrowDown className="ml-1 h-3 w-3 text-foreground" />;
  };

  const allSelected = pageAccounts.length > 0 && selectedAccounts.length === pageAccounts.length;
  const someSelected = selectedAccounts.length > 0 && selectedAccounts.length < pageAccounts.length;

  return (
    <>
      <div className={cn(isResizing && "select-none")}>
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-muted/80 backdrop-blur-sm">
            <TableRow className="border-b-2">
              <TableHead className="w-10 py-3 bg-muted/80">
                <Checkbox checked={allSelected} onCheckedChange={handleSelectAll} aria-label="Select all"
                  className={someSelected ? "data-[state=checked]:bg-primary/50" : ""} />
              </TableHead>
              {visibleColumns.map((column) => (
                <TableHead 
                  key={column.field} 
                  className={cn(
                    "relative bg-muted/80 font-bold text-foreground py-3 px-4",
                    sortField === column.field && column.field !== 'linked_contacts' && "bg-accent"
                  )}
                  style={{ 
                    width: column.field === 'linked_contacts' ? '80px' : column.field === 'description' ? '30%' : `${columnWidths[column.field] || 120}px`,
                    minWidth: column.field === 'account_name' ? '150px' : column.field === 'description' ? '200px' : '60px'
                  }}
                >
                  {column.field === 'linked_contacts' ? (
                    <span className="text-sm font-bold text-center block">{column.label}</span>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 -ml-2 text-sm font-bold hover:bg-transparent px-2" onClick={() => onSort(column.field)}>
                      {column.label}
                      {getSortIcon(column.field)}
                    </Button>
                  )}
                  {/* Resize handle */}
                  {column.field !== 'linked_contacts' && (
                    <div 
                      className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-primary/40 active:bg-primary/60" 
                      onMouseDown={e => handleMouseDown(e, column.field)} 
                    />
                  )}
                </TableHead>
              ))}
              <TableHead className="w-20 bg-muted/80 py-3"></TableHead>
            </TableRow>
          </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 2} className="text-center py-6">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto"></div>
              </TableCell>
            </TableRow>
          ) : pageAccounts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={visibleColumns.length + 2} className="text-center py-6 text-muted-foreground text-sm">
                No accounts found
              </TableCell>
            </TableRow>
          ) : (
            pageAccounts.map((account) => (
              <TableRow 
                key={account.id} 
                className={cn(
                  'group hover:bg-muted/30 transition-colors',
                  selectedAccounts.includes(account.id) && 'bg-primary/5'
                )}
              >
                <TableCell className="py-3 px-4">
                  <Checkbox checked={selectedAccounts.includes(account.id)} onCheckedChange={(checked) => handleSelectOne(account.id, checked as boolean)} aria-label={`Select ${account.account_name}`} />
                </TableCell>
                {visibleColumns.map((column) => (
                  <TableCell 
                    key={column.field} 
                    className={cn(
                      'py-3 px-4 text-sm overflow-hidden',
                      column.field === 'account_name' && 'min-w-[150px] max-w-[250px]',
                      column.field === 'description' && 'min-w-[200px] max-w-[350px]',
                      column.field === 'linked_contacts' && 'w-[80px] text-center',
                      column.field === 'account_owner' && 'whitespace-nowrap',
                      !['account_name', 'description', 'linked_contacts', 'account_owner'].includes(column.field) && 'max-w-[180px] truncate'
                    )}
                  >
                    {formatCellValue(account, column.field)}
                  </TableCell>
                ))}
                <TableCell className="py-3 px-2">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(account)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setLinkedAccountName(account.account_name); setShowLinkedDialog(true); }}>
                          <Users className="h-4 w-4 mr-2" />
                          View Linked Contacts
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDelete(account.id)} className="text-destructive focus:text-destructive">
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

      <LinkedContactsDialog
        open={showLinkedDialog}
        onOpenChange={setShowLinkedDialog}
        accountName={linkedAccountName}
      />
    </>
  );
};
