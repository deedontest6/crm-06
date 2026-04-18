import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User, Loader2, Trash2, Camera, Sun, Moon, Monitor } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getFormattedTimezoneList } from '@/utils/countryRegionMapping';

const timezones = getFormattedTimezoneList();

interface ProfileData {
  full_name: string;
  email: string;
  phone: string;
  timezone: string;
  avatar_url: string;
}

interface DisplayPrefs {
  date_format: string;
  time_format: string;
  currency: string;
  default_module: string;
}

interface ProfileSectionProps {
  profile: ProfileData;
  setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
  userId: string;
  displayPrefs: DisplayPrefs;
  setDisplayPrefs: React.Dispatch<React.SetStateAction<DisplayPrefs>>;
  theme: string;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

const ProfileSection = ({ profile, setProfile, userId, displayPrefs, setDisplayPrefs, theme, setTheme }: ProfileSectionProps) => {
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(displayPrefs));

  // Auto-save display preferences with debounce
  const saveDisplayPrefs = useCallback(async (prefs: DisplayPrefs) => {
    if (!userId) return;
    try {
      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: userId,
          ...prefs,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      if (error) throw error;
      lastSavedRef.current = JSON.stringify(prefs);
    } catch (error) {
      console.error('Error saving display preferences:', error);
      toast.error('Failed to save display preferences');
    }
  }, [userId]);

  useEffect(() => {
    const currentPrefs = JSON.stringify(displayPrefs);
    if (currentPrefs === lastSavedRef.current) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveDisplayPrefs(displayPrefs), 800);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [displayPrefs, saveDisplayPrefs]);

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
  };

  const handleAvatarUpload = async (file: File) => {
    if (!userId) return;
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${userId}/avatar.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const newUrl = urlData.publicUrl + '?t=' + Date.now();
      setProfile(p => ({ ...p, avatar_url: newUrl }));
      await supabase.from('profiles').update({ avatar_url: newUrl }).eq('id', userId);
      toast.success('Profile picture updated');
    } catch (error: any) {
      toast.error(error.message?.includes('bucket') ? 'Avatar storage not configured' : 'Failed to upload');
    }
  };

  const handleRemoveAvatar = async () => {
    if (!userId || !profile.avatar_url) return;
    setRemovingAvatar(true);
    try {
      await supabase.storage.from('avatars')
        .remove([`${userId}/avatar.png`, `${userId}/avatar.jpg`, `${userId}/avatar.jpeg`, `${userId}/avatar.webp`]);
      setProfile(p => ({ ...p, avatar_url: '' }));
      await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
      toast.success('Profile picture removed');
    } catch (error) {
      toast.error('Failed to remove profile picture');
    } finally {
      setRemovingAvatar(false);
    }
  };

  const triggerFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleAvatarUpload(file);
    };
    input.click();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4" />
          Profile Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Avatar className="h-16 w-16 cursor-pointer border-2 border-background shadow-sm" onClick={triggerFileUpload}>
              <AvatarImage src={profile.avatar_url} alt={profile.full_name} />
              <AvatarFallback className="text-lg bg-primary/10">{getInitials(profile.full_name)}</AvatarFallback>
            </Avatar>
            <div 
              className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              onClick={triggerFileUpload}
            >
              <Camera className="h-5 w-5 text-white" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-sm">{profile.full_name || 'Your Name'}</p>
            <p className="text-xs text-muted-foreground">{profile.email}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={triggerFileUpload} className="h-7 text-xs">
                Change Photo
              </Button>
              {profile.avatar_url && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={handleRemoveAvatar}
                  disabled={removingAvatar}
                >
                  {removingAvatar ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Profile Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="full_name" className="text-xs font-medium text-muted-foreground">Full Name</Label>
            <Input
              id="full_name"
              value={profile.full_name}
              onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))}
              placeholder="Enter your full name"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              value={profile.email}
              readOnly
              disabled
              className="h-9 bg-muted/50"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs font-medium text-muted-foreground">Phone</Label>
            <Input
              id="phone"
              value={profile.phone}
              onChange={e => setProfile(p => ({ ...p, phone: e.target.value.replace(/[^\d+\s()-]/g, '') }))}
              placeholder="+1 234 567 8900"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timezone" className="text-xs font-medium text-muted-foreground">Timezone</Label>
            <Select value={profile.timezone} onValueChange={v => setProfile(p => ({ ...p, timezone: v }))}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {timezones.map(tz => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Display Preferences */}
        <div className="pt-4 border-t">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Display Preferences</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
            {/* Theme */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Theme</Label>
              <Select value={theme} onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">
                    <div className="flex items-center gap-2"><Sun className="h-3.5 w-3.5" />Light</div>
                  </SelectItem>
                  <SelectItem value="dark">
                    <div className="flex items-center gap-2"><Moon className="h-3.5 w-3.5" />Dark</div>
                  </SelectItem>
                  <SelectItem value="system">
                    <div className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" />System</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Default Module */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Default Module</Label>
              <Select
                value={displayPrefs.default_module}
                onValueChange={(value) => setDisplayPrefs(p => ({ ...p, default_module: value }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dashboard">Dashboard</SelectItem>
                  <SelectItem value="deals">Deals</SelectItem>
                  <SelectItem value="contacts">Contacts</SelectItem>
                  <SelectItem value="accounts">Accounts</SelectItem>
                  <SelectItem value="tasks">Action Items</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Currency */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Currency</Label>
              <Select
                value={displayPrefs.currency}
                onValueChange={(value) => setDisplayPrefs(p => ({ ...p, currency: value }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INR">₹ INR (Rupee)</SelectItem>
                  <SelectItem value="USD">$ USD (Dollar)</SelectItem>
                  <SelectItem value="EUR">€ EUR (Euro)</SelectItem>
                  <SelectItem value="GBP">£ GBP (Pound)</SelectItem>
                  <SelectItem value="AED">د.إ AED (Dirham)</SelectItem>
                  <SelectItem value="SGD">S$ SGD (Singapore)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date Format */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Date Format</Label>
              <Select
                value={displayPrefs.date_format}
                onValueChange={(value) => setDisplayPrefs(p => ({ ...p, date_format: value }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  <SelectItem value="DD-MMM-YYYY">DD-MMM-YYYY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time Format */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Time Format</Label>
              <Select
                value={displayPrefs.time_format}
                onValueChange={(value) => setDisplayPrefs(p => ({ ...p, time_format: value }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="12h">12-hour</SelectItem>
                  <SelectItem value="24h">24-hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProfileSection;
