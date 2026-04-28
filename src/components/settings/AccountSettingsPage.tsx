import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useThemePreferences } from '@/hooks/useThemePreferences';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, User, Shield, Bell } from 'lucide-react';
import ProfileSection from './account/ProfileSection';
import EmailSignatureCard from './account/EmailSignatureCard';
import SecuritySection from './account/SecuritySection';
import NotificationsSection from './account/NotificationsSection';

interface ProfileData {
  full_name: string;
  email: string;
  phone: string;
  timezone: string;
  avatar_url: string;
}

interface NotificationPrefs {
  email_notifications: boolean;
  in_app_notifications: boolean;
  push_notifications: boolean;
  lead_assigned: boolean;
  deal_updates: boolean;
  task_reminders: boolean;
  meeting_reminders: boolean;
  weekly_digest: boolean;
  notification_frequency: string;
  leads_notifications: boolean;
  contacts_notifications: boolean;
  accounts_notifications: boolean;
  daily_reminder_time: string;
}

interface DisplayPrefs {
  date_format: string;
  time_format: string;
  currency: string;
  default_module: string;
}

const AccountSettingsPage = () => {
  const { user } = useAuth();
  const { theme, setTheme } = useThemePreferences();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const initialDataRef = useRef<{
    profile: ProfileData;
    notificationPrefs: NotificationPrefs;
    displayPrefs: DisplayPrefs;
  } | null>(null);

  const [profile, setProfile] = useState<ProfileData>({
    full_name: '',
    email: '',
    phone: '',
    timezone: 'Asia/Kolkata',
    avatar_url: ''
  });

  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>({
    email_notifications: true,
    in_app_notifications: true,
    push_notifications: false,
    lead_assigned: true,
    deal_updates: true,
    task_reminders: true,
    meeting_reminders: true,
    weekly_digest: false,
    notification_frequency: 'instant',
    leads_notifications: true,
    contacts_notifications: true,
    accounts_notifications: true,
    daily_reminder_time: '07:00'
  });

  const [displayPrefs, setDisplayPrefs] = useState<DisplayPrefs>({
    date_format: 'DD/MM/YYYY',
    time_format: '12h',
    currency: 'INR',
    default_module: 'dashboard'
  });

  const hasUnsavedChanges = useCallback(() => {
    if (!initialDataRef.current) return false;
    const { profile: initProfile } = initialDataRef.current;
    return JSON.stringify(profile) !== JSON.stringify(initProfile);
  }, [profile]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (user) {
      fetchAllData();
    }
  }, [user]);

  const fetchAllData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      // Prefer auth display name if profile full_name looks like an email
      const profileName = profileData?.full_name;
      const authName = user.user_metadata?.full_name;
      const isEmailLikeName = profileName && profileName.includes('@');
      const resolvedName = (isEmailLikeName ? authName : profileName) || authName || '';

      const loadedProfile: ProfileData = {
        full_name: resolvedName,
        email: profileData?.['Email ID'] || user.email || '',
        phone: profileData?.phone || '',
        timezone: profileData?.timezone || 'Asia/Kolkata',
        avatar_url: profileData?.avatar_url || ''
      };
      setProfile(loadedProfile);

      const { data: notifData } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const loadedNotifPrefs: NotificationPrefs = {
        email_notifications: notifData?.email_notifications ?? true,
        in_app_notifications: notifData?.in_app_notifications ?? true,
        push_notifications: notifData?.push_notifications ?? false,
        lead_assigned: notifData?.lead_assigned ?? true,
        deal_updates: notifData?.deal_updates ?? true,
        task_reminders: notifData?.task_reminders ?? true,
        meeting_reminders: notifData?.meeting_reminders ?? true,
        weekly_digest: notifData?.weekly_digest ?? false,
        notification_frequency: notifData?.notification_frequency ?? 'instant',
        leads_notifications: notifData?.leads_notifications ?? true,
        contacts_notifications: notifData?.contacts_notifications ?? true,
        accounts_notifications: notifData?.accounts_notifications ?? true,
        daily_reminder_time: (notifData as any)?.daily_reminder_time ?? '07:00'
      };
      setNotificationPrefs(loadedNotifPrefs);

      const { data: displayData } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();

      const loadedDisplayPrefs: DisplayPrefs = {
        date_format: displayData?.date_format || 'DD/MM/YYYY',
        time_format: displayData?.time_format || '12h',
        currency: displayData?.currency || 'INR',
        default_module: displayData?.default_module || 'dashboard'
      };
      setDisplayPrefs(loadedDisplayPrefs);

      initialDataRef.current = {
        profile: loadedProfile,
        notificationPrefs: loadedNotifPrefs,
        displayPrefs: loadedDisplayPrefs
      };
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await supabase.from('profiles').upsert({
        id: user.id,
        full_name: profile.full_name,
        'Email ID': profile.email,
        phone: profile.phone,
        timezone: profile.timezone,
        avatar_url: profile.avatar_url,
        updated_at: new Date().toISOString()
      });

      if (initialDataRef.current) {
        initialDataRef.current.profile = { ...profile };
      }
      toast.success('Profile saved successfully');
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full pb-6">
      <Tabs defaultValue="profile" className="w-full">
        <div className="sticky top-0 z-10 bg-background pb-2 border-b border-border">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="profile" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Profile</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Security</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Notifications</span>
          </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="profile" className="mt-6 space-y-4">
          <ProfileSection 
            profile={profile} 
            setProfile={setProfile} 
            userId={user?.id || ''}
            displayPrefs={displayPrefs}
            setDisplayPrefs={setDisplayPrefs}
            theme={theme}
            setTheme={setTheme}
          />
          {hasUnsavedChanges() && (
            <div className="flex justify-end">
              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Profile
              </Button>
            </div>
          )}
          <EmailSignatureCard
            userId={user?.id || ''}
            fullName={profile.full_name}
            email={profile.email}
          />
        </TabsContent>

        <TabsContent value="security" className="mt-6">
          <SecuritySection userId={user?.id || ''} />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <NotificationsSection
            notificationPrefs={notificationPrefs}
            setNotificationPrefs={setNotificationPrefs}
            userId={user?.id || ''}
            userTimezone={profile.timezone}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AccountSettingsPage;
