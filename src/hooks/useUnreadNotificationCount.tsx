import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Lightweight hook for the sidebar bell.
 * Single HEAD count query + one realtime channel.
 * Does NOT fetch notification rows or open multiple subscriptions.
 */
export const useUnreadNotificationCount = () => {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    let cancelled = false;

    const fetchCount = async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'unread');

      if (!cancelled && !error) {
        setUnreadCount(count || 0);
      }
    };

    fetchCount();

    const channel = supabase
      .channel(`notif-count-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Re-fetch the count on any change. Cheap HEAD query.
          fetchCount();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  return unreadCount;
};
