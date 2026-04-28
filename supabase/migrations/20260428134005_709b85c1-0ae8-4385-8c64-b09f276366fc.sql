ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS "references" text;