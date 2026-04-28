
-- ============================================================
-- Campaign Phase 1 — Correctness & security fixes
-- A2 single-source auto-complete · A5 atomic suppression
-- A7 stop_sequence flag · A9 timing windows in DB
-- B7 contacts.account_id FK · D2 stage CHECK
-- ============================================================

-- ── A2: Single source of truth for Active→Completed ─────────
-- Edge functions will call this RPC instead of running their own UPDATE.
-- Uses FOR UPDATE row lock so concurrent callers don't double-write.
CREATE OR REPLACE FUNCTION public.auto_complete_campaign(_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_end_date date;
  v_archived_at timestamptz;
BEGIN
  SELECT status, end_date, archived_at
    INTO v_status, v_end_date, v_archived_at
  FROM public.campaigns
  WHERE id = _campaign_id
  FOR UPDATE;

  IF v_status IS NULL THEN RETURN false; END IF;
  IF v_archived_at IS NOT NULL THEN RETURN false; END IF;
  IF v_end_date IS NULL OR v_end_date >= CURRENT_DATE THEN RETURN false; END IF;
  IF v_status NOT IN ('Active', 'Paused') THEN RETURN false; END IF;

  UPDATE public.campaigns
  SET status = 'Completed', modified_at = now()
  WHERE id = _campaign_id AND status = v_status;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.auto_complete_campaign(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auto_complete_campaign(uuid) TO authenticated, service_role;

-- ── A9: Timing-window check usable from runner + send fn ────
CREATE OR REPLACE FUNCTION public.is_within_timing_window(_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.campaign_timing_windows WHERE campaign_id = _campaign_id) THEN true
      ELSE EXISTS (
        SELECT 1 FROM public.campaign_timing_windows
        WHERE campaign_id = _campaign_id
          AND start_date <= CURRENT_DATE
          AND end_date   >= CURRENT_DATE
      )
    END
$$;
REVOKE ALL ON FUNCTION public.is_within_timing_window(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_within_timing_window(uuid) TO authenticated, service_role;

-- ── A5: Atomic suppression check on every outbound row ──────
-- Defence-in-depth: even if the edge function forgets to check, an
-- INSERT into campaign_communications for an already-suppressed
-- recipient will be rejected at the DB level.
CREATE OR REPLACE FUNCTION public.enforce_suppression_on_communication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.communication_type IS DISTINCT FROM 'Email' THEN RETURN NEW; END IF;
  IF NEW.delivery_status IN ('failed','manual','received') THEN RETURN NEW; END IF;
  -- Inbound graph-sync rows are always allowed.
  IF NEW.sent_via = 'graph-sync' THEN RETURN NEW; END IF;
  IF NEW.contact_id IS NULL THEN RETURN NEW; END IF;

  SELECT lower(email) INTO v_email FROM public.contacts WHERE id = NEW.contact_id;
  IF v_email IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.campaign_suppression_list
    WHERE lower(email) = v_email
      AND (campaign_id IS NULL OR campaign_id = NEW.campaign_id)
  ) THEN
    RAISE EXCEPTION 'Recipient % is on the suppression list (campaign %).', v_email, NEW.campaign_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_suppression_on_communication ON public.campaign_communications;
CREATE TRIGGER trg_enforce_suppression_on_communication
BEFORE INSERT ON public.campaign_communications
FOR EACH ROW EXECUTE FUNCTION public.enforce_suppression_on_communication();

-- ── A7: Per-contact "stop sequence" flag ────────────────────
ALTER TABLE public.campaign_contacts
  ADD COLUMN IF NOT EXISTS stop_sequence boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.campaign_contacts.stop_sequence IS
  'When true, the follow-up runner will not send any further sequence step to this contact, even if no electronic reply is recorded.';

-- ── B12 / D5: Whitelist real stage values ───────────────────
-- Existing DB values: Not Contacted, Email Sent, Responded.
-- New canonical set adds Phone Contacted, LinkedIn Contacted, Qualified
-- to match what the segment manager + stage ranks produce.
ALTER TABLE public.campaign_contacts
  DROP CONSTRAINT IF EXISTS campaign_contacts_stage_check;
ALTER TABLE public.campaign_contacts
  ADD CONSTRAINT campaign_contacts_stage_check
  CHECK (stage IN (
    'Not Contacted',
    'Email Sent',
    'Phone Contacted',
    'LinkedIn Contacted',
    'Responded',
    'Qualified'
  ));

-- ── B7: Real FK contacts.account_id → accounts(id) ──────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_account_id ON public.contacts(account_id);

-- Best-effort backfill: link each contact to the account whose name matches
-- (case-insensitive, suffix-stripped). Safe to re-run; only sets when null.
UPDATE public.contacts c
SET account_id = a.id
FROM public.accounts a
WHERE c.account_id IS NULL
  AND c.company_name IS NOT NULL
  AND a.account_name IS NOT NULL
  AND lower(regexp_replace(c.company_name, '\s*\b(inc|llc|ltd|gmbh|corp|corporation|co|company|hq|headquarters)\b\.?', '', 'gi')) =
      lower(regexp_replace(a.account_name, '\s*\b(inc|llc|ltd|gmbh|corp|corporation|co|company|hq|headquarters)\b\.?', '', 'gi'));

-- ── A2: Mirror the per-campaign single-source RPC for the cron job too ──
-- The existing auto_complete_campaigns() function is fine for batch runs;
-- we just make it advisory-locked so it cannot race a per-campaign caller.
CREATE OR REPLACE FUNCTION public.auto_complete_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  -- Advisory lock keyed on a constant so concurrent invocations serialize.
  PERFORM pg_advisory_xact_lock(782113); -- arbitrary stable key

  UPDATE public.campaigns
  SET status = 'Completed', modified_at = now()
  WHERE status IN ('Active', 'Paused')
    AND end_date IS NOT NULL
    AND end_date < CURRENT_DATE
    AND archived_at IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
