ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS tracking_id UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ;

UPDATE public.campaign_communications
SET tracking_id = gen_random_uuid()
WHERE tracking_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_communications_tracking_id
  ON public.campaign_communications(tracking_id);