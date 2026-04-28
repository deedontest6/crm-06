-- Append-only log of every sequence step evaluation
CREATE TABLE public.campaign_sequence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  sequence_id uuid NOT NULL,
  step_number int NOT NULL,
  contact_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('sent','failed','skipped','action_item_created','dry_run_match')),
  reason text,
  detail text,
  communication_id uuid,
  is_dry_run boolean NOT NULL DEFAULT false,
  ran_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_csr_campaign_ran_at ON public.campaign_sequence_runs (campaign_id, ran_at DESC);
CREATE INDEX idx_csr_sequence_ran_at ON public.campaign_sequence_runs (sequence_id, ran_at DESC);
CREATE INDEX idx_csr_dry_run ON public.campaign_sequence_runs (campaign_id, is_dry_run, ran_at DESC);

ALTER TABLE public.campaign_sequence_runs ENABLE ROW LEVEL SECURITY;

-- Authenticated users with view-access to the campaign can read its runs
CREATE POLICY "View sequence runs for accessible campaigns"
ON public.campaign_sequence_runs
FOR SELECT
TO authenticated
USING (is_user_admin() OR can_view_campaign(campaign_id));

-- Service role full write access (edge functions only)
CREATE POLICY "Service role full access sequence runs"
ON public.campaign_sequence_runs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
