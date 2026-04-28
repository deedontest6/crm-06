
-- Refine claim_send_job_items: respect parent job's scheduled_at when present.
CREATE OR REPLACE FUNCTION public.claim_send_job_items(_limit integer DEFAULT 25)
RETURNS SETOF campaign_send_job_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
BEGIN
  SELECT array_agg(i.id) INTO _ids
  FROM (
    SELECT it.id
    FROM public.campaign_send_job_items it
    JOIN public.campaign_send_jobs j ON j.id = it.job_id
    WHERE it.status IN ('queued','failed')
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

-- Helper: defer an item without consuming a retry attempt. Used when the
-- recipient is currently outside their business-hour window. The runner
-- decrements attempt_count to keep the failure budget intact.
CREATE OR REPLACE FUNCTION public.release_send_job_item_for_later(
  _item_id uuid,
  _next_at timestamptz,
  _reason text DEFAULT 'OUTSIDE_BUSINESS_HOURS'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.campaign_send_job_items
  SET status = 'queued',
      attempt_count = GREATEST(0, attempt_count - 1),
      next_attempt_at = _next_at,
      last_error_code = _reason,
      last_error_message = 'Deferred until recipient business hours.',
      updated_at = now()
  WHERE id = _item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_send_job_item_for_later(uuid, timestamptz, text) TO service_role;
