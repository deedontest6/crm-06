-- Phase 3: Auto-complete campaigns past their end_date
CREATE OR REPLACE FUNCTION public.auto_complete_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.campaigns
  SET status = 'Completed',
      modified_at = now()
  WHERE status IN ('Active', 'Paused')
    AND end_date IS NOT NULL
    AND end_date < CURRENT_DATE
    AND archived_at IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Schedule daily at 01:00 UTC via pg_cron (assumes extension is already enabled)
DO $$
BEGIN
  PERFORM cron.unschedule('auto-complete-campaigns-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'auto-complete-campaigns-daily',
  '0 1 * * *',
  $$SELECT public.auto_complete_campaigns();$$
);