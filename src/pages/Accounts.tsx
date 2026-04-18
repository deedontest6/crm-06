import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Upload, Download, Columns, MoreVertical, Search, Filter, Trash2, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AccountTable } from "@/components/AccountTable";
import { useSimpleAccountsImportExport } from "@/hooks/useSimpleAccountsImportExport";
import { supabase } from "@/integrations/supabase/client";
import { useUserDisplayNames } from "@/hooks/useUserDisplayNames";

const Accounts = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [showColumnCustomizer, setShowColumnCustomizer] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { handleImport, handleExport, isImporting } = useSimpleAccountsImportExport(() => {
    setRefreshTrigger(prev => prev + 1);
  });

  // Distinct account owners — cached for 5 min, refetched only when refreshTrigger changes
  const { data: ownerIds = [] } = useQuery({
    queryKey: ['account-owners', refreshTrigger],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('account_owner');
      if (!data) return [] as string[];
      return [...new Set(data.map(d => d.account_owner).filter(Boolean))] as string[];
    },
  });

  const { displayNames } = useUserDisplayNames(ownerIds);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) { handleImport(file); event.target.value = ''; }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-16 px-6 border-b bg-background flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Accounts</h1>
        <Button onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex-shrink-0 px-6 py-3 bg-muted/30 border-b flex items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search accounts..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9" />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="New">New</SelectItem>
            <SelectItem value="Working">Working</SelectItem>
            <SelectItem value="Qualified">Qualified</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-auto min-w-[100px] [&>svg]:hidden">
            <SelectValue placeholder="All Owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {ownerIds.map(id => (
              <SelectItem key={id} value={id}>{displayNames[id] || id.slice(0, 8)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowColumnCustomizer(true)}>
              <Columns className="h-4 w-4 mr-2" /> Customize Columns
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
              <Upload className="h-4 w-4 mr-2" /> {isImporting ? 'Importing...' : 'Import CSV'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bulk Actions */}
      {selectedAccounts.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-primary/5 border-b flex items-center gap-4">
          <span className="text-sm font-medium text-foreground">
            {selectedAccounts.length} item{selectedAccounts.length !== 1 ? 's' : ''} selected
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setSelectedAccounts([])} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4 mr-1" /> Clear
          </Button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" disabled={isImporting} />

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AccountTable
          showColumnCustomizer={showColumnCustomizer} setShowColumnCustomizer={setShowColumnCustomizer}
          showModal={showModal} setShowModal={setShowModal}
          selectedAccounts={selectedAccounts} setSelectedAccounts={setSelectedAccounts}
          refreshTrigger={refreshTrigger} searchTerm={searchTerm} statusFilter={statusFilter} ownerFilter={ownerFilter}
        />
      </div>
    </div>
  );
};

export default Accounts;
