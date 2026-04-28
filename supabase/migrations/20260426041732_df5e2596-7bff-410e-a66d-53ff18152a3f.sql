-- Critical Campaign Module implementation fixes

-- 1) Fix send-cap mailbox tracking schema mismatch.
ALTER TABLE public.campaign_send_log
  ADD COLUMN IF NOT EXISTS mailbox_email text;

CREATE INDEX IF NOT EXISTS idx_campaign_send_log_mailbox_sent_at
  ON public.campaign_send_log (lower(mailbox_email), sent_at DESC)
  WHERE mailbox_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_send_log_sender_sent_at
  ON public.campaign_send_log (sender_user_id, sent_at DESC)
  WHERE sender_user_id IS NOT NULL;

-- 2) Server-side A/B variant picker used by send-campaign-email.
CREATE OR REPLACE FUNCTION public.pick_campaign_variant(_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner uuid;
  v_random uuid;
BEGIN
  SELECT id INTO v_winner
  FROM public.campaign_email_variants
  WHERE template_id = _template_id
    AND is_winner = true
  ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1;

  IF v_winner IS NOT NULL THEN
    RETURN v_winner;
  END IF;

  SELECT id INTO v_random
  FROM public.campaign_email_variants
  WHERE template_id = _template_id
  ORDER BY random()
  LIMIT 1;

  RETURN v_random;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_campaign_variant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_campaign_variant(uuid) TO authenticated, service_role;

-- 3) Launch readiness helper used by UI and scheduled activation.
CREATE OR REPLACE FUNCTION public.get_campaign_launch_readiness(_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign record;
  v_contacts_count int := 0;
  v_email_reachable int := 0;
  v_templates_count int := 0;
  v_missing jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_enabled_channels text[];
BEGIN
  SELECT id, campaign_name, status, start_date, end_date, archived_at, mart_complete, primary_channel, enabled_channels
  INTO v_campaign
  FROM public.campaigns
  WHERE id = _campaign_id;

  IF v_campaign.id IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'blockers', jsonb_build_array('Campaign not found'), 'warnings', '[]'::jsonb);
  END IF;

  IF NOT public.can_view_campaign(_campaign_id) THEN
    RETURN jsonb_build_object('ready', false, 'blockers', jsonb_build_array('Not authorized'), 'warnings', '[]'::jsonb);
  END IF;

  v_enabled_channels := COALESCE(v_campaign.enabled_channels, ARRAY[v_campaign.primary_channel]::text[]);

  SELECT count(*) INTO v_contacts_count
  FROM public.campaign_contacts
  WHERE campaign_id = _campaign_id;

  SELECT count(*) INTO v_email_reachable
  FROM public.campaign_contacts cc
  JOIN public.contacts c ON c.id = cc.contact_id
  WHERE cc.campaign_id = _campaign_id
    AND c.email IS NOT NULL
    AND c.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND NOT public.is_email_suppressed(c.email, _campaign_id);

  SELECT count(*) INTO v_templates_count
  FROM public.campaign_email_templates
  WHERE campaign_id = _campaign_id
    AND is_archived = false
    AND COALESCE(subject, '') <> ''
    AND COALESCE(body, '') <> '';

  IF v_campaign.archived_at IS NOT NULL THEN
    v_missing := v_missing || jsonb_build_array('Campaign is archived');
  END IF;

  IF COALESCE(v_campaign.status, 'Draft') NOT IN ('Draft', 'Scheduled', 'Paused', 'Active') THEN
    v_missing := v_missing || jsonb_build_array('Campaign status cannot be launched');
  END IF;

  IF v_campaign.start_date IS NULL THEN
    v_missing := v_missing || jsonb_build_array('Start date is required');
  END IF;

  IF v_campaign.end_date IS NULL THEN
    v_missing := v_missing || jsonb_build_array('End date is required');
  END IF;

  IF v_campaign.start_date IS NOT NULL AND v_campaign.end_date IS NOT NULL AND v_campaign.start_date > v_campaign.end_date THEN
    v_missing := v_missing || jsonb_build_array('Start date cannot be after end date');
  END IF;

  IF v_campaign.end_date IS NOT NULL AND v_campaign.end_date < CURRENT_DATE THEN
    v_missing := v_missing || jsonb_build_array('Campaign end date has passed');
  END IF;

  IF COALESCE(v_campaign.mart_complete, false) = false THEN
    v_missing := v_missing || jsonb_build_array('Campaign strategy checklist is incomplete');
  END IF;

  IF v_campaign.primary_channel IS NULL OR btrim(v_campaign.primary_channel) = '' THEN
    v_missing := v_missing || jsonb_build_array('Primary channel is required');
  END IF;

  IF v_contacts_count = 0 THEN
    v_missing := v_missing || jsonb_build_array('Audience has no contacts');
  END IF;

  IF 'Email' = ANY(v_enabled_channels) AND v_email_reachable = 0 THEN
    v_missing := v_missing || jsonb_build_array('No reachable unsuppressed email recipients');
  END IF;

  IF 'Email' = ANY(v_enabled_channels) AND v_templates_count = 0 THEN
    v_missing := v_missing || jsonb_build_array('At least one email template with subject and body is required');
  END IF;

  IF v_contacts_count > 0 AND 'Email' = ANY(v_enabled_channels) AND v_email_reachable < v_contacts_count THEN
    v_warnings := v_warnings || jsonb_build_array((v_contacts_count - v_email_reachable)::text || ' contact(s) are missing valid email or are suppressed');
  END IF;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_missing) = 0,
    'blockers', v_missing,
    'warnings', v_warnings,
    'contacts_count', v_contacts_count,
    'email_reachable_count', v_email_reachable,
    'templates_count', v_templates_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_launch_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_launch_readiness(uuid) TO authenticated, service_role;

