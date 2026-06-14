-- =====================================================================
-- ANAM MMA — RPC Functions
-- =====================================================================

-- Schedule for a date: returns expanded classes for that date with counts
CREATE OR REPLACE FUNCTION public.schedule_for_date(p_date date)
RETURNS TABLE (
  id uuid, name text, description text, day_of_week int, start_time text,
  duration_min int, room text, capacity int, coach_id uuid, image text,
  coach jsonb, booked_count int, waitlist_count int, cancelled boolean,
  my_booking jsonb, date date
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dow int := EXTRACT(DOW FROM p_date)::int;
  v_uid uuid := auth.uid();
BEGIN
  -- Postgres DOW: Sun=0..Sat=6; our schema uses Mon=0..Sun=6
  v_dow := CASE v_dow WHEN 0 THEN 6 ELSE v_dow - 1 END;
  RETURN QUERY
  SELECT
    c.id, c.name, c.description, c.day_of_week, c.start_time, c.duration_min,
    c.room, c.capacity, c.coach_id, c.image,
    CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'name',p.name,'photo',p.photo,'bio',p.bio) END as coach,
    (SELECT COUNT(*)::int FROM public.bookings b WHERE b.class_id=c.id AND b.date=p_date AND b.status='booked'),
    (SELECT COUNT(*)::int FROM public.bookings b WHERE b.class_id=c.id AND b.date=p_date AND b.status='waitlist'),
    EXISTS (SELECT 1 FROM public.class_overrides o WHERE o.class_id=c.id AND o.date=p_date AND o.status='cancelled'),
    (SELECT to_jsonb(mb.*) FROM public.bookings mb WHERE mb.class_id=c.id AND mb.date=p_date AND mb.user_id=v_uid AND mb.status IN ('booked','waitlist') LIMIT 1),
    p_date
  FROM public.classes c
  LEFT JOIN public.profiles p ON p.id = c.coach_id
  WHERE c.day_of_week = v_dow AND c.archived = false
  ORDER BY c.start_time;
END;
$$;

