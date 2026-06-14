-- =====================================================================
-- ANAM MMA — Migration 0008:
--   * Re-seed plans (Kids €50/mo + Adults €70/mo)
--   * request_membership RPC (member requests → admin notification)
--   * take_payments coach permission
--   * mark_subscription_paid: also email admins; allow take_payments coaches
-- =====================================================================

-- Archive old seeded plans so they don't clutter the pricing list.
UPDATE public.plans SET archived = true
 WHERE name IN ('Unlimited Monthly','10 Class Pack','1 Week Trial','Student Monthly');

-- Insert new plans if absent
INSERT INTO public.plans (name, price, type, duration_days, description)
SELECT * FROM (VALUES
  ('Kids Membership',   50.0, 'monthly'::public.plan_type, 30, 'Unlimited kids classes — ages up to 14.'),
  ('Adults Membership', 70.0, 'monthly'::public.plan_type, 30, 'Unlimited adult classes — MMA, K1, boxing, judo & grappling.')
) v(name,price,type,duration_days,description)
WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE plans.name = v.name);

-- =====================================================================
-- request_membership: a member asks for a specific plan; admins are notified
-- =====================================================================
CREATE OR REPLACE FUNCTION public.request_membership(p_plan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user public.profiles%ROWTYPE;
  v_plan public.plans%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_user FROM public.profiles WHERE id=v_uid;
  SELECT * INTO v_plan FROM public.plans WHERE id=p_plan_id AND archived=false;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;

  -- Member-side confirmation
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (v_uid,'Membership request sent',
    format('Your request for %s (€%s) has been sent to the team. We''ll be in touch shortly.', v_plan.name, to_char(v_plan.price,'FM999990.00')),
    'membership');

  -- Admin notifications
  PERFORM public.notify_admins('💳 Membership request',
    format('%s requested the %s plan (€%s).', v_user.name, v_plan.name, to_char(v_plan.price,'FM999990.00')),
    'membership');

  -- Email admins
  INSERT INTO public.notifications(user_id,title,body,type)
  SELECT id,
    'membership-request-email-pending', -- internal marker (not shown)
    '',
    'system'
  FROM public.profiles WHERE 1=0; -- no-op (kept as placeholder for future)

  -- Queue email for each admin
  PERFORM public.queue_email(p.email, 'ANAM MMA — New membership request',
    format('<p>Hi %s,</p><p><b>%s</b> (%s) has requested the <b>%s</b> plan (€%s).</p><p>Open the admin app to confirm payment when received.</p>',
      p.name, v_user.name, v_user.email, v_plan.name, to_char(v_plan.price,'FM999990.00')))
  FROM public.profiles p WHERE p.role='admin' AND p.status='active';

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- =====================================================================
-- mark_subscription_paid: allow take_payments coaches; email admins too
-- =====================================================================
CREATE OR REPLACE FUNCTION public.mark_subscription_paid(p_sub_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_receipt text;
  v_email text; v_name text;
  v_taker text;
BEGIN
  -- Allow admins, manage_members coaches, OR take_payments coaches
  IF NOT (public.current_user_perm('manage_members') OR public.current_user_perm('take_payments')) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription not found'; END IF;

  SELECT name INTO v_taker FROM public.profiles WHERE id=auth.uid();

  v_receipt := 'ANAM-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDD') || '-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 6));

  INSERT INTO public.payments(subscription_id,user_id,user_name,plan_name,amount,method,receipt_no)
  VALUES (p_sub_id,v_sub.user_id,v_sub.user_name,v_sub.plan_name,v_sub.price,'cash',v_receipt);
  UPDATE public.subscriptions SET status='active' WHERE id=p_sub_id;

  -- Member: in-app + email
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (v_sub.user_id,'Payment confirmed',
    format('Your %s payment of €%s has been received. Receipt %s.', v_sub.plan_name, to_char(v_sub.price,'FM999990.00'), v_receipt),
    'payment');

  SELECT email,name INTO v_email,v_name FROM public.profiles WHERE id=v_sub.user_id;
  IF v_email IS NOT NULL THEN
    PERFORM public.queue_email(v_email,'ANAM MMA — Payment Confirmation',
      format('<p>Hi %s,</p><p>Payment of <b>€%s</b> for <b>%s</b> received.<br/>Receipt: %s<br/>Valid until <b>%s</b>.</p><p>Train hard.</p>',
        v_name, to_char(v_sub.price,'FM999990.00'), v_sub.plan_name, v_receipt, v_sub.end_date));
  END IF;

  -- Admin notif + email
  PERFORM public.notify_admins('💶 Payment received',
    format('%s paid €%s for %s (taken by %s). Receipt %s.',
      v_sub.user_name, to_char(v_sub.price,'FM999990.00'), v_sub.plan_name, v_taker, v_receipt),
    'payment');

  PERFORM public.queue_email(p.email, 'ANAM MMA — Payment recorded',
    format('<p>Hi %s,</p><p><b>%s</b> just paid €%s for <b>%s</b>.<br/>Taken by: %s<br/>Receipt: %s<br/>Valid until: %s</p>',
      p.name, v_sub.user_name, to_char(v_sub.price,'FM999990.00'), v_sub.plan_name, v_taker, v_receipt, v_sub.end_date))
  FROM public.profiles p WHERE p.role='admin' AND p.status='active'
    AND p.id <> auth.uid(); -- don't email the admin who took it themselves

  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  RETURN to_jsonb(v_sub);
END;
$$;
