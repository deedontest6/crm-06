-- ─── 1. Per-send scheduling ─────────────────────────────────────────
ALTER TABLE public.campaign_send_jobs
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

COMMENT ON COLUMN public.campaign_send_jobs.scheduled_at IS
  'If set, items in this job will not be picked up by the runner until this time. The enqueue function copies this into each item''s next_attempt_at.';

-- ─── 2. Per-item retry RPC (UI uses this to retry one failed recipient) ──
CREATE OR REPLACE FUNCTION public.requeue_send_job_item(_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign_id uuid;
  v_job_id uuid;
BEGIN
  SELECT campaign_id, job_id INTO v_campaign_id, v_job_id
  FROM public.campaign_send_job_items
  WHERE id = _item_id;

  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Send job item not found';
  END IF;

  IF NOT public.can_manage_campaign(v_campaign_id) THEN
    RAISE EXCEPTION 'Not authorized to retry this item' USING ERRCODE = '42501';
  END IF;

  -- Reset to queued so the runner picks it up on the next tick.
  -- Keep attempt_count so we don't loop forever on a permanent error;
  -- the runner's own MAX_ATTEMPTS gate still applies.
  UPDATE public.campaign_send_job_items
  SET status = 'queued',
      next_attempt_at = now(),
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = now()
  WHERE id = _item_id
    AND status IN ('failed', 'skipped', 'cancelled');

  -- Re-open the parent job if it had finalised.
  UPDATE public.campaign_send_jobs
  SET status = 'running', finished_at = NULL, updated_at = now()
  WHERE id = v_job_id
    AND status IN ('completed', 'failed', 'cancelled');
END;
$$;

-- ─── 3. A/B variant assignments (cohort persistence) ────────────────
CREATE TABLE IF NOT EXISTS public.campaign_variant_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  campaign_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_assignments_variant
  ON public.campaign_variant_assignments(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_assignments_campaign
  ON public.campaign_variant_assignments(campaign_id);

ALTER TABLE public.campaign_variant_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View variant assignments for accessible campaigns"
  ON public.campaign_variant_assignments;
CREATE POLICY "View variant assignments for accessible campaigns"
  ON public.campaign_variant_assignments
  FOR SELECT
  TO authenticated
  USING (campaign_id IS NULL OR public.can_view_campaign(campaign_id));

DROP POLICY IF EXISTS "Service role full access variant assignments"
  ON public.campaign_variant_assignments;
CREATE POLICY "Service role full access variant assignments"
  ON public.campaign_variant_assignments
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- New picker that PERSISTS the assignment so retries reuse the same variant.
-- Falls back to the legacy random pick when no contact is provided.
CREATE OR REPLACE FUNCTION public.pick_or_assign_variant(
  _template_id uuid,
  _contact_id uuid DEFAULT NULL,
  _campaign_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing uuid;
  v_winner uuid;
  v_random uuid;
BEGIN
  -- Reuse prior assignment if any
  IF _contact_id IS NOT NULL THEN
    SELECT variant_id INTO v_existing
    FROM public.campaign_variant_assignments
    WHERE template_id = _template_id AND contact_id = _contact_id
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- Declared winner short-circuits
  SELECT id INTO v_winner
  FROM public.campaign_email_variants
  WHERE template_id = _template_id AND is_winner = true
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_winner IS NULL THEN
    SELECT id INTO v_random
    FROM public.campaign_email_variants
    WHERE template_id = _template_id
    ORDER BY random()
    LIMIT 1;
    v_winner := v_random;
  END IF;

  -- Persist (idempotent — UNIQUE(template_id, contact_id) prevents duplicates
  -- if two requests race; the second one falls into ON CONFLICT and we
  -- re-read the winning row to honour the first writer.)
  IF v_winner IS NOT NULL AND _contact_id IS NOT NULL THEN
    INSERT INTO public.campaign_variant_assignments
      (template_id, contact_id, variant_id, campaign_id)
    VALUES (_template_id, _contact_id, v_winner, _campaign_id)
    ON CONFLICT (template_id, contact_id) DO NOTHING;

    SELECT variant_id INTO v_existing
    FROM public.campaign_variant_assignments
    WHERE template_id = _template_id AND contact_id = _contact_id;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  RETURN v_winner;
END;
$$;

-- ─── 4. Cross-campaign frequency cap ────────────────────────────────
-- Configurable in campaign_settings; defaults are conservative
-- (max 5 emails per contact per 24h across ALL campaigns).
CREATE OR REPLACE FUNCTION public.check_contact_frequency_cap(_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_daily_limit int;
  v_hourly_limit int;
  v_used_24h int := 0;
  v_used_1h int := 0;
BEGIN
  SELECT COALESCE(NULLIF(setting_value, '')::int, 5) INTO v_daily_limit
  FROM public.campaign_settings WHERE setting_key = 'cross_campaign_daily_limit';
  IF v_daily_limit IS NULL THEN v_daily_limit := 5; END IF;

  SELECT COALESCE(NULLIF(setting_value, '')::int, 2) INTO v_hourly_limit
  FROM public.campaign_settings WHERE setting_key = 'cross_campaign_hourly_limit';
  IF v_hourly_limit IS NULL THEN v_hourly_limit := 2; END IF;

  SELECT count(*) INTO v_used_24h
  FROM public.campaign_communications
  WHERE contact_id = _contact_id
    AND communication_type = 'Email'
    AND email_status IN ('Sent', 'Replied')
    AND communication_date >= now() - interval '24 hours';

  SELECT count(*) INTO v_used_1h
  FROM public.campaign_communications
  WHERE contact_id = _contact_id
    AND communication_type = 'Email'
    AND email_status IN ('Sent', 'Replied')
    AND communication_date >= now() - interval '1 hour';

  IF v_used_24h >= v_daily_limit OR v_used_1h >= v_hourly_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'cross_campaign_frequency_cap',
      'used_24h', v_used_24h, 'limit_24h', v_daily_limit,
      'used_1h', v_used_1h, 'limit_1h', v_hourly_limit
    );
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- ─── 5. Region → timezone map ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.region_timezone_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL UNIQUE,
  timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.region_timezone_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "All authenticated can view region timezone map"
  ON public.region_timezone_map;
CREATE POLICY "All authenticated can view region timezone map"
  ON public.region_timezone_map FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage region timezone map"
  ON public.region_timezone_map;
CREATE POLICY "Admins can manage region timezone map"
  ON public.region_timezone_map FOR ALL TO authenticated
  USING (public.is_user_admin()) WITH CHECK (public.is_user_admin());

-- Seed common regions (idempotent). Users may add more via admin UI.
INSERT INTO public.region_timezone_map (region, timezone) VALUES
  ('Europe', 'Europe/Berlin'),
  ('North America', 'America/New_York'),
  ('UK', 'Europe/London'),
  ('Asia Pacific', 'Asia/Singapore'),
  ('India', 'Asia/Kolkata'),
  ('Australia', 'Australia/Sydney'),
  ('Middle East', 'Asia/Dubai'),
  ('Latin America', 'America/Sao_Paulo'),
  ('Africa', 'Africa/Johannesburg')
ON CONFLICT (region) DO NOTHING;

-- Helper that returns true when the recipient's local hour is inside
-- 8am-6pm on a weekday, false otherwise. Used by send-campaign-email.
CREATE OR REPLACE FUNCTION public.is_within_recipient_business_hours(_region text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tz text;
  v_local_ts timestamptz;
  v_hour int;
  v_dow int;
BEGIN
  IF _region IS NULL OR _region = '' THEN
    RETURN true;
  END IF;
  SELECT timezone INTO v_tz FROM public.region_timezone_map
  WHERE lower(region) = lower(_region) LIMIT 1;
  IF v_tz IS NULL THEN
    RETURN true;
  END IF;

  v_hour := EXTRACT(hour FROM now() AT TIME ZONE v_tz)::int;
  v_dow := EXTRACT(isodow FROM now() AT TIME ZONE v_tz)::int;
  -- 1=Mon..7=Sun ; allow Mon-Fri 08:00-18:00 local
  IF v_dow BETWEEN 1 AND 5 AND v_hour BETWEEN 8 AND 17 THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;