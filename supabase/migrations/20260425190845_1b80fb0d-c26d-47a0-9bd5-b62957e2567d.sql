-- Per-campaign aware suppression check.
-- Global rows (campaign_id IS NULL) suppress for all campaigns.
-- Campaign-scoped rows only suppress for that campaign.
CREATE OR REPLACE FUNCTION public.is_email_suppressed(_email text, _campaign_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_suppression_list
    WHERE lower(email) = lower(_email)
      AND (campaign_id IS NULL OR campaign_id = _campaign_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_email_suppressed(text, uuid) TO authenticated, service_role;