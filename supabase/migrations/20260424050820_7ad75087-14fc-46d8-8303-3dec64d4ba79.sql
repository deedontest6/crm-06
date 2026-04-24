-- Second-pass cleanup: stricter detection of historically misattributed
-- inbound (graph-sync) replies in campaign_communications.
--
-- Rule: an inbound graph-sync row must be linked to a contact whose email
-- matches the reply sender's email recorded in `notes`
-- ("Reply from <Name> (<email>)"). Any row where the linked contact's
-- email differs from the sender email is misattributed and must be removed.
DELETE FROM public.campaign_communications cc
USING public.contacts ct
WHERE cc.sent_via = 'graph-sync'
  AND cc.contact_id = ct.id
  AND ct.email IS NOT NULL
  AND cc.notes IS NOT NULL
  AND lower(trim(both ' ' from ct.email)) <> ALL (
    SELECT lower(trim(both ' ' from m[1]))
    FROM regexp_matches(cc.notes, '\(([^)]+@[^)]+)\)', 'g') AS m
  );

-- Also drop inbound rows whose parent_id points to an outbound message
-- linked to a different contact (cross-thread parent leak).
DELETE FROM public.campaign_communications cc
USING public.campaign_communications p
WHERE cc.sent_via = 'graph-sync'
  AND cc.parent_id = p.id
  AND cc.contact_id IS NOT NULL
  AND p.contact_id IS NOT NULL
  AND cc.contact_id <> p.contact_id;

-- Recompute outbound email_status: revert to 'Sent' if no surviving
-- graph-sync reply remains in the same conversation+contact bucket.
UPDATE public.campaign_communications outbound
SET email_status = 'Sent'
WHERE outbound.sent_via IN ('azure', 'manual')
  AND outbound.communication_type = 'Email'
  AND outbound.email_status = 'Replied'
  AND NOT EXISTS (
    SELECT 1 FROM public.campaign_communications r
    WHERE r.sent_via = 'graph-sync'
      AND r.conversation_id IS NOT DISTINCT FROM outbound.conversation_id
      AND r.contact_id IS NOT DISTINCT FROM outbound.contact_id
  );

-- Recompute campaign_contacts.stage: if a contact's stage is 'Responded'
-- but no graph-sync reply remains for them in that campaign, revert to
-- 'Email Sent' when an outbound exists, otherwise 'Not Contacted'.
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