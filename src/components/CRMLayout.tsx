
import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { NotificationBell } from "./NotificationBell";
import { Button } from "./ui/button";
import { User, LogOut, Loader2, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";

interface CRMLayoutProps {
  children: ReactNode;
}

export const CRMLayout = ({ children }: CRMLayoutProps) => {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const fetchingCount = useIsFetching();
  const isFetching = fetchingCount > 0;
  const routeLabel = location.pathname + (location.search || "");

  return (
    <div className="min-h-screen bg-background flex">
      <AppSidebar />
      <div className="flex-1 flex flex-col">
        {/* Top Navigation Bar */}
        <header className="bg-white border-b border-border px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-foreground">CRM Dashboard</h1>
            <div
              className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md bg-muted/60 border border-border text-xs text-muted-foreground max-w-[420px]"
              title={isFetching ? `Loading data… (${fetchingCount} request${fetchingCount === 1 ? "" : "s"})` : "Idle"}
            >
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono">{routeLabel}</span>
              <span className="mx-1 h-3 w-px bg-border" />
              {isFetching ? (
                <span className="flex items-center gap-1 text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Fetching {fetchingCount}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Idle
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Notification Bell */}
            <NotificationBell size="small" />
            
            {/* User Menu */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span className="text-sm">{user?.email}</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};
