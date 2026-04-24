-- Phase 1: Multi-channel support
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS enabled_channels text[] DEFAULT ARRAY['Email','Phone','LinkedIn']::text[];

UPDATE public.campaigns SET enabled_channels = CASE
  WHEN primary_channel IS NULL OR primary_channel = '' THEN ARRAY['Email','Phone','LinkedIn']::text[]
  WHEN primary_channel = 'Call' THEN ARRAY['Phone']::text[]
  ELSE ARRAY[primary_channel]::text[]
END
WHERE enabled_channels IS NULL OR enabled_channels = ARRAY['Email','Phone','LinkedIn']::text[];

-- Phase 3: Audience Segments
CREATE TABLE IF NOT EXISTS public.campaign_audience_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  segment_name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_audience_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View segments for accessible campaigns"
  ON public.campaign_audience_segments FOR SELECT TO authenticated
  USING (can_view_campaign(campaign_id));

CREATE POLICY "Insert segments for managed campaigns"
  ON public.campaign_audience_segments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND can_manage_campaign(campaign_id));

CREATE POLICY "Update segments for managed campaigns"
  ON public.campaign_audience_segments FOR UPDATE TO authenticated
  USING (can_manage_campaign(campaign_id))
  WITH CHECK (can_manage_campaign(campaign_id));

CREATE POLICY "Delete segments for managed campaigns"
  ON public.campaign_audience_segments FOR DELETE TO authenticated
  USING (can_manage_campaign(campaign_id));

CREATE INDEX IF NOT EXISTS idx_campaign_audience_segments_campaign_id ON public.campaign_audience_segments(campaign_id);

-- Phase 3: Template region + segment linkage
ALTER TABLE public.campaign_email_templates ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.campaign_email_templates ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES public.campaign_audience_segments(id) ON DELETE SET NULL;

-- Phase 4: Duplicate-send guard window setting
INSERT INTO public.campaign_settings(setting_key, setting_value)
VALUES ('duplicate_send_window_days', '3')
ON CONFLICT DO NOTHING;