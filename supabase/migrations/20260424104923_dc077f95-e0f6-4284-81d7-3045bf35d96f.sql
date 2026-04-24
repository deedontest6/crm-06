DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('check-email-replies-15min', 'campaign-follow-up-runner-weekday-9am')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'check-email-replies-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://nreslricievaamrwfrlx.supabase.co/functions/v1/check-email-replies',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZXNscmljaWV2YWFtcndmcmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0Mjc3NTUsImV4cCI6MjA3MTAwMzc1NX0.xHf2lE2OGZ5jNGOBWGAsOdoyHqdwi_TxWkbKiAr1RJY"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'campaign-follow-up-runner-weekday-9am',
  '0 9 * * 1-5',
  $cron$
  SELECT net.http_post(
    url := 'https://nreslricievaamrwfrlx.supabase.co/functions/v1/campaign-follow-up-runner',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZXNscmljaWV2YWFtcndmcmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0Mjc3NTUsImV4cCI6MjA3MTAwMzc1NX0.xHf2lE2OGZ5jNGOBWGAsOdoyHqdwi_TxWkbKiAr1RJY"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);