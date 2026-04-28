
-- ============================================================
-- Phase 2 — Durable send queue
-- ============================================================

-- 1. campaign_send_jobs
CREATE TABLE IF NOT EXISTS public.campaign_send_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  created_by uuid NOT NULL,
  template_id uuid,
  segment_id uuid,
  reply_to_parent_id uuid,
  reply_to_thread_id uuid,
  reply_to_internet_message_id text,
  sender_mailbox text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','paused','completed','failed','cancelled')),
  total_items integer NOT NULL DEFAULT 0,
  sent_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  skipped_items integer NOT NULL DEFAULT 0,
  cancelled_items integer NOT NULL DEFAULT 0,
  error_summary text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_send_jobs_campaign ON public.campaign_send_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_send_jobs_status ON public.campaign_send_jobs(status) WHERE status IN ('queued','running','paused');

-- 2. campaign_send_job_items
CREATE TABLE IF NOT EXISTS public.campaign_send_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.campaign_send_jobs(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  account_id uuid,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed','skipped','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  last_error_message text,
  communication_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_send_job_items_job ON public.campaign_send_job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_send_job_items_campaign ON public.campaign_send_job_items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_send_job_items_pickup
  ON public.campaign_send_job_items(next_attempt_at)
  WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS idx_send_job_items_contact ON public.campaign_send_job_items(contact_id);

-- updated_at triggers (reuse existing helper)
DROP TRIGGER IF EXISTS trg_send_jobs_updated_at ON public.campaign_send_jobs;
CREATE TRIGGER trg_send_jobs_updated_at
  BEFORE UPDATE ON public.campaign_send_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_send_job_items_updated_at ON public.campaign_send_job_items;
CREATE TRIGGER trg_send_job_items_updated_at
  BEFORE UPDATE ON public.campaign_send_job_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.campaign_send_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_send_job_items ENABLE ROW LEVEL SECURITY;

-- jobs: view + manage by campaign access
DROP POLICY IF EXISTS "View send jobs for accessible campaigns" ON public.campaign_send_jobs;
CREATE POLICY "View send jobs for accessible campaigns"
  ON public.campaign_send_jobs FOR SELECT TO authenticated
  USING (can_view_campaign(campaign_id));

DROP POLICY IF EXISTS "Insert send jobs for managed campaigns" ON public.campaign_send_jobs;
CREATE POLICY "Insert send jobs for managed campaigns"
  ON public.campaign_send_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND can_manage_campaign(campaign_id));

DROP POLICY IF EXISTS "Update send jobs for managed campaigns" ON public.campaign_send_jobs;
CREATE POLICY "Update send jobs for managed campaigns"
  ON public.campaign_send_jobs FOR UPDATE TO authenticated
  USING (can_manage_campaign(campaign_id))
  WITH CHECK (can_manage_campaign(campaign_id));

DROP POLICY IF EXISTS "Delete send jobs for managed campaigns" ON public.campaign_send_jobs;
CREATE POLICY "Delete send jobs for managed campaigns"
  ON public.campaign_send_jobs FOR DELETE TO authenticated
  USING (can_manage_campaign(campaign_id));

-- items
DROP POLICY IF EXISTS "View send job items for accessible campaigns" ON public.campaign_send_job_items;
CREATE POLICY "View send job items for accessible campaigns"
  ON public.campaign_send_job_items FOR SELECT TO authenticated
  USING (can_view_campaign(campaign_id));

DROP POLICY IF EXISTS "Insert send job items for managed campaigns" ON public.campaign_send_job_items;
CREATE POLICY "Insert send job items for managed campaigns"
  ON public.campaign_send_job_items FOR INSERT TO authenticated
  WITH CHECK (can_manage_campaign(campaign_id));

DROP POLICY IF EXISTS "Update send job items for managed campaigns" ON public.campaign_send_job_items;
CREATE POLICY "Update send job items for managed campaigns"
  ON public.campaign_send_job_items FOR UPDATE TO authenticated
  USING (can_manage_campaign(campaign_id))
  WITH CHECK (can_manage_campaign(campaign_id));

DROP POLICY IF EXISTS "Delete send job items for managed campaigns" ON public.campaign_send_job_items;
CREATE POLICY "Delete send job items for managed campaigns"
  ON public.campaign_send_job_items FOR DELETE TO authenticated
  USING (can_manage_campaign(campaign_id));

