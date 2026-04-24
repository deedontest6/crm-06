CREATE TABLE IF NOT EXISTS public.campaign_email_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.campaign_email_templates(id) ON DELETE CASCADE,
  variant_label TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_variant_label CHECK (variant_label IN ('A','B','C')),
  UNIQUE (template_id, variant_label)
);

CREATE INDEX IF NOT EXISTS idx_variants_template ON public.campaign_email_variants(template_id);

ALTER TABLE public.campaign_email_variants ENABLE ROW LEVEL SECURITY;

-- View: anyone who can view the parent template's campaign (or templates with no campaign)
CREATE POLICY "View variants for accessible templates"
ON public.campaign_email_variants
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.campaign_email_templates t
    WHERE t.id = campaign_email_variants.template_id
      AND (t.campaign_id IS NULL OR can_view_campaign(t.campaign_id))
  )
);

CREATE POLICY "Insert variants for managed templates"
ON public.campaign_email_variants
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = created_by AND
  EXISTS (
    SELECT 1 FROM public.campaign_email_templates t
    WHERE t.id = campaign_email_variants.template_id
      AND (t.campaign_id IS NULL OR can_manage_campaign(t.campaign_id))
  )
);

CREATE POLICY "Update variants for managed templates"
ON public.campaign_email_variants
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.campaign_email_templates t
    WHERE t.id = campaign_email_variants.template_id
      AND (t.campaign_id IS NULL OR can_manage_campaign(t.campaign_id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.campaign_email_templates t
    WHERE t.id = campaign_email_variants.template_id
      AND (t.campaign_id IS NULL OR can_manage_campaign(t.campaign_id))
  )
);

CREATE POLICY "Delete variants for managed templates"
ON public.campaign_email_variants
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.campaign_email_templates t
    WHERE t.id = campaign_email_variants.template_id
      AND (t.campaign_id IS NULL OR can_manage_campaign(t.campaign_id))
  )
);

CREATE TRIGGER update_variants_updated_at
BEFORE UPDATE ON public.campaign_email_variants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Communications: attribute to a variant
ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.campaign_email_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comms_variant_id ON public.campaign_communications(variant_id);