-- Book a class (atomic: chooses booked vs waitlist)
CREATE OR REPLACE FUNCTION public.book_class(p_class_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_class public.classes%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_booked_count int;
  v_is_wait boolean;
  v_status public.booking_status;
  v_booking public.bookings%ROWTYPE;
  v_override public.class_overrides%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=v_uid;
  IF v_profile.status = 'pending' THEN RAISE EXCEPTION 'Your account is awaiting approval'; END IF;
  IF v_profile.status = 'removed' THEN RAISE EXCEPTION 'Account deactivated'; END IF;

  SELECT * INTO v_class FROM public.classes WHERE id=p_class_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;

  SELECT * INTO v_override FROM public.class_overrides WHERE class_id=p_class_id AND date=p_date;
  IF FOUND AND v_override.status='cancelled' THEN RAISE EXCEPTION 'This class is cancelled'; END IF;

  IF EXISTS (SELECT 1 FROM public.bookings WHERE class_id=p_class_id AND date=p_date AND user_id=v_uid AND status IN ('booked','waitlist')) THEN
    RAISE EXCEPTION 'Already booked';
  END IF;

  SELECT COUNT(*) INTO v_booked_count FROM public.bookings WHERE class_id=p_class_id AND date=p_date AND status='booked';
  v_is_wait := v_booked_count >= v_class.capacity;
  v_status := CASE WHEN v_is_wait THEN 'waitlist'::public.booking_status ELSE 'booked'::public.booking_status END;

  INSERT INTO public.bookings (class_id, class_name, date, start_time, room, user_id, user_name, status)
  VALUES (p_class_id, v_class.name, p_date, v_class.start_time, v_class.room, v_uid, v_profile.name, v_status)
  RETURNING * INTO v_booking;

  -- decrement class_pack sessions remaining
  IF NOT v_is_wait THEN
    UPDATE public.subscriptions
       SET sessions_remaining = sessions_remaining - 1
     WHERE user_id = v_uid AND status='active' AND plan_type='class_pack' AND sessions_remaining > 0;
  END IF;

  -- in-app notification to member
  INSERT INTO public.notifications (user_id, title, body, type)
  VALUES (
    v_uid,
    CASE WHEN v_is_wait THEN 'Waitlist joined' ELSE 'Booking confirmed' END,
    CASE WHEN v_is_wait
         THEN format('You''re on the waitlist for %s on %s at %s.', v_class.name, p_date, v_class.start_time)
         ELSE format('You''re booked into %s on %s at %s (%s).', v_class.name, p_date, v_class.start_time, v_class.room) END,
    'booking'
  );

  -- queue email
  PERFORM public.queue_email(
    v_profile.email,
    'ANAM MMA — ' || CASE WHEN v_is_wait THEN 'Waitlist joined' ELSE 'Booking confirmed' END,
    format('<p>Hi %s,</p><p>%s</p>', v_profile.name,
      CASE WHEN v_is_wait
           THEN format('You''re on the waitlist for %s on %s at %s.', v_class.name, p_date, v_class.start_time)
           ELSE format('You''re booked into %s on %s at %s.', v_class.name, p_date, v_class.start_time) END)
  );

  RETURN to_jsonb(v_booking);
END;
$$;

-- Cancel a booking + auto-promote waitlist
CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_b public.bookings%ROWTYPE;
  v_class public.classes%ROWTYPE;
  v_settings public.settings%ROWTYPE;
  v_start timestamptz;
  v_promote public.bookings%ROWTYPE;
  v_pmail text; v_pname text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_role := public.current_user_role();
  SELECT * INTO v_b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_role = 'member' AND v_b.user_id <> v_uid THEN RAISE EXCEPTION 'Not permitted'; END IF;

  SELECT * INTO v_class FROM public.classes WHERE id=v_b.class_id;
  SELECT * INTO v_settings FROM public.settings WHERE id='club';

  IF v_role = 'member' AND v_class.id IS NOT NULL THEN
    v_start := (v_b.date::text || ' ' || v_class.start_time || ':00+00')::timestamptz;
    IF now() > v_start - make_interval(hours => COALESCE(v_settings.cancellation_window_hours,2)) THEN
      RAISE EXCEPTION 'Cancellations must be made at least %h before class starts',
        COALESCE(v_settings.cancellation_window_hours,2);
    END IF;
  END IF;

  UPDATE public.bookings SET status='cancelled' WHERE id=p_booking_id;

  -- promote waitlist if a booked spot opened
  IF v_b.status = 'booked' THEN
    SELECT * INTO v_promote
      FROM public.bookings
     WHERE class_id=v_b.class_id AND date=v_b.date AND status='waitlist'
     ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      UPDATE public.bookings SET status='booked' WHERE id=v_promote.id;
      IF v_promote.user_id IS NOT NULL THEN
        INSERT INTO public.notifications(user_id,title,body,type) VALUES (
          v_promote.user_id,'You''re in! Spot opened',
          format('A spot opened in %s on %s at %s — you''ve been moved off the waitlist.', v_class.name, v_b.date, v_class.start_time),
          'waitlist');
        SELECT email,name INTO v_pmail,v_pname FROM public.profiles WHERE id=v_promote.user_id;
        IF v_pmail IS NOT NULL THEN
          PERFORM public.queue_email(v_pmail, 'ANAM MMA — Waitlist Promotion',
            format('<p>Hi %s, a spot opened in %s on %s at %s. You''re now booked in!</p>', v_pname, v_class.name, v_b.date, v_class.start_time));
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Cancel an entire class date (admin)
CREATE OR REPLACE FUNCTION public.cancel_class_date(p_class_id uuid, p_date date, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class public.classes%ROWTYPE;
  v_count int := 0;
  v_b record;
BEGIN
  IF NOT public.current_user_perm('manage_timetable') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v_class FROM public.classes WHERE id=p_class_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;

  INSERT INTO public.class_overrides(class_id,date,status,reason)
  VALUES (p_class_id,p_date,'cancelled',COALESCE(p_reason,'Class cancelled'))
  ON CONFLICT (class_id,date) DO UPDATE SET status='cancelled', reason=EXCLUDED.reason;

  FOR v_b IN SELECT * FROM public.bookings WHERE class_id=p_class_id AND date=p_date AND status IN ('booked','waitlist') LOOP
    UPDATE public.bookings SET status='class_cancelled' WHERE id=v_b.id;
    IF v_b.user_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id,title,body,type)
      VALUES (v_b.user_id,'Class cancelled',
        format('%s on %s at %s has been cancelled. %s', v_class.name, p_date, v_class.start_time, COALESCE(p_reason,'')),
        'class');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'notified',v_count);
