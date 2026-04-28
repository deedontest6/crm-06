-- ============================================================
-- E12: Multi-channel sequences (email | linkedin | call)
-- ============================================================
ALTER TABLE public.campaign_sequences
  ADD COLUMN IF NOT EXISTS step_type text NOT NULL DEFAULT 'email';

ALTER TABLE public.campaign_sequences
  DROP CONSTRAINT IF EXISTS campaign_sequences_step_type_chk;
ALTER TABLE public.campaign_sequences
  ADD CONSTRAINT campaign_sequences_step_type_chk
  CHECK (step_type IN ('email','linkedin','call'));

-- For non-email steps the template_id may be null (no email body needed);
-- the runner creates an action_item instead.

-- ============================================================
-- E11: Automation triggers — enroll contacts into a campaign
--      when an account or deal stage changes.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_automation_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- event types we currently support; extend over time
  trigger_event text NOT NULL CHECK (trigger_event IN (
    'account_status_changed',
    'deal_stage_changed'
  )),
  -- e.g. {"to_value":"Qualified"} or {"to_value":"Won","from_value":"Negotiation"}
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_campaign_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  enrolled_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_triggers_enabled
  ON public.campaign_automation_triggers(is_enabled, trigger_event);
CREATE INDEX IF NOT EXISTS idx_automation_triggers_target
  ON public.campaign_automation_triggers(target_campaign_id);

ALTER TABLE public.campaign_automation_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View automation triggers for managed campaigns"
  ON public.campaign_automation_triggers FOR SELECT TO authenticated
  USING (public.is_user_admin() OR created_by = auth.uid()
         OR public.can_view_campaign(target_campaign_id));

CREATE POLICY "Insert automation triggers for managed campaigns"
  ON public.campaign_automation_triggers FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by
              AND (public.is_user_admin() OR public.can_manage_campaign(target_campaign_id)));

CREATE POLICY "Update automation triggers for managed campaigns"
  ON public.campaign_automation_triggers FOR UPDATE TO authenticated
  USING (public.is_user_admin() OR created_by = auth.uid()
         OR public.can_manage_campaign(target_campaign_id))
  WITH CHECK (public.is_user_admin() OR created_by = auth.uid()
              OR public.can_manage_campaign(target_campaign_id));

CREATE POLICY "Delete automation triggers for managed campaigns"
  ON public.campaign_automation_triggers FOR DELETE TO authenticated
  USING (public.is_user_admin() OR created_by = auth.uid()
         OR public.can_manage_campaign(target_campaign_id));

-- Audit table: which contact got enrolled by which trigger when, so the runner
-- is idempotent (no double-enrolls on repeat ticks).
CREATE TABLE IF NOT EXISTS public.campaign_automation_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  account_id uuid,
  source_event_id uuid,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_enrollments
  ON public.campaign_automation_enrollments(trigger_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_automation_enrollments_campaign
  ON public.campaign_automation_enrollments(campaign_id);

ALTER TABLE public.campaign_automation_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View enrollments via accessible campaign"
  ON public.campaign_automation_enrollments FOR SELECT TO authenticated
  USING (public.is_user_admin() OR public.can_view_campaign(campaign_id));

CREATE POLICY "Service role full access enrollments"
  ON public.campaign_automation_enrollments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- E15: Approval workflow for large sends
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  approver_user_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','cancelled')),
  recipient_count integer NOT NULL DEFAULT 0,
  threshold integer NOT NULL DEFAULT 0,
  reason text,
  decision_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_campaign_approvals_campaign
  ON public.campaign_approvals(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_approvals_status
  ON public.campaign_approvals(status);

ALTER TABLE public.campaign_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View approvals for accessible campaigns"
  ON public.campaign_approvals FOR SELECT TO authenticated
  USING (public.is_user_admin() OR public.can_view_campaign(campaign_id));

CREATE POLICY "Request approval for managed campaigns"
  ON public.campaign_approvals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requested_by
              AND public.can_manage_campaign(campaign_id));

-- Decisions are made via a SECURITY DEFINER RPC below, so no UPDATE policy
-- for end-users by design (prevents bypassing the role check).
CREATE POLICY "Admin can update approvals"
  ON public.campaign_approvals FOR UPDATE TO authenticated
  USING (public.is_user_admin())
  WITH CHECK (public.is_user_admin());

-- Helper: count current eligible recipients for a campaign (contacts table
-- joined via campaign_contacts; matches what the audience UI shows).
CREATE OR REPLACE FUNCTION public.count_campaign_recipients(_campaign_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.campaign_contacts WHERE campaign_id = _campaign_id;
$$;

GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(uuid)
  TO authenticated, service_role;

-- Read the approval threshold from campaign_settings (default 100).
CREATE OR REPLACE FUNCTION public.get_approval_threshold()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(setting_value, '')::int
     FROM public.campaign_settings
     WHERE setting_key = 'approval_required_threshold'),
    100
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_approval_threshold()
  TO authenticated, service_role;

-- Decide on an approval (manager/admin only).
CREATE OR REPLACE FUNCTION public.decide_campaign_approval(
  _approval_id uuid,
  _decision text,
  _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_status text;
BEGIN
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision %', _decision;
  END IF;
  -- Allow admins OR users with the 'manager' role to decide.
  SELECT role::text INTO v_role FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','manager') LIMIT 1;
  IF v_role IS NULL AND NOT public.is_user_admin() THEN
    RAISE EXCEPTION 'Not authorized to decide on campaign approvals' USING ERRCODE='42501';
  END IF;
  SELECT status INTO v_status FROM public.campaign_approvals WHERE id = _approval_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Approval not found'; END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Approval already %', v_status;
  END IF;
  UPDATE public.campaign_approvals
    SET status = _decision, approver_user_id = auth.uid(),
        decision_note = _note, decided_at = now()
    WHERE id = _approval_id;
  RETURN jsonb_build_object('id', _approval_id, 'status', _decision);
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_campaign_approval(uuid, text, text)
  TO authenticated;

-- Patch transition_campaign_status to require approval when activating a
-- campaign whose audience size meets or exceeds the threshold.
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
  v_threshold int;
  v_recipients int;
  v_has_approval boolean;
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

  -- E15: gate Active transitions on approval when audience size meets threshold.
  IF _new_status = 'Active' AND NOT v_is_admin THEN
    v_threshold := public.get_approval_threshold();
    v_recipients := public.count_campaign_recipients(_campaign_id);
    IF v_recipients >= v_threshold THEN
      SELECT EXISTS(
        SELECT 1 FROM public.campaign_approvals
         WHERE campaign_id = _campaign_id AND status = 'approved'
           AND requested_at > (now() - interval '30 days')
      ) INTO v_has_approval;
      IF NOT v_has_approval THEN
        RAISE EXCEPTION 'Approval required: this campaign has % recipients (threshold %). Request approval first.',
          v_recipients, v_threshold USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;

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