-- ============================================================
-- Campaign audit fixes — Phase 1
-- ============================================================

-- 1) Stage rank: lift Email Sent to equal Opened so out-of-order
--    open events do not block stage recording.
CREATE OR REPLACE FUNCTION public.campaign_stage_rank(_stage text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _stage
    WHEN 'Not Contacted'      THEN 0
    WHEN 'Email Sent'         THEN 2
    WHEN 'Phone Contacted'    THEN 2
    WHEN 'LinkedIn Contacted' THEN 2
    WHEN 'Opened'             THEN 2
    WHEN 'Responded'          THEN 4
    WHEN 'Qualified'          THEN 5
    ELSE 0
  END;
$$;

-- 2) Engagement-score trigger: only treat resolved sends as outbound.
CREATE OR REPLACE FUNCTION public.trg_update_engagement_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- Resolved outbound only ('sent' or manual log). 'pending' is not yet a
  -- confirmed attempt; counting it caused double-attribution when the row
  -- later flipped to 'failed'.
  v_is_outbound := COALESCE(NEW.delivery_status, '') IN ('sent', 'manual')
                   AND COALESCE(NEW.sent_via, 'manual') <> 'graph-sync';

  IF TG_OP = 'INSERT' THEN
    IF v_is_outbound THEN
      UPDATE public.campaign_contacts
      SET attempt_count     = attempt_count + 1,
          last_contacted_at = COALESCE(NEW.communication_date, now()),
          last_activity_at  = COALESCE(NEW.communication_date, now())
      WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
    END IF;

    IF NEW.delivery_status = 'received' OR NEW.sent_via = 'graph-sync' THEN
      v_delta := v_delta + 5;
    END IF;

    IF NEW.bounced_at IS NOT NULL OR NEW.delivery_status IN ('failed', 'bounced') THEN
      v_delta := v_delta - 3;
    END IF;

    IF NEW.communication_type IN ('Call', 'Phone')
       AND lower(COALESCE(NEW.call_outcome, '')) IN ('connected', 'answered', 'completed') THEN
      v_delta := v_delta + 3;
    END IF;

    IF NEW.communication_type = 'LinkedIn'
       AND lower(COALESCE(NEW.linkedin_status, '')) IN ('accepted', 'connected', 'replied') THEN
      v_delta := v_delta + 2;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Pending -> sent transition counts as the real attempt (was missed before).
    IF COALESCE(OLD.delivery_status, '') NOT IN ('sent', 'manual')
       AND COALESCE(NEW.delivery_status, '') IN ('sent', 'manual')
       AND COALESCE(NEW.sent_via, 'manual') <> 'graph-sync' THEN
      UPDATE public.campaign_contacts
      SET attempt_count     = attempt_count + 1,
          last_contacted_at = COALESCE(NEW.communication_date, now()),
          last_activity_at  = COALESCE(NEW.communication_date, now())
      WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
    END IF;

    IF (OLD.opened_at IS NULL AND NEW.opened_at IS NOT NULL)
       AND COALESCE(NEW.is_bot_open, false) = false THEN
      v_delta := v_delta + 1;
    END IF;

    IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status
       AND NEW.delivery_status = 'received' THEN
      v_delta := v_delta + 5;
    END IF;

    IF OLD.bounced_at IS NULL AND NEW.bounced_at IS NOT NULL THEN
      v_delta := v_delta - 3;
    END IF;

    IF OLD.call_outcome IS DISTINCT FROM NEW.call_outcome
       AND NEW.communication_type IN ('Call', 'Phone')
       AND lower(COALESCE(NEW.call_outcome, '')) IN ('connected', 'answered', 'completed') THEN
      v_delta := v_delta + 3;
    END IF;

    IF OLD.linkedin_status IS DISTINCT FROM NEW.linkedin_status
       AND NEW.communication_type = 'LinkedIn'
       AND lower(COALESCE(NEW.linkedin_status, '')) IN ('accepted', 'connected', 'replied') THEN
      v_delta := v_delta + 2;
    END IF;

    IF OLD.unsubscribed_at IS NULL AND NEW.unsubscribed_at IS NOT NULL THEN
      v_reset_to_zero     := true;
      v_set_stop_sequence := true;
    END IF;
  END IF;

  IF v_reset_to_zero THEN
    UPDATE public.campaign_contacts
    SET engagement_score = 0,
        stop_sequence    = true,
        last_activity_at = COALESCE(NEW.communication_date, now())
    WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
    RETURN NEW;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE public.campaign_contacts
    SET engagement_score = GREATEST(0, engagement_score + v_delta),
        last_activity_at = COALESCE(NEW.communication_date, now())
    WHERE campaign_id = NEW.campaign_id AND contact_id = NEW.contact_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Suppression: drop the 'manual' bypass — manual logs must respect opt-out.
