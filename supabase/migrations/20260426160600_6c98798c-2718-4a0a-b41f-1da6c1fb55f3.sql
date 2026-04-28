-- Drain queued/failed bulk-send items whenever a campaign leaves an
-- "active" state (Pause / Complete / Fail / Archive). Without this the
-- cron runner keeps draining the queue for ~minutes after the user clicked
-- Pause, sending emails the user thought were stopped.

CREATE OR REPLACE FUNCTION public._campaigns_drain_queue_on_stop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_should_drain boolean := false;
BEGIN
  -- Status transition into a non-running state
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('Paused','Completed','Failed') THEN
    v_should_drain := true;
  END IF;

  -- Newly archived
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    v_should_drain := true;
  END IF;

  IF v_should_drain THEN
    UPDATE public.campaign_send_job_items
    SET status = 'cancelled',
        last_error_code = 'CAMPAIGN_STOPPED',
        last_error_message = 'Campaign was paused, completed, failed or archived'
    WHERE campaign_id = NEW.id
      AND status IN ('queued','failed');

    UPDATE public.campaign_send_jobs
    SET status = 'cancelled',
        finished_at = COALESCE(finished_at, now())
    WHERE campaign_id = NEW.id
      AND status NOT IN ('completed','failed','cancelled');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaigns_drain_queue_on_stop ON public.campaigns;
CREATE TRIGGER trg_campaigns_drain_queue_on_stop
AFTER UPDATE ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public._campaigns_drain_queue_on_stop();