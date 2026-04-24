-- 1. Remove duplicates, keep the oldest row per (conversation_id, sender_email, skip_reason)
DELETE FROM public.email_reply_skip_log a
USING public.email_reply_skip_log b
WHERE a.conversation_id IS NOT NULL
  AND a.conversation_id = b.conversation_id
  AND a.sender_email IS NOT DISTINCT FROM b.sender_email
  AND a.skip_reason = b.skip_reason
  AND a.created_at > b.created_at;

-- 2. Now we can safely add the unique dedupe index
CREATE UNIQUE INDEX IF NOT EXISTS email_reply_skip_log_dedupe_idx
  ON public.email_reply_skip_log (conversation_id, sender_email, skip_reason)
  WHERE conversation_id IS NOT NULL;

-- 3. Helper indexes for the audit page
CREATE INDEX IF NOT EXISTS email_reply_skip_log_campaign_created_idx
  ON public.email_reply_skip_log (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_reply_skip_log_correlation_idx
  ON public.email_reply_skip_log (correlation_id)
  WHERE correlation_id IS NOT NULL;