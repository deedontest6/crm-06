
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import SecurityEnhancedApp from "@/components/SecurityEnhancedApp";
import { AppSidebar } from "@/components/AppSidebar";
import { lazy, Suspense, useEffect, useState } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

// Eager: most-common landing pages
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";

// Lazy: everything else (huge code-split win)
const Accounts = lazy(() => import("./pages/Accounts"));
const Contacts = lazy(() => import("./pages/Contacts"));
const DealsPage = lazy(() => import("./pages/DealsPage"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const ActionItems = lazy(() => import("./pages/ActionItems"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Notifications = lazy(() => import("./pages/Notifications"));
const EmailSkipAuditLog = lazy(() => import("./pages/EmailSkipAuditLog"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background px-6">
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      <p className="text-sm font-medium text-foreground">Loading page</p>
    </div>
  </div>
);

const RouteDiagnostics = () => {
  const location = useLocation();

  useEffect(() => {
    console.info("[route] location changed", {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location]);

  return null;
};

const AppCrashedFallback = ({ onRetry }: { onRetry: () => void }) => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The preview hit a runtime error on <span className="font-medium text-foreground">{location.pathname}</span>.
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={onRetry}>Retry preview</Button>
          <Button variant="outline" onClick={() => navigate("/auth", { replace: true })}>Go to sign in</Button>
        </div>
      </div>
    </div>
  );
};

// Layout Component for all pages with fixed sidebar
const FixedSidebarLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false); // Start collapsed
  const location = useLocation();
  
  // These routes need overflow-hidden so they can control their own scrolling
  const controlledScrollRoutes = ['/action-items', '/contacts', '/deals', '/settings', '/notifications', '/', '/accounts', '/campaigns'];
  const needsControlledScroll = controlledScrollRoutes.includes(location.pathname) || location.pathname.startsWith('/campaigns/');
  
  return (
    <div className="h-screen flex w-full overflow-hidden">
      <div className="fixed top-0 left-0 z-50 h-full">
        <AppSidebar isFixed={true} isOpen={sidebarOpen} onToggle={setSidebarOpen} />
      </div>
      <main 
        className="flex-1 bg-background h-screen overflow-hidden"
        style={{ 
          marginLeft: sidebarOpen ? '200px' : '64px',
          transition: 'margin-left 300ms ease-in-out',
          width: `calc(100vw - ${sidebarOpen ? '200px' : '64px'})`
        }}
      >
        <div className={`w-full h-full min-h-0 ${needsControlledScroll ? 'overflow-hidden' : 'overflow-auto'}`}>
          <Suspense fallback={<RouteFallback />}>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  );
};

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center px-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-foreground font-medium">Restoring your workspace</p>
          <p className="text-sm text-muted-foreground mt-1">Checking your session and loading the app shell.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <FixedSidebarLayout>
      {children}
    </FixedSidebarLayout>
  );
};

// Auth Route Component (redirects if already authenticated)
const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center px-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-foreground font-medium">Preparing authentication</p>
          <p className="text-sm text-muted-foreground mt-1">Please wait while we verify your session.</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const RoutedApp = () => {
  const location = useLocation();

  return (
    <AppErrorBoundary resetKeys={[location.pathname]} fallback={(reset) => <AppCrashedFallback onRetry={reset} />}>
      <RouteDiagnostics />
      <Routes>
        <Route path="/auth" element={<AuthRoute><Auth /></AuthRoute>} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/accounts" element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
        <Route path="/contacts" element={<ProtectedRoute><Contacts /></ProtectedRoute>} />
        <Route path="/deals" element={<ProtectedRoute><DealsPage /></ProtectedRoute>} />
        <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
        <Route path="/campaigns/:id" element={<ProtectedRoute><CampaignDetail /></ProtectedRoute>} />
        <Route path="/action-items" element={<ProtectedRoute><ActionItems /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/settings/email-skip-audit" element={<ProtectedRoute><EmailSkipAuditLog /></ProtectedRoute>} />
        <Route path="*" element={<ProtectedRoute><NotFound /></ProtectedRoute>} />
      </Routes>
    </AppErrorBoundary>
  );
};

const AppRouter = () => (
  <BrowserRouter>
    <RoutedApp />
  </BrowserRouter>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <SecurityEnhancedApp>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AppRouter />
      </TooltipProvider>
    </SecurityEnhancedApp>
  </QueryClientProvider>
);

export default App;
