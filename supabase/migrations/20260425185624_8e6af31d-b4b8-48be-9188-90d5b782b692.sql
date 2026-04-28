-- Phase 2: schema hardening — enum CHECKs, unique slug, send-log retention.

-- 1) Campaign status / priority / primary_channel CHECK constraints
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check,
  ADD  CONSTRAINT campaigns_status_check
       CHECK (status IS NULL OR status IN ('Draft','Active','Paused','Completed','Archived'));

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_priority_check,
  ADD  CONSTRAINT campaigns_priority_check
       CHECK (priority IS NULL OR priority IN ('Low','Medium','High','Critical'));

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_primary_channel_check,
  ADD  CONSTRAINT campaigns_primary_channel_check
       CHECK (primary_channel IS NULL OR primary_channel IN ('Email','Phone','LinkedIn','Multi'));

-- 2) Unique slug per campaign (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_slug_unique_idx
  ON public.campaigns (lower(slug))
  WHERE slug IS NOT NULL;

-- 3) Sequence step uniqueness per campaign
CREATE UNIQUE INDEX IF NOT EXISTS campaign_sequences_campaign_step_unique
  ON public.campaign_sequences (campaign_id, step_number);

-- 4) Send-cap scope CHECK
ALTER TABLE public.campaign_send_caps
  DROP CONSTRAINT IF EXISTS campaign_send_caps_scope_check,
  ADD  CONSTRAINT campaign_send_caps_scope_check
       CHECK (scope IN ('global','campaign','per_user','per_mailbox'));

-- 5) Send-log retention: 90-day pruning function + nightly cron
CREATE OR REPLACE FUNCTION public.prune_campaign_send_log(_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.campaign_send_log
  WHERE sent_at < now() - make_interval(days => _days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_campaign_send_log(integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.prune_campaign_send_log(integer) TO postgres, service_role;

-- 6) Schedule nightly prune at 03:15 (idempotent)
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'prune-campaign-send-log-daily' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'prune-campaign-send-log-daily',
  '15 3 * * *',
  $cron$SELECT public.prune_campaign_send_log(90);$cron$
);

-- 7) Helpful index for retention scan
CREATE INDEX IF NOT EXISTS idx_campaign_send_log_sent_at
  ON public.campaign_send_log (sent_at);

-- 8) Suppression list: one row per (email, campaign) — campaign_id NULL = global
CREATE UNIQUE INDEX IF NOT EXISTS campaign_suppression_email_campaign_unique
  ON public.campaign_suppression_list (lower(email), COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 9) Timing window sanity: end_date >= start_date
ALTER TABLE public.campaign_timing_windows
  DROP CONSTRAINT IF EXISTS campaign_timing_windows_dates_check,
  ADD  CONSTRAINT campaign_timing_windows_dates_check
       CHECK (end_date >= start_date);