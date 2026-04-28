-- 1. Remove duplicate cron jobs
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-email-replies-15min') THEN
    PERFORM cron.unschedule('check-email-replies-15min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-campaign-send-log-daily') THEN
    PERFORM cron.unschedule('prune-campaign-send-log-daily');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'campaign-follow-up-runner-weekday-9am') THEN
    PERFORM cron.unschedule('campaign-follow-up-runner-weekday-9am');
  END IF;
END $$;

-- 2. Drop legacy 1-arg is_email_suppressed (keep the campaign-aware 2-arg version)
DROP FUNCTION IF EXISTS public.is_email_suppressed(text);

-- 3. Drop legacy 0-arg prune_campaign_send_log (keep the parameterised version)
DROP FUNCTION IF EXISTS public.prune_campaign_send_log();

-- 4. Recreate parameterised pruner with default 90 days so existing cron call works
CREATE OR REPLACE FUNCTION public.prune_campaign_send_log(_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.campaign_send_log
  WHERE sent_at < now() - make_interval(days => _days);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prune_campaign_send_log(integer) TO authenticated, service_role;