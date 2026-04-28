
ALTER TABLE public.email_unsubscribe_tokens
  ADD COLUMN IF NOT EXISTS token_id uuid,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '6 months');

-- Token column was NOT NULL UNIQUE in the prior migration; relax to allow
-- token_id-only rows from the existing send pipeline.
ALTER TABLE public.email_unsubscribe_tokens
  ALTER COLUMN token DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_eut_token_id
  ON public.email_unsubscribe_tokens (token_id) WHERE token_id IS NOT NULL;
