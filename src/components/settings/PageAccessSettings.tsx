import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';

interface PagePermission {
  id: string;
  page_name: string;
  description: string | null;
  route: string;
  admin_access: boolean;
  manager_access: boolean;
  user_access: boolean;
}

const PageAccessSettings = () => {
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const { logSecurityEvent } = useSecurityAudit();

  const fetchPermissions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('page_permissions')
        .select('*')
        .order('page_name');
      
      if (error) throw error;
      setPermissions(data || []);
    } catch (error) {
      console.error('Error fetching page permissions:', error);
      toast.error('Failed to load page permissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();
  }, []);

  const handleToggle = async (id: string, field: 'admin_access' | 'manager_access' | 'user_access', value: boolean) => {
    setUpdating(id);
    try {
      const { error } = await supabase
        .from('page_permissions')
        .update({ [field]: value } as any)
        .eq('id', id);
      
      if (error) throw error;
      
      const perm = permissions.find(p => p.id === id);
      setPermissions(prev => prev.map(p => 
        p.id === id ? { ...p, [field]: value } : p
      ));
      logSecurityEvent('SETTINGS_UPDATE', 'page_permissions', id, {
        page_name: perm?.page_name,
        field,
        old_value: !value,
        new_value: value
      });
      toast.success('Permission updated');
    } catch (error) {
      console.error('Error updating permission:', error);
      toast.error('Failed to update permission');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Page</TableHead>
              <TableHead>Route</TableHead>
              <TableHead className="text-center w-[100px]">Admin</TableHead>
              <TableHead className="text-center w-[100px]">Manager</TableHead>
              <TableHead className="text-center w-[100px]">User</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissions.map((permission) => (
              <TableRow key={permission.id}>
                <TableCell className="font-medium">
                  <div>
                    <div className="text-sm">{permission.page_name}</div>
                    {permission.description && (
                      <div className="text-xs text-muted-foreground">{permission.description}</div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {permission.route}
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={permission.admin_access}
                    onCheckedChange={(value) => handleToggle(permission.id, 'admin_access', value)}
                    disabled={updating === permission.id}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={permission.manager_access}
                    onCheckedChange={(value) => handleToggle(permission.id, 'manager_access', value)}
                    disabled={updating === permission.id}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={permission.user_access}
                    onCheckedChange={(value) => handleToggle(permission.id, 'user_access', value)}
                    disabled={updating === permission.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default PageAccessSettings;
