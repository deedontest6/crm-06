
-- Timing windows for seasonal/event-based campaigns
CREATE TABLE public.campaign_timing_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  window_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_timing_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view accessible campaign timing windows"
  ON public.campaign_timing_windows FOR SELECT TO authenticated
  USING (can_view_campaign(campaign_id));

CREATE POLICY "Users can insert campaign timing windows"
  ON public.campaign_timing_windows FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND can_manage_campaign(campaign_id));

CREATE POLICY "Users can update campaign timing windows"
  ON public.campaign_timing_windows FOR UPDATE TO authenticated
  USING (can_manage_campaign(campaign_id))
  WITH CHECK (can_manage_campaign(campaign_id));

CREATE POLICY "Users can delete campaign timing windows"
  ON public.campaign_timing_windows FOR DELETE TO authenticated
  USING (can_manage_campaign(campaign_id));

-- Email threading and delivery tracking columns on campaign_communications
ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS thread_id UUID,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.campaign_communications(id),
  ADD COLUMN IF NOT EXISTS message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sent_via TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.campaign_email_templates(id);
