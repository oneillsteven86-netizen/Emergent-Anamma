-- =====================================================================
-- ANAM MMA — Admin user-creation RPCs (writes directly to auth.users)
-- =====================================================================

-- Front-desk: create a member (cash-friendly)
CREATE OR REPLACE FUNCTION public.admin_create_member(
  p_name text, p_email text, p_password text, p_phone text DEFAULT '',
  p_plan_id uuid DEFAULT NULL, p_mark_paid boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_temp_pw text;
  v_hash text;
  v_sub jsonb;
  v_email text := LOWER(TRIM(p_email));
BEGIN
  IF NOT public.current_user_perm('manage_members') THEN RAISE EXCEPTION 'Not permitted'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN RAISE EXCEPTION 'Email already registered'; END IF;

  v_temp_pw := COALESCE(NULLIF(p_password,''), 'Anam' || substring(replace(gen_random_uuid()::text,'-','') for 6));
  v_hash := crypt(v_temp_pw, gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', v_email, v_hash,
    now(), jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','member'),
    jsonb_build_object('name', p_name),
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_new_id,
          jsonb_build_object('sub', v_new_id::text, 'email', v_email),
          'email', v_new_id::text, now(), now(), now());

  -- Trigger should have created profile. Patch fields:
  UPDATE public.profiles SET name=p_name, phone=COALESCE(p_phone,''),
         status='active', admin_notes='Added at front desk'
   WHERE id = v_new_id;

  IF p_plan_id IS NOT NULL THEN
    v_sub := public.create_subscription(v_new_id, p_plan_id, NULL, p_mark_paid);
  END IF;

  PERFORM public.queue_email(v_email, 'Welcome to ANAM MMA',
    format('<h2>Welcome to ANAM MMA, %s!</h2><p>Your account is ready. Log in with this email and your password%s.</p>',
      p_name,
      CASE WHEN p_password IS NULL OR p_password='' THEN ' (temporary: ' || v_temp_pw || ')' ELSE '' END
    ));

  RETURN jsonb_build_object(
    'user', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id=v_new_id),
    'temp_password', v_temp_pw,
    'subscription', v_sub
  );
END;
$$;

-- Admin: create a coach
CREATE OR REPLACE FUNCTION public.admin_create_coach(
  p_name text, p_email text, p_password text,
  p_bio text DEFAULT '', p_photo text DEFAULT '',
  p_permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_hash text;
  v_email text := LOWER(TRIM(p_email));
BEGIN
  IF public.current_user_role() <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN RAISE EXCEPTION 'Email already registered'; END IF;

  v_hash := crypt(p_password, gen_salt('bf'));
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', v_email, v_hash,
    now(), jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','coach'),
    jsonb_build_object('name', p_name),
    now(), now(), '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_new_id,
          jsonb_build_object('sub', v_new_id::text, 'email', v_email),
          'email', v_new_id::text, now(), now(), now());

  UPDATE public.profiles SET name=p_name, bio=p_bio, photo=p_photo,
         permissions=p_permissions, role='coach'
   WHERE id = v_new_id;

  RETURN (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id=v_new_id);
END;
$$;

-- Admin: delete user (cascades). Also removes auth.users row.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF public.current_user_role() <> 'admin' THEN RAISE EXCEPTION 'Admin only'; END IF;
  DELETE FROM auth.users WHERE id = p_user_id;
  -- profile cascades via FK
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Public legal text
CREATE OR REPLACE FUNCTION public.legal_waiver()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'version', '1.0',
    'text', E'ANAM MMA LIABILITY WAIVER (v1.0)\n\nI acknowledge that participation in mixed martial arts, boxing, K1, judo and related training at ANAM MMA involves inherent risks of injury. I voluntarily assume all risks associated with training. I release ANAM MMA, its coaches and staff from liability for injuries sustained during normal training activities, except where caused by gross negligence. I confirm I am physically fit to participate and have disclosed any relevant medical conditions. I consent to receive first aid / emergency treatment if required. This waiver is governed by the laws of Ireland.'
  );
$$;
GRANT EXECUTE ON FUNCTION public.legal_waiver() TO anon, authenticated;

-- Payment receipt info
CREATE OR REPLACE FUNCTION public.payment_receipt(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p public.payments%ROWTYPE; v_s public.settings%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF public.current_user_role()='member' AND v_p.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  SELECT * INTO v_s FROM public.settings WHERE id='club';
  RETURN jsonb_build_object(
    'receipt_no', v_p.receipt_no, 'date', v_p.created_at::date::text,
    'member', v_p.user_name, 'plan', v_p.plan_name, 'amount', v_p.amount,
    'method', v_p.method, 'club', 'ANAM MMA', 'club_email', COALESCE(v_s.club_email,'')
  );
END;
$$;