-- service_role can do everything (for the runner)
DROP POLICY IF EXISTS "Service role full access send jobs" ON public.campaign_send_jobs;
CREATE POLICY "Service role full access send jobs"
  ON public.campaign_send_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access send job items" ON public.campaign_send_job_items;
CREATE POLICY "Service role full access send job items"
  ON public.campaign_send_job_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- claim_send_job_items: atomic picker
-- Returns up to _limit items, marking them 'sending' under FOR UPDATE SKIP LOCKED.
-- Skips items whose parent job is paused/cancelled/completed/failed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_send_job_items(_limit integer DEFAULT 25)
RETURNS SETOF public.campaign_send_job_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
BEGIN
  SELECT array_agg(i.id) INTO _ids
  FROM (
    SELECT it.id
    FROM public.campaign_send_job_items it
    JOIN public.campaign_send_jobs j ON j.id = it.job_id
    WHERE it.status IN ('queued','failed')
      AND it.next_attempt_at <= now()
      AND j.status IN ('queued','running')
    ORDER BY it.next_attempt_at ASC
    LIMIT _limit
    FOR UPDATE OF it SKIP LOCKED
  ) i;

  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Promote claimed jobs to running (only if currently queued)
  UPDATE public.campaign_send_jobs j
  SET status = 'running',
      started_at = COALESCE(j.started_at, now())
  WHERE j.status = 'queued'
    AND j.id IN (
      SELECT job_id FROM public.campaign_send_job_items WHERE id = ANY(_ids)
    );

  RETURN QUERY
  UPDATE public.campaign_send_job_items it
  SET status = 'sending',
      attempt_count = it.attempt_count + 1,
      updated_at = now()
  WHERE it.id = ANY(_ids)
  RETURNING it.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_send_job_items(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_send_job_items(integer) TO service_role;

-- ============================================================
-- finalize_send_job: recompute job counters and transition to terminal state
-- if no remaining work.
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_send_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sent int; _failed int; _skipped int; _cancelled int; _pending int; _total int;
  _job_status text;
BEGIN
  SELECT
    count(*) FILTER (WHERE status = 'sent'),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (WHERE status = 'skipped'),
    count(*) FILTER (WHERE status = 'cancelled'),
    count(*) FILTER (WHERE status IN ('queued','sending')),
    count(*)
  INTO _sent, _failed, _skipped, _cancelled, _pending, _total
  FROM public.campaign_send_job_items
  WHERE job_id = _job_id;

  SELECT status INTO _job_status FROM public.campaign_send_jobs WHERE id = _job_id;

  UPDATE public.campaign_send_jobs
  SET sent_items = _sent,
      failed_items = _failed,
      skipped_items = _skipped,
      cancelled_items = _cancelled,
      total_items = _total,
      status = CASE
        WHEN _job_status IN ('paused','cancelled') THEN _job_status
        WHEN _pending = 0 AND _failed = 0 AND _sent > 0 THEN 'completed'
        WHEN _pending = 0 AND _sent = 0 AND _failed > 0 THEN 'failed'
        WHEN _pending = 0 THEN 'completed'
        ELSE 'running'
      END,
      finished_at = CASE WHEN _pending = 0 AND _job_status NOT IN ('paused','cancelled')
                         THEN COALESCE(finished_at, now())
                         ELSE finished_at END
  WHERE id = _job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_send_job(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_send_job(uuid) TO service_role;

-- ============================================================
-- pause / resume / cancel helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.pause_send_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_campaign((SELECT campaign_id FROM public.campaign_send_jobs WHERE id = _job_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.campaign_send_jobs
  SET status = 'paused'
  WHERE id = _job_id AND status IN ('queued','running');
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_send_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_campaign((SELECT campaign_id FROM public.campaign_send_jobs WHERE id = _job_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.campaign_send_jobs
  SET status = 'queued'
  WHERE id = _job_id AND status = 'paused';
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_send_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_campaign((SELECT campaign_id FROM public.campaign_send_jobs WHERE id = _job_id)) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.campaign_send_job_items
  SET status = 'cancelled'
  WHERE job_id = _job_id AND status IN ('queued','failed');
  UPDATE public.campaign_send_jobs
  SET status = 'cancelled', finished_at = COALESCE(finished_at, now())
  WHERE id = _job_id AND status NOT IN ('completed','failed','cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.pause_send_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_send_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_send_job(uuid) TO authenticated;
