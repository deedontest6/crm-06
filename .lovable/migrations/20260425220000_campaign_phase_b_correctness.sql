-- ============================================================
-- Campaign Module — Phase B correctness fixes
--
-- Apply this via Lovable's "Run SQL" / migration tool. After it
-- runs once the platform copies it into supabase/migrations/.
--
-- Goals:
--   1. Variant attribution: weighted-random pick + per-variant counters.
--   2. Mailbox + per-user send caps (defaults: 2k/user/day, 8k/mailbox/day).
--   3. Sequences become the single source of truth — back-fill any existing
--      campaign_follow_up_rules into campaign_sequences and add an optional
--      target_segment_id.
--   4. Segment resolution RPC so Compose / Sequences can target a slice
--      of the campaign audience without duplicating filter logic.
-- ============================================================

-- ── 1) Schema additions ────────────────────────────────────

ALTER TABLE public.campaign_email_variants
  ADD COLUMN IF NOT EXISTS traffic_weight integer NOT NULL DEFAULT 50
    CHECK (traffic_weight BETWEEN 0 AND 100);

ALTER TABLE public.campaign_send_log
  ADD COLUMN IF NOT EXISTS mailbox_email text;

CREATE INDEX IF NOT EXISTS idx_campaign_send_log_sender_sent_at
  ON public.campaign_send_log (sender_user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_send_log_mailbox_sent_at
  ON public.campaign_send_log (mailbox_email, sent_at DESC)
  WHERE mailbox_email IS NOT NULL;

ALTER TABLE public.campaign_sequences
  ADD COLUMN IF NOT EXISTS target_segment_id uuid
    REFERENCES public.campaign_audience_segments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_sequences_campaign_step
  ON public.campaign_sequences (campaign_id, step_number);

-- ── 2) Default global send-cap rows ────────────────────────
-- Scope values: 'per_user', 'per_mailbox', 'campaign'. The first two
-- are global (campaign_id IS NULL); 'campaign' is per-campaign.
INSERT INTO public.campaign_send_caps (scope, daily_limit, hourly_limit, is_enabled, campaign_id)
SELECT 'per_user', 2000, 300, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.campaign_send_caps WHERE scope = 'per_user' AND campaign_id IS NULL
);

INSERT INTO public.campaign_send_caps (scope, daily_limit, hourly_limit, is_enabled, campaign_id)
SELECT 'per_mailbox', 8000, 800, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.campaign_send_caps WHERE scope = 'per_mailbox' AND campaign_id IS NULL
);

