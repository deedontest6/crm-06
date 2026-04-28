-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Stage rank: single source of truth for "only promote forward"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.campaign_stage_rank(_stage text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _stage
    WHEN 'Not Contacted'      THEN 0
    WHEN 'Email Sent'         THEN 1
    WHEN 'Phone Contacted'    THEN 1
    WHEN 'LinkedIn Contacted' THEN 1
    WHEN 'Opened'             THEN 2
    WHEN 'Responded'          THEN 3
    WHEN 'Qualified'          THEN 4
    WHEN 'Converted'          THEN 5
    ELSE 0
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Disposition column on campaign_contacts (nullable text — soft enum)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS disposition text;

COMMENT ON COLUMN public.campaign_contacts.disposition IS
  'Hard intent flag: NULL | ''Interested'' | ''Not Interested''. Set automatically by reply intent classifier or manually by reps.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Stage promotion trigger on campaign_communications
--    Promotes campaign_contacts.stage based on what happened on the comm row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_promote_contact_stage_from_comm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_stage text := NULL;
  v_current_stage text;
  v_current_rank int;
  v_target_rank int;
  v_set_stop boolean := false;
  v_set_disposition text := NULL;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Decide which stage this row implies
  IF TG_OP = 'INSERT' THEN
    -- Outbound send → stage 1
    IF COALESCE(NEW.delivery_status, 'pending') IN ('sent', 'manual')
       AND COALESCE(NEW.sent_via, 'manual') <> 'graph-sync' THEN
      IF NEW.communication_type = 'Email' THEN
        v_target_stage := 'Email Sent';
      ELSIF NEW.communication_type IN ('Call', 'Phone') THEN
        v_target_stage := 'Phone Contacted';
      ELSIF NEW.communication_type = 'LinkedIn' THEN
        v_target_stage := 'LinkedIn Contacted';
      END IF;
    END IF;
    -- Inbound reply on insert → Responded
    IF NEW.delivery_status = 'received' OR NEW.sent_via = 'graph-sync' THEN
      v_target_stage := 'Responded';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Open detected (non-bot) → Opened
    IF (OLD.opened_at IS NULL AND NEW.opened_at IS NOT NULL)
       AND COALESCE(NEW.is_bot_open, false) = false THEN
      v_target_stage := 'Opened';
    END IF;
    -- Status flipped to received → Responded
    IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
       AND NEW.delivery_status = 'received' THEN
      v_target_stage := 'Responded';
    END IF;
  END IF;

  -- Reply intent (works on both INSERT and UPDATE)
  IF NEW.reply_intent IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.reply_intent IS DISTINCT FROM NEW.reply_intent) THEN
    IF NEW.reply_intent = 'positive' THEN
      v_target_stage := 'Qualified';
      v_set_disposition := 'Interested';
    ELSIF NEW.reply_intent = 'negative' THEN
      v_set_stop := true;
      v_set_disposition := 'Not Interested';
    END IF;
  END IF;

  -- Apply stage promotion (forward only)
  IF v_target_stage IS NOT NULL THEN
    SELECT stage INTO v_current_stage
    FROM public.campaign_contacts
    WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;

    v_current_rank := public.campaign_stage_rank(COALESCE(v_current_stage, 'Not Contacted'));
    v_target_rank  := public.campaign_stage_rank(v_target_stage);

    IF v_target_rank > v_current_rank THEN
      UPDATE public.campaign_contacts
      SET stage = v_target_stage
      WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
    END IF;
  END IF;

  -- Apply disposition / stop_sequence
  IF v_set_disposition IS NOT NULL OR v_set_stop THEN
    UPDATE public.campaign_contacts
    SET disposition  = COALESCE(v_set_disposition, disposition),
        stop_sequence = CASE WHEN v_set_stop THEN true ELSE stop_sequence END
    WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_comm_promote_stage ON public.campaign_communications;
CREATE TRIGGER trg_campaign_comm_promote_stage
  AFTER INSERT OR UPDATE OF opened_at, delivery_status, reply_intent
  ON public.campaign_communications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_promote_contact_stage_from_comm();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. State-change audit log — every campaign_contacts.stage transition writes
