-- E4: Reusable template snippets
CREATE TABLE public.campaign_template_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  body text NOT NULL,
  shortcut text,
  is_shared boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaign_template_snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own or shared snippets" ON public.campaign_template_snippets
  FOR SELECT TO authenticated USING (is_shared OR created_by = auth.uid() OR is_user_admin());
CREATE POLICY "Insert own snippets" ON public.campaign_template_snippets
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update own snippets" ON public.campaign_template_snippets
  FOR UPDATE TO authenticated USING (created_by = auth.uid() OR is_user_admin());
CREATE POLICY "Delete own snippets" ON public.campaign_template_snippets
  FOR DELETE TO authenticated USING (created_by = auth.uid() OR is_user_admin());

CREATE TRIGGER trg_snippets_updated BEFORE UPDATE ON public.campaign_template_snippets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- E7: Outbound webhooks
CREATE TABLE public.campaign_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid,
  name text NOT NULL,
  target_url text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY['sent','replied','bounced','opened']::text[],
  secret text,
  is_enabled boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,
  last_status text,
  failure_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaign_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View webhooks" ON public.campaign_webhooks FOR SELECT TO authenticated
  USING (is_user_admin() OR (campaign_id IS NULL AND created_by = auth.uid()) OR (campaign_id IS NOT NULL AND can_view_campaign(campaign_id)));
CREATE POLICY "Insert webhooks" ON public.campaign_webhooks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (is_user_admin() OR campaign_id IS NULL OR can_manage_campaign(campaign_id)));
CREATE POLICY "Update webhooks" ON public.campaign_webhooks FOR UPDATE TO authenticated
  USING (is_user_admin() OR created_by = auth.uid() OR (campaign_id IS NOT NULL AND can_manage_campaign(campaign_id)));
CREATE POLICY "Delete webhooks" ON public.campaign_webhooks FOR DELETE TO authenticated
  USING (is_user_admin() OR created_by = auth.uid() OR (campaign_id IS NOT NULL AND can_manage_campaign(campaign_id)));

CREATE TRIGGER trg_webhooks_updated BEFORE UPDATE ON public.campaign_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Webhook delivery log
CREATE TABLE public.campaign_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_code integer,
  response_body text,
  error text,
  attempt integer NOT NULL DEFAULT 1,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaign_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View deliveries via webhook" ON public.campaign_webhook_deliveries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaign_webhooks w WHERE w.id = webhook_id AND
    (is_user_admin() OR w.created_by = auth.uid() OR (w.campaign_id IS NOT NULL AND can_view_campaign(w.campaign_id)))));
CREATE POLICY "Service insert deliveries" ON public.campaign_webhook_deliveries FOR INSERT TO service_role
  WITH CHECK (true);

-- E13: Add campaign_id to deals if not present (for attribution)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deals' AND column_name='campaign_id') THEN
    ALTER TABLE public.deals ADD COLUMN campaign_id uuid;
    CREATE INDEX idx_deals_campaign_id ON public.deals(campaign_id);
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_snippets_created_by ON public.campaign_template_snippets(created_by);
CREATE INDEX IF NOT EXISTS idx_webhooks_campaign ON public.campaign_webhooks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON public.campaign_webhook_deliveries(webhook_id, delivered_at DESC);