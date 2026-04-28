-- ============================================================
-- Campaign Module — Phase A security & deliverability
--
-- Apply this via Lovable's "Run SQL" / migration tool — Lovable's
-- guard rails block the agent from writing directly into
-- supabase/migrations/. After running it once, the platform will
-- copy this file into supabase/migrations/ automatically.
--
-- Goals:
--   1. Move cron auth into Vault (no more hard-coded JWT in SQL).
--   2. Sign unsubscribe links with HMAC + dedicated tokens table.
--   3. Auto-suppress bounced recipients (bounce_type column).
--   4. Re-schedule cron jobs to use the vault-stored shared secret.
-- ============================================================

-- ── 1) Vault secrets ────────────────────────────────────────
DO $$
DECLARE
  v_cron_secret  text;
  v_unsub_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'campaign_cron_secret') THEN
    v_cron_secret := encode(extensions.gen_random_bytes(32), 'base64');
    PERFORM vault.create_secret(
      v_cron_secret,
      'campaign_cron_secret',
      'Shared secret used by pg_cron jobs to authenticate to campaign Edge Functions'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'unsubscribe_signing_key') THEN
    v_unsub_secret := encode(extensions.gen_random_bytes(32), 'base64');
    PERFORM vault.create_secret(
      v_unsub_secret,
      'unsubscribe_signing_key',
      'HMAC key used to sign one-click unsubscribe tokens in marketing emails'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url') THEN
    PERFORM vault.create_secret(
      'https://nreslricievaamrwfrlx.supabase.co',
      'project_url',
      'Base URL of this Supabase project, used by pg_cron to call Edge Functions'
    );
  END IF;
END $$;

-- ── 2) Unsubscribe tokens table ────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id     uuid NOT NULL UNIQUE,
  email        text NOT NULL,
  campaign_id  uuid REFERENCES public.campaigns(id)  ON DELETE SET NULL,
  contact_id   uuid REFERENCES public.contacts(id)   ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  consumed_at  timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  CONSTRAINT email_unsubscribe_email_lower CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS idx_email_unsub_tokens_email    ON public.email_unsubscribe_tokens (email);
CREATE INDEX IF NOT EXISTS idx_email_unsub_tokens_campaign ON public.email_unsubscribe_tokens (campaign_id);

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- Block all direct client access — only the service-role Edge Function
-- reads/writes this table.
DROP POLICY IF EXISTS "no public access to unsubscribe tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "no public access to unsubscribe tokens"
  ON public.email_unsubscribe_tokens FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- ── 3) Bounce reason on suppression list ───────────────────
ALTER TABLE public.campaign_suppression_list
  ADD COLUMN IF NOT EXISTS bounce_type text;

COMMENT ON COLUMN public.campaign_suppression_list.bounce_type IS
  'When `reason` = ''bounced'', stores the bounce classification (hard/soft/unknown).';

-- Allow the bounce-detection Edge Function (service role) to insert
-- suppression rows even when there is no authenticated user.
DROP POLICY IF EXISTS "service can suppress bounced addresses" ON public.campaign_suppression_list;
CREATE POLICY "service can suppress bounced addresses"
  ON public.campaign_suppression_list FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── 4) Cron helpers ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._campaign_cron_headers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'campaign_cron_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'campaign_cron_secret missing from vault';
  END IF;

  RETURN jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', v_secret
  );
END;
$$;
REVOKE ALL ON FUNCTION public._campaign_cron_headers() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._campaign_cron_headers() TO postgres;

CREATE OR REPLACE FUNCTION public._campaign_project_url()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url';
$$;
REVOKE ALL ON FUNCTION public._campaign_project_url() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._campaign_project_url() TO postgres;

-- ── 5) Re-schedule cron jobs (drop the JWT-laden ones first) ──
DO $$
DECLARE j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'check-email-replies-15min',
      'campaign-follow-up-runner-weekday-9am',
      'campaign-follow-up-hourly',
      'ab-winner-daily',
      'auto-complete-campaigns-daily'
    )
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'check-email-replies-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url     := public._campaign_project_url() || '/functions/v1/check-email-replies',
    headers := public._campaign_cron_headers(),
    body    := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'campaign-follow-up-runner-weekday-9am',
  '0 9 * * 1-5',
  $cron$
  SELECT net.http_post(
    url     := public._campaign_project_url() || '/functions/v1/campaign-follow-up-runner',
    headers := public._campaign_cron_headers(),
    body    := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'ab-winner-daily',
  '0 2 * * *',
  $cron$
  SELECT net.http_post(
    url     := public._campaign_project_url() || '/functions/v1/ab-winner-evaluator',
    headers := public._campaign_cron_headers(),
    body    := '{}'::jsonb
  );
  $cron$
);

-- Run every 30 min so end_date Active→Completed flips don't lag a full day
SELECT cron.schedule(
  'auto-complete-campaigns-30min',
  '*/30 * * * *',
  $cron$SELECT public.auto_complete_campaigns();$cron$
);
