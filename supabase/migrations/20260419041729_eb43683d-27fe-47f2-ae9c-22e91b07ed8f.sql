ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'Medium',
  ADD COLUMN IF NOT EXISTS primary_channel text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_campaigns_priority ON public.campaigns(priority);
CREATE INDEX IF NOT EXISTS idx_campaigns_primary_channel ON public.campaigns(primary_channel);
CREATE INDEX IF NOT EXISTS idx_campaigns_tags ON public.campaigns USING GIN(tags);