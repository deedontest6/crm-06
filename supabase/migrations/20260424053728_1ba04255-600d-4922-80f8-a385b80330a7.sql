-- Create email_reply_skip_log table for audit trail of rejected reply sync candidates
CREATE TABLE public.email_reply_skip_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  campaign_id UUID NULL,
  contact_id UUID NULL,
  contact_email TEXT,
  sender_email TEXT,
  subject TEXT,
  conversation_id TEXT,
  received_at TIMESTAMP WITH TIME ZONE,
  parent_communication_id UUID NULL,
  parent_subject TEXT,
  parent_sent_at TIMESTAMP WITH TIME ZONE,
  skip_reason TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id UUID NULL
);

-- Indexes for filtering on audit page and dashboard
CREATE INDEX idx_email_reply_skip_log_campaign_created
  ON public.email_reply_skip_log (campaign_id, created_at DESC);

CREATE INDEX idx_email_reply_skip_log_contact_created
  ON public.email_reply_skip_log (contact_id, created_at DESC);

CREATE INDEX idx_email_reply_skip_log_reason
  ON public.email_reply_skip_log (skip_reason);

CREATE INDEX idx_email_reply_skip_log_correlation
  ON public.email_reply_skip_log (correlation_id);

CREATE INDEX idx_email_reply_skip_log_created_at
  ON public.email_reply_skip_log (created_at DESC);

-- Enable RLS
ALTER TABLE public.email_reply_skip_log ENABLE ROW LEVEL SECURITY;

-- Admins can view all skip entries
CREATE POLICY "Admins can view all skip log entries"
  ON public.email_reply_skip_log
  FOR SELECT
  TO authenticated
  USING (is_user_admin());

-- Campaign owners/managers can view skip entries for their campaigns
CREATE POLICY "Campaign owners can view their skip log entries"
  ON public.email_reply_skip_log
  FOR SELECT
  TO authenticated
  USING (
    campaign_id IS NOT NULL
    AND can_view_campaign(campaign_id)
  );

-- Only service role can insert
CREATE POLICY "Service role can insert skip log entries"
  ON public.email_reply_skip_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- No update or delete policies = nobody can modify or delete (audit integrity)
