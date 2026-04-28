
-- Helper: check if a contact has been emailed in this campaign within the last N days.
-- Returns the most recent communication id when present (so the caller can show
-- a "see recent send" link). Used by enqueue-campaign-send to enforce a server-side
-- duplicate-send window across concurrent requests.
CREATE OR REPLACE FUNCTION public.recent_campaign_send_for_contact(
  _campaign_id uuid,
  _contact_id uuid,
  _window_days integer DEFAULT 3
)
RETURNS TABLE(communication_id uuid, communication_date timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, communication_date
  FROM public.campaign_communications
  WHERE campaign_id = _campaign_id
    AND contact_id  = _contact_id
    AND communication_type = 'Email'
    AND COALESCE(delivery_status, 'sent') NOT IN ('failed', 'bounced')
    AND communication_date > now() - (_window_days || ' days')::interval
  ORDER BY communication_date DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.recent_campaign_send_for_contact(uuid, uuid, integer) TO authenticated, service_role;

-- Bulk variant of the above so enqueue-campaign-send can check N contacts in one round-trip.
CREATE OR REPLACE FUNCTION public.recent_campaign_sends_for_contacts(
  _campaign_id uuid,
  _contact_ids uuid[],
  _window_days integer DEFAULT 3
)
RETURNS TABLE(contact_id uuid, communication_id uuid, communication_date timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (cc.contact_id)
    cc.contact_id, cc.id AS communication_id, cc.communication_date
  FROM public.campaign_communications cc
  WHERE cc.campaign_id = _campaign_id
    AND cc.contact_id = ANY(_contact_ids)
    AND cc.communication_type = 'Email'
    AND COALESCE(cc.delivery_status, 'sent') NOT IN ('failed', 'bounced')
    AND cc.communication_date > now() - (_window_days || ' days')::interval
  ORDER BY cc.contact_id, cc.communication_date DESC;
$$;

GRANT EXECUTE ON FUNCTION public.recent_campaign_sends_for_contacts(uuid, uuid[], integer) TO authenticated, service_role;
