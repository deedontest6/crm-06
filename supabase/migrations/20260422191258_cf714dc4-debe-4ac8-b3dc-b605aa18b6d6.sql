CREATE OR REPLACE FUNCTION public.delete_campaign_cascade(_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted uuid;
BEGIN
  IF NOT public.can_manage_campaign(_id) THEN
    RAISE EXCEPTION 'Not authorized to delete this campaign' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.campaign_communications     WHERE campaign_id = _id;
  DELETE FROM public.campaign_email_templates    WHERE campaign_id = _id;
  DELETE FROM public.campaign_phone_scripts      WHERE campaign_id = _id;
  DELETE FROM public.campaign_accounts           WHERE campaign_id = _id;
  DELETE FROM public.campaign_contacts           WHERE campaign_id = _id;
  DELETE FROM public.campaign_materials          WHERE campaign_id = _id;
  DELETE FROM public.campaign_timing_windows     WHERE campaign_id = _id;
  DELETE FROM public.campaign_mart               WHERE campaign_id = _id;

  UPDATE public.deals          SET campaign_id = NULL WHERE campaign_id = _id;

  DELETE FROM public.action_items WHERE module_type = 'campaigns' AND module_id = _id;

  DELETE FROM public.campaigns WHERE id = _id RETURNING id INTO deleted;

  IF deleted IS NULL THEN
    RAISE EXCEPTION 'Campaign not found or already deleted';
  END IF;

  RETURN deleted;
END $$;

REVOKE ALL ON FUNCTION public.delete_campaign_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_campaign_cascade(uuid) TO authenticated;