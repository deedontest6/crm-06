
-- Add Graph message metadata columns to campaign_communications
ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS graph_message_id TEXT,
  ADD COLUMN IF NOT EXISTS internet_message_id TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id TEXT;

-- Add internet_message_id to email_history for cross-referencing
ALTER TABLE public.email_history
  ADD COLUMN IF NOT EXISTS internet_message_id TEXT;

-- Index for efficient conversation lookups during reply polling
CREATE INDEX IF NOT EXISTS idx_campaign_comms_conversation_id 
  ON public.campaign_communications (conversation_id) 
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_comms_internet_message_id 
  ON public.campaign_communications (internet_message_id) 
  WHERE internet_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_history_internet_message_id 
  ON public.email_history (internet_message_id) 
  WHERE internet_message_id IS NOT NULL;
