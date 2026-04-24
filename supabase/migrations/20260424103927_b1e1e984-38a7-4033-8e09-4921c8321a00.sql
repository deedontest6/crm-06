-- 1. Bounce tracking on campaign_communications
ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_type text,
  ADD COLUMN IF NOT EXISTS bounce_reason text;

-- 2. Unique slug per campaign (slug is auto-derived; this enforces it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'campaigns_slug_unique'
  ) THEN
    -- Backfill any null slugs first using existing helper
    UPDATE public.campaigns SET slug = public.generate_campaign_slug(campaign_name, id) WHERE slug IS NULL;
    CREATE UNIQUE INDEX campaigns_slug_unique ON public.campaigns(slug) WHERE slug IS NOT NULL;
  END IF;
END $$;

-- 3. FK on follow-up rules → email templates (set null on delete)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_follow_up_rules_template_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_follow_up_rules
      ADD CONSTRAINT campaign_follow_up_rules_template_id_fkey
      FOREIGN KEY (template_id)
      REFERENCES public.campaign_email_templates(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Auto-create action item when a campaign contact stage moves to Responded
CREATE OR REPLACE FUNCTION public.auto_action_item_on_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign campaigns%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_assignee uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage = 'Responded' AND OLD.stage IS DISTINCT FROM 'Responded' THEN
    SELECT * INTO v_campaign FROM public.campaigns WHERE id = NEW.campaign_id;
    SELECT * INTO v_contact FROM public.contacts WHERE id = NEW.contact_id;

    v_assignee := COALESCE(v_campaign.owner, v_campaign.created_by);
    IF v_assignee IS NULL THEN RETURN NEW; END IF;

    -- Skip if a similar open action item already exists for this contact in this campaign
    IF EXISTS (
      SELECT 1 FROM public.action_items
      WHERE module_type = 'campaigns'
        AND module_id = NEW.campaign_id
        AND status = 'Open'
        AND title ILIKE 'Schedule discovery call%'
        AND description ILIKE '%' || NEW.contact_id::text || '%'
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.action_items (
      title, description, status, priority,
      module_type, module_id, assigned_to, created_by,
      due_date
    ) VALUES (
      'Schedule discovery call: ' || COALESCE(v_contact.contact_name, 'contact'),
      'Auto-generated: ' || COALESCE(v_contact.contact_name, 'A contact')
        || ' replied on campaign "' || COALESCE(v_campaign.campaign_name, 'campaign')
        || '". Schedule a discovery call. (contact_id: ' || NEW.contact_id::text || ')',
      'Open', 'High',
      'campaigns', NEW.campaign_id, v_assignee, v_assignee,
      CURRENT_DATE + INTERVAL '2 days'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_action_item_on_response_trg ON public.campaign_contacts;
CREATE TRIGGER auto_action_item_on_response_trg
AFTER UPDATE ON public.campaign_contacts
FOR EACH ROW
EXECUTE FUNCTION public.auto_action_item_on_response();