CREATE OR REPLACE FUNCTION public.enforce_suppression_on_communication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.communication_type IS DISTINCT FROM 'Email' THEN RETURN NEW; END IF;
  -- Inbound rows are always allowed.
  IF NEW.delivery_status IN ('failed','received') THEN RETURN NEW; END IF;
  IF NEW.sent_via = 'graph-sync' THEN RETURN NEW; END IF;
  IF NEW.contact_id IS NULL THEN RETURN NEW; END IF;

  SELECT lower(email) INTO v_email FROM public.contacts WHERE id = NEW.contact_id;
  IF v_email IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.campaign_suppression_list
    WHERE lower(email) = v_email
      AND (campaign_id IS NULL OR campaign_id = NEW.campaign_id)
  ) THEN
    RAISE EXCEPTION 'Recipient % is on the suppression list (campaign %).', v_email, NEW.campaign_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Batched channel-touch check (one round-trip vs N).
CREATE OR REPLACE FUNCTION public.has_channel_touch_today_batch(
  _campaign_id uuid,
  _contact_ids uuid[],
  _exclude_type text DEFAULT NULL
)
RETURNS TABLE(contact_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT cc.contact_id
  FROM public.campaign_communications cc
  WHERE cc.campaign_id = _campaign_id
    AND cc.contact_id = ANY(_contact_ids)
    AND cc.communication_date::date = CURRENT_DATE
    AND COALESCE(cc.delivery_status, 'pending') NOT IN ('failed', 'bounced')
    AND (_exclude_type IS NULL OR cc.communication_type <> _exclude_type);
$$;

-- 5) Send-job retry semantics: allow a 'retrying' status so finalize_send_job
--    no longer prematurely marks parent jobs as failed.
CREATE OR REPLACE FUNCTION public.claim_send_job_items(_limit integer DEFAULT 25)
RETURNS SETOF public.campaign_send_job_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ids uuid[];
BEGIN
  SELECT array_agg(i.id) INTO _ids
  FROM (
    SELECT it.id
    FROM public.campaign_send_job_items it
    JOIN public.campaign_send_jobs j ON j.id = it.job_id
    WHERE it.status IN ('queued','retrying')
      AND it.next_attempt_at <= now()
      AND j.status IN ('queued','running')
      AND (j.scheduled_at IS NULL OR j.scheduled_at <= now())
    ORDER BY it.next_attempt_at ASC
    LIMIT _limit
    FOR UPDATE OF it SKIP LOCKED
  ) i;

  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.campaign_send_jobs j
  SET status = 'running',
      started_at = COALESCE(j.started_at, now())
  WHERE j.status = 'queued'
    AND j.id IN (
      SELECT job_id FROM public.campaign_send_job_items WHERE id = ANY(_ids)
    );

  RETURN QUERY
  UPDATE public.campaign_send_job_items it
  SET status = 'sending',
      attempt_count = it.attempt_count + 1,
      updated_at = now()
  WHERE it.id = ANY(_ids)
  RETURNING it.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_send_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _sent int; _failed int; _skipped int; _cancelled int; _pending int; _total int;
  _job_status text;
