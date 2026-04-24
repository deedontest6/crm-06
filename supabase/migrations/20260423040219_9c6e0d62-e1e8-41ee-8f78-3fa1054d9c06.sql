-- Unschedule if previously created (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('campaign-follow-up-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('ab-winner-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'campaign-follow-up-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url:='https://nreslricievaamrwfrlx.supabase.co/functions/v1/campaign-follow-up-runner',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZXNscmljaWV2YWFtcndmcmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0Mjc3NTUsImV4cCI6MjA3MTAwMzc1NX0.xHf2lE2OGZ5jNGOBWGAsOdoyHqdwi_TxWkbKiAr1RJY"}'::jsonb,
    body:=concat('{"time":"', now(), '"}')::jsonb
  );
  $$
);

SELECT cron.schedule(
  'ab-winner-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url:='https://nreslricievaamrwfrlx.supabase.co/functions/v1/ab-winner-evaluator',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZXNscmljaWV2YWFtcndmcmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0Mjc3NTUsImV4cCI6MjA3MTAwMzc1NX0.xHf2lE2OGZ5jNGOBWGAsOdoyHqdwi_TxWkbKiAr1RJY"}'::jsonb,
    body:=concat('{"time":"', now(), '"}')::jsonb
  );
  $$
);