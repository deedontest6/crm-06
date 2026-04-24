-- Third-pass cleanup: remove "impossible" historical graph-sync replies.
-- A reply is impossible if either:
--   (a) it is dated BEFORE its parent outbound email (chronology violation), or
--   (b) its normalized subject root does not match the parent's normalized
--       subject root (Outlook conversationId reuse across unrelated topics).
--
-- Normalization strips leading "Re:" / "Fw:" / "Fwd:" prefixes, collapses
-- whitespace, and lowercases the subject for comparison.

CREATE OR REPLACE FUNCTION public._normalize_subject_root(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(regexp_replace(COALESCE(s, ''), '^\s*(re|fw|fwd)\s*:\s*', '', 'gi')));
$$;

-- (a) Chronology violations: inbound reply dated before the outbound parent.
DELETE FROM public.campaign_communications cc
USING public.campaign_communications p
WHERE cc.sent_via = 'graph-sync'
  AND cc.parent_id = p.id
  AND cc.communication_date IS NOT NULL
  AND p.communication_date IS NOT NULL
  AND cc.communication_date < p.communication_date;

-- (b) Subject-root mismatches between inbound reply and its parent.
DELETE FROM public.campaign_communications cc
USING public.campaign_communications p
WHERE cc.sent_via = 'graph-sync'
  AND cc.parent_id = p.id
  AND public._normalize_subject_root(cc.subject) <> ''
  AND public._normalize_subject_root(p.subject) <> ''
  AND public._normalize_subject_root(cc.subject) <> public._normalize_subject_root(p.subject)
  AND position(public._normalize_subject_root(p.subject) in public._normalize_subject_root(cc.subject)) = 0
  AND position(public._normalize_subject_root(cc.subject) in public._normalize_subject_root(p.subject)) = 0;

-- Recompute outbound email_status: revert to 'Sent' when no surviving
-- graph-sync reply remains in the same conversation+contact bucket.
UPDATE public.campaign_communications outbound
SET email_status = 'Sent'
WHERE outbound.communication_type = 'Email'
  AND outbound.email_status = 'Replied'
  AND (outbound.sent_via IS NULL OR outbound.sent_via <> 'graph-sync')
  AND NOT EXISTS (
    SELECT 1 FROM public.campaign_communications r
    WHERE r.sent_via = 'graph-sync'
      AND r.conversation_id IS NOT DISTINCT FROM outbound.conversation_id
      AND r.contact_id IS NOT DISTINCT FROM outbound.contact_id
  );

-- Recompute campaign_contacts.stage: revert 'Responded' when no surviving
-- graph-sync reply remains for that contact in that campaign.
UPDATE public.campaign_contacts cc
SET stage = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.campaign_communications oc
    WHERE oc.campaign_id = cc.campaign_id
      AND oc.contact_id = cc.contact_id
      AND oc.communication_type = 'Email'
      AND (oc.sent_via IS NULL OR oc.sent_via <> 'graph-sync')
  ) THEN 'Email Sent'
  ELSE 'Not Contacted'
END
WHERE cc.stage = 'Responded'
  AND NOT EXISTS (
    SELECT 1 FROM public.campaign_communications r
    WHERE r.campaign_id = cc.campaign_id
      AND r.contact_id = cc.contact_id
      AND r.sent_via = 'graph-sync'
  );

DROP FUNCTION IF EXISTS public._normalize_subject_root(text);