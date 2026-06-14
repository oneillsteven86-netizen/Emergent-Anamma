-- =====================================================================
-- ANAM MMA — Migration 0007:
--   * Password reset via SendGrid (custom flow)
--   * Promote member → coach
--   * Admin notifications on book / cancel / subscription expiry
--   * Plan-ending-soon (5-day) + plan-ended emails
-- =====================================================================

-- ---------- password_resets table ----------
CREATE TABLE IF NOT EXISTS public.password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pr_user_idx ON public.password_resets(user_id);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
-- No client policies → only SECURITY DEFINER fns reach it.

-- App base URL (used to build the reset link in the email)
INSERT INTO public.app_secrets(key,value) VALUES ('app_base_url','https://anam-management.preview.emergentagent.com')
ON CONFLICT (key) DO NOTHING;

-- Request: generates a token, saves SHA-256 hash, emails it
CREATE OR REPLACE FUNCTION public.request_password_reset(p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  v_email text := LOWER(TRIM(p_email));
  v_uid uuid;
  v_name text;
  v_token text;
  v_hash text;
  v_base text;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
  IF v_uid IS NULL THEN
    -- Don't reveal that the email is unknown; pretend success.
    RETURN jsonb_build_object('ok', true);
  END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = v_uid;
  -- 32 char URL-safe token
  v_token := encode(extensions.gen_random_bytes(24), 'base64');
  v_token := translate(v_token, '+/=', '-_');
  v_hash  := encode(extensions.digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.password_resets(user_id, token_hash, expires_at)
  VALUES (v_uid, v_hash, now() + interval '1 hour');

  SELECT value INTO v_base FROM public.app_secrets WHERE key = 'app_base_url';
  PERFORM public.queue_email(v_email, 'ANAM MMA — Reset your password',
    format(
      '<p>Hi %s,</p><p>We received a request to reset your ANAM MMA password. Tap the link below to set a new one (valid for 1 hour):</p><p><a href="%s/reset?token=%s">Reset my password</a></p><p>If you didn''t request this, you can safely ignore this email.</p>',
      COALESCE(v_name,'there'), v_base, v_token));
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_password_reset(text) TO anon, authenticated;

-- Reset: verifies token, swaps the bcrypt hash on auth.users
CREATE OR REPLACE FUNCTION public.reset_password(p_token text, p_new_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  v_hash text;
  v_pr   public.password_resets%ROWTYPE;
  v_pwhash text;
BEGIN
  IF length(COALESCE(p_new_password,'')) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  SELECT * INTO v_pr FROM public.password_resets WHERE token_hash = v_hash;
  IF NOT FOUND OR v_pr.used_at IS NOT NULL OR v_pr.expires_at < now() THEN
    RAISE EXCEPTION 'Reset link is invalid or has expired. Please request a new one.';
  END IF;
  v_pwhash := extensions.crypt(p_new_password, extensions.gen_salt('bf'));
  UPDATE auth.users SET encrypted_password = v_pwhash, updated_at = now() WHERE id = v_pr.user_id;
  UPDATE public.password_resets SET used_at = now() WHERE id = v_pr.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_password(text,text) TO anon, authenticated;

-- ---------- Promote member → coach (admin only) ----------
CREATE OR REPLACE FUNCTION public.promote_to_coach(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_email text; v_name text;
BEGIN
  IF public.current_user_role() <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;
  UPDATE public.profiles
     SET role = 'coach',
         permissions = COALESCE(permissions,'{}'::jsonb) || jsonb_build_object('mark_attendance', true)
   WHERE id = p_user_id
   RETURNING email,name INTO v_email,v_name;
  -- Mirror into auth.users.app_metadata role so future JWTs reflect coach
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('role','coach')
   WHERE id = p_user_id;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (p_user_id,'Coach access granted',
          'You are now a coach at ANAM MMA. You can manage your classes and attendance.','role');
  IF v_email IS NOT NULL THEN
    PERFORM public.queue_email(v_email,'ANAM MMA — You are now a coach',
      format('<p>Hi %s,</p><p>You''ve been promoted to <b>coach</b> at ANAM MMA. Log in to access coach tools.</p>', v_name));
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Same mirror for promote_to_admin
CREATE OR REPLACE FUNCTION public.promote_to_admin(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF public.current_user_role() <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;
  UPDATE public.profiles SET role='admin' WHERE id=p_user_id;
  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('role','admin')
   WHERE id = p_user_id;
  INSERT INTO public.notifications(user_id,title,body,type)
  VALUES (p_user_id,'Admin access granted','You are now an admin of ANAM MMA.','role');
  RETURN jsonb_build_object('ok',true);
END;
$$;

-- ---------- notify_admins helper ----------
CREATE OR REPLACE FUNCTION public.notify_admins(p_title text, p_body text, p_type text DEFAULT 'admin')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications(user_id,title,body,type)
  SELECT id, p_title, p_body, p_type FROM public.profiles WHERE role='admin' AND status='active';
END;
$$;

-- ---------- book_class: notify admins ----------
CREATE OR REPLACE FUNCTION public.book_class(p_class_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_class public.classes%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_booked_count int; v_is_wait boolean;
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

  IF NOT v_is_wait THEN
    UPDATE public.subscriptions SET sessions_remaining = sessions_remaining - 1
     WHERE user_id = v_uid AND status='active' AND plan_type='class_pack' AND sessions_remaining > 0;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, type) VALUES (
    v_uid,
    CASE WHEN v_is_wait THEN 'Waitlist joined' ELSE 'Booking confirmed' END,
    CASE WHEN v_is_wait
         THEN format('You''re on the waitlist for %s on %s at %s.', v_class.name, p_date, v_class.start_time)
         ELSE format('You''re booked into %s on %s at %s (%s).', v_class.name, p_date, v_class.start_time, v_class.room) END,
    'booking');

  PERFORM public.notify_admins('New booking',
    format('%s booked %s on %s%s.', v_profile.name, v_class.name, p_date,
      CASE WHEN v_is_wait THEN ' (waitlist)' ELSE '' END), 'booking');

  PERFORM public.queue_email(v_profile.email,
    'ANAM MMA — ' || CASE WHEN v_is_wait THEN 'Waitlist joined' ELSE 'Booking confirmed' END,
    format('<p>Hi %s,</p><p>%s</p>', v_profile.name,
      CASE WHEN v_is_wait
           THEN format('You''re on the waitlist for %s on %s at %s.', v_class.name, p_date, v_class.start_time)
           ELSE format('You''re booked into %s on %s at %s.', v_class.name, p_date, v_class.start_time) END));
  RETURN to_jsonb(v_booking);
END;
$$;

-- ---------- cancel_booking: notify admins ----------
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

  PERFORM public.notify_admins('Booking cancelled',
    format('%s cancelled their spot in %s on %s.', v_b.user_name, v_b.class_name, v_b.date), 'booking');

  IF v_b.status = 'booked' THEN
    SELECT * INTO v_promote FROM public.bookings
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
          PERFORM public.queue_email(v_pmail,'ANAM MMA — Waitlist Promotion',
            format('<p>Hi %s, a spot opened in %s on %s at %s. You''re now booked in!</p>',
              v_pname, v_class.name, v_b.date, v_class.start_time));
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------- guest_book_class: notify admins ----------
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
  PERFORM public.notify_admins('Guest booking',
    format('Guest %s (%s) booked %s on %s%s.', p_name, p_email, v_class.name, p_date,
      CASE WHEN v_is_wait THEN ' (waitlist)' ELSE '' END), 'booking');
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

-- ---------- Daily maintenance: 5-day reminder + plan ended + admin notifs ----------
CREATE OR REPLACE FUNCTION public.daily_membership_maintenance()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  -- Expire stale subs + notify member + notify admins
  FOR r IN
    SELECT s.id, s.user_id, s.user_name, s.plan_name, s.end_date, p.email, p.name
      FROM public.subscriptions s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.status IN ('active','frozen') AND s.end_date < current_date
  LOOP
    UPDATE public.subscriptions SET status='expired' WHERE id=r.id;
    INSERT INTO public.notifications(user_id,title,body,type)
    VALUES (r.user_id,'Membership expired',
      format('Your %s membership expired on %s. Renew to keep training.', r.plan_name, r.end_date),'membership');
    PERFORM public.queue_email(r.email,'ANAM MMA — Membership expired',
      format('<p>Hi %s,</p><p>Your <b>%s</b> membership expired on <b>%s</b>. Renew at the club or in-app to keep training.</p>',
        r.name, r.plan_name, r.end_date));
    PERFORM public.notify_admins('Membership expired',
      format('%s''s %s membership expired on %s.', r.user_name, r.plan_name, r.end_date), 'membership');
  END LOOP;

  -- Today: notify admins of expiring TODAY (active subs ending today, before the expire scan above ran they wouldn't be here, so check end_date = current_date AND status='active')
  -- (Run a second pass post-expire for newly expired today + reset reminder for already-active-today)
  FOR r IN
    SELECT s.id, s.user_id, s.user_name, s.plan_name FROM public.subscriptions s
     WHERE s.status='active' AND s.end_date = current_date
  LOOP
    PERFORM public.notify_admins('Membership ending today',
      format('%s''s %s membership ends today.', r.user_name, r.plan_name), 'membership');
  END LOOP;

  -- 5-day reminders (was 7 days previously)
  FOR r IN
    SELECT s.id, s.user_id, s.user_name, s.plan_name, s.end_date, p.email, p.name
      FROM public.subscriptions s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE s.status='active' AND s.reminder_sent=false
       AND s.end_date BETWEEN current_date AND current_date + 5
  LOOP
    UPDATE public.subscriptions SET reminder_sent=true WHERE id=r.id;
    INSERT INTO public.notifications(user_id,title,body,type)
    VALUES (r.user_id,'Membership expiring in 5 days',
      format('Your %s membership ends on %s. Renew soon to avoid interruption.', r.plan_name, r.end_date), 'membership');
    PERFORM public.queue_email(r.email, 'ANAM MMA — Your membership ends in 5 days',
      format('<p>Hi %s,</p><p>Just a heads up — your <b>%s</b> membership ends on <b>%s</b>. Renew at the club or via the app to keep your spot.</p>',
        r.name, r.plan_name, r.end_date));
  END LOOP;
END;
$$;
