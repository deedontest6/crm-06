
import { useState, useEffect, createContext, useContext } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

// Enhanced cleanup for Safari compatibility
const cleanupAuthState = () => {
  try {
    // Safari-safe localStorage cleanup
    if (typeof Storage !== 'undefined' && typeof localStorage !== 'undefined') {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
          try {
            localStorage.removeItem(key);
          } catch (e) {
            console.warn('Failed to remove localStorage key:', key, e);
          }
        }
      });
    }
    
    // Safari-safe sessionStorage cleanup
    if (typeof Storage !== 'undefined' && typeof sessionStorage !== 'undefined') {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith('supabase.auth.') || key.includes('sb-')) {
          try {
            sessionStorage.removeItem(key);
          } catch (e) {
            console.warn('Failed to remove sessionStorage key:', key, e);
          }
        }
      });
    }
  } catch (error) {
    console.warn('Error during auth state cleanup:', error);
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      
      // Force a fresh session to get updated user metadata
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      
      setUser(user);
      setSession(session);
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  useEffect(() => {
    let mounted = true;
    let sessionFetched = false;

    // Set up auth state listener first
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        console.info("[auth] state change", {
          event,
          hasSession: !!session,
          path: window.location.pathname,
        });

        // Safari-compatible session handling
        if (session) {
          setSession(session);
          setUser(session.user);
        } else {
          setSession(null);
          setUser(null);
        }
        
        if (event === 'SIGNED_OUT') {
          cleanupAuthState();
        }
        
        setLoading(false);
        sessionFetched = true;
      }
    );

    // Get initial session immediately (no artificial delay)
    const getInitialSession = async () => {
      if (!mounted || sessionFetched) return;
      
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        if (error) {
          console.error('Error getting session:', error);
          cleanupAuthState();
          setSession(null);
          setUser(null);
        } else if (session && !sessionFetched) {
          setSession(session);
          setUser(session.user);
        } else if (!session) {
          setSession(null);
          setUser(null);
        }
      } catch (error) {
        if (!mounted) return;
        console.error('Session retrieval failed:', error);
        cleanupAuthState();
        setSession(null);
        setUser(null);
      } finally {
        if (mounted && !sessionFetched) {
          setLoading(false);
        }
      }
    };

    getInitialSession();

    // Safety net: never let the auth gate hang forever. If neither the
    // listener nor getSession() resolves within 5s (slow network, broken
    // Supabase response, etc.), force loading=false so the app shell can
    // render and route the user to /auth instead of an infinite spinner.
    const safetyTimer = setTimeout(() => {
      if (mounted && !sessionFetched) {
        console.warn('[auth] session restore timed out after 5s — releasing loading state');
        setLoading(false);
      }
    }, 5000);

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []); // Empty dependency array to prevent re-running

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        console.warn('Sign out error:', error);
      }
      cleanupAuthState();
      setSession(null);
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
      cleanupAuthState();
      setSession(null);
      setUser(null);
    }
  };

  const value = {
    user,
    session,
    loading,
    signOut,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
