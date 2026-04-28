-- 1) Clean orphan rows first so FK constraints can be added safely.
DELETE FROM public.campaign_contacts cc
WHERE cc.contact_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = cc.contact_id);

DELETE FROM public.campaign_accounts ca
WHERE ca.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = ca.account_id);

UPDATE public.campaign_contacts cc
SET account_id = NULL
WHERE cc.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = cc.account_id);

UPDATE public.campaign_communications x
SET contact_id = NULL
WHERE x.contact_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = x.contact_id);

UPDATE public.campaign_communications x
SET account_id = NULL
WHERE x.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = x.account_id);

-- 2) Helper to add a constraint only if it does not already exist.
DO $$
DECLARE
  rec RECORD;
BEGIN
  -- campaign_accounts.account_id -> accounts.id ON DELETE CASCADE
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_accounts_account_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_accounts
      ADD CONSTRAINT campaign_accounts_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
  END IF;

  -- campaign_accounts.campaign_id -> campaigns.id ON DELETE CASCADE
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_accounts_campaign_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_accounts
      ADD CONSTRAINT campaign_accounts_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;

  -- campaign_contacts.contact_id -> contacts.id ON DELETE CASCADE
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_contacts_contact_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_contacts
      ADD CONSTRAINT campaign_contacts_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
  END IF;

  -- campaign_contacts.campaign_id -> campaigns.id ON DELETE CASCADE
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_contacts_campaign_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_contacts
      ADD CONSTRAINT campaign_contacts_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;

  -- campaign_contacts.account_id -> accounts.id ON DELETE SET NULL
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_contacts_account_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_contacts
      ADD CONSTRAINT campaign_contacts_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;

  -- campaign_communications: keep history, just unlink deleted refs
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_communications_contact_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_communications
      ADD CONSTRAINT campaign_communications_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_communications_account_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_communications
      ADD CONSTRAINT campaign_communications_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_communications_campaign_id_fkey'
  ) THEN
    ALTER TABLE public.campaign_communications
      ADD CONSTRAINT campaign_communications_campaign_id_fkey
      FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;
  END IF;
END $$;