END;
$$;

-- Mark subscription paid (admin)
CREATE OR REPLACE FUNCTION public.mark_subscription_paid(p_sub_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_receipt text;
  v_email text; v_name text;
BEGIN
  IF NOT public.current_user_perm('manage_members') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription not found'; END IF;

  v_receipt := 'ANAM-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDD') || '-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 6));

  INSERT INTO public.payments(subscription_id,user_id,user_name,plan_name,amount,method,receipt_no)
  VALUES (p_sub_id,v_sub.user_id,v_sub.user_name,v_sub.plan_name,v_sub.price,'cash',v_receipt);
  UPDATE public.subscriptions SET status='active' WHERE id=p_sub_id;

  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (v_sub.user_id,'Payment confirmed',
    format('Your %s payment of €%s has been received. Receipt %s.', v_sub.plan_name, to_char(v_sub.price,'FM999990.00'), v_receipt),
    'payment');

  SELECT email,name INTO v_email,v_name FROM public.profiles WHERE id=v_sub.user_id;
  IF v_email IS NOT NULL THEN
    PERFORM public.queue_email(v_email,'ANAM MMA — Payment Confirmation',
      format('<p>Hi %s,</p><p>Payment of <b>€%s</b> for <b>%s</b> received.<br/>Receipt: %s<br/>Valid until %s</p>',
        v_name, to_char(v_sub.price,'FM999990.00'), v_sub.plan_name, v_receipt, v_sub.end_date));
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  RETURN to_jsonb(v_sub);
END;
$$;

