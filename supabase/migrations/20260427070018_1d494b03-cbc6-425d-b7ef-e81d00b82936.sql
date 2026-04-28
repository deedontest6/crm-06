CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Helper: best-effort async POST to the webhook dispatcher edge function.
-- Reads URL + key from campaign_settings so admins can manage via UI later.
-- Wrapped in EXCEPTION block so a missing setting / pg_net error never blocks
-- the underlying transaction (e.g. an email send insert).
CREATE OR REPLACE FUNCTION public.fire_campaign_webhook(
  p_event_type text,
  p_campaign_id uuid,
  p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Skip entirely if no enabled webhook subscribes to this event.
  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_webhooks
    WHERE is_enabled
      AND p_event_type = ANY(events)
      AND (campaign_id IS NULL OR campaign_id = p_campaign_id)
  ) THEN
    RETURN;
  END IF;

  SELECT setting_value INTO v_url FROM public.campaign_settings WHERE setting_key = 'webhook_dispatcher_url';
  SELECT setting_value INTO v_key FROM public.campaign_settings WHERE setting_key = 'webhook_dispatcher_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('event_type', p_event_type, 'campaign_id', p_campaign_id, 'payload', p_payload)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Swallow — never block the underlying transaction
    NULL;
  END;
END $$;

-- Trigger function: detects state transitions on campaign_communications and fires events.
CREATE OR REPLACE FUNCTION public.trg_fire_communication_webhooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := jsonb_build_object(
    'communication_id', NEW.id,
    'campaign_id', NEW.campaign_id,
    'contact_id', NEW.contact_id,
    'account_id', NEW.account_id,
    'subject', NEW.subject,
    'sender_email', NEW.sender_email,
    'communication_type', NEW.communication_type,
    'delivery_status', NEW.delivery_status,
    'email_status', NEW.email_status
  );

  IF TG_OP = 'INSERT' THEN
    IF NEW.delivery_status = 'sent' THEN
      PERFORM public.fire_campaign_webhook('sent', NEW.campaign_id, v_payload);
    ELSIF NEW.delivery_status = 'failed' THEN
      PERFORM public.fire_campaign_webhook('bounced', NEW.campaign_id, v_payload);
    ELSIF NEW.delivery_status = 'received' THEN
      PERFORM public.fire_campaign_webhook('replied', NEW.campaign_id, v_payload);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status AND NEW.delivery_status = 'sent' THEN
      PERFORM public.fire_campaign_webhook('sent', NEW.campaign_id, v_payload);
    END IF;
    IF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status AND NEW.delivery_status = 'failed' THEN
      PERFORM public.fire_campaign_webhook('bounced', NEW.campaign_id, v_payload);
    END IF;
    IF NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
      PERFORM public.fire_campaign_webhook('opened', NEW.campaign_id, v_payload);
    END IF;
    IF NEW.email_status IS DISTINCT FROM OLD.email_status AND NEW.email_status = 'Replied' THEN
      PERFORM public.fire_campaign_webhook('replied', NEW.campaign_id, v_payload);
    END IF;
    IF NEW.unsubscribed_at IS NOT NULL AND OLD.unsubscribed_at IS NULL THEN
      PERFORM public.fire_campaign_webhook('unsubscribed', NEW.campaign_id, v_payload);
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS communications_webhook_fire ON public.campaign_communications;
CREATE TRIGGER communications_webhook_fire
AFTER INSERT OR UPDATE ON public.campaign_communications
FOR EACH ROW EXECUTE FUNCTION public.trg_fire_communication_webhooks();