import { useState } from 'react';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface Notification {
  id: string;
  user_id: string;
  lead_id: string | null;
  message: string;
  status: 'read' | 'unread';
  notification_type: string;
  action_item_id: string | null;
  module_type: string | null;
  module_id: string | null;
  created_at: string;
  updated_at: string;
}

const ITEMS_PER_PAGE = 50;

export const useNotifications = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = ['notifications', user?.id, currentPage];

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: !!user,
    staleTime: 60 * 1000, // 1 min cache shared across components
    queryFn: async () => {
      if (!user) return { notifications: [], total: 0 };

      const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
      const endIndex = startIndex + ITEMS_PER_PAGE - 1;

      // Single combined call: get rows + exact count
      const { data: rows, count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(startIndex, endIndex);

      if (error) throw error;

      const typed: Notification[] = (rows || []).map(item => ({
        ...item,
        status: item.status as 'read' | 'unread',
      }));

      return { notifications: typed, total: count || 0 };
    },
  });

  const notifications = data?.notifications || [];
  const totalNotifications = data?.total || 0;
  // Derive unread count from cached page (good enough for bell; full count via realtime invalidation)
  const unreadCount = notifications.filter(n => n.status === 'unread').length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications', user?.id] });
  };

  // Mark notification as read
  const markAsRead = async (notificationId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ status: 'read' })
        .eq('id', notificationId)
        .eq('user_id', user.id);
      if (error) throw error;
      invalidate();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ status: 'read' })
        .eq('user_id', user.id)
        .eq('status', 'unread');
      if (error) throw error;
      invalidate();
      toast({ title: "Success", description: "All notifications marked as read" });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      toast({ title: "Error", description: "Failed to mark notifications as read", variant: "destructive" });
    }
  };

  // Delete notification
  const deleteNotification = async (notificationId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)
        .eq('user_id', user.id);
      if (error) throw error;
      invalidate();
      toast({ title: "Success", description: "Notification deleted" });
    } catch (error) {
      console.error('Error deleting notification:', error);
      toast({ title: "Error", description: "Failed to delete notification", variant: "destructive" });
    }
  };

  // Single realtime subscription — invalidates cache on changes
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          // Invalidate cache so all consumers refetch
          queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });

          // Toast for new action item notifications
          if (payload.eventType === 'INSERT' && payload.new?.notification_type === 'action_item') {
            toast({
              title: "New Action Item Notification",
              description: payload.new.message,
              duration: 5000,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, toast]);

  const fetchNotifications = (page: number = 1) => {
    setCurrentPage(page);
  };

  return {
    notifications,
    unreadCount,
    loading: isLoading,
    currentPage,
    totalNotifications,
    itemsPerPage: ITEMS_PER_PAGE,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    fetchNotifications,
    setCurrentPage,
  };
};
