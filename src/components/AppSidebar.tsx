import { 
  Home, 
  Users, 
  BarChart3, 
  Settings,
  LogOut,
  Pin,
  PinOff,
  Bell,
  CheckSquare,
  Building2,
  Megaphone
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const menuItems = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Accounts", url: "/accounts", icon: Building2 },
  { title: "Contacts", url: "/contacts", icon: Users },
  { title: "Deals", url: "/deals", icon: BarChart3 },
  { title: "Campaigns", url: "/campaigns", icon: Megaphone },
  { title: "Action Items", url: "/action-items", icon: CheckSquare },
];

interface AppSidebarProps {
  isFixed?: boolean;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
}

export function AppSidebar({ isFixed = false, isOpen, onToggle }: AppSidebarProps) {
  const [isPinned, setIsPinned] = useState(false);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const currentPath = location.pathname;
  const unreadCount = useUnreadNotificationCount();

  // Use external state if provided (for fixed mode), otherwise use internal state
  const sidebarOpen = isFixed ? (isOpen ?? false) : isPinned;

  const isActive = (path: string) => {
    if (path === "/") {
      return currentPath === "/";
    }
    return currentPath.startsWith(path);
  };

  const handleSignOut = async () => {
    console.log('Sign out clicked');
    await signOut();
  };

  const handleLogoClick = () => {
    navigate('/');
  };

  const handleNotificationClick = () => {
    navigate('/notifications');
  };

  const getUserDisplayName = () => {
    return user?.user_metadata?.full_name || user?.email || 'User';
  };

  const togglePin = () => {
    if (isFixed) {
      onToggle?.(!sidebarOpen);
    } else {
      setIsPinned(!isPinned);
    }
  };

  return (
    <div 
      className={`h-screen flex flex-col border-r border-sidebar-border bg-sidebar-background transition-all duration-300 ease-in-out relative ${
        isFixed ? 'relative' : ''
      }`}
      style={{ 
        width: sidebarOpen ? '200px' : '64px',
        minWidth: sidebarOpen ? '200px' : '64px',
        maxWidth: sidebarOpen ? '200px' : '64px'
      }}
    >
      {/* Header */}
      <div className="flex items-center border-b border-sidebar-border relative h-16 px-4">
        <div 
          className="flex items-center cursor-pointer"
          onClick={handleLogoClick}
        >
          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
            <img 
              src="/lovable-uploads/12bdcc4a-a1c8-4ccf-ba6a-931fd566d3c8.png" 
              alt="Logo" 
              className="w-8 h-8 object-contain"
            />
          </div>
          <div 
            className={`ml-3 text-sidebar-foreground font-semibold text-lg whitespace-nowrap transition-all duration-300 overflow-hidden ${
              sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'
            }`}
            style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
          >
            RealThingks
          </div>
        </div>
      </div>

      {/* Menu Items */}
      <div className="flex-1 py-4">
        <nav className="space-y-1 px-3">
          {menuItems.map((item) => {
            const active = isActive(item.url);
            const menuButton = (
              <NavLink
                to={item.url}
                className={`
                  flex items-center h-10 rounded-lg relative transition-colors duration-200 font-medium
                  ${active 
                    ? 'text-sidebar-accent-foreground bg-sidebar-accent' 
                    : 'text-sidebar-foreground hover:text-sidebar-primary hover:bg-sidebar-accent/50'
                  }
                `}
              >
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <item.icon className="w-5 h-5" />
                </div>
                <div 
                  className={`transition-all duration-300 overflow-hidden whitespace-nowrap ${
                    sidebarOpen ? 'opacity-100 w-auto ml-0' : 'opacity-0 w-0 ml-0'
                  }`}
                  style={{ 
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  {item.title}
                </div>
              </NavLink>
            );

            if (!sidebarOpen) {
              return (
                <Tooltip key={item.title}>
                  <TooltipTrigger asChild>
                    {menuButton}
                  </TooltipTrigger>
                  <TooltipContent side="right" className="ml-2">
                    <p>{item.title}</p>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <div key={item.title}>
                {menuButton}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Bottom Section */}
      <div className="border-t border-sidebar-border p-3 space-y-1">
        {/* Notification Bell */}
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleNotificationClick}
                className={`flex items-center h-10 w-full rounded-lg transition-colors font-medium ${
                  currentPath === '/notifications' 
                    ? 'text-sidebar-accent-foreground bg-sidebar-accent' 
                    : 'text-sidebar-foreground/70 hover:text-sidebar-primary hover:bg-sidebar-accent/50'
                }`}
              >
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 relative">
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <div 
                  className={`transition-all duration-300 overflow-hidden whitespace-nowrap ${
                    sidebarOpen ? 'opacity-100 w-auto ml-0' : 'opacity-0 w-0 ml-0'
                  }`}
                  style={{ 
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '14px'
                  }}
                >
                  Notifications
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side={sidebarOpen ? "bottom" : "right"}>
              <p>Notifications</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Settings */}
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate('/settings')}
                className={`flex items-center h-10 w-full rounded-lg transition-colors font-medium ${
                  currentPath === '/settings' || currentPath.startsWith('/settings')
                    ? 'text-sidebar-accent-foreground bg-sidebar-accent' 
                    : 'text-sidebar-foreground/70 hover:text-sidebar-primary hover:bg-sidebar-accent/50'
                }`}
              >
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <Settings className="w-5 h-5" />
                </div>
                <div 
                  className={`transition-all duration-300 overflow-hidden whitespace-nowrap ${
                    sidebarOpen ? 'opacity-100 w-auto ml-0' : 'opacity-0 w-0 ml-0'
                  }`}
                  style={{ 
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '14px'
                  }}
                >
                  Settings
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side={sidebarOpen ? "bottom" : "right"}>
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Pin Toggle Button */}
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={togglePin}
                className="flex items-center h-10 w-full rounded-lg transition-colors text-sidebar-foreground/70 hover:text-sidebar-primary hover:bg-sidebar-accent/50 font-medium"
              >
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                  {sidebarOpen ? <Pin className="w-5 h-5" /> : <PinOff className="w-5 h-5" />}
                </div>
                <div 
                  className={`transition-all duration-300 overflow-hidden whitespace-nowrap ${
                    sidebarOpen ? 'opacity-100 w-auto ml-0' : 'opacity-0 w-0 ml-0'
                  }`}
                  style={{ 
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '14px'
                  }}
                >
                  {sidebarOpen ? 'Collapse' : 'Expand'}
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side={sidebarOpen ? "bottom" : "right"}>
              <p>{sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* User & Sign Out */}
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSignOutDialog(true)}
                className="flex items-center h-10 w-full rounded-lg transition-colors text-sidebar-foreground/70 hover:text-sidebar-primary hover:bg-sidebar-accent/50 font-medium"
              >
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                  <LogOut className="w-5 h-5" />
                </div>
                <div 
                  className={`transition-all duration-300 overflow-hidden whitespace-nowrap ${
                    sidebarOpen ? 'opacity-100 w-auto ml-0' : 'opacity-0 w-0 ml-0'
                  }`}
                  style={{ 
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontSize: '14px'
                  }}
                >
                  {getUserDisplayName()}
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side={sidebarOpen ? "bottom" : "right"}>
              <p>Sign Out</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Sign Out Confirmation Dialog */}
      <AlertDialog open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign Out</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out of your account?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSignOut}>
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
