-- ============================================================
-- Phase C — B7 (segment exclude + AND) + B11 (enqueue threshold)
-- ============================================================

-- 1) Seed the per-tenant enqueue threshold (B11). Stored as text in
--    campaign_settings.setting_value, parsed by the client. Default 25
--    matches the previous hard-coded behaviour.
INSERT INTO public.campaign_settings (setting_key, setting_value)
SELECT 'enqueue_threshold', '25'
WHERE NOT EXISTS (
  SELECT 1 FROM public.campaign_settings WHERE setting_key = 'enqueue_threshold'
);

-- 2) Rewrite resolve_campaign_segment_contacts to honour:
--      filters.excludes.{regions, countries, industries, stages, account_ids}
--      filters.combine_segment_ids: uuid[]   (AND across segments)
--    Existing segments without these fields behave exactly as before.
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
  v_excludes jsonb;
  v_stages text[];
  v_regions text[];
  v_countries text[];
  v_industries text[];
  v_accounts uuid[];
  v_ex_stages text[];
  v_ex_regions text[];
  v_ex_countries text[];
  v_ex_industries text[];
  v_ex_accounts uuid[];
  v_has_email boolean;
  v_has_phone boolean;
  v_has_linkedin boolean;
  v_combine uuid[];
BEGIN
  SELECT campaign_id, COALESCE(filters, '{}'::jsonb)
  INTO v_campaign_id, v_filters
  FROM public.campaign_audience_segments
  WHERE id = _segment_id;

  IF v_campaign_id IS NULL THEN RETURN; END IF;
  IF NOT public.can_view_campaign(v_campaign_id) THEN RETURN; END IF;

  v_excludes := COALESCE(v_filters->'excludes', '{}'::jsonb);

  SELECT array_agg(value) INTO v_stages     FROM jsonb_array_elements_text(COALESCE(v_filters->'stages',     v_filters->'stage',     '[]'::jsonb));
  SELECT array_agg(value) INTO v_regions    FROM jsonb_array_elements_text(COALESCE(v_filters->'regions',    v_filters->'region',    '[]'::jsonb));
  SELECT array_agg(value) INTO v_countries  FROM jsonb_array_elements_text(COALESCE(v_filters->'countries',  v_filters->'country',  '[]'::jsonb));
  SELECT array_agg(value) INTO v_industries FROM jsonb_array_elements_text(COALESCE(v_filters->'industries', v_filters->'industry', '[]'::jsonb));
  SELECT array_agg(value::uuid) INTO v_accounts FROM jsonb_array_elements_text(COALESCE(v_filters->'account_ids', '[]'::jsonb));

  SELECT array_agg(value) INTO v_ex_stages     FROM jsonb_array_elements_text(COALESCE(v_excludes->'stages',     '[]'::jsonb));
  SELECT array_agg(value) INTO v_ex_regions    FROM jsonb_array_elements_text(COALESCE(v_excludes->'regions',    '[]'::jsonb));
  SELECT array_agg(value) INTO v_ex_countries  FROM jsonb_array_elements_text(COALESCE(v_excludes->'countries',  '[]'::jsonb));
  SELECT array_agg(value) INTO v_ex_industries FROM jsonb_array_elements_text(COALESCE(v_excludes->'industries', '[]'::jsonb));
  SELECT array_agg(value::uuid) INTO v_ex_accounts FROM jsonb_array_elements_text(COALESCE(v_excludes->'account_ids', '[]'::jsonb));

  v_has_email    := COALESCE((v_filters->>'has_email')::boolean,    NULL);
  v_has_phone    := COALESCE((v_filters->>'has_phone')::boolean,    NULL);
  v_has_linkedin := COALESCE((v_filters->>'has_linkedin')::boolean, NULL);

  SELECT array_agg(value::uuid) INTO v_combine
  FROM jsonb_array_elements_text(COALESCE(v_filters->'combine_segment_ids', '[]'::jsonb));

  RETURN QUERY
  SELECT cc.contact_id
  FROM public.campaign_contacts cc
  LEFT JOIN public.contacts c ON c.id = cc.contact_id
  LEFT JOIN public.accounts a ON a.id = cc.account_id
  WHERE cc.campaign_id = v_campaign_id
    -- Includes
    AND (v_stages     IS NULL OR cc.stage = ANY(v_stages))
    AND (v_regions    IS NULL OR c.region = ANY(v_regions) OR a.region = ANY(v_regions))
    AND (v_countries  IS NULL OR a.country = ANY(v_countries))
    AND (v_industries IS NULL OR c.industry = ANY(v_industries) OR a.industry = ANY(v_industries))
    AND (v_accounts   IS NULL OR cc.account_id = ANY(v_accounts))
    AND (v_has_email    IS NULL OR ((c.email IS NOT NULL AND c.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') = v_has_email))
    AND (v_has_phone    IS NULL OR ((COALESCE(c.phone_no, a.phone) IS NOT NULL AND btrim(COALESCE(c.phone_no, a.phone)) <> '') = v_has_phone))
    AND (v_has_linkedin IS NULL OR ((c.linkedin IS NOT NULL AND btrim(c.linkedin) <> '') = v_has_linkedin))
    -- Excludes (B7 — opt-out filters; NULL means no exclusion of that kind)
    AND (v_ex_stages     IS NULL OR NOT (cc.stage = ANY(v_ex_stages)))
    AND (v_ex_regions    IS NULL OR NOT (c.region = ANY(v_ex_regions) OR a.region = ANY(v_ex_regions)))
    AND (v_ex_countries  IS NULL OR NOT (a.country = ANY(v_ex_countries)))
    AND (v_ex_industries IS NULL OR NOT (c.industry = ANY(v_ex_industries) OR a.industry = ANY(v_ex_industries)))
    AND (v_ex_accounts   IS NULL OR NOT (cc.account_id = ANY(v_ex_accounts)))
    -- AND-across-segments (B7 — every listed segment must also include this contact)
    AND (
      v_combine IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM unnest(v_combine) sid
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.resolve_campaign_segment_contacts(sid) other
          WHERE other.contact_id = cc.contact_id
        )
      )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_campaign_segment_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_segment_contacts(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_campaign_segment_contacts(uuid) IS
  'Resolves a saved segment to a list of campaign_contacts.contact_id values. '
  'Honours include rules + filters.excludes.* (NOT IN) + filters.combine_segment_ids (AND across segments). '
  'Recursive — combine_segment_ids cycles must be avoided by callers.';