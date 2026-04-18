import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Module-level shared cache to dedupe across component instances
const displayNameCache = new Map<string, string>();
// In-flight fetch promises keyed by sorted-id list to dedupe parallel calls
const pendingFetches = new Map<string, Promise<Record<string, string>>>();

async function fetchDisplayNamesForIds(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const key = [...ids].sort().join(',');
  const existing = pendingFetches.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const result: Record<string, string> = {};
    try {
      // Direct query to profiles table — much faster than the edge function
      // which calls auth.admin.listUsers() (returns ALL users every time).
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name, "Email ID"')
        .in('id', ids);
      profilesData?.forEach((profile: any) => {
        let displayName = "Unknown User";
        if (
          profile.full_name?.trim() &&
          !profile.full_name.includes('@') &&
          profile.full_name !== profile["Email ID"]
        ) {
          displayName = profile.full_name.trim();
        } else if (profile["Email ID"]) {
          displayName = profile["Email ID"].split('@')[0];
        }
        result[profile.id] = displayName;
      });
      ids.forEach((id) => {
        if (!result[id]) result[id] = "Unknown User";
        displayNameCache.set(id, result[id]);
      });
    } catch (error) {
      console.error('useUserDisplayNames: error', error);
      ids.forEach((id) => {
        result[id] = "Unknown User";
        displayNameCache.set(id, "Unknown User");
      });
    } finally {
      pendingFetches.delete(key);
    }
    return result;
  })();

  pendingFetches.set(key, promise);
  return promise;
}

export const useUserDisplayNames = (userIds: string[]) => {
  const validIds = useMemo(
    () => Array.from(new Set(userIds.filter((id) => id && id.trim() !== ''))).sort(),
    [userIds.join(',')] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Identify uncached IDs
  const uncachedIds = useMemo(
    () => validIds.filter((id) => !displayNameCache.has(id)),
    [validIds]
  );

  const queryKey = ['user-display-names', uncachedIds.join(',')];

  const { data: fetched, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchDisplayNamesForIds(uncachedIds),
    enabled: uncachedIds.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const displayNames = useMemo(() => {
    const out: Record<string, string> = {};
    validIds.forEach((id) => {
      out[id] = displayNameCache.get(id) || fetched?.[id] || "";
    });
    return out;
  }, [validIds, fetched]);

  return { displayNames, loading: isLoading };
};

// Helper hook that fetches all users from auth.users via user-admin edge function
export const useAllUsers = () => {
  const [users, setUsers] = useState<{ id: string; display_name: string; email: string; status: 'active' | 'deactivated' }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const { data: functionResult, error: functionError } = await supabase.functions.invoke(
          'user-admin',
          { method: 'GET' }
        );

        if (functionError) throw functionError;

        if (functionResult?.users) {
          const userList = functionResult.users.map((authUser: any) => {
            const metadata = authUser.user_metadata || {};
            let displayName = "Unknown User";
            if (metadata.full_name?.trim() && !metadata.full_name.includes('@')) {
              displayName = metadata.full_name.trim();
            } else if (authUser.email) {
              displayName = authUser.email.split('@')[0];
            }
            const isDeactivated = authUser.banned_until && new Date(authUser.banned_until) > new Date();
            return {
              id: authUser.id,
              display_name: displayName,
              email: authUser.email || '',
              status: isDeactivated ? 'deactivated' as const : 'active' as const,
            };
          });

          const sortedUsers = userList
            .filter((u: any) => u.status === 'active')
            .sort((a: any, b: any) => a.display_name.localeCompare(b.display_name));
          setUsers(sortedUsers);
        }
      } catch (error) {
        console.error('useAllUsers: Error fetching users:', error);
        try {
          const { data, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, "Email ID"')
            .order('full_name', { ascending: true });

          if (!profilesError && data) {
            const userList = data.map((profile: any) => {
              let displayName = "Unknown User";
              if (
                profile.full_name?.trim() &&
                !profile.full_name.includes('@') &&
                profile.full_name !== profile["Email ID"]
              ) {
                displayName = profile.full_name.trim();
              } else if (profile["Email ID"]) {
                displayName = profile["Email ID"].split('@')[0];
              }
              return {
                id: profile.id,
                display_name: displayName,
                email: profile["Email ID"] || '',
                status: 'active' as const,
              };
            });
            setUsers(userList);
          }
        } catch (fallbackError) {
          console.error('useAllUsers: Fallback also failed:', fallbackError);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const getUserDisplayName = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    return user?.display_name || 'Unknown User';
  };

  return { users, loading, getUserDisplayName };
};
