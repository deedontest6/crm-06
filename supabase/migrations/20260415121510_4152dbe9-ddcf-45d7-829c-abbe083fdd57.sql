
SELECT cron.schedule(
  'check-email-replies-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='https://nreslricievaamrwfrlx.supabase.co/functions/v1/check-email-replies',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZXNscmljaWV2YWFtcndmcmx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0Mjc3NTUsImV4cCI6MjA3MTAwMzc1NX0.xHf2lE2OGZ5jNGOBWGAsOdoyHqdwi_TxWkbKiAr1RJY"}'::jsonb,
    body:=concat('{"time": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);
