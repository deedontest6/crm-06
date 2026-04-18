-- Per-campaign aggregates for the Campaigns dashboard
CREATE OR REPLACE FUNCTION public.get_campaign_aggregates()
RETURNS TABLE (
  campaign_id uuid,
  accounts_count bigint,
  contacts_count bigint,
  communications_count bigint,
  email_count bigint,
  call_count bigint,
  phone_count bigint,
  linkedin_count bigint,
  email_sent bigint,
  email_replied bigint,
  email_failed bigint,
  replies_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible AS (
    SELECT c.id FROM public.campaigns c
    WHERE c.archived_at IS NULL
      AND public.can_view_campaign(c.id)
  ),
  acc AS (
    SELECT campaign_id, count(*)::bigint AS n
    FROM public.campaign_accounts
    WHERE campaign_id IN (SELECT id FROM visible)
    GROUP BY campaign_id
  ),
  con AS (
    SELECT campaign_id, count(*)::bigint AS n
    FROM public.campaign_contacts
    WHERE campaign_id IN (SELECT id FROM visible)
    GROUP BY campaign_id
  ),
  comm AS (
    SELECT
      campaign_id,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE communication_type = 'Email')::bigint AS email_n,
      count(*) FILTER (WHERE communication_type = 'Call')::bigint AS call_n,
      count(*) FILTER (WHERE communication_type = 'Phone')::bigint AS phone_n,
      count(*) FILTER (WHERE communication_type = 'LinkedIn')::bigint AS li_n,
      count(*) FILTER (WHERE communication_type = 'Email' AND email_status = 'Sent')::bigint AS e_sent,
      count(*) FILTER (WHERE communication_type = 'Email' AND email_status = 'Replied')::bigint AS e_replied,
      count(*) FILTER (WHERE communication_type = 'Email' AND email_status = 'Failed')::bigint AS e_failed,
      count(*) FILTER (WHERE email_status = 'Replied')::bigint AS replies
    FROM public.campaign_communications
    WHERE campaign_id IN (SELECT id FROM visible)
    GROUP BY campaign_id
  )
  SELECT
    v.id,
    COALESCE(acc.n, 0),
    COALESCE(con.n, 0),
    COALESCE(comm.total, 0),
    COALESCE(comm.email_n, 0),
    COALESCE(comm.call_n, 0),
    COALESCE(comm.phone_n, 0),
    COALESCE(comm.li_n, 0),
    COALESCE(comm.e_sent, 0),
    COALESCE(comm.e_replied, 0),
    COALESCE(comm.e_failed, 0),
    COALESCE(comm.replies, 0)
  FROM visible v
  LEFT JOIN acc ON acc.campaign_id = v.id
  LEFT JOIN con ON con.campaign_id = v.id
  LEFT JOIN comm ON comm.campaign_id = v.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_aggregates() TO authenticated;

-- Compact stats for the Dashboard widget
CREATE OR REPLACE FUNCTION public.get_campaign_widget_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  active_count int;
  total_count int;
  avg_strategy int;
  top_campaigns jsonb;
BEGIN
  WITH visible AS (
    SELECT c.id, c.campaign_name, c.status
    FROM public.campaigns c
    WHERE c.archived_at IS NULL
      AND public.can_view_campaign(c.id)
  )
  SELECT
    count(*) FILTER (WHERE status = 'Active'),
    count(*)
  INTO active_count, total_count
  FROM visible;

  SELECT COALESCE(ROUND(AVG(
    (CASE WHEN m.message_done THEN 1 ELSE 0 END
   + CASE WHEN m.audience_done THEN 1 ELSE 0 END
   + CASE WHEN m.region_done THEN 1 ELSE 0 END
   + CASE WHEN m.timing_done THEN 1 ELSE 0 END) * 25.0
  ))::int, 0)
  INTO avg_strategy
  FROM public.campaign_mart m
  WHERE m.campaign_id IN (SELECT id FROM (
    SELECT c.id FROM public.campaigns c
    WHERE c.archived_at IS NULL AND public.can_view_campaign(c.id)
  ) v);

  SELECT COALESCE(jsonb_agg(t ORDER BY t.rate DESC), '[]'::jsonb)
  INTO top_campaigns
  FROM (
    SELECT
      c.id,
      c.campaign_name AS name,
      CASE WHEN count(cc.*) = 0 THEN 0
           ELSE ROUND((count(*) FILTER (WHERE cc.stage IN ('Responded','Qualified','Converted')) * 100.0) / count(cc.*))::int
      END AS rate
    FROM public.campaigns c
    LEFT JOIN public.campaign_contacts cc ON cc.campaign_id = c.id
    WHERE c.archived_at IS NULL
      AND public.can_view_campaign(c.id)
    GROUP BY c.id, c.campaign_name
    HAVING count(cc.*) > 0
    ORDER BY rate DESC
    LIMIT 3
  ) t;

  result := jsonb_build_object(
    'activeCount', active_count,
    'totalCount', total_count,
    'avgStrategy', avg_strategy,
    'topCampaigns', top_campaigns
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_widget_stats() TO authenticated;