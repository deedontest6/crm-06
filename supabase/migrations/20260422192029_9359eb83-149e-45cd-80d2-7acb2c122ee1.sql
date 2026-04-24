-- ============================================================
-- 1. Tighten accounts RLS: UPDATE/DELETE limited to owner+admin
-- ============================================================
DROP POLICY IF EXISTS "Users can update accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can delete accounts" ON public.accounts;

CREATE POLICY "Owner or admin can update accounts"
ON public.accounts FOR UPDATE TO authenticated
USING (public.is_user_admin() OR created_by = auth.uid() OR account_owner = auth.uid())
WITH CHECK (public.is_user_admin() OR created_by = auth.uid() OR account_owner = auth.uid());

CREATE POLICY "Owner or admin can delete accounts"
ON public.accounts FOR DELETE TO authenticated
USING (public.is_user_admin() OR created_by = auth.uid() OR account_owner = auth.uid());

-- ============================================================
-- 2. Fix mutable search_path on legacy SECURITY DEFINER / trigger functions
-- ============================================================
ALTER FUNCTION public.update_saved_filters_updated_at()         SET search_path = public;
ALTER FUNCTION public.update_lead_action_items_updated_at()     SET search_path = public;
ALTER FUNCTION public.update_notifications_updated_at()         SET search_path = public;
ALTER FUNCTION public.update_user_preferences_updated_at()      SET search_path = public;
ALTER FUNCTION public.create_action_item_notification()         SET search_path = public;
ALTER FUNCTION public.create_deal_action_item_notification()    SET search_path = public;

-- ============================================================
-- 3. Bulk cascade delete RPC for many campaigns in one transaction
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_campaigns_cascade(_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_ids uuid[] := ARRAY[]::uuid[];
  cid uuid;
BEGIN
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN deleted_ids;
  END IF;

  FOREACH cid IN ARRAY _ids LOOP
    IF public.can_manage_campaign(cid) THEN
      DELETE FROM public.action_items
        WHERE module_type = 'campaigns' AND module_id = cid;

      DELETE FROM public.campaigns WHERE id = cid;

      IF FOUND THEN
        deleted_ids := array_append(deleted_ids, cid);
      END IF;
    END IF;
  END LOOP;

  RETURN deleted_ids;
END $$;

REVOKE ALL ON FUNCTION public.delete_campaigns_cascade(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_campaigns_cascade(uuid[]) TO authenticated;