-- One-time cleanup: delete graph-sync (auto-imported) reply rows that were
-- attached to the wrong contact thread because Outlook reused conversationId
-- across multiple recipients with the same subject.
--
-- A graph-sync row is misattributed when its `notes` column (set as
-- "Reply from <Name> (<email>)" by check-email-replies) references a sender
-- email that does NOT match the linked contact's email.
DELETE FROM public.campaign_communications cc
WHERE cc.sent_via = 'graph-sync'
  AND cc.contact_id IS NOT NULL
  AND cc.notes IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.contacts ct
    WHERE ct.id = cc.contact_id
      AND ct.email IS NOT NULL
      AND lower(ct.email) NOT IN (
        SELECT lower(trim(both ' ' from m[1]))
        FROM regexp_matches(cc.notes, '\(([^)]+@[^)]+)\)', 'g') AS m
      )
  );

-- After deleting orphan inbound rows, recompute email_status on outbound
-- rows that no longer have any sibling graph-sync reply in their conversation.
UPDATE public.campaign_communications outbound
SET email_status = CASE
  WHEN outbound.email_status = 'Replied' AND NOT EXISTS (
    SELECT 1 FROM public.campaign_communications r
    WHERE r.sent_via = 'graph-sync'
      AND r.conversation_id = outbound.conversation_id
      AND r.contact_id = outbound.contact_id
  ) THEN 'Sent'
  ELSE outbound.email_status
END
WHERE outbound.sent_via IN ('azure', 'manual')
  AND outbound.communication_type = 'Email'
  AND outbound.email_status = 'Replied';