CREATE TABLE IF NOT EXISTS public.campaign_follow_up_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.campaign_email_templates(id) ON DELETE SET NULL,
  trigger_event TEXT NOT NULL DEFAULT 'no_reply',
  wait_business_days INTEGER NOT NULL DEFAULT 3,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_trigger_event CHECK (trigger_event IN ('no_reply')),
  CONSTRAINT chk_wait_days CHECK (wait_business_days BETWEEN 1 AND 30),
  CONSTRAINT chk_max_attempts CHECK (max_attempts BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_rules_campaign
  ON public.campaign_follow_up_rules(campaign_id) WHERE is_enabled = TRUE;

ALTER TABLE public.campaign_follow_up_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View follow-up rules for accessible campaigns"
ON public.campaign_follow_up_rules
FOR SELECT TO authenticated
USING (can_view_campaign(campaign_id));

CREATE POLICY "Manage follow-up rules for managed campaigns"
ON public.campaign_follow_up_rules
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by AND can_manage_campaign(campaign_id));

CREATE POLICY "Update follow-up rules for managed campaigns"
ON public.campaign_follow_up_rules
FOR UPDATE TO authenticated
USING (can_manage_campaign(campaign_id))
WITH CHECK (can_manage_campaign(campaign_id));

CREATE POLICY "Delete follow-up rules for managed campaigns"
ON public.campaign_follow_up_rules
FOR DELETE TO authenticated
USING (can_manage_campaign(campaign_id));

CREATE TRIGGER update_follow_up_rules_updated_at
BEFORE UPDATE ON public.campaign_follow_up_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Communications: follow-up attribution
ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS follow_up_attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS follow_up_parent_id UUID REFERENCES public.campaign_communications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comms_followup_parent
  ON public.campaign_communications(follow_up_parent_id);