-- Freeze
CREATE OR REPLACE FUNCTION public.freeze_subscription(p_sub_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF NOT public.current_user_perm('manage_members') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  IF NOT FOUND OR v_sub.status <> 'active' THEN RAISE EXCEPTION 'Only active subscriptions can be frozen'; END IF;
  UPDATE public.subscriptions SET status='frozen', frozen_at=current_date WHERE id=p_sub_id;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (v_sub.user_id,'Membership frozen','Your membership has been paused. The end date will be extended when resumed.','membership');
  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  RETURN to_jsonb(v_sub);
END;
$$;

-- Resume
CREATE OR REPLACE FUNCTION public.resume_subscription(p_sub_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub public.subscriptions%ROWTYPE; v_days int; v_new_end date;
BEGIN
  IF NOT public.current_user_perm('manage_members') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  IF NOT FOUND OR v_sub.status <> 'frozen' THEN RAISE EXCEPTION 'Subscription is not frozen'; END IF;
  v_days := GREATEST((current_date - v_sub.frozen_at), 0);
  v_new_end := v_sub.end_date + v_days;
  UPDATE public.subscriptions SET status='active', frozen_at=NULL, end_date=v_new_end WHERE id=p_sub_id;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (v_sub.user_id,'Membership resumed',format('Your membership is active again. New end date: %s.', v_new_end),'membership');
  SELECT * INTO v_sub FROM public.subscriptions WHERE id=p_sub_id;
  RETURN to_jsonb(v_sub);
END;
$$;

-- Accept waiver (current user)
CREATE OR REPLACE FUNCTION public.accept_waiver(p_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.profiles SET waiver_accepted=true, waiver_version=p_version, waiver_accepted_at=now() WHERE id=v_uid;
  SELECT email INTO v_email FROM public.profiles WHERE id=v_uid;
  INSERT INTO public.waiver_log(user_id,user_email,version) VALUES (v_uid, v_email, p_version);
  RETURN jsonb_build_object('ok',true,'accepted_at',now());
END;
$$;

-- Admin dashboard (single round-trip)
CREATE OR REPLACE FUNCTION public.admin_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := current_date;
  v_month_start date := date_trunc('month', current_date)::date;
  v_soon date := current_date + 7;
  v_active_members int;
  v_pending int;
  v_new_signups int;
  v_revenue numeric;
  v_revenue_today numeric;
  v_expiring jsonb;
  v_attendance_today int;
  v_deletion_requests int;
  v_todays jsonb;
BEGIN
  IF NOT public.current_user_perm('manage_members') THEN RAISE EXCEPTION 'Not permitted'; END IF;

  -- expire stale subs
  UPDATE public.subscriptions SET status='expired' WHERE status IN ('active','frozen') AND end_date < v_today;

  SELECT COUNT(*) INTO v_active_members FROM public.profiles WHERE role='member' AND status='active';
  SELECT COUNT(*) INTO v_pending       FROM public.profiles WHERE role='member' AND status='pending';
  SELECT COUNT(*) INTO v_new_signups   FROM public.profiles WHERE role='member' AND created_at >= v_month_start;
  SELECT COALESCE(SUM(amount),0) INTO v_revenue       FROM public.payments WHERE created_at >= v_month_start;
  SELECT COALESCE(SUM(amount),0) INTO v_revenue_today FROM public.payments WHERE created_at::date = v_today;

  SELECT COALESCE(jsonb_agg(to_jsonb(s.*) ORDER BY s.end_date),'[]'::jsonb) INTO v_expiring
    FROM public.subscriptions s
    WHERE s.status='active' AND s.end_date BETWEEN v_today AND v_soon;

  SELECT COUNT(*) INTO v_attendance_today FROM public.bookings WHERE date=v_today AND status='attended';
  SELECT COUNT(*) INTO v_deletion_requests FROM public.profiles WHERE deletion_requested=true;
  SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) INTO v_todays FROM public.schedule_for_date(v_today) t;

  RETURN jsonb_build_object(
    'active_members', v_active_members,
    'pending_approvals', v_pending,
    'new_signups', v_new_signups,
    'revenue_month', v_revenue,
    'revenue_today', v_revenue_today,
    'expiring', v_expiring,
    'todays_classes', v_todays,
    'attendance_today', v_attendance_today,
    'deletion_requests', v_deletion_requests
  );
END;
$$;

-- Create subscription (admin)
CREATE OR REPLACE FUNCTION public.create_subscription(p_user_id uuid, p_plan_id uuid, p_start_date date DEFAULT NULL, p_mark_paid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.plans%ROWTYPE; v_user public.profiles%ROWTYPE;
  v_start date; v_end date; v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF NOT public.current_user_perm('manage_members') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT * INTO v_plan FROM public.plans WHERE id=p_plan_id;
  SELECT * INTO v_user FROM public.profiles WHERE id=p_user_id;
  IF v_plan.id IS NULL OR v_user.id IS NULL THEN RAISE EXCEPTION 'Plan or user not found'; END IF;
  v_start := COALESCE(p_start_date, current_date);
  v_end := v_start + v_plan.duration_days;
  INSERT INTO public.subscriptions(user_id,user_name,plan_id,plan_name,plan_type,price,start_date,end_date,status,sessions_remaining)
  VALUES (p_user_id,v_user.name,v_plan.id,v_plan.name,v_plan.type,v_plan.price,v_start,v_end,'pending_payment',v_plan.sessions)
  RETURNING * INTO v_sub;
  IF p_mark_paid THEN
    RETURN public.mark_subscription_paid(v_sub.id);
  END IF;
  RETURN to_jsonb(v_sub);
END;
$$;

-- Send announcement (insert + fanout notifications)
CREATE OR REPLACE FUNCTION public.send_announcement(p_title text, p_body text, p_audience text, p_class_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_ann public.announcements%ROWTYPE;
  v_count int;
BEGIN
  IF NOT public.current_user_perm('send_announcements') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id=v_uid;
  INSERT INTO public.announcements(title,body,audience,class_id,author)
  VALUES (p_title,p_body,p_audience,p_class_id,v_name) RETURNING * INTO v_ann;

  IF p_audience='class' AND p_class_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,title,body,type)
    SELECT DISTINCT b.user_id, '📣 ' || p_title, p_body, 'announcement'
    FROM public.bookings b
    WHERE b.class_id = p_class_id AND b.user_id IS NOT NULL AND b.status IN ('booked','attended');
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE
    INSERT INTO public.notifications(user_id,title,body,type)
    SELECT p.id, '📣 ' || p_title, p_body, 'announcement'
    FROM public.profiles p WHERE p.role='member' AND p.status='active';
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN to_jsonb(v_ann) || jsonb_build_object('recipients', v_count);
END;
$$;

-- Guest booking (public, no auth)
CREATE OR REPLACE FUNCTION public.guest_book_class(p_class_id uuid, p_date date, p_name text, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class public.classes%ROWTYPE; v_count int; v_is_wait boolean; v_b public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id=p_class_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.bookings WHERE class_id=p_class_id AND date=p_date AND status='booked';
  v_is_wait := v_count >= v_class.capacity;
  INSERT INTO public.bookings(class_id,class_name,date,start_time,room,user_id,user_name,guest_name,guest_email,status)
  VALUES (p_class_id,v_class.name,p_date,v_class.start_time,v_class.room,NULL,p_name,p_name,LOWER(p_email),
          CASE WHEN v_is_wait THEN 'waitlist'::public.booking_status ELSE 'booked'::public.booking_status END)
  RETURNING * INTO v_b;
  PERFORM public.queue_email(LOWER(p_email),'ANAM MMA — Class Booking',
    format('<p>Hi %s,</p><p>%s</p>', p_name,
      CASE WHEN v_is_wait
           THEN format('You''re on the waitlist for %s on %s at %s.', v_class.name, p_date, v_class.start_time)
           ELSE format('You''re booked into %s on %s at %s at ANAM MMA. See you there!', v_class.name, p_date, v_class.start_time)
      END));
  RETURN to_jsonb(v_b);
END;
$$;

GRANT EXECUTE ON FUNCTION public.guest_book_class(uuid,date,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.schedule_for_date(date) TO anon;

-- Check-in (mark attendance)
CREATE OR REPLACE FUNCTION public.checkin_booking(p_booking_id uuid, p_attended boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  IF NOT public.current_user_perm('mark_attendance') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id=auth.uid();
  UPDATE public.bookings SET status=(CASE WHEN p_attended THEN 'attended' ELSE 'booked' END)::public.booking_status,
                              checked_in_by=v_name
   WHERE id=p_booking_id;
  RETURN jsonb_build_object('ok',true);
END;
$$;

-- Public single class info
CREATE OR REPLACE FUNCTION public.public_class_info(p_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_class public.classes%ROWTYPE; v_p public.profiles%ROWTYPE;
  v_dow_today int; v_delta int; v_next date;
BEGIN
  SELECT * INTO v_class FROM public.classes WHERE id=p_class_id AND archived=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Class not found'; END IF;
  SELECT * INTO v_p FROM public.profiles WHERE id=v_class.coach_id;
  v_dow_today := EXTRACT(DOW FROM current_date)::int;
  v_dow_today := CASE v_dow_today WHEN 0 THEN 6 ELSE v_dow_today - 1 END;
  v_delta := ((v_class.day_of_week - v_dow_today) % 7 + 7) % 7;
  v_next := current_date + v_delta;
  RETURN to_jsonb(v_class) || jsonb_build_object(
    'coach', CASE WHEN v_p.id IS NULL THEN NULL ELSE jsonb_build_object('id',v_p.id,'name',v_p.name,'photo',v_p.photo,'bio',v_p.bio) END,
    'next_date', v_next
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_class_info(uuid) TO anon;

-- Request account deletion (GDPR)
CREATE OR REPLACE FUNCTION public.request_deletion()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles SET deletion_requested=true WHERE id=auth.uid();
  RETURN jsonb_build_object('ok',true);
END;
$$;

-- Promote to admin
CREATE OR REPLACE FUNCTION public.promote_to_admin(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_user_role() <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;
  UPDATE public.profiles SET role='admin' WHERE id=p_user_id;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (p_user_id,'Admin access granted','You are now an admin of ANAM MMA.','role');
  RETURN jsonb_build_object('ok',true);
END;
$$;
