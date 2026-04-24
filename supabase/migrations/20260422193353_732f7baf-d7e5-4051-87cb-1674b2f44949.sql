-- ============================================================
-- 1. SECURITY DEFINER helpers for parent-based access checks
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_view_deal(_deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.id = _deal_id
      AND (public.is_user_admin() OR d.created_by = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_lead(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = _lead_id
      AND (public.is_user_admin() OR l.created_by = auth.uid())
  );
$$;

-- ============================================================
-- 2. RLS lockdown: replace permissive USING (true) policies
-- ============================================================

-- ---------- accounts ----------
DROP POLICY IF EXISTS "Users can view all accounts" ON public.accounts;
CREATE POLICY "Owner or admin can view accounts"
  ON public.accounts FOR SELECT TO authenticated
  USING (is_user_admin() OR created_by = auth.uid() OR account_owner = auth.uid());

-- ---------- contacts ----------
DROP POLICY IF EXISTS "Authenticated users can view all contacts" ON public.contacts;
CREATE POLICY "Owner or admin can view contacts"
  ON public.contacts FOR SELECT TO authenticated
  USING (is_user_admin() OR created_by = auth.uid() OR contact_owner = auth.uid());

-- ---------- leads ----------
DROP POLICY IF EXISTS "Authenticated users can view all leads" ON public.leads;
CREATE POLICY "Owner or admin can view leads"
  ON public.leads FOR SELECT TO authenticated
  USING (is_user_admin() OR created_by = auth.uid() OR contact_owner = auth.uid());

-- ---------- deals ----------
DROP POLICY IF EXISTS "Authenticated users can view all deals" ON public.deals;
CREATE POLICY "Owner or admin can view deals"
  ON public.deals FOR SELECT TO authenticated
  USING (is_user_admin() OR created_by = auth.uid());

-- ---------- action_items ----------
DROP POLICY IF EXISTS "Authenticated users can view all action items" ON public.action_items;
CREATE POLICY "Owner assignee or admin can view action items"
  ON public.action_items FOR SELECT TO authenticated
  USING (is_user_admin() OR created_by = auth.uid() OR assigned_to = auth.uid());

-- ---------- deal_stakeholders ----------
DROP POLICY IF EXISTS "Authenticated users can view deal stakeholders" ON public.deal_stakeholders;
CREATE POLICY "View deal stakeholders for accessible deals"
  ON public.deal_stakeholders FOR SELECT TO authenticated
  USING (can_view_deal(deal_id));

-- ---------- deal_action_items ----------
DROP POLICY IF EXISTS "Users can view action items for accessible deals" ON public.deal_action_items;
CREATE POLICY "View deal action items for accessible deals"
  ON public.deal_action_items FOR SELECT
  USING (can_view_deal(deal_id));

-- ---------- lead_action_items ----------
DROP POLICY IF EXISTS "Users can view action items for accessible leads" ON public.lead_action_items;
CREATE POLICY "View lead action items for accessible leads"
  ON public.lead_action_items FOR SELECT
  USING (can_view_lead(lead_id));

-- ---------- email_templates ----------
DROP POLICY IF EXISTS "Authenticated users can view all email templates" ON public.email_templates;
CREATE POLICY "Owner or admin can view email templates"
  ON public.email_templates FOR SELECT TO authenticated
  USING (is_user_admin() OR created_by = auth.uid());

-- email_history already restricts SELECT to sent_by = auth.uid() (good)

-- ============================================================
-- 3. Foreign key constraints (data integrity)
-- ============================================================

-- Clean orphans first so FK creation succeeds
DELETE FROM public.campaign_accounts        WHERE campaign_id NOT IN (SELECT id FROM public.campaigns);
DELETE FROM public.campaign_contacts        WHERE campaign_id NOT IN (SELECT id FROM public.campaigns);
DELETE FROM public.campaign_communications  WHERE campaign_id NOT IN (SELECT id FROM public.campaigns);
DELETE FROM public.campaign_email_templates WHERE campaign_id IS NOT NULL AND campaign_id NOT IN (SELECT id FROM public.campaigns);
DELETE FROM public.campaign_phone_scripts   WHERE campaign_id IS NOT NULL AND campaign_id NOT IN (SELECT id FROM public.campaigns);
DELETE FROM public.campaign_materials       WHERE campaign_id NOT IN (SELECT id FROM public.campaigns);
DELETE FROM public.campaign_mart            WHERE campaign_id NOT IN (SELECT id FROM public.campaigns);
DELETE FROM public.campaign_timing_windows  WHERE campaign_id NOT IN (SELECT id FROM public.campaigns);
UPDATE public.deals SET campaign_id = NULL WHERE campaign_id IS NOT NULL AND campaign_id NOT IN (SELECT id FROM public.campaigns);
UPDATE public.deals SET source_campaign_contact_id = NULL WHERE source_campaign_contact_id IS NOT NULL AND source_campaign_contact_id NOT IN (SELECT id FROM public.campaign_contacts);
UPDATE public.deals SET account_id = NULL WHERE account_id IS NOT NULL AND account_id NOT IN (SELECT id FROM public.accounts);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_accounts_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_accounts ADD CONSTRAINT campaign_accounts_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_contacts_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_contacts ADD CONSTRAINT campaign_contacts_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_communications_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_communications ADD CONSTRAINT campaign_communications_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_email_templates_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_email_templates ADD CONSTRAINT campaign_email_templates_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_phone_scripts_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_phone_scripts ADD CONSTRAINT campaign_phone_scripts_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_materials_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_materials ADD CONSTRAINT campaign_materials_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_mart_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_mart ADD CONSTRAINT campaign_mart_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_timing_windows_campaign_id_fkey') THEN
    ALTER TABLE public.campaign_timing_windows ADD CONSTRAINT campaign_timing_windows_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_campaign_id_fkey') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_source_campaign_contact_id_fkey') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_source_campaign_contact_id_fkey
      FOREIGN KEY (source_campaign_contact_id) REFERENCES public.campaign_contacts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_account_id_fkey') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
END$$;

-- Trigger to enforce campaign reference on action_items when module_type='campaigns'
CREATE OR REPLACE FUNCTION public.cleanup_action_items_on_campaign_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.action_items
  WHERE module_type = 'campaigns' AND module_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_action_items_on_campaign_delete ON public.campaigns;
CREATE TRIGGER trg_cleanup_action_items_on_campaign_delete
  BEFORE DELETE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_action_items_on_campaign_delete();

-- ============================================================
-- 4. Slug column on campaigns
-- ============================================================
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS slug text;

CREATE OR REPLACE FUNCTION public.generate_campaign_slug(_name text, _id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  base text;
BEGIN
  base := lower(regexp_replace(coalesce(_name,''), '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from base);
  IF base = '' THEN base := 'campaign'; END IF;
  RETURN base || '-' || substr(_id::text, 1, 8);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_campaign_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.slug := public.generate_campaign_slug(NEW.campaign_name, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_campaign_slug ON public.campaigns;
CREATE TRIGGER trg_set_campaign_slug
  BEFORE INSERT OR UPDATE OF campaign_name ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_campaign_slug();

-- Backfill existing rows
UPDATE public.campaigns SET slug = public.generate_campaign_slug(campaign_name, id) WHERE slug IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_slug_unique ON public.campaigns(slug);