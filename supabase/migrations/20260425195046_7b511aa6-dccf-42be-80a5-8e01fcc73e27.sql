CREATE OR REPLACE FUNCTION public.check_send_cap(
  _campaign_id uuid,
  _sender_user_id uuid DEFAULT NULL,
  _mailbox_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cap_row record;
  hour_count int;
  day_count int;
BEGIN
  SELECT * INTO cap_row
  FROM public.campaign_send_caps
  WHERE is_enabled = true
    AND ((scope = 'campaign' AND campaign_id = _campaign_id) OR scope = 'global')
  ORDER BY (scope = 'campaign') DESC
  LIMIT 1;

  IF cap_row IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  SELECT count(*) INTO hour_count
  FROM public.campaign_send_log
  WHERE (cap_row.scope = 'global' OR campaign_id = _campaign_id)
    AND (_sender_user_id IS NULL OR sender_user_id = _sender_user_id)
    AND (_mailbox_email IS NULL OR lower(mailbox_email) = lower(_mailbox_email))
    AND sent_at > now() - interval '1 hour';

  SELECT count(*) INTO day_count
  FROM public.campaign_send_log
  WHERE (cap_row.scope = 'global' OR campaign_id = _campaign_id)
    AND (_sender_user_id IS NULL OR sender_user_id = _sender_user_id)
    AND (_mailbox_email IS NULL OR lower(mailbox_email) = lower(_mailbox_email))
    AND sent_at > now() - interval '24 hours';

  RETURN jsonb_build_object(
    'allowed', hour_count < cap_row.hourly_limit AND day_count < cap_row.daily_limit,
    'hourly_used', hour_count,
    'hourly_limit', cap_row.hourly_limit,
    'daily_used', day_count,
    'daily_limit', cap_row.daily_limit,
    'scope', cap_row.scope
  );
END;
$function$;