BEGIN
  SELECT
    count(*) FILTER (WHERE status = 'sent'),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (WHERE status = 'skipped'),
    count(*) FILTER (WHERE status = 'cancelled'),
    count(*) FILTER (WHERE status IN ('queued','sending','retrying')),
    count(*)
  INTO _sent, _failed, _skipped, _cancelled, _pending, _total
  FROM public.campaign_send_job_items
  WHERE job_id = _job_id;

  SELECT status INTO _job_status FROM public.campaign_send_jobs WHERE id = _job_id;

  UPDATE public.campaign_send_jobs
  SET sent_items     = _sent,
      failed_items   = _failed,
      skipped_items  = _skipped,
      cancelled_items = _cancelled,
      total_items    = _total,
      status = CASE
        WHEN _job_status IN ('paused','cancelled') THEN _job_status
        WHEN _pending = 0 AND _failed = 0 AND _sent > 0 THEN 'completed'
        WHEN _pending = 0 AND _sent = 0 AND _failed > 0 THEN 'failed'
        WHEN _pending = 0 THEN 'completed'
        ELSE 'running'
      END,
      finished_at = CASE WHEN _pending = 0 AND _job_status NOT IN ('paused','cancelled')
                         THEN COALESCE(finished_at, now())
                         ELSE finished_at END
  WHERE id = _job_id;
END;
$$;

-- 6) Backfill engagement / attempt metrics from historical communications.
--    Idempotent: replays from scratch each run.
WITH agg AS (
  SELECT
    cc.id AS campaign_contact_id,
    cc.campaign_id,
    cc.contact_id,
    -- Outbound resolved attempts
    count(*) FILTER (
      WHERE x.communication_type IN ('Email','Call','Phone','LinkedIn')
        AND COALESCE(x.delivery_status,'') IN ('sent','manual')
        AND COALESCE(x.sent_via,'manual') <> 'graph-sync'
    )::int AS attempts,
    max(x.communication_date) FILTER (
      WHERE COALESCE(x.delivery_status,'') IN ('sent','manual')
        AND COALESCE(x.sent_via,'manual') <> 'graph-sync'
    ) AS last_contact,
    max(x.communication_date) AS last_activity,
    -- Score replay
    (
      count(*) FILTER (WHERE x.delivery_status = 'received' OR x.sent_via = 'graph-sync') * 5
      + count(*) FILTER (
          WHERE x.opened_at IS NOT NULL AND COALESCE(x.is_bot_open,false) = false
        ) * 1
      + count(*) FILTER (
          WHERE x.communication_type IN ('Call','Phone')
            AND lower(COALESCE(x.call_outcome,'')) IN ('connected','answered','completed')
        ) * 3
      + count(*) FILTER (
          WHERE x.communication_type = 'LinkedIn'
            AND lower(COALESCE(x.linkedin_status,'')) IN ('accepted','connected','replied')
        ) * 2
      - count(*) FILTER (
          WHERE x.bounced_at IS NOT NULL OR x.delivery_status IN ('failed','bounced')
        ) * 3
    )::int AS replayed_score,
    bool_or(x.unsubscribed_at IS NOT NULL) AS has_unsub
  FROM public.campaign_contacts cc
  LEFT JOIN public.campaign_communications x
    ON x.campaign_id = cc.campaign_id AND x.contact_id = cc.contact_id
  GROUP BY cc.id, cc.campaign_id, cc.contact_id
)
UPDATE public.campaign_contacts cc
SET attempt_count     = COALESCE(agg.attempts, 0),
    last_contacted_at = agg.last_contact,
    last_activity_at  = agg.last_activity,
    engagement_score  = CASE WHEN agg.has_unsub THEN 0
                             ELSE GREATEST(0, COALESCE(agg.replayed_score, 0)) END,
    stop_sequence     = CASE WHEN agg.has_unsub THEN true ELSE cc.stop_sequence END
FROM agg
WHERE agg.campaign_contact_id = cc.id;
