-- ============================================================
-- BATCH B + D + E schema for Campaign module
-- ============================================================

-- 1) profiles: email signature
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_signature text;

-- 2) campaign_email_templates: signature toggle + archive
ALTER TABLE public.campaign_email_templates
  ADD COLUMN IF NOT EXISTS include_signature boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- 3) campaign_communications: bot detection, unsubscribe, sequencing, reply intent
ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS is_bot_open boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sequence_step integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reply_intent text;

CREATE INDEX IF NOT EXISTS idx_campaign_comms_bot_open
  ON public.campaign_communications(campaign_id, is_bot_open)
  WHERE is_bot_open = false;

-- ============================================================
-- 4) campaign_suppression_list (GDPR/CAN-SPAM unsubscribe)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL DEFAULT 'unsubscribed',
  source text,
  campaign_id uuid,
  contact_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_suppression_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_suppression_email_lower
  ON public.campaign_suppression_list (lower(email));

ALTER TABLE public.campaign_suppression_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view suppression list"
  ON public.campaign_suppression_list FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins or campaign owner can add suppression"
  ON public.campaign_suppression_list FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      public.is_user_admin()
      OR campaign_id IS NULL
      OR public.can_manage_campaign(campaign_id)
    )
  );

CREATE POLICY "Admins or campaign owner can update suppression"
  ON public.campaign_suppression_list FOR UPDATE
  TO authenticated
  USING (
    public.is_user_admin()
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
    OR created_by = auth.uid()
  );

CREATE POLICY "Admins can delete suppression entries"
  ON public.campaign_suppression_list FOR DELETE
  TO authenticated
  USING (public.is_user_admin());

-- ============================================================
-- 5) campaign_send_caps
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_send_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'global',
  campaign_id uuid,
  daily_limit integer NOT NULL DEFAULT 200,
  hourly_limit integer NOT NULL DEFAULT 50,
  is_enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT send_caps_scope_check CHECK (scope IN ('global','campaign')),
  CONSTRAINT send_caps_campaign_required
    CHECK (scope = 'global' OR campaign_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_send_caps_global
  ON public.campaign_send_caps ((1)) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS idx_send_caps_campaign
  ON public.campaign_send_caps (campaign_id) WHERE scope = 'campaign';

ALTER TABLE public.campaign_send_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view send caps"
  ON public.campaign_send_caps FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage send caps"
  ON public.campaign_send_caps FOR ALL
  TO authenticated
  USING (public.is_user_admin())
  WITH CHECK (public.is_user_admin());

CREATE TRIGGER trg_send_caps_updated_at
  BEFORE UPDATE ON public.campaign_send_caps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed a default global cap row if none exists
INSERT INTO public.campaign_send_caps (scope, daily_limit, hourly_limit, is_enabled)
SELECT 'global', 500, 100, true
WHERE NOT EXISTS (SELECT 1 FROM public.campaign_send_caps WHERE scope = 'global');

-- ============================================================
-- 6) campaign_send_log (cap enforcement ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid,
  contact_id uuid,
  sender_user_id uuid,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_send_log_sent_at ON public.campaign_send_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_send_log_campaign_sent_at ON public.campaign_send_log(campaign_id, sent_at);

ALTER TABLE public.campaign_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role inserts send log"
  ON public.campaign_send_log FOR INSERT
  TO service_role WITH CHECK (true);

CREATE POLICY "Authenticated insert own send log"
  ON public.campaign_send_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = sender_user_id);

CREATE POLICY "Admin or campaign owner views send log"
  ON public.campaign_send_log FOR SELECT
  TO authenticated
  USING (
    public.is_user_admin()
    OR (campaign_id IS NOT NULL AND public.can_view_campaign(campaign_id))
    OR sender_user_id = auth.uid()
  );

-- ============================================================
-- 7) campaign_sequences (multi-touch)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  step_number integer NOT NULL,
  template_id uuid,
  wait_business_days integer NOT NULL DEFAULT 3,
  condition text NOT NULL DEFAULT 'no_reply',
  is_enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sequences_step_unique UNIQUE (campaign_id, step_number),
  CONSTRAINT sequences_condition_check CHECK (condition IN ('no_reply','no_open','always'))
);

CREATE INDEX IF NOT EXISTS idx_sequences_campaign ON public.campaign_sequences(campaign_id);

ALTER TABLE public.campaign_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View sequences for accessible campaigns"
  ON public.campaign_sequences FOR SELECT
  TO authenticated
  USING (public.can_view_campaign(campaign_id));

CREATE POLICY "Insert sequences for managed campaigns"
  ON public.campaign_sequences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by AND public.can_manage_campaign(campaign_id));

CREATE POLICY "Update sequences for managed campaigns"
  ON public.campaign_sequences FOR UPDATE
  TO authenticated
  USING (public.can_manage_campaign(campaign_id))
  WITH CHECK (public.can_manage_campaign(campaign_id));

CREATE POLICY "Delete sequences for managed campaigns"
  ON public.campaign_sequences FOR DELETE
  TO authenticated
  USING (public.can_manage_campaign(campaign_id));

CREATE TRIGGER trg_sequences_updated_at
  BEFORE UPDATE ON public.campaign_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 8) Helper RPC: enforce_send_cap — returns whether sending is allowed now
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_send_cap(_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cap_row record;
  hour_count int;
  day_count int;
BEGIN
  -- Prefer per-campaign cap, fall back to global.
  SELECT * INTO cap_row
  FROM public.campaign_send_caps
  WHERE is_enabled = true
    AND ((scope = 'campaign' AND campaign_id = _campaign_id) OR scope = 'global')
  ORDER BY (scope = 'campaign') DESC
  LIMIT 1;

  IF cap_row IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  SELECT count(*) INTO hour_count
  FROM public.campaign_send_log
  WHERE (cap_row.scope = 'global' OR campaign_id = _campaign_id)
    AND sent_at > now() - interval '1 hour';

  SELECT count(*) INTO day_count
  FROM public.campaign_send_log
  WHERE (cap_row.scope = 'global' OR campaign_id = _campaign_id)
    AND sent_at > now() - interval '24 hours';

  RETURN jsonb_build_object(
    'allowed', hour_count < cap_row.hourly_limit AND day_count < cap_row.daily_limit,
    'hourly_used', hour_count,
    'hourly_limit', cap_row.hourly_limit,
    'daily_used', day_count,
    'daily_limit', cap_row.daily_limit,
    'scope', cap_row.scope
  );
END;
$$;

-- ============================================================
-- 9) Helper RPC: is_email_suppressed
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_email_suppressed(_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_suppression_list
    WHERE lower(email) = lower(_email)
  );
$$;