-- 4) Scheduled -> Active lifecycle worker.
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
      UPDATE public.campaigns
      SET status = 'Active', modified_at = now()
      WHERE id = v_row.id AND status = 'Scheduled';
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_scheduled_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_scheduled_campaigns() TO service_role;

-- 5) Apply real saved-segment filters instead of returning all campaign contacts.
CREATE OR REPLACE FUNCTION public.resolve_campaign_segment_contacts(_segment_id uuid)
RETURNS TABLE(contact_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_filters jsonb;
  v_stages text[];
  v_regions text[];
  v_countries text[];
  v_industries text[];
  v_accounts uuid[];
  v_has_email boolean;
  v_has_phone boolean;
  v_has_linkedin boolean;
BEGIN
  SELECT campaign_id, COALESCE(filters, '{}'::jsonb)
  INTO v_campaign_id, v_filters
  FROM public.campaign_audience_segments
  WHERE id = _segment_id;

  IF v_campaign_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT public.can_view_campaign(v_campaign_id) THEN
    RETURN;
  END IF;

  SELECT array_agg(value) INTO v_stages FROM jsonb_array_elements_text(COALESCE(v_filters->'stages', v_filters->'stage', '[]'::jsonb));
  SELECT array_agg(value) INTO v_regions FROM jsonb_array_elements_text(COALESCE(v_filters->'regions', v_filters->'region', '[]'::jsonb));
  SELECT array_agg(value) INTO v_countries FROM jsonb_array_elements_text(COALESCE(v_filters->'countries', v_filters->'country', '[]'::jsonb));
  SELECT array_agg(value) INTO v_industries FROM jsonb_array_elements_text(COALESCE(v_filters->'industries', v_filters->'industry', '[]'::jsonb));
  SELECT array_agg(value::uuid) INTO v_accounts FROM jsonb_array_elements_text(COALESCE(v_filters->'account_ids', '[]'::jsonb));

  v_has_email := COALESCE((v_filters->>'has_email')::boolean, NULL);
  v_has_phone := COALESCE((v_filters->>'has_phone')::boolean, NULL);
  v_has_linkedin := COALESCE((v_filters->>'has_linkedin')::boolean, NULL);

  RETURN QUERY
  SELECT cc.contact_id
  FROM public.campaign_contacts cc
  LEFT JOIN public.contacts c ON c.id = cc.contact_id
  LEFT JOIN public.accounts a ON a.id = cc.account_id
  WHERE cc.campaign_id = v_campaign_id
    AND (v_stages IS NULL OR cc.stage = ANY(v_stages))
    AND (v_regions IS NULL OR c.region = ANY(v_regions) OR a.region = ANY(v_regions))
    AND (v_countries IS NULL OR a.country = ANY(v_countries))
    AND (v_industries IS NULL OR c.industry = ANY(v_industries) OR a.industry = ANY(v_industries))
    AND (v_accounts IS NULL OR cc.account_id = ANY(v_accounts))
    AND (v_has_email IS NULL OR ((c.email IS NOT NULL AND c.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') = v_has_email))
    AND (v_has_phone IS NULL OR ((COALESCE(c.phone_no, a.phone) IS NOT NULL AND btrim(COALESCE(c.phone_no, a.phone)) <> '') = v_has_phone))
    AND (v_has_linkedin IS NULL OR ((c.linkedin IS NOT NULL AND btrim(c.linkedin) <> '') = v_has_linkedin));
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_campaign_segment_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_segment_contacts(uuid) TO authenticated, service_role;

-- 6) Keep stage validation aligned with current UI metrics that may reference Converted.
ALTER TABLE public.campaign_contacts
  DROP CONSTRAINT IF EXISTS campaign_contacts_stage_check;

ALTER TABLE public.campaign_contacts
  ADD CONSTRAINT campaign_contacts_stage_check
  CHECK (stage IN (
    'Not Contacted',
    'Email Sent',
    'Phone Contacted',
    'LinkedIn Contacted',
    'Responded',
    'Qualified',
    'Converted'
  ));