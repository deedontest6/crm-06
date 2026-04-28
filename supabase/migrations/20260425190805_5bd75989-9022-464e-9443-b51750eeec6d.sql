-- 1. target_segment_id on sequences
ALTER TABLE public.campaign_sequences
  ADD COLUMN IF NOT EXISTS target_segment_id uuid REFERENCES public.campaign_audience_segments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_sequences_target_segment
  ON public.campaign_sequences(target_segment_id) WHERE target_segment_id IS NOT NULL;

-- 2. Segment resolver RPC
CREATE OR REPLACE FUNCTION public.resolve_campaign_segment_contacts(_segment_id uuid)
RETURNS TABLE(contact_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _campaign_id uuid;
BEGIN
  SELECT campaign_id INTO _campaign_id
  FROM public.campaign_audience_segments
  WHERE id = _segment_id;

  IF _campaign_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT cc.contact_id
  FROM public.campaign_contacts cc
  WHERE cc.campaign_id = _campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_campaign_segment_contacts(uuid) TO authenticated, service_role;

-- 3. Drop the global email unique CONSTRAINT (it owns the index)
ALTER TABLE public.campaign_suppression_list
  DROP CONSTRAINT IF EXISTS campaign_suppression_email_unique;

-- 4. Idempotency for outbound comms
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outbound_comm_step_attempt
  ON public.campaign_communications (campaign_id, contact_id, sequence_step, follow_up_attempt)
  WHERE communication_type = 'Email'
    AND email_type IN ('outbound', 'follow_up')
    AND contact_id IS NOT NULL;

-- 5. Daily prune of campaign_send_log (older than 90 days)
CREATE OR REPLACE FUNCTION public.prune_campaign_send_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.campaign_send_log
  WHERE sent_at < now() - interval '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-campaign-send-log');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-campaign-send-log',
      '30 3 * * *',
      $cron$ SELECT public.prune_campaign_send_log(); $cron$
    );
  END IF;
END $$;