-- ── 3) Replace check_send_cap with mailbox+user-aware version ──
-- New signature is backward-compatible: existing single-arg callers keep
-- working (mailbox + user are still checked using NULL/auth.uid()).
CREATE OR REPLACE FUNCTION public.check_send_cap(
  _campaign_id uuid,
  _sender_user_id uuid DEFAULT auth.uid(),
  _mailbox_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now              timestamptz := now();
  v_hour_ago         timestamptz := v_now - interval '1 hour';
  v_day_ago          timestamptz := v_now - interval '24 hours';

  v_camp_cap         record;
  v_user_cap         record;
  v_mbx_cap          record;

  v_camp_h           integer := 0;
  v_camp_d           integer := 0;
  v_user_h           integer := 0;
  v_user_d           integer := 0;
  v_mbx_h            integer := 0;
  v_mbx_d            integer := 0;
BEGIN
  -- Campaign-scoped cap (optional, only when configured)
  SELECT * INTO v_camp_cap
  FROM public.campaign_send_caps
  WHERE scope = 'campaign' AND campaign_id = _campaign_id AND is_enabled
  LIMIT 1;

  IF v_camp_cap.id IS NOT NULL THEN
    SELECT count(*) INTO v_camp_h FROM public.campaign_send_log
      WHERE campaign_id = _campaign_id AND sent_at >= v_hour_ago;
    SELECT count(*) INTO v_camp_d FROM public.campaign_send_log
      WHERE campaign_id = _campaign_id AND sent_at >= v_day_ago;

    IF v_camp_h >= v_camp_cap.hourly_limit OR v_camp_d >= v_camp_cap.daily_limit THEN
      RETURN jsonb_build_object(
        'allowed', false, 'scope', 'campaign',
        'hourly_used', v_camp_h, 'hourly_limit', v_camp_cap.hourly_limit,
        'daily_used',  v_camp_d, 'daily_limit',  v_camp_cap.daily_limit
      );
    END IF;
  END IF;

  -- Per-user global cap
  SELECT * INTO v_user_cap
  FROM public.campaign_send_caps
  WHERE scope = 'per_user' AND campaign_id IS NULL AND is_enabled
  LIMIT 1;

  IF v_user_cap.id IS NOT NULL AND _sender_user_id IS NOT NULL THEN
    SELECT count(*) INTO v_user_h FROM public.campaign_send_log
      WHERE sender_user_id = _sender_user_id AND sent_at >= v_hour_ago;
    SELECT count(*) INTO v_user_d FROM public.campaign_send_log
      WHERE sender_user_id = _sender_user_id AND sent_at >= v_day_ago;

    IF v_user_h >= v_user_cap.hourly_limit OR v_user_d >= v_user_cap.daily_limit THEN
      RETURN jsonb_build_object(
        'allowed', false, 'scope', 'per_user',
        'hourly_used', v_user_h, 'hourly_limit', v_user_cap.hourly_limit,
        'daily_used',  v_user_d, 'daily_limit',  v_user_cap.daily_limit
      );
    END IF;
  END IF;

  -- Per-mailbox global cap
  SELECT * INTO v_mbx_cap
  FROM public.campaign_send_caps
  WHERE scope = 'per_mailbox' AND campaign_id IS NULL AND is_enabled
  LIMIT 1;

  IF v_mbx_cap.id IS NOT NULL AND _mailbox_email IS NOT NULL THEN
    SELECT count(*) INTO v_mbx_h FROM public.campaign_send_log
      WHERE mailbox_email = lower(_mailbox_email) AND sent_at >= v_hour_ago;
    SELECT count(*) INTO v_mbx_d FROM public.campaign_send_log
      WHERE mailbox_email = lower(_mailbox_email) AND sent_at >= v_day_ago;

    IF v_mbx_h >= v_mbx_cap.hourly_limit OR v_mbx_d >= v_mbx_cap.daily_limit THEN
      RETURN jsonb_build_object(
        'allowed', false, 'scope', 'per_mailbox',
        'hourly_used', v_mbx_h, 'hourly_limit', v_mbx_cap.hourly_limit,
        'daily_used',  v_mbx_d, 'daily_limit',  v_mbx_cap.daily_limit
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'campaign_hour', v_camp_h, 'campaign_day', v_camp_d,
    'user_hour',     v_user_h, 'user_day',     v_user_d,
    'mailbox_hour',  v_mbx_h,  'mailbox_day',  v_mbx_d
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_send_cap(uuid, uuid, text)
  TO authenticated, service_role;

-- Keep legacy 1-arg signature working (older callers).
CREATE OR REPLACE FUNCTION public.check_send_cap(_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_send_cap(_campaign_id, auth.uid(), NULL);
$$;
GRANT EXECUTE ON FUNCTION public.check_send_cap(uuid) TO authenticated, service_role;

-- ── 4) Variant pick (weighted random with winner short-circuit) ──
CREATE OR REPLACE FUNCTION public.pick_campaign_variant(_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_winner uuid;
  v_total  integer;
  v_roll   integer;
  v_acc    integer := 0;
  rec      record;
BEGIN
  -- Once a winner is declared, always send the winner.
  SELECT id INTO v_winner
  FROM public.campaign_email_variants
  WHERE template_id = _template_id AND is_winner = true
  LIMIT 1;
  IF v_winner IS NOT NULL THEN RETURN v_winner; END IF;

  SELECT coalesce(sum(greatest(traffic_weight, 0)), 0) INTO v_total
  FROM public.campaign_email_variants
  WHERE template_id = _template_id;

  IF v_total <= 0 THEN
    -- No variants configured (or all weights zero) — caller will fall back
    -- to the template body.
    RETURN NULL;
  END IF;

  v_roll := 1 + floor(random() * v_total)::int;

  FOR rec IN
    SELECT id, greatest(traffic_weight, 0) AS w
    FROM public.campaign_email_variants
    WHERE template_id = _template_id
    ORDER BY created_at
  LOOP
    v_acc := v_acc + rec.w;
    IF v_roll <= v_acc THEN
      RETURN rec.id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pick_campaign_variant(uuid)
  TO authenticated, service_role;

-- ── 5) Variant counter trigger ─────────────────────────────
-- Keeps campaign_email_variants.{sent,open,reply}_count in sync with the
-- comm rows tagged with that variant.
CREATE OR REPLACE FUNCTION public._campaign_variant_counter_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.variant_id IS NOT NULL
     AND lower(coalesce(NEW.delivery_status, '')) = 'sent' THEN
    UPDATE public.campaign_email_variants
       SET sent_count = sent_count + 1
     WHERE id = NEW.variant_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.variant_id IS NOT NULL THEN
    -- First successful (non-bot) open
    IF (OLD.opened_at IS NULL AND NEW.opened_at IS NOT NULL
        AND coalesce(NEW.is_bot_open, false) = false) THEN
      UPDATE public.campaign_email_variants
         SET open_count = open_count + 1
       WHERE id = NEW.variant_id;
    END IF;

    -- Status flip to sent (e.g. queued → sent retry path)
    IF (lower(coalesce(OLD.delivery_status, '')) <> 'sent'
        AND lower(coalesce(NEW.delivery_status, '')) = 'sent') THEN
      UPDATE public.campaign_email_variants
         SET sent_count = sent_count + 1
       WHERE id = NEW.variant_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_variant_counters
  ON public.campaign_communications;

CREATE TRIGGER trg_campaign_variant_counters
  AFTER INSERT OR UPDATE OF opened_at, is_bot_open, delivery_status
  ON public.campaign_communications
  FOR EACH ROW
  EXECUTE FUNCTION public._campaign_variant_counter_tg();

-- Reply counter — fires when a reply row is inserted with delivery_status='received'
-- and a parent that points at a variant comm.
CREATE OR REPLACE FUNCTION public._campaign_variant_reply_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_variant uuid;
BEGIN
  IF NEW.delivery_status = 'received' AND NEW.parent_id IS NOT NULL THEN
    SELECT variant_id INTO v_parent_variant
    FROM public.campaign_communications
    WHERE id = NEW.parent_id;

    IF v_parent_variant IS NOT NULL THEN
      UPDATE public.campaign_email_variants
         SET reply_count = reply_count + 1
       WHERE id = v_parent_variant;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_variant_reply
  ON public.campaign_communications;

CREATE TRIGGER trg_campaign_variant_reply
  AFTER INSERT ON public.campaign_communications
  FOR EACH ROW
  EXECUTE FUNCTION public._campaign_variant_reply_tg();

-- ── 6) Segment resolution RPC ──────────────────────────────
-- Returns the contact_ids of the campaign audience that match the saved
-- filters JSON. AND across filter groups, OR within a group.
-- Filter shape (from SegmentManager):
--   { industries: [], regions: [], countries: [], positions: [], status: '' }
-- 'status' is a per-(campaign_contact) stage column.
CREATE OR REPLACE FUNCTION public.resolve_campaign_segment_contacts(_segment_id uuid)
RETURNS TABLE (contact_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seg     record;
  v_camp    uuid;
  v_filters jsonb;
BEGIN
  SELECT id, campaign_id, filters INTO v_seg
  FROM public.campaign_audience_segments
  WHERE id = _segment_id;

  IF v_seg.id IS NULL THEN
    RETURN; -- empty
  END IF;

  v_camp    := v_seg.campaign_id;
  v_filters := coalesce(v_seg.filters, '{}'::jsonb);

  RETURN QUERY
  SELECT DISTINCT cc.contact_id::uuid
  FROM public.campaign_contacts cc
  LEFT JOIN public.contacts c ON c.id = cc.contact_id
  LEFT JOIN public.accounts a ON a.id = cc.account_id
  WHERE cc.campaign_id = v_camp
    AND (
      jsonb_array_length(coalesce(v_filters->'industries', '[]'::jsonb)) = 0
      OR a.industry = ANY (
        SELECT jsonb_array_elements_text(v_filters->'industries')
      )
    )
    AND (
      jsonb_array_length(coalesce(v_filters->'regions', '[]'::jsonb)) = 0
      OR c.region = ANY (
        SELECT jsonb_array_elements_text(v_filters->'regions')
      )
    )
    AND (
      jsonb_array_length(coalesce(v_filters->'countries', '[]'::jsonb)) = 0
      OR a.country = ANY (
        SELECT jsonb_array_elements_text(v_filters->'countries')
      )
    )
    AND (
      jsonb_array_length(coalesce(v_filters->'positions', '[]'::jsonb)) = 0
      OR c.position = ANY (
        SELECT jsonb_array_elements_text(v_filters->'positions')
      )
    )
    AND (
      coalesce(v_filters->>'status', '') = ''
      OR cc.status = (v_filters->>'status')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_campaign_segment_contacts(uuid)
  TO authenticated, service_role;

-- ── 7) Back-fill follow-up rules into sequences ────────────
-- Each enabled rule becomes a sequence step (condition='no_reply') so the
-- runner only needs to read campaign_sequences. We then disable the rule
-- to prevent double-fire by the legacy code path.
DO $$
DECLARE r record; v_next_step int;
BEGIN
  FOR r IN
    SELECT id, campaign_id, template_id, wait_business_days, max_attempts, created_by
    FROM public.campaign_follow_up_rules
    WHERE is_enabled = true
  LOOP
    -- If a sequences row already exists for this template+wait, skip.
    IF EXISTS (
      SELECT 1 FROM public.campaign_sequences
      WHERE campaign_id = r.campaign_id
        AND template_id = r.template_id
        AND wait_business_days = r.wait_business_days
    ) THEN
      CONTINUE;
    END IF;

    SELECT coalesce(max(step_number), 0) + 1 INTO v_next_step
    FROM public.campaign_sequences
    WHERE campaign_id = r.campaign_id;

    INSERT INTO public.campaign_sequences (
      campaign_id, step_number, template_id,
      wait_business_days, condition, is_enabled, created_by
    ) VALUES (
      r.campaign_id, v_next_step, r.template_id,
      r.wait_business_days, 'no_reply', true, r.created_by
    );

    -- Mirror the rule disabled so the legacy runner branch can't fire it.
    UPDATE public.campaign_follow_up_rules
       SET is_enabled = false
     WHERE id = r.id;
  END LOOP;
END $$;

-- ── 8) Helpful indexes for sequences runner ────────────────
CREATE INDEX IF NOT EXISTS idx_campaign_communications_seq_lookup
  ON public.campaign_communications (campaign_id, contact_id, sequence_step);

CREATE INDEX IF NOT EXISTS idx_campaign_communications_parent
  ON public.campaign_communications (follow_up_parent_id)
  WHERE follow_up_parent_id IS NOT NULL;
