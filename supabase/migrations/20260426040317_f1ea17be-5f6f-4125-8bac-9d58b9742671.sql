-- Campaign Module safety fixes: idempotency, retry metadata, and reply-sync uniqueness

ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS send_request_id text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

ALTER TABLE public.campaign_send_log
  ADD COLUMN IF NOT EXISTS send_request_id text;

CREATE INDEX IF NOT EXISTS idx_campaign_communications_campaign_contact_date
  ON public.campaign_communications (campaign_id, contact_id, communication_date DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_communications_send_request_id
  ON public.campaign_communications (send_request_id)
  WHERE send_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_send_log_send_request_id
  ON public.campaign_send_log (send_request_id)
  WHERE send_request_id IS NOT NULL;

-- Prevent duplicate successful manual/reply sends for the same idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_outbound_send_request
  ON public.campaign_communications (campaign_id, send_request_id)
  WHERE send_request_id IS NOT NULL
    AND communication_type = 'Email'
    AND COALESCE(sent_via, '') IN ('azure', 'sequence_runner', 'sequence-runner', 'follow-up-runner')
    AND COALESCE(delivery_status, '') <> 'failed';

-- Prevent duplicate automated follow-up step sends, including the currently-used underscore value.
DROP INDEX IF EXISTS public.uniq_campaign_followup_step;
CREATE UNIQUE INDEX uniq_campaign_followup_step
  ON public.campaign_communications (campaign_id, contact_id, sequence_step, follow_up_attempt)
  WHERE communication_type = 'Email'
    AND sequence_step IS NOT NULL
    AND contact_id IS NOT NULL
    AND follow_up_attempt > 0
    AND COALESCE(sent_via, '') IN ('azure', 'sequence_runner', 'sequence-runner', 'follow-up-runner')
    AND COALESCE(delivery_status, '') <> 'failed';

-- Prevent duplicate inbound reply rows when Graph sync replays the same message.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_graph_sync_internet_message
  ON public.campaign_communications (internet_message_id)
  WHERE sent_via = 'graph-sync'
    AND internet_message_id IS NOT NULL;

-- Remove obsolete single-argument send-cap overload if it exists to avoid RPC ambiguity.
DROP FUNCTION IF EXISTS public.check_send_cap(uuid);

CREATE OR REPLACE FUNCTION public.check_send_cap(
  _campaign_id uuid,
  _sender_user_id uuid DEFAULT NULL,
  _mailbox_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour_ago timestamptz := now() - interval '1 hour';
  v_day_ago timestamptz := now() - interval '24 hours';
  v_cap record;
  v_h int := 0;
  v_d int := 0;
BEGIN
  FOR v_cap IN
    SELECT *
    FROM public.campaign_send_caps
    WHERE is_enabled = true
      AND (
        (scope = 'campaign' AND campaign_id = _campaign_id)
        OR (scope IN ('global', 'per_user', 'per_mailbox') AND campaign_id IS NULL)
      )
    ORDER BY
      CASE scope
        WHEN 'campaign' THEN 1
        WHEN 'per_user' THEN 2
        WHEN 'per_mailbox' THEN 3
        ELSE 4
      END
  LOOP
    IF v_cap.scope = 'per_user' AND _sender_user_id IS NULL THEN
      CONTINUE;
    END IF;
    IF v_cap.scope = 'per_mailbox' AND _mailbox_email IS NULL THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_h
    FROM public.campaign_send_log
    WHERE sent_at >= v_hour_ago
      AND (v_cap.scope <> 'campaign' OR campaign_id = _campaign_id)
      AND (v_cap.scope <> 'per_user' OR sender_user_id = _sender_user_id)
      AND (v_cap.scope <> 'per_mailbox' OR lower(mailbox_email) = lower(_mailbox_email));

    SELECT count(*) INTO v_d
    FROM public.campaign_send_log
    WHERE sent_at >= v_day_ago
      AND (v_cap.scope <> 'campaign' OR campaign_id = _campaign_id)
      AND (v_cap.scope <> 'per_user' OR sender_user_id = _sender_user_id)
      AND (v_cap.scope <> 'per_mailbox' OR lower(mailbox_email) = lower(_mailbox_email));

    IF v_h >= v_cap.hourly_limit OR v_d >= v_cap.daily_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'scope', v_cap.scope,
        'hourly_used', v_h,
        'hourly_limit', v_cap.hourly_limit,
        'daily_used', v_d,
        'daily_limit', v_cap.daily_limit
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_send_cap(uuid, uuid, text) TO authenticated, service_role;