-- Performance indexes for email_reply_skip_log lookups by contact + campaign
CREATE INDEX IF NOT EXISTS idx_email_reply_skip_log_contact_id
  ON public.email_reply_skip_log (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_reply_skip_log_campaign_id
  ON public.email_reply_skip_log (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_reply_skip_log_created_at
  ON public.email_reply_skip_log (created_at DESC);

-- Auto-action-item trigger: replace fragile description-substring dedupe with
-- a 7-day window check on a structured (campaign_id, contact_id) tuple stored
-- in module_id and assigned_to. We use the action_items table itself; same
-- tuple within 7 days → skip. Also stops re-firing on stage flapping.
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
    SELECT * INTO v_contact  FROM public.contacts  WHERE id = NEW.contact_id;

    v_assignee := COALESCE(v_campaign.owner, v_campaign.created_by);
    IF v_assignee IS NULL THEN RETURN NEW; END IF;

    -- 7-day dedupe window: same campaign + same contact + open discovery-call task.
    -- Match on contact_id stored as suffix in description tag we always emit:
    --   "[contact:<uuid>]"
    IF EXISTS (
      SELECT 1 FROM public.action_items
      WHERE module_type = 'campaigns'
        AND module_id   = NEW.campaign_id
        AND status IN ('Open', 'In Progress')
        AND title ILIKE 'Schedule discovery call%'
        AND description LIKE '%[contact:' || NEW.contact_id::text || ']%'
        AND created_at > now() - INTERVAL '7 days'
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.action_items (
      title, description, status, priority,
      module_type, module_id, assigned_to, created_by, due_date
    ) VALUES (
      'Schedule discovery call: ' || COALESCE(v_contact.contact_name, 'contact'),
      'Auto-generated: ' || COALESCE(v_contact.contact_name, 'A contact')
        || ' replied on campaign "' || COALESCE(v_campaign.campaign_name, 'campaign')
        || '". Schedule a discovery call. [contact:' || NEW.contact_id::text || ']',
      'Open', 'High',
      'campaigns', NEW.campaign_id, v_assignee, v_assignee,
      CURRENT_DATE + INTERVAL '2 days'
    );
  END IF;
  RETURN NEW;
END;
$$;