--    a row to campaign_events.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_log_campaign_contact_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO public.campaign_events
      (campaign_id, actor_user_id, event_type, from_value, to_value, reason, metadata)
    VALUES
      (NEW.campaign_id, auth.uid(), 'stage_changed',
       COALESCE(OLD.stage, ''), COALESCE(NEW.stage, ''),
       NULL,
       jsonb_build_object('contact_id', NEW.contact_id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_contact_stage_log ON public.campaign_contacts;
CREATE TRIGGER trg_campaign_contact_stage_log
  AFTER UPDATE OF stage ON public.campaign_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_campaign_contact_stage_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Auto-create deal when contact reaches Qualified.
--    Idempotent: only one open deal per (campaign, contact).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_create_deal_for_qualified(
  _campaign_id uuid,
  _contact_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_existing uuid;
  v_cc record;
  v_camp record;
  v_contact record;
  v_account record;
BEGIN
  SELECT cc.id, cc.account_id, cc.contact_id, cc.campaign_id, cc.stage
  INTO v_cc
  FROM public.campaign_contacts cc
  WHERE cc.campaign_id = _campaign_id AND cc.contact_id = _contact_id;
  IF v_cc.id IS NULL THEN RETURN NULL; END IF;

  -- Idempotency: skip if any non-terminal deal already linked to this campaign-contact
  SELECT id INTO v_existing
  FROM public.deals
  WHERE source_campaign_contact_id = v_cc.id
    AND COALESCE(stage, 'Lead') NOT IN ('Won', 'Lost', 'Dropped')
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT id, campaign_name, owner, created_by INTO v_camp
  FROM public.campaigns WHERE id = _campaign_id;
  IF v_camp.id IS NULL THEN RETURN NULL; END IF;

  SELECT id, contact_name, company_name INTO v_contact
  FROM public.contacts WHERE id = _contact_id;

  IF v_cc.account_id IS NOT NULL THEN
    SELECT id, account_name, region INTO v_account
    FROM public.accounts WHERE id = v_cc.account_id;
  END IF;

  INSERT INTO public.deals (
    deal_name,
    project_name,
    customer_name,
    stage,
    region,
    account_id,
    campaign_id,
    source_campaign_contact_id,
    created_by
  ) VALUES (
    COALESCE(v_account.account_name, v_contact.company_name, v_contact.contact_name, 'Campaign lead')
      || ' — ' || COALESCE(v_camp.campaign_name, 'Campaign'),
    COALESCE(v_camp.campaign_name, 'Campaign lead'),
    COALESCE(v_account.account_name, v_contact.company_name, v_contact.contact_name),
    'Lead',
    v_account.region,
    v_cc.account_id,
    _campaign_id,
    v_cc.id,
    COALESCE(v_camp.owner, v_camp.created_by)
  )
  RETURNING id INTO v_deal_id;

  -- Audit
  INSERT INTO public.campaign_events
    (campaign_id, actor_user_id, event_type, from_value, to_value, reason, metadata)
  VALUES
    (_campaign_id, NULL, 'deal_auto_created', NULL, v_deal_id::text,
     'Contact reached Qualified',
     jsonb_build_object('contact_id', _contact_id, 'deal_id', v_deal_id));

  RETURN v_deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_qualified_creates_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'Qualified'
     AND COALESCE(OLD.stage, '') <> 'Qualified'
     AND public.campaign_stage_rank(COALESCE(OLD.stage,'Not Contacted')) < public.campaign_stage_rank('Qualified') THEN
    PERFORM public.auto_create_deal_for_qualified(NEW.campaign_id, NEW.contact_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_contact_qualified_deal ON public.campaign_contacts;
CREATE TRIGGER trg_campaign_contact_qualified_deal
  AFTER UPDATE OF stage ON public.campaign_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_qualified_creates_deal();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Same-day cross-channel conflict guard
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.should_skip_for_channel_conflict(
  _campaign_id uuid,
  _contact_id uuid,
  _channel text,
  _hours int DEFAULT 24
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_communications
    WHERE campaign_id = _campaign_id
      AND contact_id  = _contact_id
      AND communication_type <> _channel
      AND COALESCE(delivery_status,'pending') NOT IN ('failed','bounced','received')
      AND COALESCE(sent_via,'manual') <> 'graph-sync'
      AND communication_date > now() - (_hours || ' hours')::interval
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Unmatched replies queue
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_unmatched_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  from_email text NOT NULL,
  from_name text,
  subject text,
  body_preview text,
  internet_message_id text,
  in_reply_to text,
  conversation_id text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending', -- pending | mapped | discarded
  matched_contact_id uuid,
  matched_campaign_id uuid,
  matched_communication_id uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_replies_status_received
  ON public.campaign_unmatched_replies (status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_unmatched_replies_msgid
  ON public.campaign_unmatched_replies (internet_message_id);

ALTER TABLE public.campaign_unmatched_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins or campaign owners view unmatched" ON public.campaign_unmatched_replies;
CREATE POLICY "Admins or campaign owners view unmatched"
  ON public.campaign_unmatched_replies FOR SELECT
  TO authenticated
  USING (
    public.is_user_admin()
    OR (matched_campaign_id IS NOT NULL AND public.can_view_campaign(matched_campaign_id))
  );

DROP POLICY IF EXISTS "Admins or campaign owners update unmatched" ON public.campaign_unmatched_replies;
CREATE POLICY "Admins or campaign owners update unmatched"
  ON public.campaign_unmatched_replies FOR UPDATE
  TO authenticated
  USING (
    public.is_user_admin()
    OR (matched_campaign_id IS NOT NULL AND public.can_manage_campaign(matched_campaign_id))
  )
  WITH CHECK (
    public.is_user_admin()
    OR (matched_campaign_id IS NOT NULL AND public.can_manage_campaign(matched_campaign_id))
  );

DROP POLICY IF EXISTS "Service role inserts unmatched" ON public.campaign_unmatched_replies;
CREATE POLICY "Service role inserts unmatched"
  ON public.campaign_unmatched_replies FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated insert unmatched (admin only)" ON public.campaign_unmatched_replies;
CREATE POLICY "Authenticated insert unmatched (admin only)"
  ON public.campaign_unmatched_replies FOR INSERT
  TO authenticated
  WITH CHECK (public.is_user_admin());

DROP POLICY IF EXISTS "Admins delete unmatched" ON public.campaign_unmatched_replies;
CREATE POLICY "Admins delete unmatched"
  ON public.campaign_unmatched_replies FOR DELETE
  TO authenticated
  USING (public.is_user_admin());

-- Manual-map RPC: mark unmatched row as mapped, optionally insert a
-- campaign_communications row so downstream triggers fire.
CREATE OR REPLACE FUNCTION public.map_unmatched_reply(
  _unmatched_id uuid,
  _campaign_id uuid,
  _contact_id uuid,
  _account_id uuid DEFAULT NULL,
  _create_comm boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_comm_id uuid;
BEGIN
  IF NOT (public.is_user_admin() OR public.can_manage_campaign(_campaign_id)) THEN
    RAISE EXCEPTION 'Not authorized to map replies on this campaign' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.campaign_unmatched_replies WHERE id = _unmatched_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Unmatched reply not found';
  END IF;

  IF _create_comm THEN
    INSERT INTO public.campaign_communications (
      campaign_id, contact_id, account_id,
      communication_type, subject, body,
      delivery_status, sent_via,
      internet_message_id, conversation_id,
      communication_date, created_by, owner, notes
    ) VALUES (
      _campaign_id, _contact_id, _account_id,
      'Email', v_row.subject, v_row.body_preview,
      'received', 'graph-sync',
      v_row.internet_message_id, v_row.conversation_id,
      v_row.received_at, auth.uid(), auth.uid(),
      'Manually mapped from unmatched reply queue'
    )
    RETURNING id INTO v_comm_id;
  END IF;

  UPDATE public.campaign_unmatched_replies
  SET status = 'mapped',
      matched_campaign_id = _campaign_id,
      matched_contact_id = _contact_id,
      matched_communication_id = v_comm_id,
      resolved_by = auth.uid(),
      resolved_at = now()
  WHERE id = _unmatched_id;

  RETURN v_comm_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_unmatched_reply(_unmatched_id uuid, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.campaign_unmatched_replies
  SET status = 'discarded',
      resolved_by = auth.uid(),
      resolved_at = now(),
      notes = COALESCE(_note, notes)
  WHERE id = _unmatched_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.map_unmatched_reply(uuid,uuid,uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_unmatched_reply(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_stage_rank(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.should_skip_for_channel_conflict(uuid,uuid,text,int) TO authenticated;