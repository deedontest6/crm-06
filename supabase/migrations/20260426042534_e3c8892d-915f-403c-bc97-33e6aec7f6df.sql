-- 1) campaign_events audit log
CREATE TABLE IF NOT EXISTS public.campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  from_value text,
  to_value text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_created
  ON public.campaign_events (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_type
  ON public.campaign_events (event_type);

ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View campaign events for accessible campaigns" ON public.campaign_events;
CREATE POLICY "View campaign events for accessible campaigns"
  ON public.campaign_events FOR SELECT
  TO authenticated
  USING (public.is_user_admin() OR public.can_view_campaign(campaign_id));

DROP POLICY IF EXISTS "Service role inserts campaign events" ON public.campaign_events;
CREATE POLICY "Service role inserts campaign events"
  ON public.campaign_events FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated insert campaign events" ON public.campaign_events;
CREATE POLICY "Authenticated insert campaign events"
  ON public.campaign_events FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_campaign(campaign_id));

-- 2) transition_campaign_status RPC
CREATE OR REPLACE FUNCTION public.transition_campaign_status(
  _campaign_id uuid,
  _new_status text,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current text;
  v_archived timestamptz;
  v_is_admin boolean := public.is_user_admin();
  v_allowed boolean := false;
BEGIN
  IF NOT public.can_manage_campaign(_campaign_id) THEN
    RAISE EXCEPTION 'Not authorized to change this campaign''s status' USING ERRCODE = '42501';
  END IF;

  SELECT status, archived_at INTO v_current, v_archived
  FROM public.campaigns
  WHERE id = _campaign_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  IF v_archived IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Cannot change status of an archived campaign';
  END IF;

  IF _new_status NOT IN ('Draft','Scheduled','Active','Paused','Completed','Failed') THEN
    RAISE EXCEPTION 'Invalid target status: %', _new_status;
  END IF;

  IF v_current = _new_status THEN
    RETURN jsonb_build_object('changed', false, 'status', v_current);
  END IF;

  -- Allowed transitions
  v_allowed := CASE v_current
    WHEN 'Draft'     THEN _new_status IN ('Scheduled','Active')
    WHEN 'Scheduled' THEN _new_status IN ('Active','Paused','Failed','Draft')
    WHEN 'Active'    THEN _new_status IN ('Paused','Completed','Failed')
    WHEN 'Paused'    THEN _new_status IN ('Active','Completed')
    WHEN 'Completed' THEN false
    WHEN 'Failed'    THEN false
    ELSE false
  END;

  IF NOT v_allowed AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Illegal status transition: % → %', v_current, _new_status
      USING ERRCODE = '22000';
  END IF;

  -- Mark this session as authorized so the BEFORE UPDATE trigger lets it through
  PERFORM set_config('app.allow_campaign_status_change', '1', true);

  UPDATE public.campaigns
  SET status = _new_status, modified_at = now(), modified_by = auth.uid()
  WHERE id = _campaign_id;

  INSERT INTO public.campaign_events
    (campaign_id, actor_user_id, event_type, from_value, to_value, reason)
  VALUES
    (_campaign_id, auth.uid(), 'status_changed', v_current, _new_status, _reason);

  RETURN jsonb_build_object('changed', true, 'from', v_current, 'to', _new_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_campaign_status(uuid, text, text)
  TO authenticated, service_role;

-- 3) Trigger blocking direct status changes that bypass the RPC
CREATE OR REPLACE FUNCTION public._campaigns_guard_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_flag := current_setting('app.allow_campaign_status_change', true);
    IF v_flag IS DISTINCT FROM '1' THEN
      -- Allow admins to override (e.g. recovery from terminal states via dashboards)
      IF NOT public.is_user_admin() THEN
        RAISE EXCEPTION 'Direct status changes are not allowed. Use transition_campaign_status().'
          USING ERRCODE = '42501';
      ELSE
        INSERT INTO public.campaign_events
          (campaign_id, actor_user_id, event_type, from_value, to_value, reason, metadata)
        VALUES
          (NEW.id, auth.uid(), 'status_changed_admin_override',
           OLD.status, NEW.status, 'admin direct update', '{}'::jsonb);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_guard_status ON public.campaigns;
CREATE TRIGGER trg_campaigns_guard_status
  BEFORE UPDATE OF status ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public._campaigns_guard_status_change();

-- 4) Trigger that records archive/unarchive into the audit log
CREATE OR REPLACE FUNCTION public._campaigns_audit_archive_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.archived_at IS NULL) AND (NEW.archived_at IS NOT NULL) THEN
    INSERT INTO public.campaign_events (campaign_id, actor_user_id, event_type, reason)
    VALUES (NEW.id, auth.uid(), 'archived', NULL);
  ELSIF (OLD.archived_at IS NOT NULL) AND (NEW.archived_at IS NULL) THEN
    INSERT INTO public.campaign_events (campaign_id, actor_user_id, event_type, reason)
    VALUES (NEW.id, auth.uid(), 'unarchived', NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_audit_archive ON public.campaigns;
CREATE TRIGGER trg_campaigns_audit_archive
  AFTER UPDATE OF archived_at ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public._campaigns_audit_archive_change();

-- 5) Update activate_scheduled_campaigns to use the new transition path so events are logged
CREATE OR REPLACE FUNCTION public.activate_scheduled_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_row record;
  v_ready jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(782114);

  FOR v_row IN
    SELECT id
    FROM public.campaigns
    WHERE status = 'Scheduled'
      AND archived_at IS NULL
      AND start_date IS NOT NULL
      AND start_date <= CURRENT_DATE
      AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ready := public.get_campaign_launch_readiness(v_row.id);
    IF COALESCE((v_ready->>'ready')::boolean, false) THEN
      PERFORM set_config('app.allow_campaign_status_change', '1', true);
      UPDATE public.campaigns
      SET status = 'Active', modified_at = now()
      WHERE id = v_row.id AND status = 'Scheduled';

      INSERT INTO public.campaign_events
        (campaign_id, actor_user_id, event_type, from_value, to_value, reason)
      VALUES
        (v_row.id, NULL, 'status_changed', 'Scheduled', 'Active', 'auto-activate at start_date');

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Same for auto_complete_campaigns / auto_complete_campaign so they pass the guard
CREATE OR REPLACE FUNCTION public.auto_complete_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  updated_count integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(782113);

  FOR v_row IN
    SELECT id, status FROM public.campaigns
    WHERE status IN ('Active','Paused')
      AND end_date IS NOT NULL
      AND end_date < CURRENT_DATE
      AND archived_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM set_config('app.allow_campaign_status_change', '1', true);
    UPDATE public.campaigns
    SET status = 'Completed', modified_at = now()
    WHERE id = v_row.id;

    INSERT INTO public.campaign_events
      (campaign_id, actor_user_id, event_type, from_value, to_value, reason)
    VALUES
      (v_row.id, NULL, 'status_changed', v_row.status, 'Completed', 'auto-complete past end_date');

    updated_count := updated_count + 1;
  END LOOP;

  RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_complete_campaign(_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_end_date date;
  v_archived_at timestamptz;
BEGIN
  SELECT status, end_date, archived_at
    INTO v_status, v_end_date, v_archived_at
  FROM public.campaigns
  WHERE id = _campaign_id
  FOR UPDATE;

  IF v_status IS NULL THEN RETURN false; END IF;
  IF v_archived_at IS NOT NULL THEN RETURN false; END IF;
  IF v_end_date IS NULL OR v_end_date >= CURRENT_DATE THEN RETURN false; END IF;
  IF v_status NOT IN ('Active', 'Paused') THEN RETURN false; END IF;

  PERFORM set_config('app.allow_campaign_status_change', '1', true);
  UPDATE public.campaigns
  SET status = 'Completed', modified_at = now()
  WHERE id = _campaign_id AND status = v_status;

  INSERT INTO public.campaign_events
    (campaign_id, actor_user_id, event_type, from_value, to_value, reason)
  VALUES
    (_campaign_id, NULL, 'status_changed', v_status, 'Completed', 'auto-complete past end_date');

  RETURN true;
END;
$$;

-- 6) correlation_id on send log for end-to-end tracing
ALTER TABLE public.campaign_send_log
  ADD COLUMN IF NOT EXISTS correlation_id text;

CREATE INDEX IF NOT EXISTS idx_campaign_send_log_correlation
  ON public.campaign_send_log (correlation_id)
  WHERE correlation_id IS NOT NULL;