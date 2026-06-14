-- =====================================================================
-- ANAM MMA — Email queue (SendGrid via pg_net) + seed data
-- =====================================================================

-- Settings table for app secrets (admin-only access; not exposed via PostgREST anon)
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
-- No policies = nobody can read except service_role.

-- Queue an email (called from RPCs). Writes to a table; a worker function
-- dispatches via pg_net to SendGrid. We send synchronously here using pg_net
-- (non-blocking) for simplicity.
CREATE OR REPLACE FUNCTION public.queue_email(p_to text, p_subject text, p_html text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text;
  v_from text;
  v_payload jsonb;
BEGIN
  IF p_to IS NULL OR p_to = '' THEN RETURN; END IF;
  SELECT value INTO v_key  FROM public.app_secrets WHERE key='sendgrid_api_key';
  SELECT value INTO v_from FROM public.app_secrets WHERE key='sender_email';
  IF v_key IS NULL OR v_from IS NULL THEN RETURN; END IF;

  v_payload := jsonb_build_object(
    'personalizations', jsonb_build_array(jsonb_build_object('to', jsonb_build_array(jsonb_build_object('email', p_to)))),
    'from', jsonb_build_object('email', v_from, 'name', 'ANAM MMA'),
    'subject', p_subject,
    'content', jsonb_build_array(jsonb_build_object('type','text/html','value',p_html))
  );

  PERFORM net.http_post(
    url := 'https://api.sendgrid.com/v3/mail/send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := v_payload
  );
END;
$$;

-- =====================================================================
-- Daily maintenance: expiry detection + 7-day reminder (cron)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.daily_membership_maintenance()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  -- Expire stale
  FOR r IN
    SELECT s.id, s.user_id, p.email, p.name
      FROM public.subscriptions s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.status IN ('active','frozen') AND s.end_date < current_date
  LOOP
    UPDATE public.subscriptions SET status='expired' WHERE id=r.id;
    INSERT INTO public.notifications(user_id,title,body,type)
    VALUES (r.user_id,'Membership expired','Your membership has expired. Renew to keep training.','membership');
  END LOOP;

  -- 7-day reminders
  FOR r IN
    SELECT s.id, s.user_id, s.end_date, p.email, p.name
      FROM public.subscriptions s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.status='active' AND s.reminder_sent=false
       AND s.end_date BETWEEN current_date AND current_date + 7
  LOOP
    UPDATE public.subscriptions SET reminder_sent=true WHERE id=r.id;
    INSERT INTO public.notifications(user_id,title,body,type)
    VALUES (r.user_id,'Membership expiring soon',
      format('Your membership expires on %s. Renew soon to avoid interruption.', r.end_date), 'membership');
    PERFORM public.queue_email(r.email, 'ANAM MMA — Membership expiring soon',
      format('<p>Hi %s,</p><p>Your membership expires on <b>%s</b>. Renew soon to avoid interruption.</p>', r.name, r.end_date));
  END LOOP;
END;
$$;

-- Schedule daily at 06:00 UTC (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anam_daily_maint') THEN
    PERFORM cron.schedule('anam_daily_maint', '0 6 * * *', $cron$SELECT public.daily_membership_maintenance();$cron$);
  END IF;
END $$;

-- =====================================================================
-- Seed: settings, plans, classes (coaches via Auth seed script)
-- =====================================================================

INSERT INTO public.settings (id, open_registration, cancellation_window_hours, private_session_policy, club_email, waiver_version, media)
VALUES ('club', true, 2,
  'Private sessions can be cancelled free of charge up to 24 hours in advance. Late cancellations may be charged in full.',
  '', '1.0',
  jsonb_build_object(
    'login_bg', 'https://images.unsplash.com/photo-1708134028754-5ba43093fedf?crop=entropy&cs=srgb&fm=jpg&q=85',
    'logo', '',
    'banner', 'https://images.unsplash.com/photo-1708134028754-5ba43093fedf?crop=entropy&cs=srgb&fm=jpg&q=85'
  ))
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plans (name, price, type, duration_days, sessions, description)
SELECT * FROM (VALUES
  ('Unlimited Monthly', 80.0, 'monthly'::public.plan_type,    30, NULL::int, 'Unlimited access to all classes.'),
  ('10 Class Pack',    100.0, 'class_pack'::public.plan_type, 90, 10,        '10 sessions, valid 90 days.'),
  ('1 Week Trial',      15.0, 'trial'::public.plan_type,       7, NULL,      'Try every class for one week.'),
  ('Student Monthly',   60.0, 'monthly'::public.plan_type,    30, NULL,      'Unlimited classes — valid student ID required.')
) v(name,price,type,duration_days,sessions,description)
WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE plans.name = v.name);
