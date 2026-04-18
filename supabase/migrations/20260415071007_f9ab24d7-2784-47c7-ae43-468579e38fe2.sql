CREATE TABLE public.campaign_audience_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_name TEXT NOT NULL,
  criteria JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.campaign_audience_personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all personas"
ON public.campaign_audience_personas FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can create their own personas"
ON public.campaign_audience_personas FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own personas"
ON public.campaign_audience_personas FOR UPDATE
TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own personas"
ON public.campaign_audience_personas FOR DELETE
TO authenticated
USING (auth.uid() = created_by);