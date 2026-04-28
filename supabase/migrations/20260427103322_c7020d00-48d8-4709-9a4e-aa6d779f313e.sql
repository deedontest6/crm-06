-- ─────────────────────────────────────────────────────────────────────
-- 1. New columns on campaign_contacts
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS engagement_score   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_contacted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_at     timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count      integer     NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_score
  ON public.campaign_contacts (campaign_id, engagement_score DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_next_action
  ON public.campaign_contacts (campaign_id, next_action_at)
  WHERE next_action_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Engagement scoring trigger on campaign_communications
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_update_engagement_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta              integer := 0;
  v_is_outbound        boolean := false;
  v_reset_to_zero      boolean := false;
  v_set_stop_sequence  boolean := false;
BEGIN
  IF NEW.contact_id IS NULL OR NEW.campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine direction (outbound vs inbound)
  v_is_outbound := COALESCE(NEW.delivery_status, 'pending') IN ('sent', 'manual', 'pending')
                   AND COALESCE(NEW.sent_via, 'manual') <> 'graph-sync'
                   AND NEW.delivery_status <> 'received';

  IF TG_OP = 'INSERT' THEN
    -- Outbound touch: bumps attempt count + last_contacted_at, no score
    IF v_is_outbound THEN
      UPDATE public.campaign_contacts
      SET attempt_count    = attempt_count + 1,
          last_contacted_at = COALESCE(NEW.communication_date, now()),
          last_activity_at  = COALESCE(NEW.communication_date, now())
      WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
    END IF;

    -- Inbound reply on insert
    IF NEW.delivery_status = 'received' OR NEW.sent_via = 'graph-sync' THEN
      v_delta := v_delta + 5;
    END IF;

    -- Bounce on insert
    IF NEW.bounced_at IS NOT NULL OR NEW.delivery_status IN ('failed', 'bounced') THEN
      v_delta := v_delta - 3;
    END IF;

    -- Call connected on insert
    IF NEW.communication_type IN ('Call', 'Phone')
       AND lower(COALESCE(NEW.call_outcome, '')) IN ('connected', 'answered', 'completed') THEN
      v_delta := v_delta + 3;
    END IF;

    -- LinkedIn accepted on insert
    IF NEW.communication_type = 'LinkedIn'
       AND lower(COALESCE(NEW.linkedin_status, '')) IN ('accepted', 'connected', 'replied') THEN
      v_delta := v_delta + 2;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- First-time non-bot open
    IF (OLD.opened_at IS NULL AND NEW.opened_at IS NOT NULL)
       AND COALESCE(NEW.is_bot_open, false) = false THEN
      v_delta := v_delta + 1;
    END IF;

    -- Status flipped to received
    IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
       AND NEW.delivery_status = 'received' THEN
      v_delta := v_delta + 5;
    END IF;

    -- Bounce just landed
    IF OLD.bounced_at IS NULL AND NEW.bounced_at IS NOT NULL THEN
      v_delta := v_delta - 3;
    END IF;

    -- Call outcome promoted to connected
    IF OLD.call_outcome IS DISTINCT FROM NEW.call_outcome
       AND NEW.communication_type IN ('Call', 'Phone')
       AND lower(COALESCE(NEW.call_outcome, '')) IN ('connected', 'answered', 'completed') THEN
      v_delta := v_delta + 3;
    END IF;

    -- LinkedIn accepted
    IF OLD.linkedin_status IS DISTINCT FROM NEW.linkedin_status
       AND NEW.communication_type = 'LinkedIn'
       AND lower(COALESCE(NEW.linkedin_status, '')) IN ('accepted', 'connected', 'replied') THEN
      v_delta := v_delta + 2;
    END IF;

    -- Unsubscribe → reset and stop sequence
    IF OLD.unsubscribed_at IS NULL AND NEW.unsubscribed_at IS NOT NULL THEN
      v_reset_to_zero     := true;
      v_set_stop_sequence := true;
    END IF;
  END IF;

  -- Apply unsubscribe reset (overrides delta)
  IF v_reset_to_zero THEN
    UPDATE public.campaign_contacts
    SET engagement_score = 0,
        stop_sequence    = true,
        last_activity_at = COALESCE(NEW.communication_date, now())
    WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
    RETURN NEW;
  END IF;

  -- Apply incremental score change (floor at 0)
  IF v_delta <> 0 THEN
    UPDATE public.campaign_contacts
    SET engagement_score = GREATEST(0, engagement_score + v_delta),
        last_activity_at = COALESCE(NEW.communication_date, now())
    WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_engagement_score_insert ON public.campaign_communications;
CREATE TRIGGER trg_engagement_score_insert
  AFTER INSERT ON public.campaign_communications
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_engagement_score();

DROP TRIGGER IF EXISTS trg_engagement_score_update ON public.campaign_communications;
CREATE TRIGGER trg_engagement_score_update
  AFTER UPDATE ON public.campaign_communications
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_engagement_score();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Channel-coordination helper RPC
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_channel_touch_today(
  _campaign_id    uuid,
  _contact_id     uuid,
  _exclude_type   text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaign_communications
    WHERE campaign_id = _campaign_id
      AND contact_id  = _contact_id
      AND communication_date::date = CURRENT_DATE
      AND COALESCE(delivery_status, 'pending') NOT IN ('failed', 'bounced')
      AND (_exclude_type IS NULL OR communication_type <> _exclude_type)
  );
$$;
