
-- 0. Create the missing unsubscribe-tokens table the unsubscribe / send-campaign-email functions reference.
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  email text NOT NULL,
  contact_id uuid,
  campaign_id uuid,
  scope text NOT NULL DEFAULT 'campaign', -- 'campaign' | 'global'
  unsubscribed_at timestamptz,
  tracking_disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eut_email ON public.email_unsubscribe_tokens (lower(email));
CREATE INDEX IF NOT EXISTS idx_eut_campaign ON public.email_unsubscribe_tokens (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view unsubscribe tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Authenticated can view unsubscribe tokens"
  ON public.email_unsubscribe_tokens FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Service role inserts unsubscribe tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role inserts unsubscribe tokens"
  ON public.email_unsubscribe_tokens FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Admins or campaign managers update unsubscribe tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Admins or campaign managers update unsubscribe tokens"
  ON public.email_unsubscribe_tokens FOR UPDATE TO authenticated
  USING (public.is_user_admin() OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id)));

-- 1. Extend single-campaign cascade delete to cover all child tables
CREATE OR REPLACE FUNCTION public.delete_campaign_cascade(_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE deleted uuid;
BEGIN
  IF NOT public.can_manage_campaign(_id) THEN
    RAISE EXCEPTION 'Not authorized to delete this campaign' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.campaign_email_variants
    WHERE template_id IN (SELECT id FROM public.campaign_email_templates WHERE campaign_id = _id);

  DELETE FROM public.campaign_communications     WHERE campaign_id = _id;
  DELETE FROM public.campaign_email_templates    WHERE campaign_id = _id;
  DELETE FROM public.campaign_phone_scripts      WHERE campaign_id = _id;
  DELETE FROM public.campaign_accounts           WHERE campaign_id = _id;
  DELETE FROM public.campaign_contacts           WHERE campaign_id = _id;
  DELETE FROM public.campaign_materials          WHERE campaign_id = _id;
  DELETE FROM public.campaign_timing_windows     WHERE campaign_id = _id;
  DELETE FROM public.campaign_mart               WHERE campaign_id = _id;
  DELETE FROM public.campaign_audience_segments  WHERE campaign_id = _id;
  DELETE FROM public.campaign_sequences          WHERE campaign_id = _id;
  DELETE FROM public.campaign_follow_up_rules    WHERE campaign_id = _id;
  DELETE FROM public.campaign_send_caps          WHERE campaign_id = _id;
  DELETE FROM public.campaign_send_log           WHERE campaign_id = _id;
  DELETE FROM public.campaign_suppression_list   WHERE campaign_id = _id;
  DELETE FROM public.email_unsubscribe_tokens    WHERE campaign_id = _id;

  UPDATE public.deals          SET campaign_id = NULL WHERE campaign_id = _id;

  BEGIN
    EXECUTE 'UPDATE public.email_history SET campaign_id = NULL WHERE campaign_id = $1' USING _id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  DELETE FROM public.action_items WHERE module_type = 'campaigns' AND module_id = _id;

  DELETE FROM public.campaigns WHERE id = _id RETURNING id INTO deleted;

  IF deleted IS NULL THEN
    RAISE EXCEPTION 'Campaign not found or already deleted';
  END IF;

  RETURN deleted;
END $function$;

-- 2. Bulk delete uses the single cascade so coverage is identical
CREATE OR REPLACE FUNCTION public.delete_campaigns_cascade(_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_ids uuid[] := ARRAY[]::uuid[];
  cid uuid;
  res uuid;
BEGIN
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN deleted_ids;
  END IF;

  FOREACH cid IN ARRAY _ids LOOP
    IF public.can_manage_campaign(cid) THEN
      BEGIN
        res := public.delete_campaign_cascade(cid);
        IF res IS NOT NULL THEN
          deleted_ids := array_append(deleted_ids, res);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN deleted_ids;
END $function$;

-- 3. Soft-bounce tracking and sender-mailbox audit on communications
ALTER TABLE public.campaign_communications
  ADD COLUMN IF NOT EXISTS soft_bounce_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_soft_bounce_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_as_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sender_email text,
  ADD COLUMN IF NOT EXISTS tracking_disabled boolean NOT NULL DEFAULT false;

-- 4. Idempotency for follow-up runner
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_followup_step
  ON public.campaign_communications (campaign_id, contact_id, sequence_step, follow_up_attempt)
  WHERE communication_type = 'Email'
    AND sequence_step IS NOT NULL
    AND contact_id IS NOT NULL
    AND follow_up_attempt > 0
    AND sent_via IN ('azure', 'sequence-runner', 'follow-up-runner')
    AND COALESCE(delivery_status, '') <> 'failed';

-- 5. Tag email_history rows with their originating campaign for clean analytics
ALTER TABLE public.email_history
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS campaign_communication_id uuid;

CREATE INDEX IF NOT EXISTS idx_email_history_campaign_id
  ON public.email_history (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_history_campaign_comm_id
  ON public.email_history (campaign_communication_id) WHERE campaign_communication_id IS NOT NULL;

-- 6. Restrict global (campaign_id IS NULL) templates/scripts to admins only
DROP POLICY IF EXISTS "Users can insert accessible campaign email templates" ON public.campaign_email_templates;
CREATE POLICY "Users can insert accessible campaign email templates"
  ON public.campaign_email_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      (campaign_id IS NULL AND public.is_user_admin())
      OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
    )
  );

DROP POLICY IF EXISTS "Users can update accessible campaign email templates" ON public.campaign_email_templates;
CREATE POLICY "Users can update accessible campaign email templates"
  ON public.campaign_email_templates
  FOR UPDATE
  TO authenticated
  USING (
    (campaign_id IS NULL AND public.is_user_admin())
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  )
  WITH CHECK (
    (campaign_id IS NULL AND public.is_user_admin())
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  );

DROP POLICY IF EXISTS "Users can delete accessible campaign email templates" ON public.campaign_email_templates;
CREATE POLICY "Users can delete accessible campaign email templates"
  ON public.campaign_email_templates
  FOR DELETE
  TO authenticated
  USING (
    (campaign_id IS NULL AND public.is_user_admin())
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  );

DROP POLICY IF EXISTS "Users can insert accessible campaign phone scripts" ON public.campaign_phone_scripts;
CREATE POLICY "Users can insert accessible campaign phone scripts"
  ON public.campaign_phone_scripts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      (campaign_id IS NULL AND public.is_user_admin())
      OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
    )
  );

DROP POLICY IF EXISTS "Users can update accessible campaign phone scripts" ON public.campaign_phone_scripts;
CREATE POLICY "Users can update accessible campaign phone scripts"
  ON public.campaign_phone_scripts
  FOR UPDATE
  TO authenticated
  USING (
    (campaign_id IS NULL AND public.is_user_admin())
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  )
  WITH CHECK (
    (campaign_id IS NULL AND public.is_user_admin())
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  );

DROP POLICY IF EXISTS "Users can delete accessible campaign phone scripts" ON public.campaign_phone_scripts;
CREATE POLICY "Users can delete accessible campaign phone scripts"
  ON public.campaign_phone_scripts
  FOR DELETE
  TO authenticated
  USING (
    (campaign_id IS NULL AND public.is_user_admin())
    OR (campaign_id IS NOT NULL AND public.can_manage_campaign(campaign_id))
  );

-- 7. Seed tracking_consent default
INSERT INTO public.campaign_settings (setting_key, setting_value)
SELECT 'tracking_consent_default', 'enabled'
WHERE NOT EXISTS (SELECT 1 FROM public.campaign_settings WHERE setting_key = 'tracking_consent_default');
