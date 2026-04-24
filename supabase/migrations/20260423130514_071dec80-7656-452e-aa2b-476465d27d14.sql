CREATE OR REPLACE FUNCTION public.get_campaign_aggregates_v2()
 RETURNS TABLE(
   campaign_id uuid,
   accounts_count bigint,
   contacts_count bigint,
   email_touched_contacts bigint,
   call_touched_contacts bigint,
   linkedin_touched_contacts bigint,
   total_touched_contacts bigint,
   email_threads bigint,
   email_replied_threads bigint,
   email_failed_threads bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH visible AS (
    SELECT c.id FROM public.campaigns c
    WHERE c.archived_at IS NULL
      AND public.can_view_campaign(c.id)
  ),
  acc AS (
    SELECT campaign_id, count(DISTINCT account_id)::bigint AS n
    FROM public.campaign_accounts
    WHERE campaign_id IN (SELECT id FROM visible)
    GROUP BY campaign_id
  ),
  con AS (
    SELECT campaign_id, count(DISTINCT contact_id)::bigint AS n
    FROM public.campaign_contacts
    WHERE campaign_id IN (SELECT id FROM visible)
    GROUP BY campaign_id
  ),
  touched AS (
    SELECT
      campaign_id,
      count(DISTINCT contact_id) FILTER (
        WHERE communication_type = 'Email'
          AND COALESCE(sent_via, 'manual') <> 'graph-sync'
          AND contact_id IS NOT NULL
      )::bigint AS email_n,
      count(DISTINCT contact_id) FILTER (
        WHERE communication_type IN ('Call', 'Phone')
          AND contact_id IS NOT NULL
      )::bigint AS call_n,
      count(DISTINCT contact_id) FILTER (
        WHERE communication_type = 'LinkedIn'
          AND contact_id IS NOT NULL
      )::bigint AS li_n
    FROM public.campaign_communications
    WHERE campaign_id IN (SELECT id FROM visible)
    GROUP BY campaign_id
  ),
  threads AS (
    SELECT
      campaign_id,
      COALESCE(conversation_id, 'solo-' || id::text) AS conv_key,
      bool_or(COALESCE(sent_via, 'manual') <> 'graph-sync') AS has_outbound,
      bool_or(COALESCE(sent_via, 'manual') = 'graph-sync') AS has_inbound,
      bool_or(email_status = 'Failed' OR delivery_status = 'failed') AS has_failed
    FROM public.campaign_communications
    WHERE campaign_id IN (SELECT id FROM visible)
      AND communication_type = 'Email'
    GROUP BY campaign_id, COALESCE(conversation_id, 'solo-' || id::text)
  ),
  thread_agg AS (
    SELECT
      campaign_id,
      count(*) FILTER (WHERE has_outbound)::bigint AS sent_n,
      count(*) FILTER (WHERE has_inbound)::bigint AS replied_n,
      count(*) FILTER (WHERE has_failed)::bigint AS failed_n
    FROM threads
    GROUP BY campaign_id
  )
  SELECT
    v.id,
    COALESCE(acc.n, 0),
    COALESCE(con.n, 0),
    COALESCE(touched.email_n, 0),
    COALESCE(touched.call_n, 0),
    COALESCE(touched.li_n, 0),
    COALESCE(touched.email_n, 0) + COALESCE(touched.call_n, 0) + COALESCE(touched.li_n, 0),
    COALESCE(thread_agg.sent_n, 0),
    COALESCE(thread_agg.replied_n, 0),
    COALESCE(thread_agg.failed_n, 0)
  FROM visible v
  LEFT JOIN acc ON acc.campaign_id = v.id
  LEFT JOIN con ON con.campaign_id = v.id
  LEFT JOIN touched ON touched.campaign_id = v.id
  LEFT JOIN thread_agg ON thread_agg.campaign_id = v.id;
$function$;