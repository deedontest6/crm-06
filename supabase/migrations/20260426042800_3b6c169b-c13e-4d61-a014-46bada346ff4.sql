DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'activate-scheduled-campaigns-15min') THEN
    PERFORM cron.schedule(
      'activate-scheduled-campaigns-15min',
      '*/15 * * * *',
      $cron$ SELECT public.activate_scheduled_campaigns(); $cron$
    );
  END IF;
END $$;