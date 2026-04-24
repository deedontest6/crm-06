
import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSecurityAudit } from '@/hooks/useSecurityAudit';
import { usePermissions } from '@/contexts/PermissionsContext';

interface SecurityContextType {
  isSecurityEnabled: boolean;
  hasAdminAccess: boolean;
  userRole: string | null;
}

const SecurityContext = createContext<SecurityContextType | undefined>(undefined);

export const useSecurityContext = () => {
  const context = useContext(SecurityContext);
  if (!context) {
    throw new Error('useSecurityContext must be used within SecurityProvider');
  }
  return context;
};

interface SecurityProviderProps {
  children: React.ReactNode;
}

export const SecurityProvider = ({ children }: SecurityProviderProps) => {
  const { user } = useAuth();
  const { logSecurityEvent } = useSecurityAudit();
  const { userRole, isAdmin } = usePermissions();
  
  // Ref to prevent duplicate session logging
  const sessionLoggedRef = useRef<string | null>(null);

  const hasAdminAccess = isAdmin;

  useEffect(() => {
    if (!user || !userRole) {
      sessionLoggedRef.current = null;
      return;
    }

    // Only log session start once per user (not per role transition)
    const sessionKey = user.id;
    if (sessionLoggedRef.current !== sessionKey) {
      sessionLoggedRef.current = sessionKey;
      logSecurityEvent('SESSION_START', 'auth', user.id, {
        login_time: new Date().toISOString(),
        user_agent: navigator.userAgent,
        role: userRole,
        user_email: user.email
      });
    }
  }, [user, userRole, logSecurityEvent]);

  const value = {
    isSecurityEnabled: true,
    hasAdminAccess,
    userRole
  };

  return (
    <SecurityContext.Provider value={value}>
      {children}
    </SecurityContext.Provider>
  );
};
